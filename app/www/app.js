'use strict';
// Ma Vie : tâches, routines, objectifs et bilan, organisés par domaines de vie que l'utilisateur définit.
// Données sur l'appareil (localStorage) + sauvegarde automatique. Alertes via le système Android (window.Native).

const KEY = 'mavie-v4';
const NATIVE = !!(window.Native && window.Native.isNative);
const SNOOZE_BASE = 900000; // identifiants des alertes reportées (conservées lors de la reprogrammation)
const COLORS = ['#e8735a', '#4f6bed', '#e0a83c', '#d9669b', '#2fa58b', '#8b6cd9', '#7b8794'];
const DAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TYPES = { weekly: 'Certains jours de la semaine', daily: 'Tous les jours', monthly: 'Une fois par mois', once: 'Une seule fois', yearly: 'Chaque année (date importante)' };
const NO_DOMAIN = { id: '', name: 'Sans domaine', color: '#9aa3b2', private: false };

const ICONS = {
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  tasks: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/></svg>',
  routines: '<svg viewBox="0 0 24 24"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  goals: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  review: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  bell: '<svg viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  star: '<svg viewBox="0 0 24 24" style="width:16px;height:16px"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
};
const NAV = [['today', "Aujourd'hui"], ['tasks', 'Tâches'], ['routines', 'Routines'], ['goals', 'Objectifs'], ['review', 'Bilan']];

let S;
const ui = { tab: 'today', day: null, filter: 'all', showDone: false };
let unlocked = false, pinFails = 0, pinBlockedUntil = 0;
let alertState = { perm: NATIVE ? 'inconnu' : 'web', exact: null, count: 0, error: '' };

