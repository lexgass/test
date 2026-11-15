'use strict';
// Ma Vie : centre de gestion personnel. Données stockées uniquement sur l'appareil (localStorage).
// Les alertes passent par le système d'alarmes Android (plugin LocalNotifications) via window.Native.

const KEY = 'mavie-v2';
const NATIVE = !!(window.Native && window.Native.isNative);

const AREAS = {
  sport:    { label: 'Sport & santé',       icon: '💪', color: '#ff7a59' },
  skills:   { label: 'Infra & Identité',    icon: '🛡️', color: '#4f8cff' },
  business: { label: 'Business',            icon: '💼', color: '#f5b942' },
  perso:    { label: 'Vie privée & couple', icon: '❤️', color: '#e85d9a' },
  general:  { label: 'Organisation',        icon: '🧭', color: '#93a0bd' },
};
const LIFE = ['sport', 'skills', 'business', 'perso']; // les 4 piliers suivis dans l'équilibre
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TYPES = { weekly: 'Chaque semaine', daily: 'Tous les jours', once: 'Une seule fois', yearly: 'Chaque année (date importante)' };
const HABITS = { sommeil: 'Couché avant 22h30', ecrans: "Pas d'écran après 22h", eau: "1,5 L d'eau" };
const LOG_KINDS = {
  sport: ['Musculation', 'Cardio', 'Course', 'Marche', 'Étirements / mobilité', 'Autre'],
  business: ['Prospection', 'Production', 'Administratif', 'Apprentissage business', 'Autre'],
  perso: ['Avec ma femme', 'Famille', 'Amis', 'Temps pour moi', 'Maison'],
};
const NAV = [
  ['home', '🏠', 'Accueil'], ['agenda', '📅', 'Agenda'], ['sport', '💪', 'Sport'], ['skills', '🛡️', 'Infra & IAM'],
  ['business', '💼', 'Business'], ['perso', '❤️', 'Perso'], ['review', '📊', 'Bilan'], ['settings', '⚙️', 'Réglages'],
];

