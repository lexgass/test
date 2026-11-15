'use strict';
// Toutes les données sont stockées sur l'appareil (localStorage). Pas de compte, pas de serveur.
const KEY = 'mavie-v1';
const DOMAINS = { carriere: 'Carrière IAM', business: 'Business', energie: 'Énergie & santé' };
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MOMENTS = { matin: 'Matin', midi: 'Midi', soir: 'Soir' };
const HABITS = { sommeil: 'Couché avant 22h30', marche: 'Marché 20 minutes', ecrans: "Pas d'écran après 22h" };
const REVIEW_STEPS = [
  'Vider ma boîte de réception (ranger ou supprimer chaque note)',
  'Relire mes projets et cocher ce qui est fait',
  'Regarder mon énergie et mes habitudes de la semaine',
  'Choisir mes 3 priorités pour la semaine prochaine',
  'Vérifier mes créneaux de formation et de business',
];

let tab = 'today';
let S; // chargé plus bas, une fois les fonctions définies

// ---------- Outils ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ds = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ds(new Date());
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const byTime = (a, b) => a.time.localeCompare(b.time);
const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`);
const shortDate = d => new Date(d + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const bar = (v, max) => `<div class="bar"><div style="width:${max ? Math.min(100, Math.round((v / max) * 100)) : 0}%"></div></div>`;
const proj = id => S.projects.find(p => p.id === id);
function weekStart(d) { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ds(x); }
function lastDays(n) { const out = []; for (let i = 0; i < n; i++) { const d = new Date(); d.setDate(d.getDate() - i); out.push(ds(d)); } return out; }
function day(d = today()) {
  return (S.days[d] ||= { priorities: [0, 1, 2].map(() => ({ text: '', done: false })), energy: {}, habits: {} });
}
function weekMinutes() {
  const wk = weekStart(new Date());
  return S.sessions.filter(s => weekStart(new Date(s.date + 'T12:00')) === wk).reduce((a, s) => a + s.minutes, 0);
}

// ---------- Données ----------
function seed() {
  const P = (domain, title, tasks) => ({ id: uid(), domain, title, tasks: tasks.map(text => ({ id: uid(), text, done: false })) });
  const schedule = [];
  const slot = (day, time, text) => schedule.push({ id: uid(), day, time, text });
  for (let d = 1; d <= 5; d++) slot(d, '07:00', 'Train : lecture ou podcast (IAM / business)');
  for (let d = 0; d <= 6; d++) slot(d, '22:30', 'Au lit');
  slot(2, '20:45', 'Formation légère : 30 min (vidéo, lecture)');
  slot(4, '20:45', 'Formation légère : 30 min (vidéo, lecture)');
  slot(6, '09:00', 'Formation SC-300 : pratique 2 h');
  slot(6, '14:00', 'Business : 1 h');
  slot(0, '10:00', 'Révision + examen blanc : 1 h 30');
  slot(0, '18:00', 'Revue de la semaine : 20 min');
  return {
    version: 1,
    inbox: [],
    days: {},
    projects: [
      P('carriere', 'Obtenir la certification SC-300', [
        'Ouvrir le parcours SC-300 sur Microsoft Learn',
        'Faire le premier module (règle des 10 minutes)',
        'Mettre en place un environnement de test pour pratiquer',
        "Passer l'évaluation d'entraînement (Practice Assessment)",
        "Réserver la date d'examen",
      ]),
      P('carriere', 'Devenir chef de projet IAM', [
        'Lister 3 projets IAM possibles au travail (MFA, revue des accès, accès conditionnel)',
        "Préparer ce que je veux dire à mon manager (objectif, plan, bénéfices pour l'équipe)",
        'Demander un entretien à mon manager',
        'Me porter volontaire pour piloter un petit projet IAM',
      ]),
      P('carriere', 'Bases de la gestion de projet', [
        'Comparer les formations (PRINCE2 Foundation, PSM I…)',
      ]),
      P('business', 'Choisir mon activité', [
        'Lister mes compétences vendables (Entra ID, Intune, Microsoft 365…)',
        'Comparer e-commerce et prestations informatiques (temps, argent, risque)',
        'Vérifier ce que mon contrat de travail autorise (exclusivité, non-concurrence)',
        'Me renseigner sur le statut de micro-entrepreneur',
        'Identifier 3 types de clients possibles (TPE, PME, associations…)',
      ]),
      P('energie', 'Retrouver de l’énergie', [
        'Noter mon énergie 3 fois par jour pendant 7 jours',
        'Me coucher avant 22h30 toute une semaine',
        'Marcher 20 minutes par jour',
      ]),
    ],
    trainings: [
      { id: uid(), title: 'SC-300 – Identity and Access Administrator', goal: 'Valider mon expertise IAM sur Entra ID', progress: 0 },
      { id: uid(), title: 'Gestion de projet', goal: 'Pouvoir piloter des projets IAM', progress: 0 },
    ],
    sessions: [],
    reviews: [],
    reviewChecks: {},
    schedule,
    weeklyTarget: 300,
  };
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.version) return s; } catch (e) { /* données illisibles : on repart de zéro */ }
  const s = seed();
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
const save = () => localStorage.setItem(KEY, JSON.stringify(S));

// ---------- Vues ----------
function vToday() {
  const now = new Date(), d = day();
  const sunday = now.getDay() === 0 && !S.reviews.some(r => r.week === weekStart(now));
  const slots = S.schedule.filter(s => s.day === now.getDay()).sort(byTime);
  const mins = weekMinutes();
  const next = S.projects.map(p => ({ p, t: p.tasks.find(t => !t.done) })).filter(x => x.t);
  return `
  <h1>${esc(cap(now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })))}</h1>
  ${sunday ? `<div class="banner" data-a="tab" data-tab="week">C'est dimanche : prends 20 minutes pour ta revue de la semaine →</div>` : ''}
  <div class="grid">
    <section class="card"><h2>Mes 3 priorités du jour</h2>
      ${d.priorities.map((p, i) => `<div class="row">
        <input type="checkbox" data-a="prio-done" data-i="${i}" ${p.done ? 'checked' : ''}>
        <input class="grow ${p.done ? 'done' : ''}" data-c="prio-text" data-i="${i}" value="${esc(p.text)}" placeholder="Priorité ${i + 1}">
      </div>`).join('')}
    </section>
    <section class="card"><h2>Mon énergie (1 = épuisé, 5 = en forme)</h2>${energyRows(d)}</section>
    <section class="card"><h2>Mes habitudes</h2>
      ${Object.entries(HABITS).map(([k, l]) => `<label class="row"><input type="checkbox" data-a="habit" data-k="${k}" ${d.habits[k] ? 'checked' : ''}> ${l}</label>`).join('')}
    </section>
    <section class="card"><h2>Mon planning du jour</h2>
      ${slots.length ? `<ul class="list">${slots.map(s => `<li><b>${esc(s.time)}</b> ${esc(s.text)}</li>`).join('')}</ul>` : '<p class="muted">Rien de prévu.</p>'}
    </section>
    <section class="card"><h2>Formation cette semaine</h2>
      ${bar(mins, S.weeklyTarget)}<p>${fmtMin(mins)} sur ${fmtMin(S.weeklyTarget)}</p>
      <button data-a="tab" data-tab="learn">Enregistrer une session</button>
    </section>
    <section class="card"><h2>Prochaines actions</h2>
      ${next.length ? `<ul class="tasks">${next.map(({ p, t }) => `<li class="row">
        <input type="checkbox" data-a="task-done" data-p="${p.id}" data-t="${t.id}">
        <span class="grow">${esc(t.text)}</span><span class="tag">${esc(DOMAINS[p.domain])}</span></li>`).join('')}</ul>`
        : '<p class="muted">Tout est fait. Ajoute des tâches dans Projets.</p>'}
    </section>
    <section class="card wide"><h2>Boîte de réception (${S.inbox.length})</h2>
      ${S.inbox.length ? `<ul class="list">${S.inbox.map(i => `<li class="row wrap">
        <span class="grow">${esc(i.text)}</span>
        <select data-c="inbox-move" data-id="${i.id}"><option value="">Ranger dans un projet…</option>
          ${S.projects.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
        <button class="icon" data-a="inbox-del" data-id="${i.id}" title="Supprimer">✕</button></li>`).join('')}</ul>`
        : '<p class="muted">Vide. Appuie sur ＋ dès que tu as une idée ou une tâche en tête.</p>'}
    </section>
  </div>`;
}

function energyRows(d) {
  return Object.entries(MOMENTS).map(([k, l]) => `<div class="row"><span class="lbl">${l}</span>
    ${[1, 2, 3, 4, 5].map(n => `<button class="pill ${d.energy[k] === n ? 'on' : ''}" data-a="energy" data-k="${k}" data-n="${n}">${n}</button>`).join('')}
  </div>`).join('');
}

function vProjects() {
  return `<h1>Mes projets</h1>
  <form class="card row wrap" data-f="project-add">
    <select name="domain">${Object.entries(DOMAINS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <input name="title" class="grow" placeholder="Nouveau projet…" required><button>Ajouter</button>
  </form>
  ${Object.entries(DOMAINS).map(([k, l]) => {
    const ps = S.projects.filter(p => p.domain === k);
    return `<h2 class="domain">${l}</h2><div class="grid">${ps.map(projectCard).join('') || '<p class="muted">Aucun projet.</p>'}</div>`;
  }).join('')}`;
}

function projectCard(p) {
  const done = p.tasks.filter(t => t.done).length;
  return `<section class="card">
    <div class="row"><h3 class="grow">${esc(p.title)}</h3><button class="icon" data-a="project-del" data-p="${p.id}" title="Supprimer le projet">🗑</button></div>
    ${bar(done, p.tasks.length)}<p class="muted">${done}/${p.tasks.length} tâches faites</p>
    <ul class="tasks">${p.tasks.map(t => `<li class="row">
      <input type="checkbox" data-a="task-done" data-p="${p.id}" data-t="${t.id}" ${t.done ? 'checked' : ''}>
      <span class="grow ${t.done ? 'done' : ''}">${esc(t.text)}</span>
      <button class="icon" data-a="task-del" data-p="${p.id}" data-t="${t.id}" title="Supprimer">✕</button></li>`).join('')}</ul>
    <form class="row" data-f="task-add" data-p="${p.id}"><input name="text" class="grow" placeholder="Ajouter une tâche…" required><button>+</button></form>
  </section>`;
}

function vLearn() {
  const mins = weekMinutes();
  const recent = [...S.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  const tname = id => S.trainings.find(t => t.id === id)?.title || 'Formation supprimée';
  return `<h1>Mes formations</h1>
  <div class="grid">
    <section class="card"><h2>Cette semaine</h2>
      ${bar(mins, S.weeklyTarget)}<p>${fmtMin(mins)} sur ${fmtMin(S.weeklyTarget)}</p>
      <label class="row">Objectif par semaine (heures)
        <input type="number" min="0.5" max="40" step="0.5" data-c="target" value="${S.weeklyTarget / 60}" style="width:6em"></label>
      <p class="muted">Astuce : le trajet en train du matin compte aussi (lecture, podcast).</p>
    </section>
    <form class="card" data-f="session-add"><h2>Enregistrer une session</h2>
      <select name="training" required>${S.trainings.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select>
      <div class="row"><input name="minutes" type="number" min="5" step="5" value="30" required style="width:7em"> minutes</div>
      <input name="note" placeholder="Ce que j'ai fait (facultatif)">
      <button>Enregistrer</button>
    </form>
    ${S.trainings.map(t => {
      const total = S.sessions.filter(s => s.training === t.id).reduce((a, s) => a + s.minutes, 0);
      return `<section class="card">
        <div class="row"><h3 class="grow">${esc(t.title)}</h3><button class="icon" data-a="training-del" data-id="${t.id}" title="Supprimer">🗑</button></div>
        ${t.goal ? `<p class="muted">${esc(t.goal)}</p>` : ''}
        <p>Temps total : <b>${fmtMin(total)}</b></p>
        <label>Avancement : ${t.progress} %<input type="range" min="0" max="100" step="5" value="${t.progress}" data-c="training-progress" data-id="${t.id}"></label>
      </section>`;
    }).join('')}
    <form class="card" data-f="training-add"><h2>Nouvelle formation</h2>
      <input name="title" placeholder="Nom (ex. MD-102 Intune)" required>
      <input name="goal" placeholder="Pourquoi ? (ton objectif)">
      <button>Ajouter</button>
    </form>
    <section class="card wide"><h2>Historique</h2>
      ${recent.length ? `<ul class="list">${recent.map(s => `<li class="row">
        <span class="tag">${shortDate(s.date)}</span><b>${fmtMin(s.minutes)}</b>
        <span class="grow">${esc(tname(s.training))}${s.note ? ` – ${esc(s.note)}` : ''}</span>
        <button class="icon" data-a="session-del" data-id="${s.id}" title="Supprimer">✕</button></li>`).join('')}</ul>`
        : '<p class="muted">Aucune session pour l’instant.</p>'}
    </section>
  </div>`;
}

function vWeek() {
  const wk = weekStart(new Date());
  const checks = S.reviewChecks[wk] || {};
  const current = S.reviews.find(r => r.week === wk) || {};
  return `<h1>Ma semaine</h1>
  <div class="grid">
    <section class="card wide"><h2>Mon planning type</h2>
      <div class="week">${[1, 2, 3, 4, 5, 6, 0].map(d => `<div class="day"><h3>${DAYS[d]}</h3>
        ${S.schedule.filter(s => s.day === d).sort(byTime).map(s => `<div class="slot"><b>${esc(s.time)}</b><span>${esc(s.text)}</span>
          <button class="icon" data-a="slot-del" data-id="${s.id}" title="Supprimer">✕</button></div>`).join('')}
      </div>`).join('')}</div>
      <form class="row wrap" data-f="slot-add">
        <select name="day">${[1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}">${DAYS[d]}</option>`).join('')}</select>
        <input name="time" type="time" required><input name="text" class="grow" placeholder="Activité" required><button>Ajouter</button>
      </form>
    </section>
    <section class="card"><h2>Revue de la semaine : les étapes</h2>
      ${REVIEW_STEPS.map((s, i) => `<label class="row"><input type="checkbox" data-a="review-check" data-i="${i}" ${checks[i] ? 'checked' : ''}> ${s}</label>`).join('')}
    </section>
    <form class="card" data-f="review-add"><h2>Bilan de la semaine</h2>
      <label>Mes victoires<textarea name="wins" rows="2">${esc(current.wins)}</textarea></label>
      <label>Ce qui a bloqué<textarea name="blockers" rows="2">${esc(current.blockers)}</textarea></label>
      <label>Mes 3 priorités pour la semaine prochaine<textarea name="next" rows="2">${esc(current.next)}</textarea></label>
      <button>Enregistrer le bilan</button>
    </form>
    <section class="card wide"><h2>Bilans précédents</h2>
      ${S.reviews.length ? [...S.reviews].sort((a, b) => b.week.localeCompare(a.week)).map(r => `<div>
        <b>Semaine du ${shortDate(r.week)}</b>
        ${r.wins ? `<p>✅ ${esc(r.wins)}</p>` : ''}${r.blockers ? `<p>🚧 ${esc(r.blockers)}</p>` : ''}${r.next ? `<p>🎯 ${esc(r.next)}</p>` : ''}
      </div>`).join('<hr>') : '<p class="muted">Ton premier bilan apparaîtra ici.</p>'}
    </section>
    <section class="card wide"><h2>Sauvegarde</h2>
      <p class="muted">Tes données restent uniquement sur cette tablette. Exporte-les de temps en temps (par exemple chaque dimanche) pour ne rien perdre.</p>
      <div class="row wrap">
        <button data-a="export">Exporter mes données</button>
        <label class="btn">Importer une sauvegarde<input type="file" accept=".json,application/json" data-c="import" hidden></label>
        <button class="danger" data-a="reset">Tout réinitialiser</button>
      </div>
    </section>
  </div>`;
}

function vEnergy() {
  const days = lastDays(14);
  const week = days.slice(0, 7);
  const avg = k => { const v = week.map(d => S.days[d]?.energy?.[k]).filter(Boolean); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const avgs = Object.keys(MOMENTS).map(k => [k, avg(k)]);
  const known = avgs.filter(([, v]) => v !== null);
  const best = known.length ? known.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
  const habitDays = k => week.filter(d => S.days[d]?.habits?.[k]).length;
  return `<h1>Mon énergie</h1>
  <div class="grid">
    <section class="card"><h2>Aujourd'hui</h2>${energyRows(day())}</section>
    <section class="card"><h2>Moyenne sur 7 jours</h2>
      ${avgs.map(([k, v]) => `<div class="row"><span class="lbl">${MOMENTS[k]}</span><div class="grow">${bar(v || 0, 5)}</div><b>${v === null ? '–' : v.toFixed(1)}</b></div>`).join('')}
      <p class="muted">${best ? `Ton meilleur moment : <b>${MOMENTS[best].toLowerCase()}</b>. Place-y ce qui demande le plus de concentration.` : 'Note ton énergie quelques jours pour découvrir ton meilleur moment.'}</p>
    </section>
    <section class="card"><h2>Habitudes sur 7 jours</h2>
      ${Object.entries(HABITS).map(([k, l]) => `<div class="row"><span class="grow">${l}</span><div style="width:90px">${bar(habitDays(k), 7)}</div><b>${habitDays(k)}/7</b></div>`).join('')}
    </section>
    <section class="card wide"><h2>Les 14 derniers jours</h2>
      <table><tr><th>Jour</th>${Object.values(MOMENTS).map(m => `<th>${m}</th>`).join('')}${Object.keys(HABITS).map(k => `<th>${{ sommeil: '😴', marche: '🚶', ecrans: '📵' }[k]}</th>`).join('')}</tr>
      ${days.map(d => { const x = S.days[d] || { energy: {}, habits: {} }; return `<tr><td>${shortDate(d)}</td>
        ${Object.keys(MOMENTS).map(k => `<td>${x.energy[k] || '·'}</td>`).join('')}
        ${Object.keys(HABITS).map(k => `<td>${x.habits[k] ? '✓' : '·'}</td>`).join('')}</tr>`; }).join('')}
      </table>
      <p class="muted">Si ton énergie reste basse depuis longtemps malgré un bon sommeil, parles-en à un médecin.</p>
    </section>
  </div>`;
}

const VIEWS = { today: vToday, projects: vProjects, learn: vLearn, week: vWeek, energy: vEnergy };

function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('main').innerHTML = VIEWS[tab]();
}

// ---------- Actions ----------
const findTask = el => proj(el.dataset.p)?.tasks.find(t => t.id === el.dataset.t);

const CLICK = {
  tab: el => { tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  capture: () => { const d = document.getElementById('capture'); d.showModal(); d.querySelector('textarea').focus(); },
  'capture-close': () => document.getElementById('capture').close(),
  'prio-done': el => { const p = day().priorities[el.dataset.i]; p.done = !p.done; },
  energy: el => { const e = day().energy, k = el.dataset.k, n = +el.dataset.n; if (e[k] === n) delete e[k]; else e[k] = n; },
  habit: el => { const h = day().habits; h[el.dataset.k] = !h[el.dataset.k]; },
  'task-done': el => { const t = findTask(el); t.done = !t.done; },
  'task-del': el => { const p = proj(el.dataset.p); p.tasks = p.tasks.filter(t => t.id !== el.dataset.t); },
  'project-del': el => { if (!confirm('Supprimer ce projet et toutes ses tâches ?')) return false; S.projects = S.projects.filter(p => p.id !== el.dataset.p); },
  'inbox-del': el => { S.inbox = S.inbox.filter(i => i.id !== el.dataset.id); },
  'training-del': el => {
    if (!confirm('Supprimer cette formation et son historique ?')) return false;
    S.trainings = S.trainings.filter(t => t.id !== el.dataset.id);
    S.sessions = S.sessions.filter(s => s.training !== el.dataset.id);
  },
  'session-del': el => { S.sessions = S.sessions.filter(s => s.id !== el.dataset.id); },
  'slot-del': el => { S.schedule = S.schedule.filter(s => s.id !== el.dataset.id); },
  'review-check': el => { const wk = weekStart(new Date()); const c = (S.reviewChecks[wk] ||= {}); c[el.dataset.i] = !c[el.dataset.i]; },
  export: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = `ma-vie-sauvegarde-${today()}.json`;
    a.click();
    return false;
  },
  reset: () => { if (!confirm('Effacer toutes tes données et repartir du modèle de départ ?')) return false; S = seed(); },
};

const CHANGE = {
  'prio-text': el => { day().priorities[el.dataset.i].text = el.value.trim(); return 'norender'; },
  'inbox-move': el => {
    const item = S.inbox.find(i => i.id === el.dataset.id), p = proj(el.value);
    if (!item || !p) return false;
    p.tasks.push({ id: uid(), text: item.text, done: false });
    S.inbox = S.inbox.filter(i => i !== item);
  },
  target: el => { const h = parseFloat(el.value); if (!(h > 0)) return false; S.weeklyTarget = Math.round(h * 60); },
  'training-progress': el => { S.trainings.find(t => t.id === el.dataset.id).progress = +el.value; },
  import: el => {
    const file = el.files[0];
    if (!file) return false;
    file.text().then(txt => {
      try {
        const data = JSON.parse(txt);
        if (!data.version || !Array.isArray(data.projects)) throw new Error();
        if (!confirm('Remplacer tes données actuelles par cette sauvegarde ?')) return;
        S = data; save(); render();
      } catch (e) { alert("Ce fichier n'est pas une sauvegarde valide."); }
    });
    return false;
  },
};

const SUBMIT = {
  capture: (f, d) => { S.inbox.push({ id: uid(), text: d.text, created: today() }); document.getElementById('capture').close(); },
  'project-add': (f, d) => { S.projects.push({ id: uid(), domain: d.domain, title: d.title, tasks: [] }); },
  'task-add': (f, d) => { proj(f.dataset.p).tasks.push({ id: uid(), text: d.text, done: false }); },
  'training-add': (f, d) => { S.trainings.push({ id: uid(), title: d.title, goal: d.goal, progress: 0 }); },
  'session-add': (f, d) => {
    const minutes = parseInt(d.minutes, 10);
    if (!(minutes > 0)) return false;
    S.sessions.push({ id: uid(), training: d.training, minutes, note: d.note, date: today() });
  },
  'slot-add': (f, d) => { S.schedule.push({ id: uid(), day: +d.day, time: d.time, text: d.text }); },
  'review-add': (f, d) => {
    const week = weekStart(new Date());
    S.reviews = S.reviews.filter(r => r.week !== week);
    S.reviews.push({ week, wins: d.wins, blockers: d.blockers, next: d.next });
    alert('Bilan enregistré. Bravo !');
  },
};

// Un résultat `false` = rien n'a changé ; 'norender' = on enregistre sans redessiner (garde le clavier ouvert).
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
  if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v).trim()]));
  if ([...f.querySelectorAll('[required]')].some(i => !d[i.name])) return;
  after(SUBMIT[f.dataset.f](f, d));
  f.reset();
});

S = load();
render();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js');
}
// Demande au navigateur de ne pas effacer les données en cas de manque de place.
navigator.storage?.persist?.();