// ---------- Outils ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ds = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ds(new Date());
const parse = s => new Date(s + 'T12:00');
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ds(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const longDate = s => cap(parse(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
const shortDate = s => parse(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dayMonth = s => parse(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const monthYear = s => parse(s).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const fmtNum = n => (Math.round(n * 10) / 10).toLocaleString('fr-FR');
const opts = (pairs, sel) => pairs.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
function weekStart(s = today()) { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ds(d); }
const inWeek = (s, wk = weekStart()) => !!s && weekStart(s) === wk;
const relDay = s => { const n = daysBetween(today(), s); return n === 0 ? "Aujourd'hui" : n === 1 ? 'Demain' : n === -1 ? 'Hier' : shortDate(s); };

// ---------- Domaines & confidentialité ----------
const dom = id => S.domains.find(d => d.id === id) || NO_DOMAIN;
const hidden = id => !!S.pin && !unlocked && dom(id).private;
const anyHidden = () => !!S.pin && !unlocked && S.domains.some(d => d.private);
const label = (domainId, text) => (hidden(domainId) ? 'Élément privé' : text);
const domMeta = id => { const d = dom(id); return `<span><span class="dot" style="background:${d.color}"></span>${esc(d.name)}</span>`; };
async function hashPin(pin, salt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const checkPin = async pin => !!S.pin && (await hashPin(pin, S.pin.salt)) === S.pin.hash;

// ---------- Routines : occurrences, coches, régularité ----------
function occursOn(r, s) {
  if (r.created && s < r.created && r.type !== 'once' && r.type !== 'yearly') return false;
  if (r.type === 'daily') return true;
  if (r.type === 'weekly') return r.days.includes(parse(s).getDay());
  if (r.type === 'monthly') return +s.slice(8) === +r.day;
  if (r.type === 'once') return r.date === s;
  if (r.type === 'yearly') return !!r.date && r.date.slice(5) === s.slice(5);
  return false;
}
function nextYearly(mmdd) { const y = new Date().getFullYear(), s = `${y}-${mmdd}`; return s < today() ? `${y + 1}-${mmdd}` : s; }
const check = (s, id) => (S.checks[s] || {})[id];
function setCheck(r, s, val) {
  const c = (S.checks[s] ||= {});
  if (c[r.id] === val) delete c[r.id]; else c[r.id] = val;
}
// Une routine compte comme « prévue » une fois son heure passée (ou dès qu'elle est cochée).
function isDue(r, s) {
  if (s < today()) return true;
  if (s > today()) return false;
  return !!check(s, r.id) || !r.time || new Date(`${s}T${r.time}`) <= new Date();
}
function adherence(filter, from, to) {
  let planned = 0, done = 0;
  for (let s = from; s <= to && s <= today(); s = addDays(s, 1)) {
    for (const r of S.routines) {
      if (!r.track || !filter(r) || !occursOn(r, s) || !isDue(r, s)) continue;
      planned++;
      if (check(s, r.id) === 'done') done++;
    }
  }
  return { planned, done, pct: pct(done, planned) };
}
function whenText(r) {
  return r.type === 'daily' ? 'Tous les jours'
    : r.type === 'weekly' ? (r.days.length === 7 ? 'Tous les jours' : WEEK_ORDER.filter(d => r.days.includes(d)).map(d => DAYS_SHORT[d]).join(' · '))
    : r.type === 'monthly' ? `Le ${r.day} du mois`
    : r.type === 'once' ? shortDate(r.date) : `Chaque ${dayMonth(r.date)}`;
}

// ---------- Objectifs chiffrés ----------
function goalStats(g) {
  const e = [...g.entries].sort((a, b) => a.date.localeCompare(b.date));
  const now = e.length ? e[e.length - 1].value : g.start;
  const total = g.target - g.start, done = now - g.start;
  const progress = total ? Math.max(0, Math.min(1, done / total)) : 1;
  // Tendance par semaine (régression linéaire sur les 6 dernières semaines)
  const w = e.filter(x => daysBetween(x.date, today()) <= 42);
  let trend = null;
  if (w.length >= 2 && daysBetween(w[0].date, w[w.length - 1].date) >= 7) {
    const xs = w.map(x => daysBetween(w[0].date, x.date)), ys = w.map(x => x.value);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    if (den) trend = (xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den) * 7;
  }
  const left = g.target - now;
  let eta = null;
  if (trend && Math.sign(trend) === Math.sign(left) && left !== 0) eta = addDays(today(), Math.round((left / trend) * 7));
  const weeksLeft = g.deadline ? Math.max(1, daysBetween(today(), g.deadline) / 7) : null;
  return { e, now, progress, trend, eta, left, needed: weeksLeft ? left / weeksLeft : null, reached: total ? Math.sign(left) !== Math.sign(total) || left === 0 : true };
}

// ---------- Données ----------
function seed() {
  const D = (name, color, priv = false) => ({ id: uid(), name, color, private: priv });
  return {
    version: 4,
    domains: [D('Santé & sport', COLORS[0]), D('Travail', COLORS[1]), D('Projets', COLORS[2]), D('Couple & famille', COLORS[3], true), D('Maison & admin', COLORS[6])],
    tasks: [], routines: [], checks: {}, goals: [], reviews: [],
    pin: null, backup: { last: '', where: '', error: '' },
  };
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.version === 4) return s; } catch (e) { /* illisible : on repart de zéro */ }
  const s = seed();
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
let syncTimer;
function save() {
  localStorage.setItem(KEY, JSON.stringify(S));
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncAlerts, 600);
}

// ---------- Alertes Android ----------
function buildNotifications() {
  const out = [], now = new Date();
  let id = 1;
  const add = (title, body, schedule, extra) => out.push({ id: id++, title, body, schedule: { ...schedule, allowWhileIdle: true }, actionTypeId: 'MAVIE', extra });
  const secret = d => dom(d).private && S.pin && S.pin.hideNotif;
  for (const r of S.routines) {
    if (!r.alert || !r.time) continue;
    const [h, m] = r.time.split(':').map(Number);
    const title = secret(r.domain) ? 'Rappel privé' : r.title;
    const body = secret(r.domain) ? 'Ouvre Ma Vie pour voir le détail' : r.note || dom(r.domain).name;
    const extra = { kind: 'r', id: r.id };
    if (r.type === 'daily') add(title, body, { on: { hour: h, minute: m } }, extra);
    else if (r.type === 'weekly') r.days.forEach(d => add(title, body, { on: { weekday: d + 1, hour: h, minute: m } }, extra));
    else if (r.type === 'monthly') add(title, body, { on: { day: +r.day, hour: h, minute: m } }, extra);
    else if (r.type === 'once') { const at = new Date(`${r.date}T${r.time}`); if (at > now) add(title, body, { at }, extra); }
    else if (r.type === 'yearly' && r.date) {
      // Prochaine occurrence + préavis ; reprogrammé à chaque ouverture, donc renouvelé chaque année.
      let s = nextYearly(r.date.slice(5));
      if (new Date(`${s}T${r.time}`) <= now) s = `${+s.slice(0, 4) + 1}${s.slice(4)}`;
      add(title, body, { at: new Date(`${s}T${r.time}`) }, extra);
      if (r.before > 0) {
        const pre = new Date(`${addDays(s, -r.before)}T${r.time}`);
        if (pre > now) add(`${title} dans ${r.before} jours`, 'Pense à préparer quelque chose.', { at: pre }, { kind: 'info' });
      }
    }
  }
  for (const t of S.tasks) {
    if (t.done || !t.alert || !t.due) continue;
    const at = new Date(`${t.due}T${t.time || '09:00'}`);
    if (at > now) add(secret(t.domain) ? 'Tâche privée' : t.title, 'Tâche prévue maintenant', { at }, { kind: 't', id: t.id });
  }
  return out;
}
async function refreshAlertState() {
  if (!NATIVE) return;
  const LN = Native.LocalNotifications;
  alertState.perm = (await LN.checkPermissions()).display;
  try { alertState.exact = (await LN.checkExactNotificationSetting()).exact_alarm; } catch (e) { alertState.exact = 'granted'; }
}
async function syncAlerts() {
  if (!NATIVE) return;
  const LN = Native.LocalNotifications;
  try {
    await refreshAlertState();
    if (alertState.perm !== 'granted') return;
    const pending = await LN.getPending();
    const old = pending.notifications.filter(n => n.id < SNOOZE_BASE);
    if (old.length) await LN.cancel({ notifications: old.map(n => ({ id: n.id })) });
    const list = buildNotifications();
    list.forEach(n => { n.isExactNotification = alertState.exact === 'granted'; });
    if (list.length) await LN.schedule({ notifications: list });
    alertState.count = list.length;
    alertState.error = '';
  } catch (e) { alertState.error = String(e && e.message || e); }
}
async function enableAlerts() {
  const LN = Native.LocalNotifications;
  await LN.requestPermissions();
  await refreshAlertState();
  if (alertState.perm === 'granted' && alertState.exact !== 'granted') {
    try { await LN.changeExactNotificationSetting(); } catch (e) { /* Android < 12 */ }
  }
  await syncAlerts();
  render();
}
async function setupNotificationActions() {
  const LN = Native.LocalNotifications;
  await LN.registerActionTypes({ types: [{ id: 'MAVIE', actions: [{ id: 'done', title: '✓ Fait' }, { id: 'snooze', title: 'Dans 30 min' }] }] });
  await LN.addListener('localNotificationActionPerformed', ({ actionId, notification }) => {
    const x = notification.extra || {};
    if (actionId === 'snooze') {
      LN.schedule({ notifications: [{ id: SNOOZE_BASE + Math.floor(Math.random() * 90000), title: notification.title, body: notification.body,
        schedule: { at: new Date(Date.now() + 30 * 60000), allowWhileIdle: true }, actionTypeId: 'MAVIE', extra: x }] });
      return;
    }
    if (actionId === 'done') {
      if (x.kind === 'r') { const r = S.routines.find(y => y.id === x.id); if (r && check(today(), r.id) !== 'done') setCheck(r, today(), 'done'); }
      if (x.kind === 't') { const t = S.tasks.find(y => y.id === x.id); if (t) { t.done = true; t.doneAt = today(); } }
      save();
    }
    ui.tab = 'today'; ui.day = null;
    render();
  });
}

// ---------- Sauvegarde automatique (une fois par jour) ----------
async function autoBackup(force) {
  if (!NATIVE || (!force && S.backup.last === today())) return;
  const FS = Native.Filesystem, data = JSON.stringify(S);
  try {
    // Documents/MaVie : conservé même si l'application est désinstallée.
    await FS.writeFile({ path: `MaVie/sauvegarde-${today()}.json`, data, directory: Native.Directory.Documents, encoding: Native.Encoding.UTF8, recursive: true });
    S.backup = { last: today(), where: 'Documents/MaVie', error: '' };
    try {
      const { files } = await FS.readdir({ path: 'MaVie', directory: Native.Directory.Documents });
      const old = files.map(f => f.name).filter(n => /^sauvegarde-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().slice(0, -14);
      for (const n of old) await FS.deleteFile({ path: `MaVie/${n}`, directory: Native.Directory.Documents }).catch(() => {});
    } catch (e) { /* nettoyage facultatif */ }
  } catch (e) {
    try {
      await FS.writeFile({ path: 'sauvegarde-auto.json', data, directory: Native.Directory.Data, encoding: Native.Encoding.UTF8 });
      S.backup = { last: today(), where: "Dossier interne de l'application", error: String(e && e.message || e) };
    } catch (e2) { S.backup = { ...S.backup, error: String(e2 && e2.message || e2) }; }
  }
  localStorage.setItem(KEY, JSON.stringify(S));
}

// ---------- Morceaux d'interface ----------
const tick = (on, action, attrs, skip) => `<button class="tick ${on ? 'on' : skip ? 'skip' : ''}" data-a="${action}" ${attrs} aria-label="Fait">${on ? ICONS.check : skip ? '–' : ''}</button>`;
function header(title, eyebrow, extra = '') {
  return `<div class="top"><div class="titles">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1></div>${extra}
    <button class="iconbtn" data-a="tab" data-tab="settings" aria-label="Réglages">${ICONS.settings}</button></div>`;
}
function lockNotice() {
  if (!anyHidden()) return '';
  return `<div class="notice">${ICONS.lock}<span>Les éléments privés sont masqués.</span><button class="btn small" data-a="unlock">Déverrouiller</button></div>`;
}
function taskItem(t) {
  const priv = hidden(t.domain), late = !t.done && t.due && t.due < today();
  const when = t.due ? `<span class="${late ? 'late' : ''}">${relDay(t.due)}${t.time ? ` · ${t.time}` : ''}</span>` : '';
  return `<div class="item ${t.done ? 'done' : ''}">
    ${tick(t.done, 'task-done', `data-id="${t.id}"`)}
    <div class="body" data-a="${priv ? 'unlock' : 'task-edit'}" data-id="${t.id}">
      <span class="title">${esc(label(t.domain, t.title))}</span>
      <span class="meta">${domMeta(t.domain)}${when}${t.alert && t.due && !t.done ? ICONS.bell : ''}${t.star && !t.done ? ICONS.star : ''}</span>
    </div></div>`;
}
function routineItem(r, s) {
  const priv = hidden(r.domain), c = check(s, r.id), canCheck = r.track && s <= today();
  return `<div class="item ${c === 'done' ? 'done' : ''}">
    ${canCheck ? tick(c === 'done', 'check', `data-id="${r.id}" data-d="${s}" data-v="done"`, c === 'skip') : `<span class="time">${esc(r.time || '')}</span>`}
    <div class="body" data-a="${priv ? 'unlock' : 'routine-edit'}" data-id="${r.id}">
      <span class="title">${esc(label(r.domain, r.title))}</span>
      <span class="meta">${canCheck && r.time ? `<span>${r.time}</span>` : ''}${domMeta(r.domain)}${r.alert && r.time ? ICONS.bell : ''}</span>
    </div>
    ${canCheck && c !== 'done' ? `<button class="skipbtn" data-a="check" data-id="${r.id}" data-d="${s}" data-v="skip">${c === 'skip' ? 'Annuler' : 'Pas fait'}</button>` : ''}
  </div>`;
}
const list = items => `<div class="list">${items.join('')}</div>`;
const empty = text => `<div class="empty">${text}</div>`;
function lineChart(points, target) {
  if (points.length < 2) return '';
  const W = 600, H = 140, pad = 16;
  const vals = points.map(p => p.value).concat(target), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = i => pad + (i * (W - 2 * pad)) / (points.length - 1), y = v => H - pad - ((v - min) * (H - 2 * pad)) / span;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line x1="${pad}" x2="${W - pad}" y1="${y(target)}" y2="${y(target)}" stroke="var(--ok)" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/>
    <path d="${points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}" stroke="var(--accent)" stroke-width="3" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

// ---------- Écrans ----------
function vToday() {
  const s = ui.day || today(), isToday = s === today();
  const routines = S.routines.filter(r => occursOn(r, s)).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  const tasks = S.tasks.filter(t => (t.due === s) || (isToday && !t.done && ((t.due && t.due < s) || t.star)))
    .sort((a, b) => a.done - b.done || (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '99').localeCompare(b.time || '99'));
  const doneR = routines.filter(r => r.track && check(s, r.id) === 'done').length, totR = routines.filter(r => r.track).length;
  const doneT = tasks.filter(t => t.done).length, total = totR + tasks.length, done = doneR + doneT;
  const C = 2 * Math.PI * 28, frac = total ? done / total : 0;
  const nav = `<div class="daynav"><button class="iconbtn" data-a="day" data-n="-1" aria-label="Jour précédent">${ICONS.left}</button>
    <button class="iconbtn" data-a="day" data-n="1" aria-label="Jour suivant">${ICONS.right}</button></div>`;
  return `${header(isToday ? "Aujourd'hui" : relDay(s), longDate(s), nav)}
    ${lockNotice()}
    ${!isToday ? `<div class="notice"><span>Tu regardes un autre jour.</span><button class="btn small ghost" data-a="day-today">Revenir à aujourd'hui</button></div>` : ''}
    ${total ? `<div class="summary"><svg class="ring" viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="28"/><circle class="fg" cx="32" cy="32" r="28" stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}"/></svg>
      <div><div class="big">${done} / ${total}</div><div class="muted small">${done === total ? 'Tout est fait. Bravo !' : 'fait' + (done > 1 ? 's' : '') + (isToday ? " aujourd'hui" : '')}</div></div></div>` : ''}
    <h2>Routines</h2>
    ${routines.length ? list(routines.map(r => routineItem(r, s))) : empty('Aucune routine ce jour-là. Ajoute-les dans l’onglet Routines.')}
    <h2>Tâches</h2>
    ${tasks.length ? list(tasks.map(taskItem)) : empty(isToday ? 'Aucune tâche pour aujourd’hui. Touche + pour en ajouter une.' : 'Aucune tâche ce jour-là.')}`;
}

function vTasks() {
  const t0 = today(), f = ui.filter;
  const domainsUsed = S.domains.concat(S.tasks.some(t => !t.domain) ? [NO_DOMAIN] : []);
  const mine = S.tasks.filter(t => f === 'all' || t.domain === (f === '-' ? '' : f));
  const open = mine.filter(t => !t.done);
  const groups = [
    ['En retard', open.filter(t => t.due && t.due < t0)],
    ["Aujourd'hui", open.filter(t => t.due === t0)],
    ['Demain', open.filter(t => t.due === addDays(t0, 1))],
    ['Plus tard', open.filter(t => t.due && t.due > addDays(t0, 1))],
    ['Sans date', open.filter(t => !t.due)],
  ];
  const sorter = (a, b) => (a.due || '').localeCompare(b.due || '') || (b.star - a.star) || (a.time || '99').localeCompare(b.time || '99');
  const done = mine.filter(t => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  return `${header('Tâches', `${open.length} à faire`)}
    ${lockNotice()}
    <div class="chips"><button class="chip ${f === 'all' ? 'on' : ''}" data-a="filter" data-f="all">Toutes</button>
      ${domainsUsed.map(d => `<button class="chip ${f === (d.id || '-') ? 'on' : ''}" data-a="filter" data-f="${d.id || '-'}"><span class="dot" style="background:${d.color}"></span>${esc(d.name)}</button>`).join('')}</div>
    <div class="seg"><button class="${ui.showDone ? '' : 'on'}" data-a="show-done" data-v="0">À faire</button><button class="${ui.showDone ? 'on' : ''}" data-a="show-done" data-v="1">Faites (${done.length})</button></div>
    ${ui.showDone
      ? (done.length ? list(done.slice(0, 60).map(taskItem)) : empty('Aucune tâche terminée.'))
      : (open.length ? groups.filter(([, l]) => l.length).map(([n, l]) => `<h2>${n}</h2>${list(l.sort(sorter).map(taskItem))}`).join('')
        : empty('Aucune tâche. Touche + pour en ajouter une.'))}`;
}

function vRoutines() {
  const from = addDays(today(), -27);
  const byDomain = S.domains.concat(NO_DOMAIN).map(d => [d, S.routines.filter(r => (r.domain || '') === d.id)]).filter(([, l]) => l.length);
  const all = adherence(() => true, from, today());
  return `${header('Routines', all.planned ? `Régularité sur 4 semaines : ${all.pct} %` : 'Ce qui revient régulièrement')}
    ${lockNotice()}
    ${byDomain.length ? byDomain.map(([d, l]) => `<h2><span class="dot" style="background:${d.color}"></span>${esc(d.name)}</h2>
      ${list(l.sort((a, b) => (a.time || '99').localeCompare(b.time || '99')).map(r => {
        const priv = hidden(r.domain), a = r.track ? adherence(x => x.id === r.id, from, today()) : null;
        return `<div class="item"><span class="time">${esc(r.time || '—')}</span>
          <div class="body" data-a="${priv ? 'unlock' : 'routine-edit'}" data-id="${r.id}"><span class="title">${esc(label(r.domain, r.title))}</span>
            <span class="meta"><span>${esc(whenText(r))}</span>${r.alert && r.time ? ICONS.bell : ''}</span></div>
          ${a && a.planned ? `<span class="side">${a.pct} %</span>` : ''}</div>`;
      }))}`).join('')
      : empty('Une routine, c’est ce qui revient : sport le lundi, appeler tes parents le dimanche, payer le loyer le 5… Touche + pour en créer une.')}`;
}

function vGoals() {
  return `${header('Objectifs', 'Ce que tu veux atteindre, en chiffres')}
    ${lockNotice()}
    ${S.goals.length ? S.goals.map(g => {
      if (hidden(g.domain)) return `<div class="card click" data-a="unlock"><h3>Objectif privé</h3><p class="muted small">${domMeta(g.domain)}</p></div>`;
      const x = goalStats(g);
      return `<div class="card click" data-a="goal-open" data-id="${g.id}">
        <div class="row"><h3 class="grow">${esc(g.title)}</h3><span class="muted small">${Math.round(x.progress * 100)} %</span></div>
        <p class="muted small">${domMeta(g.domain)}</p>
        <div class="row" style="margin-top:8px"><span class="big">${fmtNum(x.now)} ${esc(g.unit)}</span><span class="muted">→ ${fmtNum(g.target)} ${esc(g.unit)}${g.deadline ? ` · ${monthYear(g.deadline)}` : ''}</span></div>
        <div class="bar"><div style="width:${Math.round(x.progress * 100)}%"></div></div>
        <p class="muted small">${x.reached ? 'Objectif atteint 🎉' : x.eta ? `À ce rythme : atteint vers ${monthYear(x.eta)}` : 'Ajoute des valeurs régulièrement pour voir ta tendance.'}</p>
      </div>`;
    }).join('') : empty('Un objectif se mesure : poids, épargne, heures de formation, revenus… Touche + pour en créer un.')}`;
}

function vReview() {
  const wk = weekStart(), end = addDays(wk, 6);
  const cur = S.reviews.find(r => r.week === wk) || {};
  const all = adherence(() => true, wk, end);
  const doms = S.domains.concat(NO_DOMAIN).map(d => [d, adherence(r => (r.domain || '') === d.id, wk, end)]).filter(([, a]) => a.planned);
  const tasksDone = S.tasks.filter(t => t.done && inWeek(t.doneAt, wk)).length;
  const moved = S.goals.filter(g => !hidden(g.domain)).map(g => {
    const e = [...g.entries].sort((a, b) => a.date.localeCompare(b.date));
    const before = [...e].reverse().find(x => x.date < wk), last = e.length ? e[e.length - 1] : null;
    return last && inWeek(last.date, wk) ? `${esc(g.title)} : ${fmtNum(before ? before.value : g.start)} → ${fmtNum(last.value)} ${esc(g.unit)}` : null;
  }).filter(Boolean);
  const past = [...S.reviews].filter(r => r.week !== wk).sort((a, b) => b.week.localeCompare(a.week));
  return `${header('Bilan', `Semaine du ${dayMonth(wk)}`)}
    <div class="card"><div class="row"><div class="grow"><div class="big">${all.planned ? all.pct + ' %' : '—'}</div><div class="muted small">de tes routines faites cette semaine</div></div>
      <div><div class="big">${tasksDone}</div><div class="muted small">tâche${tasksDone > 1 ? 's' : ''} terminée${tasksDone > 1 ? 's' : ''}</div></div></div>
      ${doms.map(([d, a]) => `<div style="margin-top:12px"><div class="row small"><span class="grow"><span class="dot" style="background:${d.color}"></span>${esc(d.name)}</span><span class="muted">${a.done}/${a.planned}</span></div>
        <div class="bar"><div style="width:${a.pct}%;background:${d.color}"></div></div></div>`).join('')}
      ${moved.length ? `<p class="small" style="margin-top:12px">${moved.join('<br>')}</p>` : ''}
    </div>
    <h2>Mon bilan</h2>
    <form class="card f" data-f="review">
      <label>Ce qui s'est bien passé<textarea name="wins" rows="2">${esc(cur.wins)}</textarea></label>
      <label>Ce qui a coincé<textarea name="blockers" rows="2">${esc(cur.blockers)}</textarea></label>
      <label>Mes priorités pour la semaine prochaine<textarea name="next" rows="2">${esc(cur.next)}</textarea></label>
      <div class="btns"><button class="btn">Enregistrer</button></div>
    </form>
    ${past.length ? `<h2>Semaines précédentes</h2>${past.slice(0, 12).map(r => `<div class="card"><b>Semaine du ${dayMonth(r.week)}</b>
      ${r.wins ? `<p class="small">✓ ${esc(r.wins)}</p>` : ''}${r.blockers ? `<p class="small muted">✗ ${esc(r.blockers)}</p>` : ''}${r.next ? `<p class="small">→ ${esc(r.next)}</p>` : ''}</div>`).join('')}` : ''}`;
}

function vSettings() {
  const st = alertState;
  return `<div class="top"><div class="titles"><h1>Réglages</h1></div><button class="btn ghost small" data-a="tab" data-tab="today">Fermer</button></div>
    <h2>Mes domaines de vie</h2>
    ${list(S.domains.map(d => `<div class="item"><span class="dot" style="background:${d.color};width:14px;height:14px"></span>
      <div class="body" data-a="domain-edit" data-id="${d.id}"><span class="title">${esc(d.name)}</span>
        <span class="meta">${d.private ? '<span>Privé (protégé par le code)</span>' : ''}<span>${S.tasks.filter(t => t.domain === d.id && !t.done).length} tâches · ${S.routines.filter(r => r.domain === d.id).length} routines</span></span></div></div>`))}
    <div class="btns"><button class="btn ghost" data-a="domain-new">Ajouter un domaine</button></div>

    <h2>Alertes</h2>
    <div class="card">
      ${NATIVE ? `<p>Notifications : <b>${st.perm === 'granted' ? 'autorisées' : 'non autorisées'}</b> · Heure exacte : <b>${st.exact === 'granted' ? 'oui' : 'non'}</b> · ${st.count} programmée(s)</p>
        ${st.error ? `<p class="late small">${esc(st.error)}</p>` : ''}
        <div class="btns"><button class="btn" data-a="alerts-enable">Autoriser les alertes</button><button class="btn ghost" data-a="alerts-test">Tester dans 10 s</button></div>
        <p class="muted small">Chaque alerte propose « ✓ Fait » et « Dans 30 min ». Si elles n'arrivent pas : Paramètres Android → Applications → Ma Vie → Batterie → « Sans restriction ».</p>`
        : '<p class="muted">Les alertes fonctionnent dans l’application Android installée.</p>'}
    </div>

    <h2>Code PIN</h2>
    <div class="card">
      ${S.pin ? `<p>Code actif. Il protège les domaines marqués « privé ». Ils se reverrouillent quand l'application passe en arrière-plan.</p>
        <label class="row" style="margin:8px 0"><input type="checkbox" data-c="pin-notif" ${S.pin.hideNotif ? 'checked' : ''}> Masquer aussi le texte des alertes privées</label>
        <div class="btns">${unlocked ? '<button class="btn ghost" data-a="lock">Verrouiller maintenant</button>' : ''}<button class="btn ghost" data-a="pin-change">Changer le code</button><button class="btn danger" data-a="pin-remove">Retirer le code</button></div>`
        : `<p class="muted">Protège les domaines marqués « privé » : ils seront masqués partout tant que tu n'as pas tapé ton code.</p>
        <div class="btns"><button class="btn" data-a="pin-set">Créer un code</button></div>`}
      <p class="muted small">Ce n'est pas un chiffrement : les sauvegardes contiennent tes données en clair.</p>
    </div>

    <h2>Sauvegarde</h2>
    <div class="card">
      ${NATIVE ? `<p>Dernière sauvegarde automatique : <b>${S.backup.last ? `${shortDate(S.backup.last)} (${esc(S.backup.where)})` : 'pas encore faite'}</b></p>
        <p class="muted small">Une copie par jour dans Documents/MaVie (14 jours gardés). Pour restaurer : Importer, puis choisir le fichier.</p>` : ''}
      <div class="btns">${NATIVE ? '<button class="btn ghost" data-a="backup-now">Sauvegarder maintenant</button>' : ''}
        <button class="btn ghost" data-a="export">Exporter</button>
        <label class="btn ghost">Importer<input type="file" accept=".json,application/json" data-c="import" hidden></label></div>
    </div>
    <div class="btns" style="margin-top:20px"><button class="btn danger" data-a="reset">Tout effacer</button></div>`;
}

const VIEWS = { today: vToday, tasks: vTasks, routines: vRoutines, goals: vGoals, review: vReview, settings: vSettings };
function render() {
  document.getElementById('nav').innerHTML = NAV.map(([k, l]) => `<button data-a="tab" data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${ICONS[k]}<span>${l}</span></button>`).join('');
  document.getElementById('fab').hidden = ui.tab === 'review' || ui.tab === 'settings';
  document.getElementById('main').innerHTML = VIEWS[ui.tab]();
}

// ---------- Panneau (formulaires) ----------
const sheetEl = () => document.getElementById('sheet');
function openSheet(title, body) {
  sheetEl().innerHTML = `<div class="sheet"><div class="grab"></div><h3>${title}</h3>${body}</div>`;
  if (!sheetEl().open) sheetEl().showModal();
  const first = sheetEl().querySelector('input:not([type=hidden]):not([type=checkbox]), textarea');
  if (first && !first.value) first.focus();
  return false;
}
const closeSheet = () => { if (sheetEl().open) sheetEl().close(); };
const domainSelect = sel => `<label>Domaine<select name="domain">${opts([['', 'Sans domaine']].concat(S.domains.filter(d => !hidden(d.id)).map(d => [d.id, d.name])), sel)}</select></label>`;
function taskForm(t) {
  const n = !t.id;
  return `<form class="f" data-f="task" ${t.id ? `data-id="${t.id}"` : ''}>
    <input class="titlein" name="title" placeholder="Que faut-il faire ?" value="${esc(t.title)}" required>
    ${domainSelect(t.domain)}
    <div class="two"><label>Date<input type="date" name="due" value="${esc(t.due)}"></label><label>Heure<input type="time" name="time" value="${esc(t.time)}"></label></div>
    <label class="check"><input type="checkbox" name="alert" ${t.alert || n ? 'checked' : ''}> Alerte (à 9 h si pas d'heure)</label>
    <label class="check"><input type="checkbox" name="star" ${t.star ? 'checked' : ''}> Prioritaire (affichée aujourd'hui)</label>
    <label>Notes<textarea name="notes" rows="2">${esc(t.notes)}</textarea></label>
    <div class="btns"><button class="btn">${n ? 'Ajouter' : 'Enregistrer'}</button>${n ? '' : `<button type="button" class="btn danger" data-a="task-del" data-id="${t.id}">Supprimer</button>`}</div>
  </form>`;
}
function routineForm(r) {
  const n = !r.id, v = { type: 'weekly', time: '', days: [], day: 1, date: '', before: 7, alert: true, track: true, note: '', ...r };
  return `<form class="f rf" data-f="routine" data-type="${v.type}" ${r.id ? `data-id="${r.id}"` : ''}>
    <input class="titlein" name="title" placeholder="Ex. : sport, appeler mes parents…" value="${esc(v.title)}" required>
    ${domainSelect(v.domain)}
    <label>Fréquence<select name="type" data-c="rtype">${opts(Object.entries(TYPES), v.type)}</select></label>
    <div class="daypick x-days">${WEEK_ORDER.map(d => `<label><input type="checkbox" name="days" value="${d}" ${v.days.includes(d) ? 'checked' : ''}><span>${DAYS_SHORT[d]}</span></label>`).join('')}</div>
    <label class="x-day">Jour du mois<input type="number" name="day" min="1" max="28" value="${v.day}"></label>
    <label class="x-date">Date<input type="date" name="date" value="${esc(v.date)}"></label>
    <label class="x-before">Me prévenir aussi (jours avant)<input type="number" name="before" min="0" max="60" value="${v.before}"></label>
    <label>Heure<input type="time" name="time" value="${esc(v.time)}"></label>
    <label class="check"><input type="checkbox" name="alert" ${v.alert ? 'checked' : ''}> Alerte à cette heure</label>
    <label class="check"><input type="checkbox" name="track" ${v.track ? 'checked' : ''}> À cocher (compte dans ma régularité)</label>
    <div class="btns"><button class="btn">${n ? 'Ajouter' : 'Enregistrer'}</button>${n ? '' : `<button type="button" class="btn danger" data-a="routine-del" data-id="${r.id}">Supprimer</button>`}</div>
  </form>`;
}
function goalForm(g) {
  const n = !g.id;
  return `<form class="f" data-f="goal" ${g.id ? `data-id="${g.id}"` : ''}>
    <input class="titlein" name="title" placeholder="Ex. : Poids, Épargne, Heures de formation" value="${esc(g.title)}" required>
    ${domainSelect(g.domain)}
    <div class="three"><label>Départ<input type="number" step="any" name="start" value="${g.start ?? ''}" required></label>
      <label>Cible<input type="number" step="any" name="target" value="${g.target ?? ''}" required></label>
      <label>Unité<input name="unit" placeholder="kg, €, h…" value="${esc(g.unit)}"></label></div>
    <label>Pour le (facultatif)<input type="date" name="deadline" value="${esc(g.deadline)}"></label>
    <div class="btns"><button class="btn">${n ? 'Créer' : 'Enregistrer'}</button>${n ? '' : `<button type="button" class="btn danger" data-a="goal-del" data-id="${g.id}">Supprimer</button>`}</div>
  </form>`;
}
function goalSheet(g) {
  const x = goalStats(g);
  const speed = x.trend !== null ? `${x.trend > 0 ? '+' : ''}${fmtNum(x.trend)} ${esc(g.unit)}/semaine` : '—';
  return openSheet(esc(g.title), `
    <div class="row"><span class="big">${fmtNum(x.now)} ${esc(g.unit)}</span><span class="muted">objectif ${fmtNum(g.target)} ${esc(g.unit)}</span></div>
    <div class="bar"><div style="width:${Math.round(x.progress * 100)}%"></div></div>
    ${lineChart(x.e, g.target)}
    <p class="small">Tendance : <b>${speed}</b>${x.eta ? ` · atteint vers <b>${monthYear(x.eta)}</b>` : ''}</p>
    ${x.needed !== null && !x.reached ? `<p class="small muted">Pour tenir la date (${shortDate(g.deadline)}) : ${x.needed > 0 ? '+' : ''}${fmtNum(x.needed)} ${esc(g.unit)}/semaine.</p>` : ''}
    <form class="f" data-f="entry" data-id="${g.id}" style="margin-top:12px">
      <div class="two"><label>Nouvelle valeur<input type="number" step="any" name="value" required></label><label>Date<input type="date" name="date" value="${today()}"></label></div>
      <div class="btns"><button class="btn">Ajouter</button><button type="button" class="btn ghost" data-a="goal-edit" data-id="${g.id}">Modifier l'objectif</button></div>
    </form>
    ${x.e.length ? `<h2>Historique</h2>${list([...x.e].reverse().slice(0, 20).map(e => `<div class="item"><div class="body"><span class="title">${fmtNum(e.value)} ${esc(g.unit)}</span><span class="meta">${shortDate(e.date)}</span></div>
      <button class="skipbtn" data-a="entry-del" data-g="${g.id}" data-id="${e.id}">Supprimer</button></div>`))}` : ''}`);
}
function domainForm(d) {
  const n = !d.id;
  return `<form class="f" data-f="domain" ${d.id ? `data-id="${d.id}"` : ''}>
    <input class="titlein" name="name" placeholder="Ex. : Santé, Famille, Finances…" value="${esc(d.name)}" required>
    <div class="swatches">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${(d.color || COLORS[0]) === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
    <label class="check"><input type="checkbox" name="private" ${d.private ? 'checked' : ''}> Privé (masqué par le code PIN)</label>
    <div class="btns"><button class="btn">${n ? 'Ajouter' : 'Enregistrer'}</button>${n ? '' : `<button type="button" class="btn danger" data-a="domain-del" data-id="${d.id}">Supprimer</button>`}</div>
  </form>`;
}
const pinIn = (name, ph) => `<input name="${name}" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="off" placeholder="${ph}" required>`;

// ---------- Actions ----------
const task = id => S.tasks.find(t => t.id === id);
const routine = id => S.routines.find(r => r.id === id);
const goal = id => S.goals.find(g => g.id === id);
const CLICK = {
  tab: el => { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); return false; },
  fab: () => {
    const f = ui.filter !== 'all' && ui.filter !== '-' ? ui.filter : '';
    if (ui.tab === 'routines') return openSheet('Nouvelle routine', routineForm({ domain: '' }));
    if (ui.tab === 'goals') return openSheet('Nouvel objectif', goalForm({ domain: '', unit: '' }));
    return openSheet('Nouvelle tâche', taskForm({ domain: ui.tab === 'tasks' ? f : '', due: ui.tab === 'today' ? (ui.day || today()) : '' }));
  },
  day: el => { ui.day = addDays(ui.day || today(), +el.dataset.n); if (ui.day === today()) ui.day = null; render(); return false; },
  'day-today': () => { ui.day = null; render(); return false; },
  filter: el => { ui.filter = el.dataset.f; render(); return false; },
  'show-done': el => { ui.showDone = el.dataset.v === '1'; render(); return false; },
  'task-done': el => { const t = task(el.dataset.id); t.done = !t.done; t.doneAt = t.done ? today() : ''; },
  'task-edit': el => openSheet('Tâche', taskForm(task(el.dataset.id))),
  'task-del': el => { S.tasks = S.tasks.filter(t => t.id !== el.dataset.id); closeSheet(); },
  check: el => { setCheck(routine(el.dataset.id), el.dataset.d, el.dataset.v); },
  'routine-edit': el => openSheet('Routine', routineForm(routine(el.dataset.id))),
  'routine-del': el => { if (!confirm('Supprimer cette routine ?')) return false; S.routines = S.routines.filter(r => r.id !== el.dataset.id); closeSheet(); },
  'goal-open': el => goalSheet(goal(el.dataset.id)),
  'goal-edit': el => openSheet('Modifier l’objectif', goalForm(goal(el.dataset.id))),
  'goal-del': el => { if (!confirm('Supprimer cet objectif et son historique ?')) return false; S.goals = S.goals.filter(g => g.id !== el.dataset.id); closeSheet(); },
  'entry-del': el => { const g = goal(el.dataset.g); g.entries = g.entries.filter(e => e.id !== el.dataset.id); save(); render(); goalSheet(g); return false; },
  'domain-new': () => openSheet('Nouveau domaine', domainForm({ color: COLORS[S.domains.length % COLORS.length] })),
  'domain-edit': el => { const d = dom(el.dataset.id); return hidden(d.id) ? CLICK.unlock() : openSheet('Domaine', domainForm(d)); },
  'domain-del': el => {
    if (!confirm('Supprimer ce domaine ? Ses tâches, routines et objectifs sont conservés, « Sans domaine ».')) return false;
    const id = el.dataset.id;
    S.domains = S.domains.filter(d => d.id !== id);
    [S.tasks, S.routines, S.goals].forEach(l => l.forEach(x => { if (x.domain === id) x.domain = ''; }));
    if (ui.filter === id) ui.filter = 'all';
    closeSheet();
  },
  unlock: () => {
    const wait = Math.ceil((pinBlockedUntil - Date.now()) / 1000);
    return openSheet('Code PIN', `<form class="f" data-f="unlock">${pinIn('pin', 'Ton code')}
      ${wait > 0 ? `<p class="late small">Trop d'essais. Réessaie dans ${wait} s.</p>` : ''}
      <div class="btns"><button class="btn">Déverrouiller</button><button type="button" class="btn danger" data-a="pin-forgot">Code oublié ?</button></div></form>`);
  },
  lock: () => { unlocked = false; },
  'pin-set': () => openSheet('Créer un code', `<form class="f" data-f="pin-set">${pinIn('pin', 'Code (4 à 6 chiffres)')}${pinIn('pin2', 'Confirmer le code')}
    <label class="check"><input type="checkbox" name="hideNotif" checked> Masquer aussi le texte des alertes privées</label><div class="btns"><button class="btn">Activer</button></div></form>`),
  'pin-change': () => openSheet('Changer le code', `<form class="f" data-f="pin-change">${pinIn('current', 'Code actuel')}${pinIn('pin', 'Nouveau code')}${pinIn('pin2', 'Confirmer')}<div class="btns"><button class="btn">Changer</button></div></form>`),
  'pin-remove': () => openSheet('Retirer le code', `<form class="f" data-f="pin-remove">${pinIn('current', 'Code actuel')}<div class="btns"><button class="btn danger">Retirer le code</button></div></form>`),
  'pin-forgot': () => {
    if (!confirm('Le code ne peut pas être récupéré. Effacer tout le contenu des domaines privés (tâches, routines, objectifs) et retirer le code ?')) return false;
    const priv = new Set(S.domains.filter(d => d.private).map(d => d.id));
    S.tasks = S.tasks.filter(t => !priv.has(t.domain));
    S.routines = S.routines.filter(r => !priv.has(r.domain));
    S.goals = S.goals.filter(g => !priv.has(g.domain));
    S.pin = null;
    closeSheet();
  },
  'alerts-enable': () => { enableAlerts(); return false; },
  'alerts-test': () => {
    Native.LocalNotifications.schedule({ notifications: [{ id: SNOOZE_BASE - 1, title: 'Test réussi', body: 'Les alertes de Ma Vie fonctionnent.', schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true }, actionTypeId: 'MAVIE', extra: { kind: 'info' } }] })
      .then(() => alert('Alerte programmée dans 10 secondes. Tu peux fermer l’application.'))
      .catch(e => alert('Erreur : ' + (e.message || e)));
    return false;
  },
  'backup-now': () => { autoBackup(true).then(render); return false; },
  export: () => {
    if (!S.pin) { exportData(); return false; }
    const pin = prompt('Code PIN (l’export contient tes données privées) :');
    if (pin) checkPin(pin).then(ok => (ok ? exportData() : alert('Code incorrect.')));
    return false;
  },
  reset: () => { if (!confirm('Effacer toutes tes données ? C’est définitif.')) return false; S = seed(); unlocked = false; },
};
const CHANGE = {
  rtype: el => { el.form.dataset.type = el.value; return false; },
  'pin-notif': el => { S.pin.hideNotif = el.checked; },
  import: el => { importData(el.files[0]); return false; },
};
const validPin = (a, b) => {
  if (!/^\d{4,6}$/.test(a)) { alert('Le code doit contenir 4 à 6 chiffres.'); return false; }
  if (a !== b) { alert('Les deux codes ne sont pas identiques.'); return false; }
  return true;
};
async function setPin(pin, hideNotif) {
  const salt = uid();
  S.pin = { salt, hash: await hashPin(pin, salt), hideNotif };
  unlocked = false;
  closeSheet(); save(); render();
}
const SUBMIT = {
  task: (f, d) => {
    const v = { title: d.title, domain: d.domain, due: d.due, time: d.time, alert: !!d.alert, star: !!d.star, notes: d.notes };
    if (f.dataset.id) Object.assign(task(f.dataset.id), v);
    else S.tasks.push({ id: uid(), ...v, done: false, doneAt: '', created: today() });
    closeSheet();
  },
  routine: (f, d, fd) => {
    const days = fd.getAll('days').map(Number);
    if (d.type === 'weekly' && !days.length) { alert('Choisis au moins un jour.'); return false; }
    if ((d.type === 'once' || d.type === 'yearly') && !d.date) { alert('Choisis une date.'); return false; }
    if (d.alert && !d.time) { alert("Choisis une heure pour l'alerte (ou décoche « Alerte »)."); return false; }
    const v = { title: d.title, domain: d.domain, type: d.type, time: d.time, days, day: +d.day || 1, date: d.date, before: d.type === 'yearly' ? +d.before || 0 : 0, alert: !!d.alert, track: !!d.track };
    if (f.dataset.id) Object.assign(routine(f.dataset.id), v);
    else S.routines.push({ id: uid(), ...v, note: '', created: today() });
    closeSheet();
  },
  goal: (f, d) => {
    const v = { title: d.title, domain: d.domain, start: parseFloat(d.start), target: parseFloat(d.target), unit: d.unit, deadline: d.deadline };
    if (!Number.isFinite(v.start) || !Number.isFinite(v.target)) return false;
    if (f.dataset.id) Object.assign(goal(f.dataset.id), v);
    else S.goals.push({ id: uid(), ...v, entries: [] });
    closeSheet();
  },
  entry: (f, d) => {
    const g = goal(f.dataset.id), value = parseFloat(d.value);
    if (!Number.isFinite(value)) return false;
    g.entries.push({ id: uid(), date: d.date || today(), value });
    save(); render(); goalSheet(g);
    return false;
  },
  domain: (f, d) => {
    const v = { name: d.name, color: d.color || COLORS[0], private: !!d.private };
    if (f.dataset.id) Object.assign(S.domains.find(x => x.id === f.dataset.id), v);
    else S.domains.push({ id: uid(), ...v });
    closeSheet();
  },
  review: (f, d) => {
    const week = weekStart();
    S.reviews = S.reviews.filter(r => r.week !== week);
    S.reviews.push({ week, wins: d.wins, blockers: d.blockers, next: d.next });
    alert('Bilan enregistré.');
  },
  unlock: (f, d) => {
    if (Date.now() < pinBlockedUntil) return false;
    checkPin(d.pin).then(ok => {
      if (ok) { unlocked = true; pinFails = 0; closeSheet(); render(); return; }
      pinFails++;
      if (pinFails >= 5) { pinBlockedUntil = Date.now() + 30000; pinFails = 0; }
      alert('Code incorrect.');
      CLICK.unlock();
    });
    return false;
  },
  'pin-set': (f, d) => { if (validPin(d.pin, d.pin2)) setPin(d.pin, !!d.hideNotif); return false; },
  'pin-change': (f, d) => {
    if (validPin(d.pin, d.pin2)) checkPin(d.current).then(ok => (ok ? setPin(d.pin, S.pin.hideNotif) : alert('Code actuel incorrect.')));
    return false;
  },
  'pin-remove': (f, d) => {
    checkPin(d.current).then(ok => { if (!ok) return alert('Code incorrect.'); S.pin = null; closeSheet(); save(); render(); });
    return false;
  },
};

async function exportData() {
  const name = `ma-vie-sauvegarde-${today()}.json`, json = JSON.stringify(S, null, 2);
  if (NATIVE) {
    try {
      const r = await Native.Filesystem.writeFile({ path: name, data: json, directory: Native.Directory.Cache, encoding: Native.Encoding.UTF8 });
      await Native.Share.share({ title: 'Sauvegarde Ma Vie', files: [r.uri] });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) alert('Export impossible : ' + (e.message || e)); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  a.click();
}
async function importData(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.version !== 4 || !Array.isArray(data.domains)) throw new Error();
    if (!confirm('Remplacer tes données actuelles par cette sauvegarde ?')) return;
    S = data; unlocked = false; save(); render();
  } catch (e) { alert("Ce fichier n'est pas une sauvegarde valide de cette version de Ma Vie."); }
}

// `false` : rien n'a changé · sinon on enregistre et on redessine
function after(result) { if (result === false) return; save(); render(); }
document.addEventListener('click', e => {
  if (e.target === sheetEl()) { closeSheet(); return; } // toucher le fond ferme le panneau
  const el = e.target.closest('[data-a]');
  if (el && CLICK[el.dataset.a]) after(CLICK[el.dataset.a](el));
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-c]');
  if (el && CHANGE[el.dataset.c]) after(CHANGE[el.dataset.c](el));
});
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-f]');
  if (!f || !SUBMIT[f.dataset.f]) return;
  e.preventDefault();
  const fd = new FormData(f), d = {};
  for (const [k, v] of fd) if (!(k in d)) d[k] = String(v).trim();
  if ([...f.querySelectorAll('[required]')].some(i => i.name && !d[i.name])) return;
  after(SUBMIT[f.dataset.f](f, d, fd));
});
// Les éléments privés se reverrouillent quand l'application passe en arrière-plan.
document.addEventListener('visibilitychange', () => { if (document.hidden && unlocked) { unlocked = false; closeSheet(); render(); } });

// ---------- Démarrage ----------
S = load();
render();
if (NATIVE) {
  setupNotificationActions().catch(() => {});
  syncAlerts().then(() => autoBackup()).then(render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAlerts().then(() => autoBackup()).then(render); });
}