let S;                       // état (chargé plus bas)
let tab = 'home';
let agendaDay = null;        // jour affiché dans l'agenda
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
const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}` : `${m} min`);
const longDate = s => cap(parse(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
const shortDate = s => parse(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dayMonth = s => parse(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const bar = (v, max, color) => `<div class="bar"><div style="width:${max ? Math.min(100, Math.round((v / max) * 100)) : 0}%;${color ? `background:${color}` : ''}"></div></div>`;
const areaTag = a => `<span class="tag" style="color:${AREAS[a].color};border-color:${AREAS[a].color}">${AREAS[a].icon} ${esc(AREAS[a].label)}</span>`;
const inDays = n => (n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : n < 0 ? `il y a ${-n} j` : `dans ${n} jours`);
const opts = (pairs, sel) => pairs.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
function weekStart(s = today()) { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ds(d); }
function day(d = today()) { return (S.days[d] ||= { focus: [0, 1, 2].map(() => ({ text: '', done: false })), energy: 0, habits: {} }); }
const inWeek = (s, wk = weekStart()) => weekStart(s) === wk;
const weekMinutes = (area, wk) => S.logs.filter(l => l.area === area && inWeek(l.date, wk)).reduce((a, l) => a + l.minutes, 0);
const sessionsCount = wk => S.logs.filter(l => l.area === 'sport' && inWeek(l.date, wk)).length;

// Le rappel a-t-il lieu ce jour-là ?
function occursOn(r, s) {
  if (r.type === 'daily') return true;
  if (r.type === 'weekly') return r.days.includes(parse(s).getDay());
  if (r.type === 'once') return r.date === s;
  if (r.type === 'yearly') return r.date.slice(5) === s.slice(5);
  return false;
}
// Prochaine date (>= aujourd'hui) d'une date annuelle
function nextYearly(mmdd) {
  const y = new Date().getFullYear();
  let s = `${y}-${mmdd}`;
  if (s < today()) s = `${y + 1}-${mmdd}`;
  return s;
}
function itemsOn(s) {
  const out = S.reminders.filter(r => occursOn(r, s)).map(r => ({ kind: 'r', time: r.time, title: r.title, area: r.area, r }));
  S.tasks.filter(t => t.due === s).forEach(t => out.push({ kind: 't', time: t.time || '', title: t.title, area: t.area, t }));
  return out.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
}
function nextAlert() {
  const now = new Date();
  for (let i = 0; i < 370; i++) {
    const s = addDays(today(), i);
    const hit = S.reminders.filter(r => r.alert && occursOn(r, s) && new Date(`${s}T${r.time}`) > now).sort((a, b) => a.time.localeCompare(b.time))[0];
    if (hit) return { r: hit, s };
  }
  return null;
}

// ---------- Données de départ (selon ton plan) ----------
function seed() {
  const reminders = [];
  const R = (area, title, type, time, extra = {}) => reminders.push({ id: uid(), area, title, type, time, days: [], date: '', before: 0, note: '', alert: true, ...extra });
  R('general', 'Choisis tes 3 priorités du jour', 'weekly', '06:40', { days: [1, 2, 3, 4, 5] });
  R('skills', 'Train : formation (lecture ou podcast)', 'weekly', '07:05', { days: [1, 2, 3, 4, 5] });
  R('skills', 'Formation légère : 30 min', 'weekly', '20:45', { days: [2, 4] });
  R('skills', 'Formation SC-300 : pratique 2 h', 'weekly', '09:00', { days: [6] });
  R('skills', 'Révision + examen blanc : 1 h 30', 'weekly', '10:00', { days: [0] });
  R('sport', 'Séance maison : 25 min de renforcement', 'weekly', '20:30', { days: [1, 3] });
  R('sport', 'Séance de sport : 1 h', 'weekly', '11:30', { days: [6] });
  R('sport', 'Marche ou footing : 45 min (avec ma femme ?)', 'weekly', '16:00', { days: [0] });
  R('sport', 'Écrans éteints, prépare-toi à dormir', 'daily', '22:15');
  R('business', 'Business : 1 h 30 de travail', 'weekly', '14:00', { days: [6] });
  R('business', "Business : 30 min, point d'avancement", 'weekly', '14:00', { days: [0] });
  R('perso', 'Envoie un petit message à ma femme', 'daily', '12:30');
  R('perso', 'Prévoir un moment à deux ce week-end', 'weekly', '18:30', { days: [5] });
  R('perso', 'Soirée à deux, sans téléphone', 'weekly', '19:30', { days: [6] });
  R('general', 'Bilan de la semaine (20 min)', 'weekly', '18:00', { days: [0] });

  const projects = [];
  const P = (area, title, goal) => { const p = { id: uid(), area, title, goal, deadline: '', updates: [] }; projects.push(p); return p.id; };
  const pSport = P('sport', 'Transformation physique', 'À préciser : poids visé, tour de taille, force…');
  const pSc = P('skills', 'Certification SC-300', 'Valider mon expertise IAM sur Entra ID');
  const pCdp = P('skills', 'Devenir chef de projet IAM', 'Évoluer vers un poste de IAM manager / chef de projet IAM');
  const pBiz = P('business', 'Choisir et lancer mon activité', 'Prestations informatiques ou e-commerce : décider, puis premier client');

  const tasks = [];
  const T = (area, title, project = '', priority = 'normale') => tasks.push({ id: uid(), area, title, project, priority, due: '', time: '', remind: false, done: false, doneAt: '' });
  T('sport', 'Définir mon objectif physique précis (poids, tour de taille, force)', pSport, 'haute');
  T('sport', 'Prendre mes mesures de départ (poids, tour de taille, photo)', pSport, 'haute');
  T('sport', 'Choisir un programme (maison ou salle)', pSport);
  T('skills', 'Ouvrir le parcours SC-300 sur Microsoft Learn', pSc, 'haute');
  T('skills', 'Faire le premier module (règle des 10 minutes)', pSc);
  T('skills', 'Mettre en place un environnement de test pour pratiquer', pSc);
  T('skills', "Passer l'évaluation d'entraînement (Practice Assessment)", pSc);
  T('skills', "Réserver la date d'examen", pSc);
  T('skills', 'Lister 3 projets IAM possibles au travail (MFA, revue des accès, accès conditionnel)', pCdp);
  T('skills', "Préparer l'entretien avec mon manager (objectif, plan, bénéfices pour l'équipe)", pCdp);
  T('skills', 'Demander un entretien à mon manager', pCdp, 'haute');
  T('business', 'Vérifier ce que mon contrat de travail autorise (exclusivité, non-concurrence)', pBiz, 'haute');
  T('business', 'Lister mes compétences vendables (Entra ID, Intune, Microsoft 365…)', pBiz);
  T('business', 'Comparer e-commerce et prestations informatiques (temps, argent, risque)', pBiz);
  T('business', 'Me renseigner sur le statut de micro-entrepreneur', pBiz);
  T('business', 'Identifier 3 types de clients possibles (TPE, PME, associations…)', pBiz);
  T('perso', 'Ajouter les dates importantes (anniversaire de ma femme, de mariage…)', '', 'haute');
  T('perso', 'Planifier une sortie à deux ce mois-ci');

  return {
    version: 2,
    inbox: [], days: {}, tasks, projects, reminders, logs: [], body: [], ideas: [],
    trainings: [
      { id: uid(), title: 'SC-300 – Identity and Access Administrator', examDate: '', progress: 0 },
      { id: uid(), title: 'Gestion de projet (PRINCE2 / PSM…)', examDate: '', progress: 0 },
    ],
    reviews: [], reviewChecks: {},
    targets: { sport: 150, skills: 300, business: 120, perso: 360 },
    sportSessions: 3,
  };
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.version === 2) return s; } catch (e) { /* illisible : on repart du modèle */ }
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
  const add = (title, body, schedule) => out.push({ id: id++, title, body, schedule: { ...schedule, allowWhileIdle: true } });
  for (const r of S.reminders) {
    if (!r.alert) continue;
    const [h, m] = r.time.split(':').map(Number);
    const title = `${AREAS[r.area].icon} ${r.title}`, body = r.note || AREAS[r.area].label;
    if (r.type === 'daily') add(title, body, { on: { hour: h, minute: m } });
    else if (r.type === 'weekly') r.days.forEach(d => add(title, body, { on: { weekday: d + 1, hour: h, minute: m } }));
    else if (r.type === 'once') { const at = new Date(`${r.date}T${r.time}`); if (at > now) add(title, body, { at }); }
    else if (r.type === 'yearly') {
      // Prochaine occurrence + préavis. Reprogrammé à chaque ouverture de l'app, donc ça se renouvelle chaque année.
      let s = nextYearly(r.date.slice(5));
      if (new Date(`${s}T${r.time}`) <= now) s = `${+s.slice(0, 4) + 1}${s.slice(4)}`;
      add(title, body, { at: new Date(`${s}T${r.time}`) });
      if (r.before > 0) {
        const pre = new Date(`${addDays(s, -r.before)}T${r.time}`);
        if (pre > now) add(`${title} dans ${r.before} jours`, 'Prépare quelque chose : cadeau, réservation, petit mot…', { at: pre });
      }
    }
  }
  for (const t of S.tasks) {
    if (t.done || !t.remind || !t.due) continue;
    const at = new Date(`${t.due}T${t.time || '09:00'}`);
    if (at > now) add(`${AREAS[t.area].icon} ${t.title}`, 'Tâche prévue maintenant', { at });
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
    if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    const list = buildNotifications();
    // Si l'heure exacte n'est pas autorisée, on programme quand même (à quelques minutes près) sans rouvrir les réglages à chaque fois.
    list.forEach(n => { n.isExactNotification = alertState.exact === 'granted'; });
    if (list.length) await LN.schedule({ notifications: list });
    alertState.count = list.length;
    alertState.error = '';
  } catch (e) {
    alertState.error = String(e && e.message || e);
  }
}
async function enableAlerts() {
  const LN = Native.LocalNotifications;
  await LN.requestPermissions();
  await refreshAlertState();
  if (alertState.perm === 'granted' && alertState.exact !== 'granted') {
    try { await LN.changeExactNotificationSetting(); } catch (e) { /* Android < 12 : rien à faire */ }
  }
  await syncAlerts();
  render();
}

// ---------- Composants réutilisables ----------
function taskLine(t, showArea) {
  const late = !t.done && t.due && t.due < today();
  const proj = t.project && S.projects.find(p => p.id === t.project);
  return `<li class="${t.done ? 'off' : ''}">
    <input type="checkbox" data-a="task-done" data-id="${t.id}" ${t.done ? 'checked' : ''}>
    <span class="grow ${t.done ? 'done' : ''}">${t.priority === 'haute' && !t.done ? '🔥 ' : ''}${esc(t.title)}
      ${proj ? `<br><span class="muted small">↳ ${esc(proj.title)}</span>` : ''}
      ${showArea ? `<br>${areaTag(t.area)}` : ''}</span>
    ${t.due ? `<span class="tag ${late ? 'hot' : ''}">${t.remind ? '🔔 ' : ''}${shortDate(t.due)}${t.time ? ' ' + t.time : ''}</span>` : ''}
    ${late ? `<button class="small ghost" data-a="task-tomorrow" data-id="${t.id}">→ demain</button>` : ''}
    <button class="icon" data-a="task-del" data-id="${t.id}" title="Supprimer">✕</button>
  </li>`;
}
function sortTasks(list) {
  return list.sort((a, b) => (a.done - b.done) || ((a.due || '9999') .localeCompare(b.due || '9999')) || ((b.priority === 'haute') - (a.priority === 'haute')));
}
function tasksCard(area, title = 'Mes tâches') {
  const all = S.tasks.filter(t => t.area === area);
  const open = sortTasks(all.filter(t => !t.done));
  const done = all.filter(t => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const projs = S.projects.filter(p => p.area === area);
  return `<section class="card"><header><h2>${title}</h2><span class="tag">${open.length} à faire</span></header>
    ${open.length ? `<ul class="list">${open.map(t => taskLine(t)).join('')}</ul>` : '<p class="muted">Rien à faire. Bravo !</p>'}
    <details><summary>＋ Ajouter une tâche</summary>
      <form class="form" data-f="task-add" data-area="${area}">
        <input name="title" placeholder="Que faut-il faire ?" required>
        ${projs.length ? `<select name="project"><option value="">Sans projet</option>${opts(projs.map(p => [p.id, p.title]))}</select>` : ''}
        <div class="row wrap"><label>Pour le<input type="date" name="due"></label><label>À<input type="time" name="time"></label>
          <label>Priorité<select name="priority">${opts([['normale', 'Normale'], ['haute', 'Haute 🔥']])}</select></label></div>
        <label class="row"><input type="checkbox" name="remind" checked> M'envoyer une alerte (à 9h si pas d'heure)</label>
        <button>Ajouter la tâche</button>
      </form></details>
    ${done.length ? `<details><summary>${done.length} tâche(s) terminée(s)</summary><ul class="list">${done.slice(0, 30).map(t => taskLine(t)).join('')}</ul></details>` : ''}
  </section>`;
}
function reminderLine(r, showArea) {
  const when = r.type === 'daily' ? 'Tous les jours'
    : r.type === 'weekly' ? WEEK_ORDER.filter(d => r.days.includes(d)).map(d => DAYS_SHORT[d]).join(', ')
    : r.type === 'once' ? shortDate(r.date) : `Chaque ${dayMonth(r.date)}${r.before ? ` (+ ${r.before} j avant)` : ''}`;
  return `<li class="${r.alert ? '' : 'off'}">
    <span class="time">${esc(r.time)}</span>
    <span class="grow">${esc(r.title)}<br><span class="muted small">${esc(when)}</span></span>
    ${showArea ? areaTag(r.area) : ''}
    <button class="icon" data-a="rem-toggle" data-id="${r.id}" title="${r.alert ? 'Couper l’alerte' : 'Activer l’alerte'}">${r.alert ? '🔔' : '🔕'}</button>
    <button class="icon" data-a="rem-del" data-id="${r.id}" title="Supprimer">✕</button>
  </li>`;
}
function reminderForm(area, type = 'weekly') {
  return `<form class="form rform" data-f="rem-add" data-type="${type}">
    <input name="title" placeholder="Ex. : séance de sport, appeler ma femme…" required>
    ${area ? `<input type="hidden" name="area" value="${area}">` : `<select name="area">${opts(Object.entries(AREAS).map(([k, a]) => [k, `${a.icon} ${a.label}`]))}</select>`}
    <div class="row wrap"><select name="type" data-c="rtype">${opts(Object.entries(TYPES), type)}</select>
      <label>Heure<input type="time" name="time" value="09:00" required></label></div>
    <div class="days f-days">${WEEK_ORDER.map(d => `<label><input type="checkbox" name="days" value="${d}">${DAYS_SHORT[d]}</label>`).join('')}</div>
    <label class="f-date">Date<input type="date" name="date"></label>
    <label class="f-before">Me prévenir aussi … jours avant<input type="number" name="before" min="0" max="60" value="7"></label>
    <input name="note" placeholder="Détail affiché dans l'alerte (facultatif)">
    <button>Ajouter</button>
  </form>`;
}
function remindersCard(area, title = 'Mon programme & mes alertes', filter = r => r.type !== 'yearly') {
  const list = S.reminders.filter(r => r.area === area && filter(r)).sort((a, b) => a.time.localeCompare(b.time));
  return `<section class="card"><header><h2>${title}</h2></header>
    ${list.length ? `<ul class="list">${list.map(r => reminderLine(r)).join('')}</ul>` : '<p class="muted">Aucun rappel.</p>'}
    <details><summary>＋ Ajouter un rappel</summary>${reminderForm(area)}</details>
  </section>`;
}
function logCard(area, title, kinds) {
  const mins = weekMinutes(area), target = S.targets[area];
  const recent = S.logs.filter(l => l.area === area).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  return `<section class="card"><header><h2>${title}</h2></header>
    <div class="row"><span class="big">${fmtMin(mins)}</span><span class="muted">sur ${fmtMin(target)} cette semaine</span></div>
    ${bar(mins, target, AREAS[area].color)}
    <form class="form" data-f="log-add" data-area="${area}">
      <div class="row wrap">
        <select name="kind" class="grow">${opts(kinds.map(k => [k, k]))}</select>
        <input name="minutes" type="number" min="5" step="5" value="30" required style="width:6.5em"><span>min</span>
      </div>
      <div class="row"><input type="date" name="date" value="${today()}"><input name="note" class="grow" placeholder="Note (facultatif)"></div>
      <button>Enregistrer</button>
    </form>
    ${recent.length ? `<details><summary>Historique</summary><ul class="list">${recent.map(l => `<li>
      <span class="tag">${shortDate(l.date)}</span><b>${fmtMin(l.minutes)}</b><span class="grow">${esc(l.kind)}${l.note ? ` – ${esc(l.note)}` : ''}</span>
      <button class="icon" data-a="log-del" data-id="${l.id}" title="Supprimer">✕</button></li>`).join('')}</ul></details>` : ''}
  </section>`;
}
function projectsCard(area, title = 'Mes projets') {
  const ps = S.projects.filter(p => p.area === area);
  return `<section class="card"><header><h2>${title}</h2></header>
    ${ps.map(p => {
      const pt = S.tasks.filter(t => t.project === p.id), done = pt.filter(t => t.done).length;
      const last = p.updates[p.updates.length - 1];
      const pct = last ? last.pct : (pt.length ? Math.round((done / pt.length) * 100) : 0);
      const left = p.deadline ? daysBetween(today(), p.deadline) : null;
      return `<div class="form">
        <div class="row"><h3 class="grow">${esc(p.title)}</h3><button class="icon" data-a="proj-del" data-id="${p.id}" title="Supprimer le projet">🗑</button></div>
        ${p.goal ? `<p class="muted">${esc(p.goal)}</p>` : ''}
        <div class="row">${bar(pct, 100, AREAS[area].color)}<b>${pct} %</b></div>
        <p class="small">${done}/${pt.length} tâches faites${left !== null ? ` · échéance <span class="${left < 0 ? 'late' : ''}">${shortDate(p.deadline)} (${inDays(left)})</span>` : ''}</p>
        ${p.updates.length ? `<details><summary>Points d'avancement (${p.updates.length})</summary><ul class="list">${[...p.updates].reverse().map(u => `<li class="top">
          <span class="tag">${shortDate(u.date)}</span><b>${u.pct} %</b><span class="grow">${esc(u.text)}</span></li>`).join('')}</ul></details>` : ''}
        <details><summary>＋ Faire un point d'avancement</summary>
          <form class="form" data-f="proj-update" data-id="${p.id}">
            <label>Avancement : <output>${pct}</output> %<input type="range" name="pct" min="0" max="100" step="5" value="${pct}" oninput="this.previousElementSibling.value=this.value"></label>
            <textarea name="text" rows="2" placeholder="Où j'en suis, ce qui bloque, prochaine étape…" required></textarea>
            <label>Échéance du projet<input type="date" name="deadline" value="${esc(p.deadline)}"></label>
            <button>Enregistrer le point</button>
          </form></details>
      </div>`;
    }).join('') || '<p class="muted">Aucun projet.</p>'}
    <details><summary>＋ Nouveau projet</summary>
      <form class="form" data-f="proj-add" data-area="${area}">
        <input name="title" placeholder="Nom du projet" required>
        <input name="goal" placeholder="Objectif / résultat attendu">
        <label>Échéance<input type="date" name="deadline"></label>
        <button>Créer le projet</button>
      </form></details>
  </section>`;
}
function areaHeader(area, subtitle) {
  return `<h1>${AREAS[area].icon} ${AREAS[area].label}</h1><p class="sub">${subtitle}</p>`;
}

// ---------- Écrans ----------
function vHome() {
  const now = new Date(), t = today(), d = day();
  const items = itemsOn(t);
  const late = sortTasks(S.tasks.filter(x => !x.done && x.due && x.due < t));
  const prio = sortTasks(S.tasks.filter(x => !x.done && x.priority === 'haute' && !(x.due && x.due < t))).slice(0, 6);
  const nx = nextAlert();
  const sunday = now.getDay() === 0 && !S.reviews.some(r => r.week === weekStart());
  return `
  <h1>${longDate(t)}</h1>
  <p class="sub">${nx ? `🔔 Prochaine alerte : <b>${esc(nx.r.title)}</b>, ${nx.s === t ? "aujourd'hui" : shortDate(nx.s)} à ${nx.r.time}` : 'Aucune alerte programmée.'}</p>
  ${alertBanner()}
  ${sunday ? `<div class="banner"><span class="grow">C'est dimanche : prends 20 minutes pour ton bilan de la semaine.</span><button class="ghost" data-a="tab" data-tab="review">Faire mon bilan →</button></div>` : ''}
  <div class="grid">
    <section class="card"><header><h2>🎯 Mes 3 priorités du jour</h2></header>
      ${d.focus.map((p, i) => `<div class="row">
        <input type="checkbox" data-a="focus-done" data-i="${i}" ${p.done ? 'checked' : ''}>
        <input class="grow ${p.done ? 'done' : ''}" data-c="focus-text" data-i="${i}" value="${esc(p.text)}" placeholder="Priorité ${i + 1}">
      </div>`).join('')}
    </section>
    <section class="card"><header><h2>📅 Mon programme du jour</h2><button class="small ghost" data-a="tab" data-tab="agenda">Agenda</button></header>
      ${items.length ? `<ul class="list">${items.map(agendaLine).join('')}</ul>` : '<p class="muted">Rien de prévu.</p>'}
    </section>
    ${balanceCard()}
    <section class="card"><header><h2>⚡ Mon énergie & mes habitudes</h2></header>
      <div class="row">${[1, 2, 3, 4, 5].map(n => `<button class="pill ${d.energy === n ? 'on' : ''}" data-a="energy" data-n="${n}">${n}</button>`).join('')}<span class="muted small">1 = épuisé · 5 = en forme</span></div>
      ${Object.entries(HABITS).map(([k, l]) => `<label class="row"><input type="checkbox" data-a="habit" data-k="${k}" ${d.habits[k] ? 'checked' : ''}> ${l}</label>`).join('')}
    </section>
    ${late.length ? `<section class="card"><header><h2 class="late">⏰ En retard</h2><span class="tag hot">${late.length}</span></header><ul class="list">${late.map(x => taskLine(x, true)).join('')}</ul></section>` : ''}
    <section class="card"><header><h2>🔥 Tâches prioritaires</h2></header>
      ${prio.length ? `<ul class="list">${prio.map(x => taskLine(x, true)).join('')}</ul>` : '<p class="muted">Aucune tâche prioritaire.</p>'}
    </section>
    ${upcomingCard()}
    <section class="card"><header><h2>📥 Boîte de réception</h2><span class="tag">${S.inbox.length}</span></header>
      ${S.inbox.length ? `<ul class="list">${S.inbox.map(i => `<li class="row wrap">
        <span class="grow">${esc(i.text)}</span>
        <select data-c="inbox-move" data-id="${i.id}"><option value="">Ranger dans…</option>${opts(LIFE.concat('general').map(a => [a, `${AREAS[a].icon} Tâche ${AREAS[a].label}`]))}<option value="idea">💡 Idée pour ma femme</option></select>
        <button class="icon" data-a="inbox-del" data-id="${i.id}" title="Supprimer">✕</button></li>`).join('')}</ul>`
        : '<p class="muted">Vide. Appuie sur ＋ dès que quelque chose te passe par la tête.</p>'}
    </section>
  </div>`;
}
function agendaLine(it) {
  if (it.kind === 't') return `<li><span class="time">${esc(it.time || '—')}</span><input type="checkbox" data-a="task-done" data-id="${it.t.id}" ${it.t.done ? 'checked' : ''}>
    <span class="grow ${it.t.done ? 'done' : ''}">${esc(it.title)}</span>${areaTag(it.area)}</li>`;
  return `<li class="${it.r.alert ? '' : 'off'}"><span class="time">${esc(it.time)}</span><span class="dot" style="background:${AREAS[it.area].color}"></span>
    <span class="grow">${esc(it.title)}</span>${it.r.alert ? '🔔' : ''}</li>`;
}
function balanceCard(wk = weekStart()) {
  return `<section class="card balance"><header><h2>⚖️ Mon équilibre cette semaine</h2></header>
    ${LIFE.map(a => { const m = weekMinutes(a, wk); return `<div class="line"><div class="row"><span class="grow">${AREAS[a].icon} ${AREAS[a].label}</span><span class="small">${fmtMin(m)} / ${fmtMin(S.targets[a])}</span></div>${bar(m, S.targets[a], AREAS[a].color)}</div>`; }).join('')}
    <p class="muted small">Séances de sport : <b>${sessionsCount(wk)}/${S.sportSessions}</b>. Enregistre ton temps dans chaque pilier pour voir ton équilibre.</p>
  </section>`;
}
function upcomingCard() {
  const t = today(), out = [];
  S.reminders.filter(r => r.type === 'yearly').forEach(r => { const s = nextYearly(r.date.slice(5)); const n = daysBetween(t, s); if (n <= 45) out.push([n, `${AREAS[r.area].icon} ${r.title}`, s]); });
  S.trainings.filter(x => x.examDate && x.examDate >= t).forEach(x => out.push([daysBetween(t, x.examDate), `🎓 Examen ${x.title}`, x.examDate]));
  S.projects.filter(p => p.deadline && p.deadline >= t).forEach(p => { const n = daysBetween(t, p.deadline); if (n <= 60) out.push([n, `${AREAS[p.area].icon} Échéance : ${p.title}`, p.deadline]); });
  S.tasks.filter(x => !x.done && x.due && x.due > t && daysBetween(t, x.due) <= 7).forEach(x => out.push([daysBetween(t, x.due), `${AREAS[x.area].icon} ${x.title}`, x.due]));
  out.sort((a, b) => a[0] - b[0]);
  return `<section class="card"><header><h2>🗓️ À venir</h2></header>
    ${out.length ? `<ul class="list">${out.slice(0, 10).map(([n, l, s]) => `<li><span class="grow">${esc(l)}</span><span class="tag ${n <= 3 ? 'hot' : ''}">${shortDate(s)} · ${inDays(n)}</span></li>`).join('')}</ul>` : '<p class="muted">Rien dans les prochaines semaines.</p>'}
  </section>`;
}
function alertBanner() {
  if (!NATIVE) return `<div class="banner warn"><span class="grow">Version navigateur : les alertes ne fonctionnent que dans l'application Android installée.</span></div>`;
  if (alertState.perm !== 'granted') return `<div class="banner warn"><span class="grow">Les alertes ne sont pas encore activées.</span><button data-a="alerts-enable">Activer les alertes</button></div>`;
  if (alertState.error) return `<div class="banner warn"><span class="grow">Problème avec les alertes : ${esc(alertState.error)}</span></div>`;
  return '';
}

function vAgenda() {
  const s = agendaDay || today();
  const items = itemsOn(s), wk = weekStart(s);
  return `<h1>📅 Agenda</h1><p class="sub">Ton programme (rappels réguliers) et tes tâches datées.</p>
  <div class="daynav">
    <button class="ghost" data-a="agenda-move" data-n="-1">◀</button>
    <h2>${longDate(s)}</h2>
    <button class="ghost" data-a="agenda-move" data-n="1">▶</button>
    ${s !== today() ? `<button class="small" data-a="agenda-today">Aujourd'hui</button>` : ''}
  </div>
  <div class="grid">
    <section class="card"><header><h2>Ce jour-là</h2></header>
      ${items.length ? `<ul class="list">${items.map(agendaLine).join('')}</ul>` : '<p class="muted">Rien de prévu.</p>'}
      <details><summary>＋ Ajouter un rendez-vous ce jour-là</summary>
        <form class="form" data-f="event-add" data-date="${s}">
          <input name="title" placeholder="Ex. : dentiste, resto avec ma femme, appel client…" required>
          <div class="row wrap"><select name="area">${opts(Object.entries(AREAS).map(([k, a]) => [k, `${a.icon} ${a.label}`]))}</select>
            <label>Heure<input type="time" name="time" value="09:00" required></label></div>
          <label class="row"><input type="checkbox" name="alert" checked> M'envoyer une alerte</label>
          <button>Ajouter</button>
        </form></details>
    </section>
    <section class="card wide"><header><h2>Semaine du ${dayMonth(wk)}</h2></header>
      <div class="week">${[0, 1, 2, 3, 4, 5, 6].map(i => { const x = addDays(wk, i); return `<div class="day ${x === today() ? 'today' : ''}">
        <h3 data-a="agenda-go" data-d="${x}">${DAYS_SHORT[parse(x).getDay()]} ${parse(x).getDate()}</h3>
        ${itemsOn(x).map(it => `<div class="row top"><span class="dot" style="background:${AREAS[it.area].color};margin-top:5px"></span><span><b>${esc(it.time)}</b> ${esc(it.title)}</span></div>`).join('')}
      </div>`; }).join('')}</div>
    </section>
    <section class="card wide"><header><h2>Toutes mes alertes</h2></header>
      <ul class="list">${[...S.reminders].sort((a, b) => a.time.localeCompare(b.time)).map(r => reminderLine(r, true)).join('')}</ul>
      <details><summary>＋ Ajouter un rappel</summary>${reminderForm(null)}</details>
    </section>
  </div>`;
}

function vSport() {
  const wk = weekStart(), n = sessionsCount(wk);
  const body = [...S.body].sort((a, b) => a.date.localeCompare(b.date));
  const first = body[0], last = body[body.length - 1];
  const diff = first && last && first !== last && first.weight && last.weight ? (last.weight - first.weight).toFixed(1) : null;
  return `${areaHeader('sport', 'Objectif : transformation physique. Régularité avant intensité.')}
  <div class="grid">
    <section class="card"><header><h2>Séances cette semaine</h2></header>
      <div class="row"><span class="big">${n} / ${S.sportSessions}</span><span class="muted">${n >= S.sportSessions ? 'Objectif atteint 💪' : `encore ${S.sportSessions - n}`}</span></div>
      ${bar(n, S.sportSessions, AREAS.sport.color)}
    </section>
    ${logCard('sport', 'Enregistrer une séance', LOG_KINDS.sport)}
    <section class="card"><header><h2>📏 Mes mesures</h2></header>
      ${last ? `<div class="row wrap">
        <div class="stat grow"><span class="muted small">Poids</span><span class="big">${last.weight ?? '–'} kg</span></div>
        <div class="stat grow"><span class="muted small">Tour de taille</span><span class="big">${last.waist ?? '–'} cm</span></div>
        ${diff !== null ? `<div class="stat grow"><span class="muted small">Depuis le début</span><span class="big">${diff > 0 ? '+' : ''}${diff} kg</span></div>` : ''}
      </div>` : '<p class="muted">Ajoute tes mesures de départ, puis une fois par semaine (même jour, le matin à jeun).</p>'}
      ${chart(body.filter(b => b.weight).map(b => [b.date, b.weight]), AREAS.sport.color, 'kg')}
      <form class="form" data-f="body-add">
        <div class="row wrap"><input type="date" name="date" value="${today()}">
          <input name="weight" type="number" step="0.1" min="30" max="250" placeholder="Poids (kg)" style="width:9em">
          <input name="waist" type="number" step="0.5" min="40" max="200" placeholder="Taille (cm)" style="width:9em"></div>
        <button>Enregistrer la mesure</button>
      </form>
      ${body.length ? `<details><summary>Historique</summary><ul class="list">${[...body].reverse().map(b => `<li><span class="tag">${shortDate(b.date)}</span><span class="grow">${b.weight ?? '–'} kg · ${b.waist ?? '–'} cm</span><button class="icon" data-a="body-del" data-id="${b.id}">✕</button></li>`).join('')}</ul></details>` : ''}
    </section>
    ${projectsCard('sport', 'Mon objectif')}
    ${tasksCard('sport')}
    ${remindersCard('sport')}
  </div>`;
}
function chart(points, color, unit) {
  if (points.length < 2) return '';
  const W = 600, H = 150, pad = 24;
  const vals = points.map(p => p[1]), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = i => pad + (i * (W - 2 * pad)) / (points.length - 1);
  const y = v => H - pad - ((v - min) * (H - 2 * pad)) / span;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${path}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[1])}" r="4" fill="${color}"/>`).join('')}
    <text x="4" y="14" fill="#93a0bd" font-size="13">${max} ${unit}</text><text x="4" y="${H - 4}" fill="#93a0bd" font-size="13">${min} ${unit}</text>
  </svg>`;
}

function vSkills() {
  return `${areaHeader('skills', 'Objectif : SC-300, puis évoluer vers IAM manager / chef de projet IAM.')}
  <div class="grid">
    ${logCard('skills', 'Enregistrer une session de formation', S.trainings.map(t => t.title).concat('Lecture / podcast (train)', 'Pratique au travail'))}
    <section class="card"><header><h2>🎓 Mes formations</h2></header>
      ${S.trainings.map(t => {
        const total = S.logs.filter(l => l.area === 'skills' && l.kind === t.title).reduce((a, l) => a + l.minutes, 0);
        const left = t.examDate ? daysBetween(today(), t.examDate) : null;
        return `<div class="form">
          <div class="row"><h3 class="grow">${esc(t.title)}</h3><button class="icon" data-a="training-del" data-id="${t.id}" title="Supprimer">🗑</button></div>
          <p class="small">Temps total : <b>${fmtMin(total)}</b>${left !== null ? ` · Examen ${shortDate(t.examDate)} (<b>${inDays(left)}</b>)` : ''}</p>
          <label>Avancement : ${t.progress} %<input type="range" min="0" max="100" step="5" value="${t.progress}" data-c="training-progress" data-id="${t.id}"></label>
          <label>Date d'examen<input type="date" value="${esc(t.examDate)}" data-c="training-exam" data-id="${t.id}"></label>
        </div>`;
      }).join('')}
      <details><summary>＋ Nouvelle formation</summary>
        <form class="form" data-f="training-add"><input name="title" placeholder="Ex. : MD-102 Intune, SC-100…" required><button>Ajouter</button></form></details>
    </section>
    ${projectsCard('skills', 'Mes projets carrière')}
    ${tasksCard('skills')}
    ${remindersCard('skills')}
  </div>`;
}

function vBusiness() {
  return `${areaHeader('business', 'Construire une activité à côté : tâches, rappels, points d’avancement et bilans.')}
  <div class="grid">
    ${projectsCard('business')}
    ${tasksCard('business')}
    ${logCard('business', 'Temps passé sur mon business', LOG_KINDS.business)}
    ${remindersCard('business')}
  </div>`;
}

function vPerso() {
  const t = today();
  const dates = S.reminders.filter(r => r.area === 'perso' && r.type === 'yearly')
    .map(r => ({ r, s: nextYearly(r.date.slice(5)) })).sort((a, b) => a.s.localeCompare(b.s));
  return `${areaHeader('perso', 'Ton espace privé : prendre soin de ta femme, de ta famille et de toi.')}
  <div class="grid">
    ${remindersCard('perso', '❤️ Rappels pour mon couple et ma vie perso')}
    <section class="card"><header><h2>🎂 Dates importantes</h2></header>
      ${dates.length ? `<ul class="list">${dates.map(({ r, s }) => `<li><span class="grow">${esc(r.title)}<br><span class="muted small">${dayMonth(r.date)}${r.before ? ` · alerte ${r.before} j avant` : ''}</span></span>
        <span class="tag ${daysBetween(t, s) <= 7 ? 'hot' : ''}">${inDays(daysBetween(t, s))}</span><button class="icon" data-a="rem-del" data-id="${r.id}">✕</button></li>`).join('')}</ul>`
        : '<p class="muted">Ajoute l’anniversaire de ta femme, votre anniversaire de mariage… Tu recevras une alerte quelques jours avant pour préparer quelque chose.</p>'}
      <details><summary>＋ Ajouter une date</summary>${reminderForm('perso', 'yearly')}</details>
    </section>
    <section class="card"><header><h2>💡 Idées pour lui faire plaisir</h2></header>
      ${S.ideas.length ? `<ul class="list">${S.ideas.map(i => `<li><span class="grow">${esc(i.text)}</span><button class="icon" data-a="idea-del" data-id="${i.id}">✕</button></li>`).join('')}</ul>` : '<p class="muted">Note ici dès qu’elle mentionne une envie : un resto, un livre, une sortie…</p>'}
      <form class="row" data-f="idea-add"><input name="text" class="grow" placeholder="Nouvelle idée…" required><button>+</button></form>
    </section>
    ${logCard('perso', 'Temps de qualité', LOG_KINDS.perso)}
    ${tasksCard('perso', 'Mes tâches privées')}
  </div>`;
}

function vReview() {
  const wk = weekStart(), checks = S.reviewChecks[wk] || {};
  const cur = S.reviews.find(r => r.week === wk) || { scores: {} };
  const doneThisWeek = a => S.tasks.filter(x => x.area === a && x.done && x.doneAt && inWeek(x.doneAt, wk)).length;
  const steps = [
    'Vider ma boîte de réception',
    'Cocher les tâches faites, reporter ou supprimer les autres',
    "Faire un point d'avancement sur mes projets business",
    'Regarder mon équilibre et mon énergie de la semaine',
    'Préparer la semaine prochaine : séances, formation, business, moment à deux',
  ];
  const energy = Object.entries(S.days).filter(([k]) => inWeek(k, wk)).map(([, v]) => v.energy).filter(Boolean);
  return `<h1>📊 Bilan de la semaine</h1><p class="sub">Semaine du ${dayMonth(wk)}. 20 minutes le dimanche pour garder le cap.</p>
  <div class="grid">
    ${balanceCard(wk)}
    <section class="card"><header><h2>Les chiffres de la semaine</h2></header>
      <ul class="list">${LIFE.map(a => `<li><span class="grow">${AREAS[a].icon} ${AREAS[a].label}</span><span class="tag">${doneThisWeek(a)} tâche(s) faite(s)</span></li>`).join('')}
        <li><span class="grow">⚡ Énergie moyenne</span><span class="tag">${energy.length ? (energy.reduce((x, y) => x + y, 0) / energy.length).toFixed(1) + ' / 5' : '–'}</span></li></ul>
    </section>
    <section class="card"><header><h2>Les étapes</h2></header>
      ${steps.map((s, i) => `<label class="row"><input type="checkbox" data-a="review-check" data-i="${i}" ${checks[i] ? 'checked' : ''}> ${s}</label>`).join('')}
    </section>
    <form class="card" data-f="review-save"><header><h2>Mon bilan</h2></header>
      <p class="muted">Ta satisfaction dans chaque pilier, de 1 à 10 :</p>
      ${LIFE.map(a => `<label>${AREAS[a].icon} ${AREAS[a].label} : <output>${cur.scores[a] || 5}</output>/10
        <input type="range" name="score_${a}" min="1" max="10" value="${cur.scores[a] || 5}" oninput="this.previousElementSibling.value=this.value"></label>`).join('')}
      <label>Mes victoires<textarea name="wins" rows="2">${esc(cur.wins)}</textarea></label>
      <label>Ce qui a bloqué<textarea name="blockers" rows="2">${esc(cur.blockers)}</textarea></label>
      <label>Business : où j'en suis ?<textarea name="business" rows="2">${esc(cur.business)}</textarea></label>
      <label>Mes 3 priorités pour la semaine prochaine<textarea name="next" rows="2">${esc(cur.next)}</textarea></label>
      <button>Enregistrer mon bilan</button>
    </form>
    <section class="card wide"><header><h2>Bilans précédents</h2></header>
      ${S.reviews.length ? [...S.reviews].sort((a, b) => b.week.localeCompare(a.week)).map(r => `<div class="form">
        <b>Semaine du ${dayMonth(r.week)}</b>
        <div class="row wrap">${LIFE.map(a => `<span class="tag">${AREAS[a].icon} ${r.scores[a] || '–'}/10</span>`).join('')}</div>
        ${r.wins ? `<p>✅ ${esc(r.wins)}</p>` : ''}${r.blockers ? `<p>🚧 ${esc(r.blockers)}</p>` : ''}${r.business ? `<p>💼 ${esc(r.business)}</p>` : ''}${r.next ? `<p>🎯 ${esc(r.next)}</p>` : ''}
      </div>`).join('') : '<p class="muted">Ton premier bilan apparaîtra ici.</p>'}
    </section>
  </div>`;
}

function vSettings() {
  const st = alertState;
  return `<h1>⚙️ Réglages</h1><p class="sub">Alertes, objectifs et sauvegarde.</p>
  <div class="grid">
    <section class="card"><header><h2>🔔 Alertes</h2></header>
      ${NATIVE ? `
        <p>Notifications : <b>${st.perm === 'granted' ? 'autorisées ✅' : 'non autorisées ❌'}</b></p>
        <p>Alertes à l'heure exacte : <b>${st.exact === 'granted' ? 'oui ✅' : 'non (à quelques minutes près)'}</b></p>
        <p>Alertes programmées : <b>${st.count}</b></p>
        ${st.error ? `<p class="late">${esc(st.error)}</p>` : ''}
        <div class="row wrap"><button data-a="alerts-enable">Autoriser les alertes</button><button class="ghost" data-a="alerts-test">Tester (dans 10 s)</button></div>
        <p class="muted small">Si les alertes n'arrivent pas : Paramètres Android → Applications → Ma Vie → Batterie → « Sans restriction ».</p>`
        : '<p class="muted">Les alertes fonctionnent uniquement dans l’application Android installée.</p>'}
    </section>
    <form class="card" data-f="targets"><header><h2>🎯 Mes objectifs par semaine</h2></header>
      ${LIFE.map(a => `<label>${AREAS[a].icon} ${AREAS[a].label} (heures)<input type="number" name="${a}" min="0" max="80" step="0.5" value="${S.targets[a] / 60}"></label>`).join('')}
      <label>💪 Nombre de séances de sport<input type="number" name="sessions" min="0" max="14" value="${S.sportSessions}"></label>
      <button>Enregistrer</button>
    </form>
    <section class="card"><header><h2>💾 Sauvegarde</h2></header>
      <p class="muted">Tes données restent uniquement sur ta tablette. Si tu désinstalles l'application, elles sont effacées : exporte-les régulièrement (par exemple à chaque bilan).</p>
      <div class="row wrap">
        <button data-a="export">Exporter mes données</button>
        <label class="btn ghost">Importer<input type="file" accept=".json,application/json" data-c="import" hidden></label>
      </div>
      <button class="danger" data-a="reset">Tout effacer et repartir du modèle</button>
    </section>
  </div>`;
}

const VIEWS = { home: vHome, agenda: vAgenda, sport: vSport, skills: vSkills, business: vBusiness, perso: vPerso, review: vReview, settings: vSettings };

function render() {
  document.getElementById('nav').innerHTML = NAV.map(([k, i, l]) => `<button data-a="tab" data-tab="${k}" class="${k === tab ? 'active' : ''}">${i}<span>${l}</span></button>`).join('');
  // Garde ouverts les volets « Ajouter… » que l'utilisateur avait dépliés
  const main = document.getElementById('main');
  const open = [...main.querySelectorAll('details')].map(d => d.open);
  main.innerHTML = VIEWS[tab]();
  main.querySelectorAll('details').forEach((d, i) => { if (open[i] && !d.querySelector('form[data-f]')) d.open = true; });
}

// ---------- Actions ----------
const task = id => S.tasks.find(t => t.id === id);
const CLICK = {
  tab: el => { tab = el.dataset.tab; document.getElementById('main').innerHTML = ''; render(); window.scrollTo(0, 0); return false; },
  capture: () => { const d = document.getElementById('capture'); d.showModal(); d.querySelector('textarea').focus(); return false; },
  'capture-close': () => { document.getElementById('capture').close(); return false; },
  'focus-done': el => { const p = day().focus[el.dataset.i]; p.done = !p.done; },
  energy: el => { const d = day(), n = +el.dataset.n; d.energy = d.energy === n ? 0 : n; },
  habit: el => { const h = day().habits; h[el.dataset.k] = !h[el.dataset.k]; },
  'task-done': el => { const t = task(el.dataset.id); t.done = !t.done; t.doneAt = t.done ? today() : ''; },
  'task-del': el => { S.tasks = S.tasks.filter(t => t.id !== el.dataset.id); },
  'task-tomorrow': el => { task(el.dataset.id).due = addDays(today(), 1); },
  'proj-del': el => {
    if (!confirm('Supprimer ce projet ? Ses tâches sont conservées.')) return false;
    S.projects = S.projects.filter(p => p.id !== el.dataset.id);
    S.tasks.forEach(t => { if (t.project === el.dataset.id) t.project = ''; });
  },
  'rem-toggle': el => { const r = S.reminders.find(x => x.id === el.dataset.id); r.alert = !r.alert; },
  'rem-del': el => { if (!confirm('Supprimer ce rappel ?')) return false; S.reminders = S.reminders.filter(r => r.id !== el.dataset.id); },
  'log-del': el => { S.logs = S.logs.filter(l => l.id !== el.dataset.id); },
  'body-del': el => { S.body = S.body.filter(b => b.id !== el.dataset.id); },
  'idea-del': el => { S.ideas = S.ideas.filter(i => i.id !== el.dataset.id); },
  'inbox-del': el => { S.inbox = S.inbox.filter(i => i.id !== el.dataset.id); },
  'training-del': el => { if (!confirm('Supprimer cette formation ?')) return false; S.trainings = S.trainings.filter(t => t.id !== el.dataset.id); },
  'review-check': el => { const c = (S.reviewChecks[weekStart()] ||= {}); c[el.dataset.i] = !c[el.dataset.i]; },
  'agenda-move': el => { agendaDay = addDays(agendaDay || today(), +el.dataset.n); render(); return false; },
  'agenda-today': () => { agendaDay = null; render(); return false; },
  'agenda-go': el => { agendaDay = el.dataset.d; render(); return false; },
  'alerts-enable': () => { enableAlerts(); return false; },
  'alerts-test': () => {
    Native.LocalNotifications.schedule({ notifications: [{ id: 999999, title: '🔔 Test réussi', body: 'Les alertes de Ma Vie fonctionnent.', schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true } }] })
      .then(() => alert('Alerte de test programmée dans 10 secondes. Tu peux fermer l’application.'))
      .catch(e => alert('Erreur : ' + (e.message || e)));
    return false;
  },
  export: () => { exportData(); return false; },
  reset: () => { if (!confirm('Effacer toutes tes données et repartir du modèle de départ ?')) return false; S = seed(); },
};
const CHANGE = {
  'focus-text': el => { day().focus[el.dataset.i].text = el.value.trim(); return 'norender'; },
  rtype: el => { el.form.dataset.type = el.value; return false; },
  'inbox-move': el => {
    const item = S.inbox.find(i => i.id === el.dataset.id);
    if (!item || !el.value) return false;
    if (el.value === 'idea') S.ideas.push({ id: uid(), text: item.text });
    else S.tasks.push({ id: uid(), area: el.value, title: item.text, project: '', priority: 'normale', due: '', time: '', remind: false, done: false, doneAt: '' });
    S.inbox = S.inbox.filter(i => i !== item);
  },
  'training-progress': el => { S.trainings.find(t => t.id === el.dataset.id).progress = +el.value; },
  'training-exam': el => { S.trainings.find(t => t.id === el.dataset.id).examDate = el.value; },
  import: el => { importData(el.files[0]); return false; },
};
const SUBMIT = {
  capture: (f, d) => { S.inbox.push({ id: uid(), text: d.text, created: today() }); document.getElementById('capture').close(); },
  'task-add': (f, d) => {
    S.tasks.push({ id: uid(), area: f.dataset.area, title: d.title, project: d.project || '', priority: d.priority, due: d.due, time: d.time, remind: !!d.remind && !!d.due, done: false, doneAt: '' });
  },
  'rem-add': (f, d, fd) => {
    const days = fd.getAll('days').map(Number);
    if (d.type === 'weekly' && !days.length) { alert('Choisis au moins un jour.'); return false; }
    if ((d.type === 'once' || d.type === 'yearly') && !d.date) { alert('Choisis une date.'); return false; }
    S.reminders.push({ id: uid(), area: d.area, title: d.title, type: d.type, time: d.time, days, date: d.date, before: d.type === 'yearly' ? +d.before || 0 : 0, note: d.note, alert: true });
  },
  'event-add': (f, d) => { S.reminders.push({ id: uid(), area: d.area, title: d.title, type: 'once', time: d.time, days: [], date: f.dataset.date, before: 0, note: '', alert: !!d.alert }); },
  'log-add': (f, d) => {
    const minutes = parseInt(d.minutes, 10);
    if (!(minutes > 0)) return false;
    S.logs.push({ id: uid(), area: f.dataset.area, kind: d.kind, minutes, note: d.note, date: d.date || today() });
  },
  'proj-add': (f, d) => { S.projects.push({ id: uid(), area: f.dataset.area, title: d.title, goal: d.goal, deadline: d.deadline, updates: [] }); },
  'proj-update': (f, d) => {
    const p = S.projects.find(x => x.id === f.dataset.id);
    p.updates.push({ id: uid(), date: today(), pct: +d.pct, text: d.text });
    p.deadline = d.deadline;
  },
  'body-add': (f, d) => {
    const weight = d.weight ? parseFloat(d.weight) : null, waist = d.waist ? parseFloat(d.waist) : null;
    if (weight === null && waist === null) return false;
    S.body.push({ id: uid(), date: d.date || today(), weight, waist });
  },
  'idea-add': (f, d) => { S.ideas.push({ id: uid(), text: d.text }); },
  'training-add': (f, d) => { S.trainings.push({ id: uid(), title: d.title, examDate: '', progress: 0 }); },
  'review-save': (f, d) => {
    const week = weekStart(), scores = {};
    LIFE.forEach(a => { scores[a] = +d['score_' + a]; });
    S.reviews = S.reviews.filter(r => r.week !== week);
    S.reviews.push({ week, scores, wins: d.wins, blockers: d.blockers, business: d.business, next: d.next });
    alert('Bilan enregistré. Bravo !');
  },
  targets: (f, d) => {
    LIFE.forEach(a => { const h = parseFloat(d[a]); if (h >= 0) S.targets[a] = Math.round(h * 60); });
    S.sportSessions = parseInt(d.sessions, 10) || 0;
    alert('Objectifs enregistrés.');
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
    if (data.version !== 2 || !Array.isArray(data.tasks)) throw new Error();
    if (!confirm('Remplacer tes données actuelles par cette sauvegarde ?')) return;
    S = data; save(); render();
  } catch (e) { alert("Ce fichier n'est pas une sauvegarde valide de Ma Vie."); }
}

// `false` : rien n'a changé · 'norender' : on enregistre sans redessiner (le clavier reste ouvert)
function after(result) {
  if (result === false) return;
  save();
  if (result !== 'norender') render();
}
document.addEventListener('click', e => {
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
  const fd = new FormData(f);
  const d = {};
  for (const [k, v] of fd) if (!(k in d)) d[k] = String(v).trim();
  if ([...f.querySelectorAll('[required]')].some(i => i.name && !d[i.name])) return;
  const res = SUBMIT[f.dataset.f](f, d, fd);
  if (res !== false) f.reset();
  after(res);
});

// ---------- Démarrage ----------
S = load();
render();
if (NATIVE) {
  // Reprogramme les alertes à chaque ouverture (renouvelle aussi les dates annuelles).
  syncAlerts().then(render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAlerts().then(render); });
}
