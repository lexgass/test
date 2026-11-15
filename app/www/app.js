'use strict';
// Ma Vie : centre de gestion personnel. Données stockées sur l'appareil (localStorage) + sauvegarde automatique.
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
const LIFE = ['sport', 'skills', 'business', 'perso']; // les 4 piliers suivis
const DAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const TYPES = { weekly: 'Chaque semaine', daily: 'Tous les jours', monthly: 'Chaque mois', once: 'Une seule fois', yearly: 'Chaque année (date importante)' };
const HABITS = { sommeil: 'Couché avant 22h30', ecrans: "Pas d'écran après 22h", eau: "1,5 L d'eau" };
const LOG_KINDS = {
  sport: ['Musculation', 'Cardio', 'Course', 'Marche', 'Étirements / mobilité', 'Autre'],
  business: ['Prospection', 'Production', 'Administratif', 'Apprentissage business', 'Autre'],
  perso: ['Avec ma femme', 'Famille', 'Amis', 'Temps pour moi', 'Maison'],
};
const PIPE = { todo: 'À contacter', contacted: 'Contacté', meeting: 'Rendez-vous', quote: 'Devis envoyé', won: 'Client ✅', lost: 'Perdu' };
const NAV = [
  ['home', '🏠', 'Accueil'], ['agenda', '📅', 'Agenda'], ['sport', '💪', 'Sport'], ['skills', '🛡️', 'Infra & IAM'],
  ['business', '💼', 'Business'], ['perso', '❤️', 'Perso'], ['progress', '📈', 'Progrès'], ['review', '📊', 'Bilan'], ['settings', '⚙️', 'Réglages'],
];
const SNOOZE_BASE = 900000; // identifiants des alertes « reportées » (non effacées lors de la reprogrammation)

let S;                       // état (chargé plus bas)
let tab = 'home';
let agendaDay = null;        // jour affiché dans l'agenda
let reviewMode = 'week';     // bilan : 'week' ou 'month'
let persoUnlocked = false;   // espace Perso déverrouillé (jusqu'à ce qu'on le quitte ou que l'app passe en arrière-plan)
let pinFails = 0, pinBlockedUntil = 0;
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
const fmtEur = n => `${Math.round(n).toLocaleString('fr-FR')} €`;
const fmtKg = n => `${(Math.round(n * 10) / 10).toLocaleString('fr-FR')} kg`;
const longDate = s => cap(parse(s).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
const shortDate = s => parse(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dayMonth = s => parse(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const monthYear = s => parse(s).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const monthKey = s => s.slice(0, 7);
const bar = (v, max, color) => `<div class="bar"><div style="width:${max ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : 0}%;${color ? `background:${color}` : ''}"></div></div>`;
const areaTag = a => `<span class="tag" style="color:${AREAS[a].color};border-color:${AREAS[a].color}">${AREAS[a].icon} ${esc(AREAS[a].label)}</span>`;
const inDays = n => (n === 0 ? "aujourd'hui" : n === 1 ? 'demain' : n < 0 ? `il y a ${-n} j` : `dans ${n} jours`);
const opts = (pairs, sel) => pairs.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
// Espace Perso protégé : tant qu'il est verrouillé, ses éléments sont masqués partout ailleurs.
const PRIVATE_LABEL = '🔒 Élément privé';
const hidden = area => area === 'perso' && !!S.pin && !persoUnlocked;
const shown = (area, text) => (hidden(area) ? PRIVATE_LABEL : text);
async function hashPin(pin, salt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const checkPin = async pin => !!S.pin && (await hashPin(pin, S.pin.salt)) === S.pin.hash;
function weekStart(s = today()) { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ds(d); }
function day(d = today()) { return (S.days[d] ||= { focus: [0, 1, 2].map(() => ({ text: '', done: false, task: '' })), energy: 0, habits: {} }); }
const inWeek = (s, wk = weekStart()) => weekStart(s) === wk;
const lastWeeks = n => Array.from({ length: n }, (_, i) => addDays(weekStart(), -7 * (n - 1 - i)));
const weekMinutes = (area, wk) => S.logs.filter(l => l.area === area && inWeek(l.date, wk)).reduce((a, l) => a + l.minutes, 0);
const sessionsCount = wk => S.logs.filter(l => l.area === 'sport' && l.minutes > 0 && inWeek(l.date, wk)).length;
// « Séance : 1 h 30 » → 90 ; « 25 min » → 25
function durationFromTitle(t) {
  const h = /(\d+)\s*h(?:\s*(\d+))?/.exec(t), m = /(\d+)\s*min/.exec(t);
  return h ? +h[1] * 60 + (+h[2] || 0) : m ? +m[1] : 0;
}

// ---------- Programme : occurrences, coches, régularité ----------
function occursOn(r, s) {
  if (r.created && s < r.created && r.type !== 'once' && r.type !== 'yearly') return false;
  if (r.type === 'daily') return true;
  if (r.type === 'weekly') return r.days.includes(parse(s).getDay());
  if (r.type === 'monthly') return +s.slice(8) === +r.day;
  if (r.type === 'once') return r.date === s;
  if (r.type === 'yearly') return r.date.slice(5) === s.slice(5);
  return false;
}
function nextYearly(mmdd) {
  const y = new Date().getFullYear();
  const s = `${y}-${mmdd}`;
  return s < today() ? `${y + 1}-${mmdd}` : s;
}
const check = (s, id) => (S.checks[s] || {})[id];
function setCheck(r, s, val) {
  const c = (S.checks[s] ||= {});
  S.logs = S.logs.filter(l => !(l.from === r.id && l.date === s)); // retire le temps compté auparavant
  if (c[r.id] === val) { delete c[r.id]; return; }                   // second appui = annuler
  c[r.id] = val;
  if (val === 'done' && r.duration > 0 && LIFE.includes(r.area)) {
    S.logs.push({ id: uid(), area: r.area, kind: r.title, minutes: r.duration, note: 'Programme', date: s, from: r.id });
  }
}
// Un rendez-vous du jour compte comme « prévu » dès que son heure est passée (ou s'il a été coché).
function isDue(r, s) {
  if (s < today()) return true;
  if (s > today()) return false;
  return !!check(s, r.id) || new Date(`${s}T${r.time}`) <= new Date();
}
function adherence(area, from, to) {
  let planned = 0, done = 0;
  for (let s = from; s <= to && s <= today(); s = addDays(s, 1)) {
    for (const r of S.reminders) {
      if (!r.track || (area && r.area !== area) || !occursOn(r, s) || !isDue(r, s)) continue;
      planned++;
      if (check(s, r.id) === 'done') done++;
    }
  }
  return { planned, done, pct: pct(done, planned) };
}
const weekAdherence = (area, wk = weekStart()) => adherence(area, wk, addDays(wk, 6));
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

// ---------- Objectifs : calculs de progression ----------
function weightSeries() { return [...S.body].filter(b => b.weight).sort((a, b) => a.date.localeCompare(b.date)); }
function weightNow() { const w = weightSeries(); return w.length ? w[w.length - 1].weight : S.goals.sport.start; }
// Tendance (régression linéaire) sur les 6 dernières semaines de pesées : kg par semaine (négatif = perte)
function weightTrend() {
  const w = weightSeries().filter(b => daysBetween(b.date, today()) <= 42);
  if (w.length < 2 || daysBetween(w[0].date, w[w.length - 1].date) < 7) return null;
  const xs = w.map(b => daysBetween(w[0].date, b.date)), ys = w.map(b => b.weight);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den ? (num / den) * 7 : null;
}
function sportGoal() {
  const g = S.goals.sport, now = weightNow(), trend = weightTrend();
  const total = g.start - g.target, lost = g.start - now;
  const weeksLeft = Math.max(1, daysBetween(today(), g.targetDate) / 7);
  const needed = (now - g.target) / weeksLeft; // kg/semaine nécessaires
  let eta = null;
  if (trend !== null && trend < -0.05 && now > g.target) eta = addDays(today(), Math.round(((now - g.target) / -trend) * 7));
  // Paliers : chaque tranche de 5 kg, avec la date prévue sur un rythme régulier
  const steps = [];
  for (let k = Math.floor((g.start - 0.01) / 5) * 5; k > g.target + 1; k -= 5) steps.push(k);
  steps.push(g.target);
  const span = daysBetween(g.startDate, g.targetDate);
  const milestones = steps.map(k => ({ kg: k, done: now <= k, date: addDays(g.startDate, Math.round(span * ((g.start - k) / total))) }));
  return { g, now, lost, total, pct: Math.max(0, Math.round((lost / total) * 100)), trend, needed, eta, milestones };
}
function skillsGoal() {
  const g = S.goals.skills;
  const total = S.logs.filter(l => l.area === 'skills').reduce((a, l) => a + l.minutes, 0) / 60;
  const weeks = lastWeeks(4), avg = weeks.reduce((a, w) => a + weekMinutes('skills', w), 0) / 60 / 4;
  const eta = avg > 0 && total < g.hours ? addDays(today(), Math.round(((g.hours - total) / avg) * 7)) : null;
  const exam = S.trainings.find(t => t.examDate && t.examDate >= today());
  return { g, total, avg, eta, exam };
}
const monthRevenue = mk => S.income.filter(i => monthKey(i.date) === mk).reduce((a, i) => a + i.amount, 0);
function businessGoal() {
  const g = S.goals.business, mk = monthKey(today());
  const target = today() <= g.date1 ? g.step1 : g.step2;
  const contacts = S.prospects.filter(p => p.contactedAt && inWeek(p.contactedAt)).length;
  const clients = S.prospects.filter(p => p.status === 'won').length;
  const open = S.prospects.filter(p => !['won', 'lost'].includes(p.status)).length;
  return { g, month: monthRevenue(mk), target, contacts, clients, open, targetDate: today() <= g.date1 ? g.date1 : g.date2 };
}

// ---------- Données de départ ----------
function baseReminders() {
  const list = [];
  const R = (area, title, type, time, extra = {}) => list.push({
    id: uid(), area, title, type, time, days: [], date: '', day: 1, before: 0, note: '', alert: true,
    track: LIFE.includes(area), duration: durationFromTitle(title), created: today(), ...extra,
  });
  R('general', 'Choisis tes 3 priorités du jour', 'weekly', '06:40', { days: [1, 2, 3, 4, 5], track: false });
  R('skills', 'Train : formation (lecture ou podcast)', 'weekly', '07:05', { days: [1, 2, 3, 4, 5], duration: 20 });
  R('skills', 'Formation légère : 30 min', 'weekly', '20:45', { days: [2, 4] });
  R('skills', 'Formation SC-300 : pratique 2 h', 'weekly', '09:00', { days: [6] });
  R('skills', 'Révision + examen blanc : 1 h 30', 'weekly', '10:00', { days: [0] });
  R('sport', 'Séance maison : 25 min de renforcement', 'weekly', '20:30', { days: [1, 3] });
  R('sport', 'Séance de sport : 1 h', 'weekly', '11:30', { days: [6] });
  R('sport', 'Marche ou footing : 45 min (avec ma femme ?)', 'weekly', '16:00', { days: [0] });
  R('sport', 'Écrans éteints, prépare-toi à dormir', 'daily', '22:15');
  R('sport', 'Pesée du matin (à jeun)', 'weekly', '07:00', { days: [6], track: false });
  R('business', 'Business : 1 h 30 de travail', 'weekly', '14:00', { days: [6] });
  R('business', "Business : 30 min, point d'avancement", 'weekly', '14:00', { days: [0] });
  R('business', 'Prospection : contacter 1 entreprise (15 min)', 'weekly', '12:45', { days: [2, 4] });
  R('perso', 'Envoie un petit message à ma femme', 'daily', '12:30');
  R('perso', 'Prévoir un moment à deux ce week-end', 'weekly', '18:30', { days: [5], track: false });
  R('perso', 'Soirée à deux, sans téléphone', 'weekly', '19:30', { days: [6], duration: 120 });
  R('general', 'Bilan de la semaine (20 min)', 'weekly', '18:00', { days: [0] });
  R('general', 'Bilan du mois (30 min)', 'monthly', '20:30', { day: 1 });
  return list;
}
function bizPlanTasks(pBiz) {
  const T = (title, priority = 'normale') => ({ id: uid(), area: 'business', title, project: pBiz, priority, due: '', time: '', remind: false, done: false, doneAt: '' });
  return [
    T('Choisir mon offre de départ (ex. : audit sécurité Microsoft 365 pour TPE/PME)', 'haute'),
    T('Fixer mes tarifs : forfait audit, mise en place MFA, support mensuel (≈ 150 €/mois)'),
    T('Créer ma micro-entreprise'),
    T("Préparer une présentation d'une page + mettre à jour mon profil LinkedIn"),
    T('Lister 20 entreprises ou contacts à qui proposer mon offre (réseau, anciens collègues, commerçants)'),
    T('Décrocher mon premier client'),
  ];
}
function defaultGoals() {
  return {
    sport: { start: 110, startDate: today(), target: 89, targetDate: '2027-07-31', sessions: 3 },
    skills: { title: 'SC-300', hours: 50, targetDate: '2027-02-28' },
    business: { step1: 500, date1: '2027-06-30', step2: 1000, date2: '2027-12-31', contacts: 3 },
    perso: { moments: 2 },
  };
}
function seed() {
  const projects = [];
  const P = (area, title, goal) => { const p = { id: uid(), area, title, goal, deadline: '', updates: [] }; projects.push(p); return p.id; };
  const pSport = P('sport', 'Transformation physique', 'Passer de 110 kg à moins de 90 kg, à un rythme durable (≈ 0,6 kg/semaine)');
  const pSc = P('skills', 'Certification SC-300', 'Valider mon expertise IAM sur Entra ID');
  const pCdp = P('skills', 'Devenir chef de projet IAM', 'Évoluer vers un poste de IAM manager / chef de projet IAM');
  const pBiz = P('business', 'Lancer mon activité : 500 €/mois', 'Complément de revenu : 500 €/mois en juin 2027, puis 1 000 €/mois');

  const tasks = [];
  const T = (area, title, project = '', priority = 'normale') => tasks.push({ id: uid(), area, title, project, priority, due: '', time: '', remind: false, done: false, doneAt: '' });
  T('sport', 'Prendre rendez-vous chez le médecin : bilan avant de reprendre le sport', pSport, 'haute');
  T('sport', 'Me peser et prendre mon tour de taille (point de départ)', pSport, 'haute');
  T('sport', 'Choisir un programme (maison ou salle)', pSport);
  T('sport', 'Revoir mon alimentation : un seul changement par semaine', pSport);
  T('skills', 'Ouvrir le parcours SC-300 sur Microsoft Learn', pSc, 'haute');
  T('skills', 'Faire le premier module (règle des 10 minutes)', pSc);
  T('skills', 'Mettre en place un environnement de test pour pratiquer', pSc);
  T('skills', "Passer l'évaluation d'entraînement (Practice Assessment)", pSc);
  T('skills', "Réserver la date d'examen", pSc);
  T('skills', 'Lister 3 projets IAM possibles au travail (MFA, revue des accès, accès conditionnel)', pCdp);
  T('skills', "Préparer l'entretien avec mon manager (objectif, plan, bénéfices pour l'équipe)", pCdp);
  T('skills', 'Demander un entretien à mon manager', pCdp, 'haute');
  T('business', 'Vérifier ce que mon contrat de travail autorise (exclusivité, non-concurrence)', pBiz, 'haute');
  tasks.push(...bizPlanTasks(pBiz));
  T('perso', 'Ajouter les dates importantes (anniversaire de ma femme, de mariage…)', '', 'haute');
  T('perso', 'Planifier une sortie à deux ce mois-ci');

  return {
    version: 3,
    inbox: [], days: {}, tasks, projects, reminders: baseReminders(), logs: [], body: [], ideas: [],
    trainings: [
      { id: uid(), title: 'SC-300 – Identity and Access Administrator', examDate: '', progress: 0 },
      { id: uid(), title: 'Gestion de projet (PRINCE2 / PSM…)', examDate: '', progress: 0 },
    ],
    checks: {}, prospects: [], income: [], reviews: [], monthReviews: [], reviewChecks: {},
    targets: { sport: 150, skills: 300, business: 120, perso: 360 },
    goals: defaultGoals(),
    backup: { last: '', where: '', error: '' },
  };
}
// Passage de la version 2 (déjà installée) à la version 3 : on garde tout et on complète.
function migrate(s) {
  if (s.version === 2) {
    s.checks ||= {}; s.prospects ||= []; s.income ||= []; s.monthReviews ||= [];
    s.backup ||= { last: '', where: '', error: '' };
    s.goals ||= defaultGoals();
    if (s.sportSessions !== undefined) { s.goals.sport.sessions = s.sportSessions; delete s.sportSessions; }
    s.reminders.forEach(r => {
      r.track ??= LIFE.includes(r.area);
      r.duration ??= r.title.startsWith('Train') ? 20 : r.title.startsWith('Soirée à deux') ? 120 : durationFromTitle(r.title);
      r.created ??= today();
      r.day ??= 1;
    });
    const has = t => s.reminders.some(r => r.title === t);
    baseReminders().filter(r => ['Pesée du matin (à jeun)', 'Prospection : contacter 1 entreprise (15 min)', 'Bilan du mois (30 min)'].includes(r.title) && !has(r.title))
      .forEach(r => s.reminders.push(r));
    let pBiz = s.projects.find(p => p.area === 'business');
    if (!pBiz) { pBiz = { id: uid(), area: 'business', title: 'Lancer mon activité : 500 €/mois', goal: '', deadline: '', updates: [] }; s.projects.push(pBiz); }
    if (!pBiz.goal || pBiz.goal.startsWith('Prestations informatiques ou e-commerce')) pBiz.goal = 'Complément de revenu : 500 €/mois en juin 2027, puis 1 000 €/mois';
    const pSp = s.projects.find(p => p.area === 'sport');
    if (pSp && (!pSp.goal || pSp.goal.startsWith('À préciser'))) pSp.goal = 'Passer de 110 kg à moins de 90 kg, à un rythme durable (≈ 0,6 kg/semaine)';
    bizPlanTasks(pBiz.id).filter(t => !s.tasks.some(x => x.title === t.title)).forEach(t => s.tasks.push(t));
    if (!s.tasks.some(t => t.title.startsWith('Prendre rendez-vous chez le médecin'))) {
      const pSport = s.projects.find(p => p.area === 'sport');
      s.tasks.push({ id: uid(), area: 'sport', title: 'Prendre rendez-vous chez le médecin : bilan avant de reprendre le sport', project: pSport ? pSport.id : '', priority: 'haute', due: '', time: '', remind: false, done: false, doneAt: '' });
    }
    Object.values(s.days).forEach(d => d.focus && d.focus.forEach(f => { f.task ??= ''; }));
    s.version = 3;
  }
  return s;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && (s.version === 2 || s.version === 3)) { const m = migrate(s); localStorage.setItem(KEY, JSON.stringify(m)); return m; }
  } catch (e) { /* illisible : on repart du modèle */ }
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
  for (const r of S.reminders) {
    if (!r.alert) continue;
    const [h, m] = r.time.split(':').map(Number);
    const secret = r.area === 'perso' && S.pin && S.pin.hideNotif;
    const title = secret ? '❤️ Rappel privé' : `${AREAS[r.area].icon} ${r.title}`;
    const body = secret ? 'Ouvre Ma Vie pour voir le détail' : r.note || AREAS[r.area].label, extra = { kind: 'r', id: r.id };
    if (r.type === 'daily') add(title, body, { on: { hour: h, minute: m } }, extra);
    else if (r.type === 'weekly') r.days.forEach(d => add(title, body, { on: { weekday: d + 1, hour: h, minute: m } }, extra));
    else if (r.type === 'monthly') add(title, body, { on: { day: +r.day, hour: h, minute: m } }, extra);
    else if (r.type === 'once') { const at = new Date(`${r.date}T${r.time}`); if (at > now) add(title, body, { at }, extra); }
    else if (r.type === 'yearly') {
      // Prochaine occurrence + préavis. Reprogrammé à chaque ouverture de l'app, donc renouvelé chaque année.
      let s = nextYearly(r.date.slice(5));
      if (new Date(`${s}T${r.time}`) <= now) s = `${+s.slice(0, 4) + 1}${s.slice(4)}`;
      add(title, body, { at: new Date(`${s}T${r.time}`) }, extra);
      if (r.before > 0) {
        const pre = new Date(`${addDays(s, -r.before)}T${r.time}`);
        if (pre > now) add(`${title} dans ${r.before} jours`, 'Prépare quelque chose : cadeau, réservation, petit mot…', { at: pre }, { kind: 'info' });
      }
    }
  }
  for (const t of S.tasks) {
    if (t.done || !t.remind || !t.due) continue;
    const at = new Date(`${t.due}T${t.time || '09:00'}`);
    const secret = t.area === 'perso' && S.pin && S.pin.hideNotif;
    if (at > now) add(secret ? '❤️ Tâche privée' : `${AREAS[t.area].icon} ${t.title}`, 'Tâche prévue maintenant', { at }, { kind: 't', id: t.id });
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
    const old = pending.notifications.filter(n => n.id < SNOOZE_BASE); // on garde les alertes reportées
    if (old.length) await LN.cancel({ notifications: old.map(n => ({ id: n.id })) });
    const list = buildNotifications();
    // Sans autorisation « heure exacte », on programme quand même (à quelques minutes près) sans rouvrir les réglages.
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
// Boutons dans la notification : « Fait » et « Dans 30 min »
async function setupNotificationActions() {
  const LN = Native.LocalNotifications;
  await LN.registerActionTypes({ types: [{ id: 'MAVIE', actions: [{ id: 'done', title: '✓ Fait' }, { id: 'snooze', title: '⏰ Dans 30 min' }] }] });
  await LN.addListener('localNotificationActionPerformed', ({ actionId, notification }) => {
    const x = notification.extra || {};
    if (actionId === 'done') {
      if (x.kind === 'r') { const r = S.reminders.find(y => y.id === x.id); if (r && check(today(), r.id) !== 'done') setCheck(r, today(), 'done'); }
      if (x.kind === 't') { const t = S.tasks.find(y => y.id === x.id); if (t) { t.done = true; t.doneAt = today(); } }
      save();
    } else if (actionId === 'snooze') {
      LN.schedule({ notifications: [{
        id: SNOOZE_BASE + Math.floor(Math.random() * 90000), title: notification.title, body: notification.body,
        schedule: { at: new Date(Date.now() + 30 * 60000), allowWhileIdle: true }, actionTypeId: 'MAVIE', extra: x,
      }] });
      return;
    }
    tab = 'agenda'; agendaDay = null;
    render();
  });
}

// ---------- Sauvegarde automatique (une fois par jour) ----------
async function autoBackup(force) {
  if (!NATIVE || (!force && S.backup.last === today())) return;
  const FS = Native.Filesystem, name = `MaVie/sauvegarde-${today()}.json`;
  const data = JSON.stringify(S);
  try {
    // Dossier « Documents/MaVie » de la tablette : conservé même si l'application est désinstallée.
    await FS.writeFile({ path: name, data, directory: Native.Directory.Documents, encoding: Native.Encoding.UTF8, recursive: true });
    S.backup = { last: today(), where: 'Documents/MaVie', error: '' };
    try { // ne garde que les 14 dernières
      const { files } = await FS.readdir({ path: 'MaVie', directory: Native.Directory.Documents });
      const old = files.map(f => f.name).filter(n => /^sauvegarde-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().slice(0, -14);
      for (const n of old) await FS.deleteFile({ path: `MaVie/${n}`, directory: Native.Directory.Documents }).catch(() => {});
    } catch (e) { /* nettoyage facultatif */ }
  } catch (e) {
    try { // repli : dossier privé de l'application (inclus dans la sauvegarde Google d'Android)
      await FS.writeFile({ path: 'sauvegarde-auto.json', data, directory: Native.Directory.Data, encoding: Native.Encoding.UTF8 });
      S.backup = { last: today(), where: "Dossier interne de l'application", error: String(e && e.message || e) };
    } catch (e2) {
      S.backup = { ...S.backup, error: String(e2 && e2.message || e2) };
    }
  }
  localStorage.setItem(KEY, JSON.stringify(S));
}

// ---------- Composants réutilisables ----------
function taskLine(t, showArea) {
  const late = !t.done && t.due && t.due < today();
  const proj = t.project && S.projects.find(p => p.id === t.project);
  return `<li class="${t.done ? 'off' : ''}">
    <input type="checkbox" data-a="task-done" data-id="${t.id}" ${t.done ? 'checked' : ''}>
    <span class="grow ${t.done ? 'done' : ''}">${t.priority === 'haute' && !t.done ? '🔥 ' : ''}${esc(shown(t.area, t.title))}
      ${proj && !hidden(t.area) ? `<br><span class="muted small">↳ ${esc(proj.title)}</span>` : ''}
      ${showArea ? `<br>${areaTag(t.area)}` : ''}</span>
    ${t.due ? `<span class="tag ${late ? 'hot' : ''}">${t.remind ? '🔔 ' : ''}${shortDate(t.due)}${t.time ? ' ' + t.time : ''}</span>` : ''}
    ${late ? `<button class="small ghost" data-a="task-tomorrow" data-id="${t.id}">→ demain</button>` : ''}
    ${hidden(t.area) ? '' : `<button class="icon" data-a="task-edit" data-id="${t.id}" title="Modifier">✏️</button>`}
  </li>`;
}
function sortTasks(list) {
  return list.sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999') || ((b.priority === 'haute') - (a.priority === 'haute')));
}
function taskFields(t, area) {
  const projs = S.projects.filter(p => p.area === (t.area || area));
  return `<input name="title" placeholder="Que faut-il faire ?" value="${esc(t.title)}" required>
    ${projs.length ? `<select name="project"><option value="">Sans projet</option>${opts(projs.map(p => [p.id, p.title]), t.project)}</select>` : ''}
    <div class="row wrap"><label>Pour le<input type="date" name="due" value="${esc(t.due)}"></label><label>À<input type="time" name="time" value="${esc(t.time)}"></label>
      <label>Priorité<select name="priority">${opts([['normale', 'Normale'], ['haute', 'Haute 🔥']], t.priority)}</select></label></div>
    <label class="row"><input type="checkbox" name="remind" ${t.remind || !t.id ? 'checked' : ''}> M'envoyer une alerte (à 9h si pas d'heure)</label>`;
}
function tasksCard(area, title = 'Mes tâches') {
  const all = S.tasks.filter(t => t.area === area);
  const open = sortTasks(all.filter(t => !t.done));
  const done = all.filter(t => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  return `<section class="card"><header><h2>${title}</h2><span class="tag">${open.length} à faire</span></header>
    ${open.length ? `<ul class="list">${open.map(t => taskLine(t)).join('')}</ul>` : '<p class="muted">Rien à faire.</p>'}
    <details><summary>＋ Ajouter une tâche</summary>
      <form class="form" data-f="task-add" data-area="${area}">${taskFields({ area }, area)}<button>Ajouter la tâche</button></form></details>
    ${done.length ? `<details><summary>${done.length} tâche(s) terminée(s)</summary><ul class="list">${done.slice(0, 30).map(t => taskLine(t)).join('')}</ul></details>` : ''}
  </section>`;
}
function whenText(r) {
  return r.type === 'daily' ? 'Tous les jours'
    : r.type === 'weekly' ? WEEK_ORDER.filter(d => r.days.includes(d)).map(d => DAYS_SHORT[d]).join(', ')
    : r.type === 'monthly' ? `Le ${r.day} de chaque mois`
    : r.type === 'once' ? shortDate(r.date) : `Chaque ${dayMonth(r.date)}${r.before ? ` (+ ${r.before} j avant)` : ''}`;
}
function reminderLine(r, showArea) {
  return `<li class="${r.alert ? '' : 'off'}">
    <span class="time">${esc(r.time)}</span>
    <span class="grow">${esc(shown(r.area, r.title))}<br><span class="muted small">${esc(whenText(r))}${r.duration ? ` · ${fmtMin(r.duration)}` : ''}${r.track ? ' · suivi ✓' : ''}</span></span>
    ${showArea ? areaTag(r.area) : ''}
    <button class="icon" data-a="rem-toggle" data-id="${r.id}" title="${r.alert ? 'Couper l’alerte' : 'Activer l’alerte'}">${r.alert ? '🔔' : '🔕'}</button>
    ${hidden(r.area) ? '' : `<button class="icon" data-a="rem-edit" data-id="${r.id}" title="Modifier">✏️</button>`}
  </li>`;
}
function reminderForm(area, type = 'weekly', r = null, fname = 'rem-add') {
  const v = r || { title: '', time: '09:00', days: [], date: '', day: 1, before: 7, note: '', duration: 0, track: !!area && LIFE.includes(area) };
  return `<form class="form rform" data-f="${fname}" data-type="${r ? r.type : type}" ${r ? `data-id="${r.id}"` : ''}>
    <input name="title" placeholder="Ex. : séance de sport, appeler ma femme…" value="${esc(v.title)}" required>
    ${area ? `<input type="hidden" name="area" value="${area}">` : `<select name="area">${opts(Object.entries(AREAS).map(([k, a]) => [k, `${a.icon} ${a.label}`]), r && r.area)}</select>`}
    <div class="row wrap"><select name="type" data-c="rtype">${opts(Object.entries(TYPES), r ? r.type : type)}</select>
      <label>Heure<input type="time" name="time" value="${esc(v.time)}" required></label>
      <label>Durée (min)<input type="number" name="duration" min="0" max="600" step="5" value="${v.duration || 0}" style="width:6em"></label></div>
    <div class="days f-days">${WEEK_ORDER.map(d => `<label><input type="checkbox" name="days" value="${d}" ${v.days.includes(d) ? 'checked' : ''}>${DAYS_SHORT[d]}</label>`).join('')}</div>
    <label class="f-date">Date<input type="date" name="date" value="${esc(v.date)}"></label>
    <label class="f-day">Jour du mois<input type="number" name="day" min="1" max="28" value="${v.day || 1}"></label>
    <label class="f-before">Me prévenir aussi … jours avant<input type="number" name="before" min="0" max="60" value="${v.before ?? 7}"></label>
    <input name="note" placeholder="Détail affiché dans l'alerte (facultatif)" value="${esc(v.note)}">
    <label class="row"><input type="checkbox" name="track" ${v.track ? 'checked' : ''}> Je veux le cocher (compte dans ma régularité)</label>
    <button>${r ? 'Enregistrer' : 'Ajouter'}</button>
  </form>`;
}
function remindersCard(area, title = 'Mon programme & mes alertes', filter = r => r.type !== 'yearly') {
  const list = S.reminders.filter(r => r.area === area && filter(r)).sort((a, b) => a.time.localeCompare(b.time));
  const adh = weekAdherence(area);
  return `<section class="card"><header><h2>${title}</h2>${adh.planned ? `<span class="tag">Régularité ${adh.pct} %</span>` : ''}</header>
    ${list.length ? `<ul class="list">${list.map(r => reminderLine(r)).join('')}</ul>` : '<p class="muted">Aucun rappel.</p>'}
    <details><summary>＋ Ajouter un rappel</summary>${reminderForm(area)}</details>
  </section>`;
}
function logCard(area, title, kinds) {
  const mins = weekMinutes(area), target = S.targets[area];
  const recent = S.logs.filter(l => l.area === area).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  return `<section class="card"><header><h2>${title}</h2></header>
    <div class="row"><span class="big">${fmtMin(mins)}</span><span class="muted">sur ${fmtMin(target)} cette semaine</span></div>
    ${bar(mins, target, AREAS[area].color)}
    <p class="muted small">Les éléments du programme cochés « Fait » sont comptés automatiquement. Ajoute ici le reste.</p>
    <details><summary>＋ Ajouter du temps</summary>
    <form class="form" data-f="log-add" data-area="${area}">
      <div class="row wrap">
        <select name="kind" class="grow">${opts(kinds.map(k => [k, k]))}</select>
        <input name="minutes" type="number" min="5" step="5" value="30" required style="width:6.5em"><span>min</span>
      </div>
      <div class="row"><input type="date" name="date" value="${today()}"><input name="note" class="grow" placeholder="Note (facultatif)"></div>
      <button>Enregistrer</button>
    </form></details>
    ${recent.length ? `<details><summary>Historique</summary><ul class="list">${recent.map(l => `<li>
      <span class="tag">${shortDate(l.date)}</span><b>${fmtMin(l.minutes)}</b><span class="grow">${esc(l.kind)}${l.note ? ` – ${esc(l.note)}` : ''}</span>
      <button class="icon" data-a="log-del" data-id="${l.id}" title="Supprimer">✕</button></li>`).join('')}</ul></details>` : ''}
  </section>`;
}
const nextAction = p => sortTasks(S.tasks.filter(t => t.project === p.id && !t.done))[0];
function projectsCard(area, title = 'Mes projets') {
  const ps = S.projects.filter(p => p.area === area);
  return `<section class="card"><header><h2>${title}</h2></header>
    ${ps.map(p => {
      const pt = S.tasks.filter(t => t.project === p.id), done = pt.filter(t => t.done).length;
      const last = p.updates[p.updates.length - 1];
      const value = last ? last.pct : (pt.length ? Math.round((done / pt.length) * 100) : 0);
      const left = p.deadline ? daysBetween(today(), p.deadline) : null;
      const na = nextAction(p);
      return `<div class="form">
        <div class="row"><h3 class="grow">${esc(p.title)}</h3><button class="icon" data-a="proj-edit" data-id="${p.id}" title="Modifier">✏️</button></div>
        ${p.goal ? `<p class="muted">${esc(p.goal)}</p>` : ''}
        <div class="row">${bar(value, 100, AREAS[area].color)}<b>${value} %</b></div>
        <p class="small">${done}/${pt.length} tâches faites${left !== null ? ` · échéance <span class="${left < 0 ? 'late' : ''}">${shortDate(p.deadline)} (${inDays(left)})</span>` : ''}</p>
        ${na ? `<p class="next">➡️ Prochaine action : <b>${esc(na.title)}</b></p>` : `<p class="next warn">⚠️ Aucune prochaine action : ajoute une tâche à ce projet.</p>`}
        ${p.updates.length ? `<details><summary>Points d'avancement (${p.updates.length})</summary><ul class="list">${[...p.updates].reverse().map(u => `<li class="top">
          <span class="tag">${shortDate(u.date)}</span><b>${u.pct} %</b><span class="grow">${esc(u.text)}</span></li>`).join('')}</ul></details>` : ''}
        <details><summary>＋ Faire un point d'avancement</summary>
          <form class="form" data-f="proj-update" data-id="${p.id}">
            <label>Avancement : <output>${value}</output> %<input type="range" name="pct" min="0" max="100" step="5" value="${value}" oninput="this.previousElementSibling.value=this.value"></label>
            <textarea name="text" rows="2" placeholder="Où j'en suis, ce qui bloque, prochaine étape…" required></textarea>
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
function areaHeader(area, subtitle) { return `<h1>${AREAS[area].icon} ${AREAS[area].label}</h1><p class="sub">${subtitle}</p>`; }
// Petit graphique en barres (une barre par semaine/mois)
function barsChart(values, labels, color, opt = {}) {
  const W = 600, H = 140, pad = 18, max = Math.max(opt.max || 0, ...values, 1), n = values.length, bw = (W - 2 * pad) / n;
  const y = v => H - pad - ((H - 2 * pad - 10) * v) / max;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${opt.line ? `<line x1="${pad}" x2="${W - pad}" y1="${y(opt.line)}" y2="${y(opt.line)}" stroke="#93a0bd" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>` : ''}
    ${values.map((v, i) => `<rect x="${pad + i * bw + bw * 0.15}" y="${y(v)}" width="${bw * 0.7}" height="${Math.max(0, H - pad - y(v))}" rx="4" fill="${color}" opacity="${i === n - 1 ? 1 : 0.65}"/>`).join('')}
    ${labels.map((l, i) => `<text x="${pad + i * bw + bw / 2}" y="${H - 3}" fill="#93a0bd" font-size="12" text-anchor="middle">${esc(l)}</text>`).join('')}
  </svg>`;
}
function lineChart(points, color, unit, target) {
  if (points.length < 2) return '';
  const W = 600, H = 150, pad = 24;
  const vals = points.map(p => p[1]).concat(target ?? []), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = i => pad + (i * (W - 2 * pad)) / (points.length - 1);
  const y = v => H - pad - ((v - min) * (H - 2 * pad)) / span;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${target !== undefined ? `<line x1="${pad}" x2="${W - pad}" y1="${y(target)}" y2="${y(target)}" stroke="#3ecf8e" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>` : ''}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="3" vector-effect="non-scaling-stroke"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p[1])}" r="4" fill="${color}"/>`).join('')}
    <text x="4" y="14" fill="#93a0bd" font-size="13">${max} ${unit}</text><text x="4" y="${H - 4}" fill="#93a0bd" font-size="13">${min} ${unit}</text>
  </svg>`;
}

// ---------- Cartes « objectif » (réutilisées dans Accueil, piliers, Progrès) ----------
function sportGoalCard(compact) {
  const x = sportGoal(), g = x.g;
  const trendTxt = x.trend === null ? 'Pèse-toi 1 fois par semaine pour voir ta tendance.'
    : `Tendance : <b>${x.trend > 0 ? '+' : ''}${x.trend.toFixed(2).replace('.', ',')} kg/semaine</b>${x.eta ? ` → objectif atteint vers <b>${monthYear(x.eta)}</b>` : ''}`;
  return `<section class="card"><header><h2>⚖️ Objectif : moins de ${g.target + 1} kg</h2><span class="tag">${x.pct} %</span></header>
    <div class="row wrap"><div class="stat grow"><span class="muted small">Départ</span><b>${fmtKg(g.start)}</b></div>
      <div class="stat grow"><span class="muted small">Actuel</span><span class="big">${fmtKg(x.now)}</span></div>
      <div class="stat grow"><span class="muted small">Cible (${shortDate(g.targetDate)})</span><b>${fmtKg(g.target)}</b></div></div>
    ${bar(x.lost, x.total, AREAS.sport.color)}
    <p class="small">${x.lost > 0 ? `<b>${fmtKg(x.lost)}</b> perdus · ` : ''}encore ${fmtKg(Math.max(0, x.now - g.target))}. Rythme nécessaire : <b>${x.needed.toFixed(2).replace('.', ',')} kg/semaine</b>.</p>
    <p class="small">${trendTxt}</p>
    ${compact ? '' : `<ul class="list">${x.milestones.map(m => `<li><span>${m.done ? '✅' : '⬜'}</span><span class="grow">Palier ${m.kg === g.target ? `sous ${g.target + 1}` : m.kg} kg</span><span class="tag">prévu ${monthYear(m.date)}</span></li>`).join('')}</ul>`}
  </section>`;
}
function skillsGoalCard() {
  const x = skillsGoal();
  return `<section class="card"><header><h2>🎓 Objectif : ${esc(x.g.title)}</h2><span class="tag">${Math.min(100, Math.round((x.total / x.g.hours) * 100))} %</span></header>
    <div class="row"><span class="big">${x.total.toFixed(1).replace('.', ',')} h</span><span class="muted">sur ${x.g.hours} h de préparation</span></div>
    ${bar(x.total, x.g.hours, AREAS.skills.color)}
    <p class="small">Moyenne (4 dernières semaines) : <b>${x.avg.toFixed(1).replace('.', ',')} h/semaine</b>${x.eta ? ` → préparation terminée vers <b>${monthYear(x.eta)}</b>` : ''}.</p>
    <p class="small">${x.exam ? `Examen : <b>${shortDate(x.exam.examDate)}</b> (${inDays(daysBetween(today(), x.exam.examDate))})` : `Pas encore de date d'examen. Cible provisoire : <b>${monthYear(x.g.targetDate)}</b>. Réserve-la quand tu atteins ~${Math.round(x.g.hours * 0.7)} h.`}</p>
  </section>`;
}
function businessGoalCard() {
  const x = businessGoal();
  return `<section class="card"><header><h2>💶 Objectif : ${fmtEur(x.target)}/mois</h2><span class="tag">avant ${monthYear(x.targetDate)}</span></header>
    <div class="row"><span class="big">${fmtEur(x.month)}</span><span class="muted">encaissés ce mois-ci</span></div>
    ${bar(x.month, x.target, AREAS.business.color)}
    <div class="row wrap">
      <div class="stat grow"><span class="muted small">Contacts cette semaine</span><b class="${x.contacts >= x.g.contacts ? 'okc' : ''}">${x.contacts} / ${x.g.contacts}</b></div>
      <div class="stat grow"><span class="muted small">En cours</span><b>${x.open}</b></div>
      <div class="stat grow"><span class="muted small">Clients</span><b>${x.clients}</b></div></div>
    <p class="muted small">Le chiffre qui fait tout avancer : <b>le nombre d'entreprises contactées chaque semaine</b>.</p>
  </section>`;
}

// ---------- Écrans ----------
function vHome() {
  const now = new Date(), t = today(), d = day();
  const items = itemsOn(t);
  const late = sortTasks(S.tasks.filter(x => !x.done && x.due && x.due < t));
  const prio = sortTasks(S.tasks.filter(x => !x.done && x.priority === 'haute' && !(x.due && x.due < t))).slice(0, 6);
  const stuck = S.projects.filter(p => !nextAction(p));
  const nx = nextAlert();
  const adh = weekAdherence(null);
  const sunday = now.getDay() === 0 && !S.reviews.some(r => r.week === weekStart());
  const firstOfMonth = now.getDate() <= 3 && !S.monthReviews.some(r => r.month === monthKey(addDays(t, -now.getDate())));
  const openTasks = sortTasks(S.tasks.filter(x => !x.done));
  return `
  <h1>${longDate(t)}</h1>
  <p class="sub">${nx ? `🔔 Prochaine alerte : <b>${esc(shown(nx.r.area, nx.r.title))}</b>, ${nx.s === t ? "aujourd'hui" : shortDate(nx.s)} à ${nx.r.time}` : 'Aucune alerte programmée.'}
    ${adh.planned ? ` · Régularité de la semaine : <b>${adh.pct} %</b>` : ''}</p>
  ${alertBanner()}
  ${sunday ? `<div class="banner"><span class="grow">C'est dimanche : prends 20 minutes pour ton bilan de la semaine.</span><button class="ghost" data-a="go-review" data-m="week">Faire mon bilan →</button></div>` : ''}
  ${firstOfMonth ? `<div class="banner"><span class="grow">Nouveau mois : fais ton bilan du mois pour garder le cap.</span><button class="ghost" data-a="go-review" data-m="month">Bilan du mois →</button></div>` : ''}
  <div class="grid">
    <section class="card"><header><h2>📅 Aujourd'hui : coche ce que tu fais</h2><button class="small ghost" data-a="tab" data-tab="agenda">Agenda</button></header>
      ${items.length ? `<ul class="list">${items.map(it => agendaLine(it, t)).join('')}</ul>` : '<p class="muted">Rien de prévu.</p>'}
    </section>
    <section class="card"><header><h2>🎯 Mes 3 priorités du jour</h2></header>
      ${d.focus.map((p, i) => { const ft = p.task && task(p.task), masked = ft && hidden(ft.area); return `<div class="row">
        <input type="checkbox" data-a="focus-done" data-i="${i}" ${p.done ? 'checked' : ''}>
        <input class="grow ${p.done ? 'done' : ''}" data-c="focus-text" data-i="${i}" value="${esc(masked ? PRIVATE_LABEL : p.text)}" placeholder="Priorité ${i + 1}" ${masked ? 'readonly' : ''}>
        ${p.task ? '<span class="tag" title="Liée à une tâche">🔗</span>' : ''}
      </div>`; }).join('')}
      ${openTasks.length && d.focus.some(f => !f.text) ? `<select data-c="focus-pick"><option value="">＋ Choisir parmi mes tâches…</option>
        ${LIFE.concat('general').map(a => { const ts = openTasks.filter(x => x.area === a && !hidden(x.area)); return ts.length ? `<optgroup label="${AREAS[a].icon} ${AREAS[a].label}">${opts(ts.map(x => [x.id, x.title]))}</optgroup>` : ''; }).join('')}</select>` : ''}
    </section>
    ${sportGoalCard(true)}
    ${businessGoalCard()}
    ${balanceCard()}
    <section class="card"><header><h2>⚡ Mon énergie & mes habitudes</h2></header>
      <div class="row">${[1, 2, 3, 4, 5].map(n => `<button class="pill ${d.energy === n ? 'on' : ''}" data-a="energy" data-n="${n}">${n}</button>`).join('')}<span class="muted small">1 = épuisé · 5 = en forme</span></div>
      ${Object.entries(HABITS).map(([k, l]) => `<label class="row"><input type="checkbox" data-a="habit" data-k="${k}" ${d.habits[k] ? 'checked' : ''}> ${l}</label>`).join('')}
    </section>
    ${late.length ? `<section class="card"><header><h2 class="late">⏰ En retard</h2><span class="tag hot">${late.length}</span></header><ul class="list">${late.map(x => taskLine(x, true)).join('')}</ul></section>` : ''}
    <section class="card"><header><h2>🔥 Tâches prioritaires</h2></header>
      ${prio.length ? `<ul class="list">${prio.map(x => taskLine(x, true)).join('')}</ul>` : '<p class="muted">Aucune tâche prioritaire.</p>'}
    </section>
    <section class="card"><header><h2>➡️ Mes projets : prochaines actions</h2></header>
      <ul class="list">${S.projects.map(p => { const na = nextAction(p); return `<li class="top"><span class="dot" style="background:${AREAS[p.area].color};margin-top:6px"></span>
        <span class="grow"><b>${esc(shown(p.area, p.title))}</b><br>${na ? `<span class="small">${esc(shown(p.area, na.title))}</span>` : '<span class="small warn">⚠️ Aucune prochaine action</span>'}</span>
        ${na ? `<input type="checkbox" data-a="task-done" data-id="${na.id}" title="Fait">` : ''}</li>`; }).join('')}</ul>
      ${stuck.length ? `<p class="muted small">Un projet sans prochaine action n'avance pas : ajoute-lui une tâche.</p>` : ''}
    </section>
    ${upcomingCard()}
    ${tasksCard('general', '🧭 Organisation')}
    <section class="card"><header><h2>📥 Boîte de réception</h2><span class="tag">${S.inbox.length}</span></header>
      ${S.inbox.length ? `<ul class="list">${S.inbox.map(i => `<li class="row wrap">
        <span class="grow">${esc(i.text)}</span>
        <select data-c="inbox-move" data-id="${i.id}"><option value="">Ranger dans…</option>${opts(LIFE.concat('general').map(a => [a, `${AREAS[a].icon} Tâche ${AREAS[a].label}`]))}<option value="idea">💡 Idée pour ma femme</option><option value="prospect">💼 Prospect business</option></select>
        <button class="icon" data-a="inbox-del" data-id="${i.id}" title="Supprimer">✕</button></li>`).join('')}</ul>`
        : '<p class="muted">Vide. Appuie sur ＋ dès que quelque chose te passe par la tête.</p>'}
    </section>
  </div>`;
}
function agendaLine(it, s) {
  if (it.kind === 't') return `<li><span class="time">${esc(it.time || '—')}</span><input type="checkbox" data-a="task-done" data-id="${it.t.id}" ${it.t.done ? 'checked' : ''}>
    <span class="grow ${it.t.done ? 'done' : ''}">${esc(shown(it.area, it.title))}</span>${areaTag(it.area)}</li>`;
  const r = it.r, c = check(s, r.id), canCheck = r.track && s <= today();
  const missed = canCheck && !c && isDue(r, s) && s < today();
  return `<li class="${r.alert || r.track ? '' : 'off'}"><span class="time">${esc(it.time)}</span><span class="dot" style="background:${AREAS[it.area].color}"></span>
    <span class="grow ${c === 'done' ? 'done' : ''}">${esc(shown(it.area, it.title))}${missed ? ' <span class="tag hot">non coché</span>' : ''}</span>
    ${canCheck ? `<button class="chk ${c === 'done' ? 'yes' : ''}" data-a="check" data-id="${r.id}" data-d="${s}" data-v="done" title="Fait">✓</button>
      <button class="chk ${c === 'skip' ? 'no' : ''}" data-a="check" data-id="${r.id}" data-d="${s}" data-v="skip" title="Pas fait">✗</button>` : (r.alert ? '🔔' : '')}
  </li>`;
}
function balanceCard(wk = weekStart()) {
  return `<section class="card balance"><header><h2>⚖️ Mon équilibre cette semaine</h2></header>
    ${LIFE.map(a => { const m = weekMinutes(a, wk), adh = weekAdherence(a, wk); return `<div class="line"><div class="row"><span class="grow">${AREAS[a].icon} ${AREAS[a].label}</span>
      <span class="small">${fmtMin(m)} / ${fmtMin(S.targets[a])}${adh.planned ? ` · ${adh.done}/${adh.planned} ✓` : ''}</span></div>${bar(m, S.targets[a], AREAS[a].color)}</div>`; }).join('')}
    <p class="muted small">Séances de sport : <b>${sessionsCount(wk)}/${S.goals.sport.sessions}</b>.</p>
  </section>`;
}
function upcomingCard() {
  const t = today(), out = [];
  S.reminders.filter(r => r.type === 'yearly').forEach(r => { const s = nextYearly(r.date.slice(5)); const n = daysBetween(t, s); if (n <= 45) out.push([n, `${AREAS[r.area].icon} ${shown(r.area, r.title)}`, s]); });
  S.trainings.filter(x => x.examDate && x.examDate >= t).forEach(x => out.push([daysBetween(t, x.examDate), `🎓 Examen ${x.title}`, x.examDate]));
  S.projects.filter(p => p.deadline && p.deadline >= t).forEach(p => { const n = daysBetween(t, p.deadline); if (n <= 60) out.push([n, `${AREAS[p.area].icon} Échéance : ${shown(p.area, p.title)}`, p.deadline]); });
  S.tasks.filter(x => !x.done && x.due && x.due > t && daysBetween(t, x.due) <= 7).forEach(x => out.push([daysBetween(t, x.due), `${AREAS[x.area].icon} ${shown(x.area, x.title)}`, x.due]));
  S.prospects.filter(p => p.nextDate && !['won', 'lost'].includes(p.status) && daysBetween(t, p.nextDate) <= 7).forEach(p => out.push([daysBetween(t, p.nextDate), `💼 Relancer ${p.name}`, p.nextDate]));
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
  return `<h1>📅 Agenda</h1><p class="sub">Ton programme : coche ✓ ce que tu as fait, ✗ ce que tu n'as pas fait. C'est ce qui mesure ta régularité.</p>
  <div class="daynav">
    <button class="ghost" data-a="agenda-move" data-n="-1">◀</button>
    <h2>${longDate(s)}</h2>
    <button class="ghost" data-a="agenda-move" data-n="1">▶</button>
    ${s !== today() ? `<button class="small" data-a="agenda-today">Aujourd'hui</button>` : ''}
  </div>
  <div class="grid">
    <section class="card"><header><h2>Ce jour-là</h2></header>
      ${items.length ? `<ul class="list">${items.map(it => agendaLine(it, s)).join('')}</ul>` : '<p class="muted">Rien de prévu.</p>'}
      <details><summary>＋ Ajouter un rendez-vous ce jour-là</summary>
        <form class="form" data-f="event-add" data-date="${s}">
          <input name="title" placeholder="Ex. : dentiste, resto avec ma femme, appel client…" required>
          <div class="row wrap"><select name="area">${opts(Object.entries(AREAS).map(([k, a]) => [k, `${a.icon} ${a.label}`]))}</select>
            <label>Heure<input type="time" name="time" value="09:00" required></label></div>
          <label class="row"><input type="checkbox" name="alert" checked> M'envoyer une alerte</label>
          <button>Ajouter</button>
        </form></details>
    </section>
    <section class="card wide"><header><h2>Semaine du ${dayMonth(wk)}</h2>${(() => { const a = weekAdherence(null, wk); return a.planned ? `<span class="tag">Régularité ${a.pct} %</span>` : ''; })()}</header>
      <div class="week">${[0, 1, 2, 3, 4, 5, 6].map(i => { const x = addDays(wk, i); return `<div class="day ${x === today() ? 'today' : ''}">
        <h3 data-a="agenda-go" data-d="${x}">${DAYS_SHORT[parse(x).getDay()]} ${parse(x).getDate()}</h3>
        ${itemsOn(x).map(it => { const c = it.kind === 'r' ? check(x, it.r.id) : (it.t.done ? 'done' : ''); return `<div class="row top"><span class="dot" style="background:${AREAS[it.area].color};margin-top:5px"></span>
          <span class="${c === 'done' ? 'done' : ''}"><b>${esc(it.time)}</b> ${esc(shown(it.area, it.title))}${c === 'done' ? ' ✓' : c === 'skip' ? ' ✗' : ''}</span></div>`; }).join('')}
      </div>`; }).join('')}</div>
    </section>
    <section class="card wide"><header><h2>Toutes mes alertes</h2></header>
      <ul class="list">${[...S.reminders].sort((a, b) => a.time.localeCompare(b.time)).map(r => reminderLine(r, true)).join('')}</ul>
      <details><summary>＋ Ajouter un rappel</summary>${reminderForm(null)}</details>
    </section>
  </div>`;
}

function vSport() {
  const wk = weekStart(), n = sessionsCount(wk), body = weightSeries(), all = [...S.body].sort((a, b) => a.date.localeCompare(b.date));
  return `${areaHeader('sport', 'Objectif : passer sous les 90 kg. Régularité avant intensité.')}
  <div class="grid">
    ${sportGoalCard(false)}
    <section class="card"><header><h2>📏 Mes mesures</h2></header>
      ${lineChart(body.map(b => [b.date, b.weight]), AREAS.sport.color, 'kg', S.goals.sport.target)}
      <form class="form" data-f="body-add">
        <div class="row wrap"><input type="date" name="date" value="${today()}">
          <input name="weight" type="number" step="0.1" min="30" max="250" placeholder="Poids (kg)" style="width:9em">
          <input name="waist" type="number" step="0.5" min="40" max="200" placeholder="Taille (cm)" style="width:9em"></div>
        <button>Enregistrer la mesure</button>
      </form>
      <p class="muted small">Pèse-toi 1 fois par semaine, même jour, le matin à jeun. Le poids varie d'un jour à l'autre : seule la tendance compte.</p>
      ${all.length ? `<details><summary>Historique</summary><ul class="list">${[...all].reverse().map(b => `<li><span class="tag">${shortDate(b.date)}</span><span class="grow">${b.weight ?? '–'} kg · ${b.waist ?? '–'} cm</span><button class="icon" data-a="body-del" data-id="${b.id}">✕</button></li>`).join('')}</ul></details>` : ''}
    </section>
    <section class="card"><header><h2>Séances cette semaine</h2></header>
      <div class="row"><span class="big">${n} / ${S.goals.sport.sessions}</span><span class="muted">${n >= S.goals.sport.sessions ? 'Objectif atteint 💪' : `encore ${S.goals.sport.sessions - n}`}</span></div>
      ${bar(n, S.goals.sport.sessions, AREAS.sport.color)}
      <p class="small">Série en cours : <b>${streak()} semaine(s)</b> d'affilée avec ${S.goals.sport.sessions} séances.</p>
    </section>
    ${logCard('sport', 'Temps de sport', LOG_KINDS.sport)}
    ${projectsCard('sport', 'Mon projet')}
    ${tasksCard('sport')}
    ${remindersCard('sport')}
  </div>`;
}
// Semaines consécutives (terminées) où l'objectif de séances est atteint ; la semaine en cours compte si déjà atteinte.
function streak() {
  let n = sessionsCount(weekStart()) >= S.goals.sport.sessions ? 1 : 0;
  for (let w = addDays(weekStart(), -7); sessionsCount(w) >= S.goals.sport.sessions; w = addDays(w, -7)) n++;
  return n;
}

function vSkills() {
  return `${areaHeader('skills', 'Objectif : SC-300, puis évoluer vers IAM manager / chef de projet IAM.')}
  <div class="grid">
    ${skillsGoalCard()}
    ${logCard('skills', 'Temps de formation', S.trainings.map(t => t.title).concat('Lecture / podcast (train)', 'Pratique au travail'))}
    <section class="card"><header><h2>🎓 Mes formations</h2></header>
      ${S.trainings.map(t => {
        const left = t.examDate ? daysBetween(today(), t.examDate) : null;
        return `<div class="form">
          <div class="row"><h3 class="grow">${esc(t.title)}</h3><button class="icon" data-a="training-del" data-id="${t.id}" title="Supprimer">🗑</button></div>
          ${left !== null ? `<p class="small">Examen ${shortDate(t.examDate)} (<b>${inDays(left)}</b>)</p>` : ''}
          <label>Modules terminés : ${t.progress} %<input type="range" min="0" max="100" step="5" value="${t.progress}" data-c="training-progress" data-id="${t.id}"></label>
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
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return ds(d); });
  const active = S.prospects.filter(p => !['won', 'lost'].includes(p.status)).sort((a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999'));
  const closed = S.prospects.filter(p => ['won', 'lost'].includes(p.status));
  return `${areaHeader('business', 'Complément de revenu : 500 €/mois, puis 1 000 €/mois. Contacter, relancer, encaisser.')}
  <div class="grid">
    ${businessGoalCard()}
    <section class="card"><header><h2>🎯 Prospects</h2><span class="tag">${active.length} en cours</span></header>
      ${active.length ? `<ul class="list">${active.map(p => `<li class="top"><span class="grow"><b>${esc(p.name)}</b>${p.amount ? ` · ${fmtEur(p.amount)}` : ''}<br>
          <span class="small muted">${p.next ? `➡️ ${esc(p.next)}` : ''}${p.nextDate ? ` · <span class="${p.nextDate < today() ? 'late' : ''}">${shortDate(p.nextDate)}</span>` : ''}</span></span>
          <select data-c="prospect-status" data-id="${p.id}">${opts(Object.entries(PIPE), p.status)}</select>
          <button class="icon" data-a="prospect-edit" data-id="${p.id}" title="Modifier">✏️</button></li>`).join('')}</ul>`
        : '<p class="muted">Ajoute les entreprises ou personnes à qui proposer ton offre.</p>'}
      <details><summary>＋ Ajouter un prospect</summary>
        <form class="form" data-f="prospect-add">${prospectFields({})}<button>Ajouter</button></form></details>
      ${closed.length ? `<details><summary>Terminés (${closed.length})</summary><ul class="list">${closed.map(p => `<li><span class="grow">${esc(p.name)}</span><span class="tag">${PIPE[p.status]}</span>
        <select data-c="prospect-status" data-id="${p.id}">${opts(Object.entries(PIPE), p.status)}</select></li>`).join('')}</ul></details>` : ''}
    </section>
    <section class="card"><header><h2>💶 Revenus</h2></header>
      ${barsChart(months.map(m => monthRevenue(monthKey(m))), months.map(m => parse(m).toLocaleDateString('fr-FR', { month: 'short' })), AREAS.business.color, { line: businessGoal().target })}
      <form class="form" data-f="income-add">
        <div class="row wrap"><input name="amount" type="number" min="1" step="1" placeholder="Montant (€)" required style="width:9em">
          <input type="date" name="date" value="${today()}"><input name="client" class="grow" placeholder="Client"></div>
        <button>Enregistrer un paiement</button>
      </form>
      ${S.income.length ? `<details><summary>Historique</summary><ul class="list">${[...S.income].sort((a, b) => b.date.localeCompare(a.date)).map(i => `<li><span class="tag">${shortDate(i.date)}</span><b>${fmtEur(i.amount)}</b><span class="grow">${esc(i.client)}</span><button class="icon" data-a="income-del" data-id="${i.id}">✕</button></li>`).join('')}</ul></details>` : ''}
    </section>
    ${projectsCard('business')}
    ${tasksCard('business')}
    ${logCard('business', 'Temps passé sur mon business', LOG_KINDS.business)}
    ${remindersCard('business')}
  </div>`;
}
function prospectFields(p) {
  return `<input name="name" placeholder="Entreprise ou personne" value="${esc(p.name)}" required>
    <div class="row wrap"><select name="status">${opts(Object.entries(PIPE), p.status || 'todo')}</select>
      <input name="amount" type="number" min="0" step="10" placeholder="Montant estimé (€)" value="${p.amount || ''}" style="width:11em"></div>
    <input name="next" placeholder="Prochaine étape (ex. : envoyer le devis)" value="${esc(p.next)}">
    <label>Date de la prochaine étape<input type="date" name="nextDate" value="${esc(p.nextDate)}"></label>
    <input name="note" placeholder="Notes" value="${esc(p.note)}">`;
}

function vPerso() {
  const t = today();
  const dates = S.reminders.filter(r => r.area === 'perso' && r.type === 'yearly')
    .map(r => ({ r, s: nextYearly(r.date.slice(5)) })).sort((a, b) => a.s.localeCompare(b.s));
  const moments = weekAdherence('perso');
  return `${areaHeader('perso', 'Ton espace privé : prendre soin de ta femme, de ta famille et de toi.')}
  <div class="grid">
    ${remindersCard('perso', '❤️ Rappels pour mon couple et ma vie perso')}
    <section class="card"><header><h2>🎂 Dates importantes</h2></header>
      ${dates.length ? `<ul class="list">${dates.map(({ r, s }) => `<li><span class="grow">${esc(r.title)}<br><span class="muted small">${dayMonth(r.date)}${r.before ? ` · alerte ${r.before} j avant` : ''}</span></span>
        <span class="tag ${daysBetween(t, s) <= 7 ? 'hot' : ''}">${inDays(daysBetween(t, s))}</span><button class="icon" data-a="rem-edit" data-id="${r.id}">✏️</button></li>`).join('')}</ul>`
        : '<p class="muted">Ajoute l’anniversaire de ta femme, votre anniversaire de mariage… Tu recevras une alerte quelques jours avant pour préparer quelque chose.</p>'}
      <details><summary>＋ Ajouter une date</summary>${reminderForm('perso', 'yearly')}</details>
    </section>
    <section class="card"><header><h2>💡 Idées pour lui faire plaisir</h2></header>
      ${S.ideas.length ? `<ul class="list">${S.ideas.map(i => `<li><span class="grow">${esc(i.text)}</span><button class="icon" data-a="idea-del" data-id="${i.id}">✕</button></li>`).join('')}</ul>` : '<p class="muted">Note ici dès qu’elle mentionne une envie : un resto, un livre, une sortie…</p>'}
      <form class="row" data-f="idea-add"><input name="text" class="grow" placeholder="Nouvelle idée…" required><button>+</button></form>
    </section>
    <section class="card"><header><h2>Attentions cette semaine</h2></header>
      <div class="row"><span class="big">${moments.done} / ${moments.planned}</span><span class="muted">rappels perso cochés « Fait »</span></div>
      ${bar(moments.done, moments.planned || 1, AREAS.perso.color)}
    </section>
    ${logCard('perso', 'Temps de qualité', LOG_KINDS.perso)}
    ${tasksCard('perso', 'Mes tâches privées')}
  </div>`;
}

function vProgress() {
  const weeks = lastWeeks(12), wl = weeks.map(w => `${parse(w).getDate()}/${parse(w).getMonth() + 1}`);
  const scores = a => weeks.map(w => (S.reviews.find(r => r.week === w)?.scores?.[a]) || 0);
  const energy = weeks.map(w => { const v = Object.entries(S.days).filter(([k]) => inWeek(k, w)).map(([, x]) => x.energy).filter(Boolean); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
  const fourWeeks = adherence(null, addDays(weekStart(), -21), today());
  return `<h1>📈 Mes progrès</h1><p class="sub">Tes objectifs, ta régularité et ton évolution sur 12 semaines.</p>
  <div class="grid">
    ${sportGoalCard(false)}
    ${skillsGoalCard()}
    ${businessGoalCard()}
    <section class="card"><header><h2>✅ Régularité (4 dernières semaines)</h2><span class="tag">${fourWeeks.pct ?? '–'} %</span></header>
      ${LIFE.map(a => { const x = adherence(a, addDays(weekStart(), -21), today()); return `<div class="line"><div class="row"><span class="grow">${AREAS[a].icon} ${AREAS[a].label}</span><span class="small">${x.done}/${x.planned} · ${x.pct ?? '–'} %</span></div>${bar(x.done, x.planned, AREAS[a].color)}</div>`; }).join('')}
      <p class="muted small">Part de ton programme réellement fait. Au-dessus de 70 %, tu progresses ; en dessous, allège le programme plutôt que de culpabiliser.</p>
    </section>
    ${LIFE.map(a => `<section class="card"><header><h2>${AREAS[a].icon} Temps ${AREAS[a].label} (h/semaine)</h2></header>
      ${barsChart(weeks.map(w => Math.round(weekMinutes(a, w) / 6) / 10), wl, AREAS[a].color, { line: S.targets[a] / 60 })}</section>`).join('')}
    <section class="card"><header><h2>💪 Séances par semaine</h2><span class="tag">Série : ${streak()} sem.</span></header>
      ${barsChart(weeks.map(sessionsCount), wl, AREAS.sport.color, { line: S.goals.sport.sessions })}</section>
    <section class="card"><header><h2>⚡ Énergie moyenne</h2></header>${barsChart(energy.map(e => Math.round(e * 10) / 10), wl, '#3ecf8e', { max: 5 })}</section>
    <section class="card wide"><header><h2>📊 Satisfaction par pilier (bilans)</h2></header>
      <div class="grid">${LIFE.map(a => `<div><p class="small">${AREAS[a].icon} ${AREAS[a].label}</p>${barsChart(scores(a), wl, AREAS[a].color, { max: 10 })}</div>`).join('')}</div>
    </section>
  </div>`;
}

function vReview() {
  return `<h1>📊 Bilan</h1>
  <div class="row" style="margin:6px 0 16px"><button class="${reviewMode === 'week' ? '' : 'ghost'}" data-a="review-mode" data-m="week">Bilan de la semaine</button>
    <button class="${reviewMode === 'month' ? '' : 'ghost'}" data-a="review-mode" data-m="month">Bilan du mois</button></div>
  ${reviewMode === 'week' ? weekReview() : monthReview()}`;
}
function weekReview() {
  const wk = weekStart(), checks = S.reviewChecks[wk] || {};
  const cur = S.reviews.find(r => r.week === wk) || { scores: {} };
  const doneThisWeek = a => S.tasks.filter(x => x.area === a && x.done && x.doneAt && inWeek(x.doneAt, wk)).length;
  const steps = [
    'Vider ma boîte de réception',
    'Cocher ✓ / ✗ mon programme de la semaine dans l’agenda',
    'Me peser et noter mon poids',
    "Business : relancer mes prospects, faire un point d'avancement",
    'Vérifier que chaque projet a une prochaine action',
    'Préparer la semaine : séances, formation, business, moment à deux',
    'Exporter une sauvegarde si la sauvegarde automatique ne fonctionne pas',
  ];
  const energy = Object.entries(S.days).filter(([k]) => inWeek(k, wk)).map(([, v]) => v.energy).filter(Boolean);
  const adh = weekAdherence(null, wk), bz = businessGoal();
  return `<p class="sub">Semaine du ${dayMonth(wk)}. 20 minutes le dimanche pour garder le cap.</p>
  <div class="grid">
    ${balanceCard(wk)}
    <section class="card"><header><h2>Les chiffres de la semaine</h2></header>
      <ul class="list">
        <li><span class="grow">✅ Programme fait</span><span class="tag">${adh.done}/${adh.planned} · ${adh.pct ?? '–'} %</span></li>
        <li><span class="grow">⚖️ Poids actuel</span><span class="tag">${fmtKg(weightNow())}</span></li>
        <li><span class="grow">💼 Entreprises contactées</span><span class="tag">${bz.contacts}/${bz.g.contacts}</span></li>
        ${LIFE.map(a => `<li><span class="grow">${AREAS[a].icon} Tâches faites</span><span class="tag">${doneThisWeek(a)}</span></li>`).join('')}
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
// Bilan du mois : par défaut le mois écoulé dans les 7 premiers jours, sinon le mois en cours.
function reviewMonth() { const d = new Date(); return d.getDate() <= 7 ? monthKey(addDays(today(), -d.getDate())) : monthKey(today()); }
function monthReview() {
  const mk = reviewMonth(), first = `${mk}-01`;
  const end = (() => { const d = parse(first); d.setMonth(d.getMonth() + 1); d.setDate(0); return ds(d); })();
  const cur = S.monthReviews.find(r => r.month === mk) || {};
  const adh = adherence(null, first, end < today() ? end : today());
  const w = weightSeries().filter(b => b.date >= first && b.date <= end);
  const skillsH = S.logs.filter(l => l.area === 'skills' && monthKey(l.date) === mk).reduce((a, l) => a + l.minutes, 0) / 60;
  const contacts = S.prospects.filter(p => p.contactedAt && monthKey(p.contactedAt) === mk).length;
  return `<p class="sub">${cap(monthYear(first))} : prends du recul. Est-ce que tu te rapproches de tes objectifs ?</p>
  <div class="grid">
    <section class="card"><header><h2>Le mois en chiffres</h2></header>
      <ul class="list">
        <li><span class="grow">✅ Programme fait</span><span class="tag">${adh.done}/${adh.planned} · ${adh.pct ?? '–'} %</span></li>
        <li><span class="grow">⚖️ Poids</span><span class="tag">${w.length >= 2 ? `${fmtKg(w[0].weight)} → ${fmtKg(w[w.length - 1].weight)}` : w.length ? fmtKg(w[0].weight) : 'pas de pesée'}</span></li>
        <li><span class="grow">🛡️ Formation</span><span class="tag">${skillsH.toFixed(1).replace('.', ',')} h</span></li>
        <li><span class="grow">💼 Entreprises contactées</span><span class="tag">${contacts}</span></li>
        <li><span class="grow">💶 Encaissé</span><span class="tag">${fmtEur(monthRevenue(mk))}</span></li>
      </ul>
    </section>
    ${sportGoalCard(true)}
    ${skillsGoalCard()}
    ${businessGoalCard()}
    <form class="card wide" data-f="month-save" data-m="${mk}"><header><h2>Mon bilan du mois</h2></header>
      <label>Est-ce que je me rapproche de mes objectifs ? Où est l'écart ?<textarea name="gap" rows="3">${esc(cur.gap)}</textarea></label>
      <label>Qu'est-ce que je change le mois prochain (programme, horaires, priorités) ?<textarea name="change" rows="3">${esc(cur.change)}</textarea></label>
      <label>Mes 3 objectifs pour le mois prochain<textarea name="goals" rows="3">${esc(cur.goals)}</textarea></label>
      ${hidden('perso') ? `<input type="hidden" name="perso" value="${esc(cur.perso)}"><p class="muted small">🔒 La question sur ton couple est dans l'espace Perso verrouillé.</p>` : `<label>Mon couple et ma famille : comment ça va ?<textarea name="perso" rows="2">${esc(cur.perso)}</textarea></label>`}
      <button>Enregistrer le bilan du mois</button>
    </form>
    <section class="card wide"><header><h2>Bilans des mois précédents</h2></header>
      ${S.monthReviews.length ? [...S.monthReviews].sort((a, b) => b.month.localeCompare(a.month)).map(r => `<div class="form"><b>${cap(monthYear(r.month + '-01'))}</b>
        ${r.gap ? `<p>📏 ${esc(r.gap)}</p>` : ''}${r.change ? `<p>🔧 ${esc(r.change)}</p>` : ''}${r.goals ? `<p>🎯 ${esc(r.goals)}</p>` : ''}${r.perso && !hidden('perso') ? `<p>❤️ ${esc(r.perso)}</p>` : ''}</div>`).join('')
        : '<p class="muted">Ton premier bilan du mois apparaîtra ici.</p>'}
    </section>
  </div>`;
}

function vSettings() {
  const st = alertState, g = S.goals;
  return `<h1>⚙️ Réglages</h1><p class="sub">Alertes, objectifs et sauvegarde.</p>
  <div class="grid">
    <section class="card"><header><h2>🔔 Alertes</h2></header>
      ${NATIVE ? `
        <p>Notifications : <b>${st.perm === 'granted' ? 'autorisées ✅' : 'non autorisées ❌'}</b></p>
        <p>Alertes à l'heure exacte : <b>${st.exact === 'granted' ? 'oui ✅' : 'non (à quelques minutes près)'}</b></p>
        <p>Alertes programmées : <b>${st.count}</b></p>
        ${st.error ? `<p class="late">${esc(st.error)}</p>` : ''}
        <div class="row wrap"><button data-a="alerts-enable">Autoriser les alertes</button><button class="ghost" data-a="alerts-test">Tester (dans 10 s)</button></div>
        <p class="muted small">Chaque alerte a deux boutons : « ✓ Fait » (coche dans l'agenda) et « ⏰ Dans 30 min ». Si les alertes n'arrivent pas : Paramètres Android → Applications → Ma Vie → Batterie → « Sans restriction ».</p>`
        : '<p class="muted">Les alertes fonctionnent uniquement dans l’application Android installée.</p>'}
    </section>
    <form class="card" data-f="goals"><header><h2>🎯 Mes objectifs</h2></header>
      <p class="muted small">💪 Poids</p>
      <div class="row wrap"><label>Départ (kg)<input type="number" name="start" step="0.1" value="${g.sport.start}" style="width:7em"></label>
        <label>Cible (kg)<input type="number" name="target" step="0.1" value="${g.sport.target}" style="width:7em"></label>
        <label>Pour le<input type="date" name="targetDate" value="${g.sport.targetDate}"></label></div>
      <label>Séances de sport par semaine<input type="number" name="sessions" min="0" max="14" value="${g.sport.sessions}"></label>
      <p class="muted small">🛡️ Formation</p>
      <div class="row wrap"><label>Heures de préparation SC-300<input type="number" name="hours" min="1" max="500" value="${g.skills.hours}" style="width:7em"></label>
        <label>Examen visé vers<input type="date" name="skillsDate" value="${g.skills.targetDate}"></label></div>
      <p class="muted small">💼 Business</p>
      <div class="row wrap"><label>1er palier (€/mois)<input type="number" name="step1" value="${g.business.step1}" style="width:7em"></label><label>avant le<input type="date" name="date1" value="${g.business.date1}"></label></div>
      <div class="row wrap"><label>2e palier (€/mois)<input type="number" name="step2" value="${g.business.step2}" style="width:7em"></label><label>avant le<input type="date" name="date2" value="${g.business.date2}"></label></div>
      <label>Entreprises à contacter par semaine<input type="number" name="contacts" min="0" max="50" value="${g.business.contacts}"></label>
      <p class="muted small">⏱️ Temps visé par semaine (heures)</p>
      <div class="row wrap">${LIFE.map(a => `<label>${AREAS[a].icon}<input type="number" name="t_${a}" min="0" max="80" step="0.5" value="${S.targets[a] / 60}" style="width:6em"></label>`).join('')}</div>
      <button>Enregistrer mes objectifs</button>
    </form>
    ${pinCard()}
    <section class="card"><header><h2>💾 Sauvegarde</h2></header>
      ${NATIVE ? `<p>Sauvegarde automatique : <b>${S.backup.last ? `${shortDate(S.backup.last)} → ${esc(S.backup.where)}` : 'pas encore faite'}</b></p>
        ${S.backup.error ? `<p class="muted small">Détail : ${esc(S.backup.error)}</p>` : ''}
        <p class="muted small">Une copie est faite chaque jour à l'ouverture (14 jours gardés), dans le dossier Documents/MaVie de la tablette. Pour restaurer : « Importer » et choisir le fichier.</p>
        <button class="ghost" data-a="backup-now">Sauvegarder maintenant</button>`
        : '<p class="muted">La sauvegarde automatique fonctionne dans l’application Android.</p>'}
      <div class="row wrap">
        <button data-a="export">Exporter / partager</button>
        <label class="btn ghost">Importer<input type="file" accept=".json,application/json" data-c="import" hidden></label>
      </div>
      <button class="danger" data-a="reset">Tout effacer et repartir du modèle</button>
    </section>
  </div>`;
}

function vLocked() {
  const wait = Math.ceil((pinBlockedUntil - Date.now()) / 1000);
  return `<h1>❤️ Vie privée & couple</h1><p class="sub">Cet espace est protégé par un code PIN.</p>
  <div class="grid"><form class="card" data-f="pin-unlock"><header><h2>🔒 Entre ton code</h2></header>
    <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="Code PIN" required>
    ${wait > 0 ? `<p class="late">Trop d'essais. Réessaie dans ${wait} s.</p>` : ''}
    <button>Déverrouiller</button>
    <details><summary>Code oublié ?</summary>
      <p class="muted small">Le code ne peut pas être récupéré. Tu peux retirer le code en effaçant le contenu de l'espace Perso (rappels, dates, idées, tâches et temps perso). Le reste de l'application est conservé.</p>
      <button type="button" class="danger" data-a="pin-forgot">Effacer l'espace Perso et retirer le code</button>
    </details>
  </form></div>`;
}
function pinCard() {
  const pinInput = (name, ph) => `<input name="${name}" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="off" placeholder="${ph}" required>`;
  return `<section class="card"><header><h2>🔒 Code PIN de l'espace Perso</h2></header>
    ${S.pin ? `<p>Code actif ✅ L'espace Perso se reverrouille dès que tu le quittes ou que tu fermes l'application.</p>
      <label class="row"><input type="checkbox" data-c="pin-notif" ${S.pin.hideNotif ? 'checked' : ''}> Masquer aussi le texte des alertes perso (« ❤️ Rappel privé »)</label>
      <details><summary>Changer le code</summary><form class="form" data-f="pin-change">${pinInput('current', 'Code actuel')}${pinInput('pin', 'Nouveau code (4 à 6 chiffres)')}${pinInput('pin2', 'Confirmer le nouveau code')}<button>Changer le code</button></form></details>
      <details><summary>Retirer le code</summary><form class="form" data-f="pin-remove">${pinInput('current', 'Code actuel')}<button class="danger">Retirer le code</button></form></details>`
    : `<p class="muted">Protège ton espace privé : rappels pour ton couple, dates importantes, idées cadeaux. Ces éléments seront aussi masqués sur l'accueil et dans l'agenda.</p>
      <form class="form" data-f="pin-set">${pinInput('pin', 'Code (4 à 6 chiffres)')}${pinInput('pin2', 'Confirmer le code')}
        <label class="row"><input type="checkbox" name="hideNotif" checked> Masquer aussi le texte des alertes perso</label>
        <button>Activer le code</button></form>`}
    <p class="muted small">Le code empêche quelqu'un qui prend ta tablette de lire ton espace privé. Ce n'est pas un chiffrement : les sauvegardes et exports contiennent tes données en clair.</p>
  </section>`;
}

const VIEWS = { home: vHome, agenda: vAgenda, sport: vSport, skills: vSkills, business: vBusiness, perso: () => (hidden('perso') ? vLocked() : vPerso()), progress: vProgress, review: vReview, settings: vSettings };

function render() {
  document.getElementById('nav').innerHTML = NAV.map(([k, i, l]) => `<button data-a="tab" data-tab="${k}" class="${k === tab ? 'active' : ''}">${i}<span>${l}</span></button>`).join('');
  // Garde ouverts les volets d'historique que l'utilisateur avait dépliés (pas les formulaires d'ajout)
  const main = document.getElementById('main');
  const open = [...main.querySelectorAll('details')].map(d => d.open);
  main.innerHTML = VIEWS[tab]();
  main.querySelectorAll('details').forEach((d, i) => { if (open[i] && !d.querySelector('form[data-f]')) d.open = true; });
}

// ---------- Fenêtre de modification ----------
function openEdit(title, html, delAction, id) {
  const dlg = document.getElementById('edit');
  dlg.innerHTML = `<div class="row"><h2 class="grow">${title}</h2><button class="icon" data-a="edit-close">✕</button></div>${html}
    ${delAction ? `<button class="danger" data-a="${delAction}" data-id="${id}">Supprimer</button>` : ''}`;
  dlg.showModal();
  return false;
}
const closeEdit = () => document.getElementById('edit').close();

// ---------- Actions ----------
const task = id => S.tasks.find(t => t.id === id);
const rem = id => S.reminders.find(r => r.id === id);
const CLICK = {
  tab: el => { if (el.dataset.tab !== 'perso') persoUnlocked = false; tab = el.dataset.tab; document.getElementById('main').innerHTML = ''; render(); window.scrollTo(0, 0); return false; },
  'go-review': el => { reviewMode = el.dataset.m; return CLICK.tab({ dataset: { tab: 'review' } }); },
  'review-mode': el => { reviewMode = el.dataset.m; render(); return false; },
  capture: () => { const d = document.getElementById('capture'); d.showModal(); d.querySelector('textarea').focus(); return false; },
  'capture-close': () => { document.getElementById('capture').close(); return false; },
  'edit-close': () => { closeEdit(); return false; },
  'focus-done': el => {
    const p = day().focus[el.dataset.i]; p.done = !p.done;
    const t = p.task && task(p.task); if (t) { t.done = p.done; t.doneAt = p.done ? today() : ''; }
  },
  energy: el => { const d = day(), n = +el.dataset.n; d.energy = d.energy === n ? 0 : n; },
  habit: el => { const h = day().habits; h[el.dataset.k] = !h[el.dataset.k]; },
  check: el => { setCheck(rem(el.dataset.id), el.dataset.d, el.dataset.v); },
  'task-done': el => { const t = task(el.dataset.id); t.done = !t.done; t.doneAt = t.done ? today() : ''; },
  'task-tomorrow': el => { task(el.dataset.id).due = addDays(today(), 1); },
  'task-edit': el => { const t = task(el.dataset.id); return openEdit('Modifier la tâche', `<form class="form" data-f="task-edit" data-id="${t.id}">${taskFields(t)}<button>Enregistrer</button></form>`, 'task-del', t.id); },
  'task-del': el => { S.tasks = S.tasks.filter(t => t.id !== el.dataset.id); closeEdit(); },
  'proj-edit': el => {
    const p = S.projects.find(x => x.id === el.dataset.id);
    return openEdit('Modifier le projet', `<form class="form" data-f="proj-edit" data-id="${p.id}">
      <input name="title" value="${esc(p.title)}" required><input name="goal" value="${esc(p.goal)}" placeholder="Objectif">
      <label>Échéance<input type="date" name="deadline" value="${esc(p.deadline)}"></label><button>Enregistrer</button></form>`, 'proj-del', p.id);
  },
  'proj-del': el => {
    if (!confirm('Supprimer ce projet ? Ses tâches sont conservées.')) return false;
    S.projects = S.projects.filter(p => p.id !== el.dataset.id);
    S.tasks.forEach(t => { if (t.project === el.dataset.id) t.project = ''; });
    closeEdit();
  },
  'rem-toggle': el => { const r = rem(el.dataset.id); r.alert = !r.alert; },
  'rem-edit': el => { const r = rem(el.dataset.id); return openEdit('Modifier le rappel', reminderForm(null, r.type, r, 'rem-edit'), 'rem-del', r.id); },
  'rem-del': el => { if (!confirm('Supprimer ce rappel ?')) return false; S.reminders = S.reminders.filter(r => r.id !== el.dataset.id); closeEdit(); },
  'prospect-edit': el => { const p = S.prospects.find(x => x.id === el.dataset.id); return openEdit('Modifier le prospect', `<form class="form" data-f="prospect-edit" data-id="${p.id}">${prospectFields(p)}<button>Enregistrer</button></form>`, 'prospect-del', p.id); },
  'prospect-del': el => { if (!confirm('Supprimer ce prospect ?')) return false; S.prospects = S.prospects.filter(p => p.id !== el.dataset.id); closeEdit(); },
  'income-del': el => { S.income = S.income.filter(i => i.id !== el.dataset.id); },
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
    Native.LocalNotifications.schedule({ notifications: [{ id: SNOOZE_BASE - 1, title: '🔔 Test réussi', body: 'Les alertes de Ma Vie fonctionnent.', schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true }, actionTypeId: 'MAVIE', extra: { kind: 'info' } }] })
      .then(() => alert('Alerte de test programmée dans 10 secondes. Tu peux fermer l’application.'))
      .catch(e => alert('Erreur : ' + (e.message || e)));
    return false;
  },
  'backup-now': () => { autoBackup(true).then(render); return false; },
  export: () => {
    if (!S.pin) { exportData(); return false; }
    const pin = prompt("Code PIN de l'espace Perso (l'export contient tes données privées) :");
    if (pin) checkPin(pin).then(ok => (ok ? exportData() : alert('Code incorrect.')));
    return false;
  },
  'pin-forgot': () => {
    if (!confirm("Effacer tout le contenu de l'espace Perso et retirer le code ? C'est définitif.")) return false;
    const gone = new Set(S.reminders.filter(r => r.area === 'perso').map(r => r.id));
    S.reminders = S.reminders.filter(r => !gone.has(r.id));
    S.tasks = S.tasks.filter(t => t.area !== 'perso');
    S.logs = S.logs.filter(l => l.area !== 'perso');
    S.projects = S.projects.filter(p => p.area !== 'perso');
    S.ideas = [];
    Object.values(S.checks).forEach(c => gone.forEach(id => delete c[id]));
    S.monthReviews.forEach(r => { r.perso = ''; });
    S.pin = null;
  },
  reset: () => { if (!confirm('Effacer toutes tes données et repartir du modèle de départ ?')) return false; S = seed(); },
};
const CHANGE = {
  'focus-text': el => { const f = day().focus[el.dataset.i]; f.text = el.value.trim(); f.task = ''; return 'norender'; },
  'focus-pick': el => {
    const t = task(el.value), f = day().focus.find(x => !x.text);
    if (!t || !f) return false;
    f.text = t.title; f.task = t.id; f.done = false;
  },
  rtype: el => { el.form.dataset.type = el.value; return false; },
  'pin-notif': el => { S.pin.hideNotif = el.checked; },
  'inbox-move': el => {
    const item = S.inbox.find(i => i.id === el.dataset.id);
    if (!item || !el.value) return false;
    if (el.value === 'idea') S.ideas.push({ id: uid(), text: item.text });
    else if (el.value === 'prospect') S.prospects.push({ id: uid(), name: item.text, status: 'todo', amount: 0, next: '', nextDate: '', note: '', contactedAt: '' });
    else S.tasks.push({ id: uid(), area: el.value, title: item.text, project: '', priority: 'normale', due: '', time: '', remind: false, done: false, doneAt: '' });
    S.inbox = S.inbox.filter(i => i !== item);
  },
  'prospect-status': el => { setProspectStatus(S.prospects.find(p => p.id === el.dataset.id), el.value); },
  'training-progress': el => { S.trainings.find(t => t.id === el.dataset.id).progress = +el.value; },
  'training-exam': el => { S.trainings.find(t => t.id === el.dataset.id).examDate = el.value; },
  import: el => { importData(el.files[0]); return false; },
};
// Le premier passage au-delà de « À contacter » compte comme un contact de la semaine.
function setProspectStatus(p, status) {
  p.status = status;
  if (status !== 'todo' && !p.contactedAt) p.contactedAt = today();
}
function remFromForm(d, fd, base = {}) {
  const days = fd.getAll('days').map(Number);
  if (d.type === 'weekly' && !days.length) { alert('Choisis au moins un jour.'); return null; }
  if ((d.type === 'once' || d.type === 'yearly') && !d.date) { alert('Choisis une date.'); return null; }
  return {
    ...base, area: d.area, title: d.title, type: d.type, time: d.time, days, date: d.date, day: +d.day || 1,
    before: d.type === 'yearly' ? +d.before || 0 : 0, note: d.note, duration: +d.duration || 0, track: !!d.track,
  };
}
const validPin = (a, b) => {
  if (!/^\d{4,6}$/.test(a)) { alert('Le code doit contenir 4 à 6 chiffres.'); return false; }
  if (a !== b) { alert('Les deux codes ne sont pas identiques.'); return false; }
  return true;
};
async function setPin(pin, hideNotif) {
  const salt = uid();
  S.pin = { salt, hash: await hashPin(pin, salt), hideNotif };
  persoUnlocked = false;
  save(); render();
}
const SUBMIT = {
  'pin-unlock': (f, d) => {
    if (Date.now() < pinBlockedUntil) { render(); return false; }
    checkPin(d.pin).then(ok => {
      if (ok) { persoUnlocked = true; pinFails = 0; }
      else {
        pinFails++;
        if (pinFails >= 5) { pinBlockedUntil = Date.now() + 30000; pinFails = 0; setTimeout(render, 30500); }
        alert('Code incorrect.');
      }
      render();
    });
    return false;
  },
  'pin-set': (f, d) => { if (validPin(d.pin, d.pin2)) setPin(d.pin, !!d.hideNotif).then(() => alert('Code activé.')); return false; },
  'pin-change': (f, d) => {
    if (!validPin(d.pin, d.pin2)) return false;
    checkPin(d.current).then(ok => (ok ? setPin(d.pin, S.pin.hideNotif).then(() => alert('Code changé.')) : alert('Code actuel incorrect.')));
    return false;
  },
  'pin-remove': (f, d) => {
    checkPin(d.current).then(ok => { if (!ok) return alert('Code incorrect.'); S.pin = null; save(); render(); alert('Code retiré.'); });
    return false;
  },
  capture: (f, d) => { S.inbox.push({ id: uid(), text: d.text, created: today() }); document.getElementById('capture').close(); },
  'task-add': (f, d) => {
    S.tasks.push({ id: uid(), area: f.dataset.area, title: d.title, project: d.project || '', priority: d.priority, due: d.due, time: d.time, remind: !!d.remind && !!d.due, done: false, doneAt: '' });
  },
  'task-edit': (f, d) => { Object.assign(task(f.dataset.id), { title: d.title, project: d.project || '', priority: d.priority, due: d.due, time: d.time, remind: !!d.remind && !!d.due }); closeEdit(); },
  'rem-add': (f, d, fd) => { const r = remFromForm(d, fd, { id: uid(), alert: true, created: today() }); if (!r) return false; S.reminders.push(r); },
  'rem-edit': (f, d, fd) => { const r = rem(f.dataset.id), v = remFromForm(d, fd, r); if (!v) return false; Object.assign(r, v); closeEdit(); },
  'event-add': (f, d) => { S.reminders.push({ id: uid(), area: d.area, title: d.title, type: 'once', time: d.time, days: [], date: f.dataset.date, day: 1, before: 0, note: '', alert: !!d.alert, track: false, duration: 0, created: today() }); },
  'log-add': (f, d) => {
    const minutes = parseInt(d.minutes, 10);
    if (!(minutes > 0)) return false;
    S.logs.push({ id: uid(), area: f.dataset.area, kind: d.kind, minutes, note: d.note, date: d.date || today() });
  },
  'proj-add': (f, d) => { S.projects.push({ id: uid(), area: f.dataset.area, title: d.title, goal: d.goal, deadline: d.deadline, updates: [] }); },
  'proj-edit': (f, d) => { Object.assign(S.projects.find(x => x.id === f.dataset.id), { title: d.title, goal: d.goal, deadline: d.deadline }); closeEdit(); },
  'proj-update': (f, d) => { S.projects.find(x => x.id === f.dataset.id).updates.push({ id: uid(), date: today(), pct: +d.pct, text: d.text }); },
  'prospect-add': (f, d) => {
    const p = { id: uid(), name: d.name, status: 'todo', amount: +d.amount || 0, next: d.next, nextDate: d.nextDate, note: d.note, contactedAt: '' };
    setProspectStatus(p, d.status); S.prospects.push(p);
  },
  'prospect-edit': (f, d) => {
    const p = S.prospects.find(x => x.id === f.dataset.id);
    Object.assign(p, { name: d.name, amount: +d.amount || 0, next: d.next, nextDate: d.nextDate, note: d.note });
    setProspectStatus(p, d.status); closeEdit();
  },
  'income-add': (f, d) => { const amount = parseFloat(d.amount); if (!(amount > 0)) return false; S.income.push({ id: uid(), amount, date: d.date || today(), client: d.client }); },
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
  'month-save': (f, d) => {
    const month = f.dataset.m;
    S.monthReviews = S.monthReviews.filter(r => r.month !== month);
    S.monthReviews.push({ month, gap: d.gap, change: d.change, goals: d.goals, perso: d.perso });
    alert('Bilan du mois enregistré.');
  },
  goals: (f, d) => {
    const g = S.goals, num = (v, def) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : def);
    g.sport.start = num(d.start, g.sport.start); g.sport.target = num(d.target, g.sport.target);
    g.sport.targetDate = d.targetDate || g.sport.targetDate; g.sport.sessions = num(d.sessions, g.sport.sessions);
    g.skills.hours = num(d.hours, g.skills.hours); g.skills.targetDate = d.skillsDate || g.skills.targetDate;
    g.business.step1 = num(d.step1, g.business.step1); g.business.date1 = d.date1 || g.business.date1;
    g.business.step2 = num(d.step2, g.business.step2); g.business.date2 = d.date2 || g.business.date2;
    g.business.contacts = num(d.contacts, g.business.contacts);
    LIFE.forEach(a => { const h = parseFloat(d['t_' + a]); if (h >= 0) S.targets[a] = Math.round(h * 60); });
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
    if (![2, 3].includes(data.version) || !Array.isArray(data.tasks)) throw new Error();
    if (!confirm('Remplacer tes données actuelles par cette sauvegarde ?')) return;
    S = migrate(data); save(); render();
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
  if (res !== false && f.isConnected) f.reset();
  after(res);
});

// ---------- Démarrage ----------
S = load();
render();
document.addEventListener('visibilitychange', () => { if (document.hidden && persoUnlocked) { persoUnlocked = false; render(); } });
if (NATIVE) {
  setupNotificationActions().catch(() => {});
  // Reprogramme les alertes à chaque ouverture (renouvelle aussi les dates annuelles) + sauvegarde du jour.
  syncAlerts().then(() => autoBackup()).then(render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAlerts().then(() => autoBackup()).then(render); });
}
