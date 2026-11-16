// App shell: state, rendering and event wiring. Views are plain template
// strings; every piece of user-entered text goes through esc().

import { addDays, diffDays, isoWeek, isValidISO, todayISO, weekStart } from './dates.js';
import { BUILTIN_SPORTS, CUSTOM_COLORS, EVENT_PRESETS, sportMap } from './sports.js';
import {
  TYPE_INTENSITY, computeAdaptation, findConflicts, generatePlan, newId, planWeeks, sessionStreak, suggestMakeup, weekSummary,
} from './engine.js';
import { LANGS, dayName, detectLang, fmtDate, fmtLong, fmtShort, getLang, setLang, t } from './i18n.js';
import { clearState, emptyState, flush, isRelayUrl, loadState, normalise, saveState } from './store.js';
import { applyActivities, fetchGarminActivities, readActivityFile } from './devices.js';
import { buildIcs, encodeWorkout, slug, zipStore } from './exporters.js';
import { art, face, icon } from './art.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TABS = ['today', 'plan', 'goals', 'progress'];
const PHASE_COLOR = { base: '#BDEBFF', build: '#FFC93C', peak: '#FF5A4E', taper: '#D8CCFF', race: '#3DDC97', recover: '#FFD0E8' };
const EDIT_TYPES = ['easy', 'long', 'fartlek', 'tempo', 'intervals', 'recovery', 'strength', 'strength_max', 'strength_maintain', 'core', 'mobility', 'technique', 'skill_hard', 'free'];
const EXPECTED_RPE = [0, 2, 4, 6, 8, 9];

let state = emptyState();
let sports = sportMap();
let today = todayISO();
let installPrompt = null;
const ui = { week: weekStart(today), step: 0, fresh: null };

// ---------------------------------------------------------------------------
// Derived data helpers
// ---------------------------------------------------------------------------

const sportOf = (id) => sports.get(id) || { id, color: '#C9BFE8', art: 'custom', kind: 'endurance', missing: true };
const sportName = (id) => {
  const s = sportOf(id);
  return s.custom ? s.name : s.missing ? '–' : t(`sports.${id}`);
};
const goalOf = (id) => state.goals.find((g) => g.id === id);
const sessionTitle = (s) => (s.goalId && goalOf(s.goalId)?.name) || t(`types.${TYPE_INTENSITY[s.type] ? s.type : 'free'}`);
const sessionSub = (s) => `${sportName(s.sportId)}, ${s.duration} ${t('common.min')}, ${t('intensity')[s.intensity].toLowerCase()}`;
const nextMonday = () => addDays(weekStart(today), 7);
const selectedSports = () => state.profile.sports.filter((id) => sports.has(id));

function replan(from = today) {
  state.sessions = generatePlan(state, today, from).sessions;
  if (!state.planStart) state.planStart = weekStart(today);
}

function commit() {
  saveState(state);
  render();
}

function toast(msg) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.innerHTML = ''; }, 2600);
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const thumb = (s) => `<span class="thumb" style="--tile:${sportOf(s.sportId).color}">${art(s.type === 'race' ? 'trophy' : sportOf(s.sportId).art)}</span>`;

function statusBadge(s) {
  if (s.status === 'done') return `<span class="badge done">${icon('check')}<span class="sr">${t('today.doneBadge')}</span></span>`;
  if (s.status === 'skipped') return `<span class="badge skipped">${icon('skip')}<span class="sr">${t('today.skippedBadge')}</span></span>`;
  if (s.locked) return `<span class="badge">${icon('lock')}<span class="sr">${t('plan.locked')}</span></span>`;
  return '<span></span>';
}

const sessionRow = (s, withDate = false) => `
  <li><button type="button" class="srow is-${s.status}" data-action="open-session" data-id="${esc(s.id)}">
    ${thumb(s)}
    <span class="grow"><span class="title">${esc(sessionTitle(s))}</span><br>
      <span class="sub">${withDate ? `${esc(fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ` : ''}${esc(sessionSub(s))}</span></span>
    ${statusBadge(s)}
  </button></li>`;

const choice = (name, value, label, checked, { type = 'radio', cls = '', style = '', extra = '' } = {}) => `
  <label class="choice ${cls}" ${style ? `style="${style}"` : ''}><input type="${type}" name="${name}" value="${esc(value)}" ${checked ? 'checked' : ''} ${extra}><span>${label}</span></label>`;

function profileFields(p) {
  return `
    <fieldset class="field"><legend>${t('profile.level')}</legend>
      <div class="choices even">${['beginner', 'intermediate', 'advanced'].map((l) => choice('level', l, `${t(`levels.${l}`)}<small>${t(`levelHint.${l}`)}</small>`, p.level === l, { cls: 'stacked' })).join('')}</div>
    </fieldset>
    <fieldset class="field"><legend>${t('profile.days')}</legend>
      <div class="choices even">${[0, 1, 2, 3, 4, 5, 6].map((d) => choice('days', d, dayName(d), p.days.includes(d), { type: 'checkbox' })).join('')}</div>
    </fieldset>
    <fieldset class="field"><legend>${t('profile.minutes')}</legend>
      <div class="choices even">${[30, 45, 60, 90].map((m) => choice('minutes', m, `${m} ${t('common.min')}`, p.minutes === m || (![30, 45, 60, 90].includes(p.minutes) && m === 60))).join('')}</div>
    </fieldset>
    <div class="field"><label for="longDay">${t('profile.longDay')}</label>
      <select class="input" id="longDay" name="longDay">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}" ${p.longDay === d ? 'selected' : ''}>${dayName(d, 'long')}</option>`).join('')}</select>
    </div>`;
}

function readProfile(form) {
  const fd = new FormData(form);
  const p = state.profile;
  if (fd.has('level')) p.level = fd.get('level');
  if (form.querySelector('[name=days]')) p.days = fd.getAll('days').map(Number).sort((a, b) => a - b);
  if (fd.has('minutes')) p.minutes = Number(fd.get('minutes'));
  if (fd.has('longDay')) p.longDay = Number(fd.get('longDay'));
  if (form.querySelector('[name=sports]')) p.sports = fd.getAll('sports').filter((id) => sports.has(id));
}

function goalFields(g, sportIds) {
  const isEvent = g.kind !== 'performance';
  return `
    <input type="hidden" name="kind" value="${isEvent ? 'event' : 'performance'}">
    ${isEvent ? `<div class="field"><label for="preset">${t('goals.preset')} <span class="muted small">(${t('common.optional')})</span></label>
      <select class="input" id="preset" name="preset"><option value="">–</option>${EVENT_PRESETS.filter((p) => p.sports.every((id) => sportIds.includes(id))).map((p) => `<option value="${p.id}">${t(`presets.${p.id}`)}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label for="goal-name">${t('goals.name')}</label>
      <input class="input" id="goal-name" name="name" maxlength="60" autocomplete="off" value="${esc(g.name || '')}" placeholder="${t(isEvent ? 'goals.namePhEvent' : 'goals.namePhPerf')}"></div>
    <div class="field"><label for="goal-date">${t(isEvent ? 'goals.date' : 'goals.dateTarget')}</label>
      <input class="input" id="goal-date" name="date" type="date" value="${esc(g.date || '')}"></div>
    <fieldset class="field"><legend>${t('goals.sports')}</legend>
      <div class="choices">${sportIds.map((id) => choice('gsports', id, esc(sportName(id)), (g.sports || []).includes(id) || sportIds.length === 1, { type: 'checkbox', style: `--pick:${sportOf(id).color}` })).join('')}</div>
    </fieldset>
    ${isEvent ? `<fieldset class="field"><legend>${t('goals.priority')}</legend>
      <div class="choices">${['A', 'B', 'C'].map((p) => choice('priority', p, t(`priority.${p}`), (g.priority || 'A') === p)).join('')}</div></fieldset>` : ''}
    <p class="error" role="alert" data-error></p>`;
}

function readGoal(form, existing) {
  const fd = new FormData(form);
  const goal = {
    id: existing?.id || newId('g'),
    kind: fd.get('kind') === 'performance' ? 'performance' : 'event',
    name: String(fd.get('name') || '').trim().slice(0, 60),
    date: String(fd.get('date') || ''),
    sports: fd.getAll('gsports').filter((id) => sports.has(id)),
    priority: ['A', 'B', 'C'].includes(fd.get('priority')) ? fd.get('priority') : 'B',
  };
  const err = !goal.name ? 'goals.needName' : !isValidISO(goal.date) ? 'goals.needDate' : !goal.sports.length ? 'goals.needSport' : null;
  if (err) {
    form.querySelector('[data-error]').textContent = t(err);
    return null;
  }
  return goal;
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function sportTile(s, checked) {
  return `<label class="sport-tile" style="--tile:${s.color}">
    <input type="checkbox" name="sports" value="${esc(s.id)}" ${checked ? 'checked' : ''}>
    <span class="face-up"><span class="pic">${art(s.art)}</span>
      <span class="name">${esc(sportName(s.id))}<span class="badge done tick">${icon('check')}</span></span></span>
  </label>`;
}

function sportPicker() {
  const picked = state.profile.sports;
  const groups = ['endurance', 'power', 'outdoor'].map((g) => `
    <section class="stack"><h2>${t(`groups.${g}`)}</h2>
      <div class="sport-grid">${BUILTIN_SPORTS.filter((s) => s.group === g).map((s) => sportTile(s, picked.includes(s.id))).join('')}</div>
    </section>`).join('');
  const customs = state.customSports.map((c) => sportTile(sportOf(c.id), picked.includes(c.id))).join('');
  return `${groups}
    <section class="stack"><h2>${t('groups.custom')}</h2>
      <div class="sport-grid">${customs}
        <button type="button" class="sport-tile add" data-action="add-sport">
          <span class="face-up"><span class="pic">${icon('plus')}</span><span class="name">${t('profile.ownSport')}</span></span>
        </button>
      </div>
    </section>`;
}

function viewOnboarding() {
  const step = ui.step;
  const langSwitch = `<div class="choices" role="group" aria-label="${t('settings.language')}">${Object.entries(LANGS).map(([k, v]) => choice('lang', k, v, getLang() === k, { extra: 'data-change="lang"' })).join('')}</div>`;
  if (step === 0) {
    return `<div class="welcome">
      <div class="collage" aria-hidden="true">
        <div style="--tile:#FF5A4E">${art('run')}</div><div style="--tile:#8B5CF6">${art('strength')}</div><div style="--tile:#2EC4F1">${art('swim')}</div>
      </div>
      <div class="stack"><h1>${t('onboard.hello')}</h1><p>${t('onboard.helloSub')}</p></div>
      <div class="stack">
        <button type="button" class="btn primary big block" data-action="ob-next">${t('onboard.start')}</button>
        ${langSwitch}
        <p class="small muted">${t('settings.exportHint').split('. ')[0]}. ${t('settings.offline')}</p>
      </div>
    </div>`;
  }
  const head = (title, sub) => `
    <header class="stack">
      <div class="steps" role="img" aria-label="${t('onboard.step', step, 3)}">${[1, 2, 3].map((i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
      <h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}
    </header>`;
  const nav = (primary, extra = '') => `
    <div class="wizard-nav">
      <button type="button" class="icon-btn" data-action="ob-back" aria-label="${t('common.back')}">${icon('left')}</button>
      ${primary}${extra}
    </div>`;
  if (step === 1) {
    return `<form id="ob-form" class="stack-lg" data-form="ob-next" novalidate>
      ${head(t('onboard.sportsTitle'), t('onboard.sportsSub'))}
      ${sportPicker()}
      <p class="error" role="alert" data-error></p>
      ${nav(`<button class="btn primary big">${t('common.next')}</button>`)}
    </form>`;
  }
  if (step === 2) {
    return `<form id="ob-form" class="stack-lg" data-form="ob-next" novalidate>
      ${head(t('onboard.profileTitle'))}
      ${profileFields(state.profile)}
      <p class="error" role="alert" data-error></p>
      ${nav(`<button class="btn primary big">${t('common.next')}</button>`)}
    </form>`;
  }
  const kind = ui.goalKind || 'event';
  return `<form id="ob-form" class="stack-lg" data-form="ob-finish" novalidate>
    ${head(t('onboard.goalTitle'), t('onboard.goalSub'))}
    <div class="choices even" role="group" aria-label="${t('goals.title')}">
      ${choice('kindPick', 'event', t('goals.event'), kind === 'event', { extra: 'data-change="ob-kind"' })}
      ${choice('kindPick', 'performance', t('goals.performance'), kind === 'performance', { extra: 'data-change="ob-kind"' })}
    </div>
    ${goalFields({ kind, priority: 'A' }, selectedSports())}
    <div class="wizard-nav">
      <button type="button" class="icon-btn" data-action="ob-back" aria-label="${t('common.back')}">${icon('left')}</button>
      <button class="btn primary big">${t('onboard.finish')}</button>
    </div>
    <button type="button" class="btn quiet block" data-action="ob-skip">${t('onboard.skipGoal')}</button>
  </form>`;
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function heroTile(s) {
  const sp = sportOf(s.sportId);
  const id = esc(s.id);
  let body;
  if (s.status === 'planned') {
    body = `<p class="desc">${t(`typeDesc.${TYPE_INTENSITY[s.type] ? s.type : 'free'}`)}${s.note ? `<br><b>${esc(s.note)}</b>` : ''}</p>
      <div class="actions">
        <button type="button" class="btn go" data-action="done-session" data-id="${id}">${icon('check')}${t('today.done')}</button>
        <button type="button" class="btn" data-action="skip-session" data-id="${id}">${t('today.skip')}</button>
      </div>`;
  } else {
    const done = s.status === 'done';
    body = `<div class="hero-foot"><span class="stamp ${ui.fresh === s.id ? 'is-fresh' : ''}">${done ? (s.feeling ? face(s.feeling) : icon('check')) : icon('skip')}${t(done ? 'today.doneBadge' : 'today.skippedBadge')}</span>
      <button type="button" class="btn quiet hero-detail" data-action="open-session" data-id="${id}">${t('common.edit')}</button></div>`;
  }
  return `<article class="hero is-${s.status}" style="--tile:${sp.color}">
    <div class="hero-head">
      <div><p class="sport">${esc(sportName(s.sportId))}</p><h2>${esc(sessionTitle(s))}</h2>
        <p class="meta">${s.duration} ${t('common.min')}, ${t('intensity')[s.intensity].toLowerCase()}</p></div>
      <div class="hero-art">${art(s.type === 'race' ? 'trophy' : sp.art)}</div>
    </div>
    ${body}
    ${s.status === 'planned' ? `<button type="button" class="btn quiet hero-detail" data-action="open-session" data-id="${id}">${t('common.edit')}</button>` : ''}
  </article>`;
}

function viewToday() {
  const weeks = planWeeks(state.goals, today);
  const week = weeks[0];
  const todays = state.sessions.filter((s) => s.date === today);
  const nextGoal = state.goals.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const weekNo = state.planStart ? Math.floor(diffDays(state.planStart, weekStart(today)) / 7) + 1 : 1;
  const open = state.sessions.filter((s) => s.status === 'planned' && s.date < today && s.date >= addDays(today, -6));
  const upcoming = state.sessions.filter((s) => s.date > today && s.status === 'planned').slice(0, 3);
  const ws = weekStart(today);

  const strip = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const iso = addDays(ws, d);
    const list = state.sessions.filter((s) => s.date === iso);
    return `<a href="#plan" class="${iso === today ? 'is-today' : ''}" aria-label="${esc(fmtDate(iso))}: ${list.length ? esc(list.map(sessionTitle).join(', ')) : t('plan.restDay')}">
      <span>${dayName(d)}</span>
      <span class="dots">${list.map((s) => `<i class="dot is-${s.status}" style="--tile:${sportOf(s.sportId).color}"></i>`).join('')}</span></a>`;
  }).join('');

  return `
    <header class="top">
      <div><p class="kicker">${t('today.hello')}</p><h1>${esc(fmtDate(today))}</h1></div>
      <button type="button" class="icon-btn" data-action="settings" aria-label="${t('common.settings')}">${icon('gear')}</button>
    </header>
    <div class="stack-lg">
      <div class="banner">
        <span class="chip phase-${week.phase}">${t(`phases.${week.phase}`)}</span>
        ${week.deload ? `<span class="chip">${t('deload')}</span>` : ''}
        <span>${t('today.weekOf', weekNo, weekNo - 1 + weeks.length)}</span>
        ${nextGoal ? `<span class="chip">${icon('goals')}${esc(t('today.countdown', diffDays(today, nextGoal.date), nextGoal.name))}</span>` : ''}
      </div>
      <section class="stack">
        ${todays.length ? todays.map(heroTile).join('') : `
          <article class="hero" style="--tile:#D8CCFF">
            <div class="hero-head"><div><h2>${t('today.rest')}</h2><p class="meta">${t('today.restSub')}</p></div><div class="hero-art">${art('rest')}</div></div>
            <button type="button" class="btn quiet hero-detail" data-action="add-session" data-date="${today}">${t('plan.addSession')}</button>
          </article>`}
      </section>
      ${open.length ? `<section><div class="section-title"><h2>${t('today.open')}</h2></div><ul class="sessions">${open.map((s) => sessionRow(s, true)).join('')}</ul></section>` : ''}
      <section><div class="section-title"><h2>${t('today.week')}</h2><span class="muted small">${t(`phaseHint.${week.phase}`)}</span></div>
        <div class="weekstrip">${strip}</div></section>
      ${upcoming.length ? `<section><div class="section-title"><h2>${t('today.up')}</h2></div><ul class="sessions">${upcoming.map((s) => sessionRow(s, true)).join('')}</ul></section>` : ''}
    </div>`;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function viewPlan() {
  const ws = ui.week;
  const weeks = planWeeks(state.goals, today);
  const meta = weeks.find((w) => w.start === ws);
  const list = state.sessions.filter((s) => s.date >= ws && s.date <= addDays(ws, 6));
  const phase = meta?.phase || list.find((s) => s.phase)?.phase;
  const sum = weekSummary(state.sessions, sports, ws);
  const maxLoad = Math.max(1, ...weeks.map((w) => weekSummary(state.sessions, sports, w.start).load));
  const conflicts = findConflicts(state.sessions, state.goals, state.profile, sports, ws);
  const goalsHere = state.goals.filter((g) => g.date >= ws && g.date <= addDays(ws, 6));

  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const iso = addDays(ws, d);
    const items = list.filter((s) => s.date === iso);
    const add = `<button type="button" class="add-btn" data-action="add-session" data-date="${iso}" aria-label="${t('plan.addSession')}: ${esc(fmtDate(iso))}">${icon('plus')}</button>`;
    return `<li class="day ${iso === today ? 'is-today' : ''}">
      <div class="date">${dayName(d)}<span>${Number(iso.slice(8))}</span></div>
      <div class="body">${items.length
    ? `<ul class="sessions">${items.map((s) => sessionRow(s)).join('')}</ul>`
    : `<div class="rest">${t('plan.restDay')}${add}</div>`}</div>
    </li>`;
  }).join('');

  return `
    <header class="top">
      <h1>${t('nav.plan')}</h1>
      <button type="button" class="icon-btn" data-action="settings" aria-label="${t('common.settings')}">${icon('gear')}</button>
    </header>
    <div class="stack-lg">
      <div class="pager">
        <button type="button" class="icon-btn" data-action="week-prev" aria-label="${t('common.back')}">${icon('left')}</button>
        <div class="label"><b>${t('plan.week', isoWeek(ws))}</b><span class="small">${esc(fmtShort(ws))} – ${esc(fmtShort(addDays(ws, 6)))}</span></div>
        <button type="button" class="icon-btn" data-action="week-next" aria-label="${t('common.next')}">${icon('right')}</button>
      </div>
      <div class="banner">
        ${phase ? `<span class="chip phase-${phase}">${t(`phases.${phase}`)}</span>` : ''}
        ${meta?.deload ? `<span class="chip">${t('deload')}</span>` : ''}
        ${goalsHere.map((g) => `<span class="chip">${icon('goals')}${esc(g.name)}</span>`).join('')}
        ${ws !== weekStart(today) ? `<button type="button" class="btn quiet" data-action="week-today">${t('common.today')}</button>` : ''}
      </div>
      <div class="summary">
        <div class="stat"><b>${sum.count}</b><span>${t('plan.sessions', sum.count).replace(/^\d+\s/, '')}</span></div>
        <div class="stat"><b>${t('plan.hours', sum.planned)}</b><span>${t('progress.planned')}</span></div>
        <div class="stat"><b>${sum.load}</b><span>${t('plan.load')}</span>
          <div class="meter" role="img" aria-label="${t('plan.load')} ${Math.round((sum.load / maxLoad) * 100)} %"><i style="inline-size:${Math.min(100, Math.round((sum.load / maxLoad) * 100))}%"></i></div></div>
      </div>
      ${conflicts.length ? `<aside class="warnings"><h3>${icon('warn')}${t('warn.title')}</h3><ul>${conflicts.map((c) => `<li>${esc(t(`warn.${c.code}`, c))}${['tooManyHard', 'noRestDay', 'loadJump'].includes(c.code) ? '' : ` <span class="muted">(${esc(fmtDate(c.date, { weekday: 'short', day: 'numeric', month: 'short' }))})</span>`}</li>`).join('')}</ul></aside>` : ''}
      <ul class="days">${days}</ul>
      <div class="stack">
        <button type="button" class="btn block" data-action="regenerate">${icon('refresh')}${t('plan.regenerate')}</button>
        <p class="small muted">${t('plan.regenerateHint')}</p>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function seasonChart() {
  const weeks = planWeeks(state.goals, today);
  const sums = weeks.map((w) => weekSummary(state.sessions, sports, w.start).planned);
  const max = Math.max(1, ...sums);
  const bars = weeks.map((w, i) => {
    const flags = state.goals.filter((g) => g.date >= w.start && g.date <= w.end);
    const flag = flags.length ? `<span class="flag">${flags.some((g) => g.kind === 'event') ? esc(flags.find((g) => g.kind === 'event').priority) : '★'}</span>` : '';
    return `<div class="wk ${i === 0 ? 'is-now' : ''}">${flag}<div class="bar" style="--c:${PHASE_COLOR[w.phase]};block-size:${Math.max(6, Math.round((sums[i] / max) * 78))}%"></div></div>`;
  }).join('');
  const used = [...new Set(weeks.map((w) => w.phase))];
  const label = `${t('goals.season')}: ${used.map((p) => t(`phases.${p}`)).join(', ')}`;
  return `<section class="card stack">
    <div><h2>${t('goals.season')}</h2><p class="small muted">${t('goals.seasonSub')}</p></div>
    <div class="season" tabindex="0" role="img" aria-label="${esc(label)}"><div class="season-bars">${bars}</div></div>
    <ul class="legend">${used.map((p) => `<li><i class="swatch" style="--c:${PHASE_COLOR[p]}"></i>${t(`phases.${p}`)}</li>`).join('')}</ul>
  </section>`;
}

function goalTile(g) {
  const days = diffDays(today, g.date);
  const first = sportOf(g.sports[0]);
  const when = days < 0 ? t('goals.past') : days > 20 ? t('goals.inWeeks', Math.round(days / 7)) : t('goals.inDays', days);
  return `<li><button type="button" class="goal ${days < 0 ? 'is-past' : ''}" style="--tile:${first.color}" data-action="edit-goal" data-id="${esc(g.id)}">
    <span><span class="chip">${g.kind === 'event' ? t(`priorityShort.${g.priority}`) : t('goals.performance')}</span>
      <h3>${esc(g.name)}</h3>
      <span class="when">${esc(when)}</span><br><span class="small">${esc(fmtLong(g.date))} · ${esc(g.sports.map(sportName).join(', '))}</span></span>
    <span class="goal-art">${art(g.kind === 'event' ? 'trophy' : first.art)}</span>
  </button></li>`;
}

function viewGoals() {
  const sorted = [...state.goals].sort((a, b) => (a.date < today) - (b.date < today) || a.date.localeCompare(b.date));
  return `
    <header class="top">
      <h1>${t('goals.title')}</h1>
      <button type="button" class="icon-btn" data-action="settings" aria-label="${t('common.settings')}">${icon('gear')}</button>
    </header>
    <div class="stack-lg">
      ${sorted.length
    ? `<ul class="sessions" style="gap:1rem">${sorted.map(goalTile).join('')}</ul>`
    : `<div class="card empty">${art('trophy')}<h2>${t('goals.empty')}</h2><p>${t('goals.emptySub')}</p></div>`}
      <div class="actions-row">
        <button type="button" class="btn primary" data-action="add-goal" data-kind="event">${icon('plus')}${t('goals.addEvent')}</button>
        <button type="button" class="btn" data-action="add-goal" data-kind="performance">${icon('plus')}${t('goals.addPerf')}</button>
      </div>
      ${seasonChart()}
    </div>`;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function viewProgress() {
  const ws = weekStart(today);
  const doneAll = state.sessions.filter((s) => s.status === 'done');
  const head = `<header class="top"><h1>${t('progress.title')}</h1>
    <button type="button" class="icon-btn" data-action="settings" aria-label="${t('common.settings')}">${icon('gear')}</button></header>`;
  if (!doneAll.length) {
    return `${head}<div class="card empty">${art('hello')}<h2>${t('progress.empty')}</h2><p>${t('progress.emptySub')}</p>
      <a class="btn primary" href="#today">${t('nav.today')}</a></div>`;
  }
  const weeks = Array.from({ length: 8 }, (_, i) => weekSummary(state.sessions, sports, addDays(ws, (i - 7) * 7)));
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.planned, w.done)));
  const last28 = state.sessions.filter((s) => s.date > addDays(today, -28) && s.date <= today);
  const planned = last28.reduce((n, s) => n + s.duration, 0);
  const done = last28.filter((s) => s.status === 'done').reduce((n, s) => n + s.duration, 0);
  const adherence = planned ? Math.round((done / planned) * 100) : 0;
  const split = {};
  for (const s of last28) if (s.status === 'done') split[s.sportId] = (split[s.sportId] || 0) + s.duration;
  const splitList = Object.entries(split).sort((a, b) => b[1] - a[1]);
  const feelings = doneAll.filter((s) => s.feeling).slice(-12);
  const adapt = computeAdaptation(state.sessions, today);
  const thisWeek = weeks.at(-1);

  const bars = weeks.map((w) => `
    <div class="col"><span>${w.done || ''}</span>
      <div class="track">${w.planned ? `<div class="planned" style="block-size:${Math.round((w.planned / max) * 100)}%"></div>` : ''}<div class="done" style="block-size:${Math.round((w.done / max) * 100)}%;${w.done ? '' : 'visibility:hidden'}"></div></div>
      <span>${isoWeek(w.start)}</span></div>`).join('');

  return `${head}
    <div class="stack-lg">
      <div class="bigstats">
        <div class="bigstat" style="--tile:var(--sun)"><b>${sessionStreak(state.sessions, today)}</b><span>${t('progress.streak')}</span></div>
        <div class="bigstat" style="--tile:var(--grass)"><b>${adherence} %</b><span>${t('progress.adherence')}, ${t('progress.adherenceSub')}</span></div>
      </div>
      <section class="card stack">
        <div class="row between"><h2>${t('progress.minutes')}</h2><span class="chip">${t('progress.thisWeek')}: ${thisWeek.done}/${thisWeek.planned}</span></div>
        <div class="bars" role="img" aria-label="${esc(`${t('progress.minutes')}: ${weeks.map((w) => `${t('plan.week', isoWeek(w.start))} ${w.done}/${w.planned}`).join(', ')}`)}">${bars}</div>
        <ul class="legend"><li><i class="swatch" style="--c:var(--grass)"></i>${t('progress.done')}</li><li><i class="swatch outline"></i>${t('progress.planned')}</li></ul>
      </section>
      ${splitList.length ? `<section class="card stack"><h2>${t('progress.bySport')}</h2>
        <div class="split" role="img" aria-label="${esc(splitList.map(([id, m]) => `${sportName(id)} ${m} ${t('common.min')}`).join(', '))}">${splitList.map(([id, m]) => `<i style="--c:${sportOf(id).color};flex:${m}"></i>`).join('')}</div>
        <ul class="legend">${splitList.map(([id, m]) => `<li><i class="swatch" style="--c:${sportOf(id).color}"></i>${esc(sportName(id))} ${m} ${t('common.min')}</li>`).join('')}</ul></section>` : ''}
      ${feelings.length ? `<section class="card stack"><h2>${t('progress.feeling')}</h2>
        <div class="faces" role="img" aria-label="${esc(feelings.map((s) => t('feedback.feelings')[s.feeling]).join(', '))}">${feelings.map((s) => face(s.feeling)).join('')}</div></section>` : ''}
      <section class="card stack"><h2>${t('progress.adapt.title')}</h2>
        ${(adapt.reasons.length ? adapt.reasons : ['none']).map((r) => `<p>${t(`progress.adapt.${r}`)}</p>`).join('')}</section>
    </div>`;
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

const sheet = () => $('#sheet');
function openSheet(title, body) {
  const el = sheet();
  el.innerHTML = `<div class="sheet-inner">
    <div class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="${t('common.close')}">${icon('close')}</button></div>
    ${body}</div>`;
  if (!el.open) el.showModal();
  el.scrollTop = 0;
}
const closeSheet = () => sheet().open && sheet().close();

function sheetSession(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  const sid = esc(s.id);
  let actions;
  if (s.status === 'planned') {
    actions = `<div class="actions-row">
        <button type="button" class="btn go" data-action="done-session" data-id="${sid}">${icon('check')}${t('today.done')}</button>
        <button type="button" class="btn" data-action="skip-session" data-id="${sid}">${t('today.skip')}</button></div>
      <button type="button" class="btn block" data-action="edit-session" data-id="${sid}">${t('common.edit')}</button>`;
  } else {
    const fb = s.status === 'done' && (s.feeling || s.rpe)
      ? `<div class="card flat row">${s.feeling ? face(s.feeling, 'icon') : ''}<span>${s.feeling ? `${t('feedback.feelings')[s.feeling]}. ` : ''}${s.rpe ? `${t('feedback.rpe')}: ${s.rpe}/10, ${t('feedback.rpeScale')[s.rpe].toLowerCase()}` : ''}</span></div>` : '';
    actions = `${fb}<div class="actions-row">
        <button type="button" class="btn" data-action="reopen-session" data-id="${sid}">${t('session.reopen')}</button>
        <button type="button" class="btn" data-action="edit-session" data-id="${sid}">${t('common.edit')}</button></div>`;
  }
  openSheet(sessionTitle(s), `
    <div class="sheet-hero">${thumb(s)}
      <div><p><b>${esc(sportName(s.sportId))}</b></p><p>${esc(fmtDate(s.date))}</p>
        <p>${s.duration} ${t('common.min')}, ${t('intensity')[s.intensity].toLowerCase()}</p></div></div>
    <div class="row wrap">
      ${s.phase ? `<span class="chip phase-${esc(s.phase)}">${t(`phases.${s.phase}`)}</span>` : ''}
      ${s.status !== 'planned' ? `<span class="chip">${t(s.status === 'done' ? 'today.doneBadge' : 'today.skippedBadge')}</span>` : ''}
      ${s.locked ? `<span class="chip">${icon('lock')}${t('plan.locked')}</span>` : ''}
    </div>
    <p>${t(`typeDesc.${TYPE_INTENSITY[s.type] ? s.type : 'free'}`)}</p>
    ${s.note ? `<p class="card flat">${esc(s.note)}</p>` : ''}
    ${s.actual ? `<p class="card flat"><b>${t('devices.recorded')}, ${esc(s.actual.source)}:</b> ${esc(actualLine(s.actual))}</p>` : ''}
    <div class="actions-col">${actions}</div>`);
}

const km = (m) => new Intl.NumberFormat(getLang() === 'de' ? 'de-AT' : 'en-GB', { maximumFractionDigits: 1 }).format(m / 1000);
function actualLine(a) {
  return [
    a.distance ? `${km(a.distance)} km` : '',
    a.avgHr ? `${t('devices.avgHr')} ${a.avgHr}` : '',
    a.maxHr ? `${t('devices.maxHr')} ${a.maxHr}` : '',
    a.ascent ? `${a.ascent} m ${t('devices.ascent')}` : '',
    a.calories ? `${a.calories} kcal` : '',
  ].filter(Boolean).join(', ') || '–';
}

function sheetFeedback(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  const rpe = s.rpe || EXPECTED_RPE[s.intensity] || 5;
  openSheet(t('feedback.title'), `
    <form class="stack-lg" data-form="feedback" data-id="${esc(s.id)}">
      <p><b>${esc(sessionTitle(s))}</b>, ${esc(sportName(s.sportId))}</p>
      <fieldset class="field"><legend>${t('feedback.feeling')}</legend>
        <div class="choices even">${[1, 2, 3, 4, 5].map((n) => choice('feeling', n, `${face(n)}${t('feedback.feelings')[n]}`, (s.feeling || 4) === n, { cls: 'face-choice' })).join('')}</div></fieldset>
      <div class="field"><label for="rpe">${t('feedback.rpe')}</label>
        <div class="row"><span class="range-out" data-rpe-num>${rpe}</span><span data-rpe-text>${t('feedback.rpeScale')[rpe]}</span></div>
        <input class="range" id="rpe" name="rpe" type="range" min="1" max="10" step="1" value="${rpe}" data-input="rpe"></div>
      <div class="field"><label for="fb-duration">${t('feedback.duration')} (${t('common.min')})</label>
        <input class="input" id="fb-duration" name="duration" type="number" inputmode="numeric" min="5" max="900" value="${s.duration}"></div>
      <div class="field"><label for="fb-note">${t('session.note')} <span class="muted small">(${t('common.optional')})</span></label>
        <textarea class="input" id="fb-note" name="note" maxlength="400" placeholder="${t('session.notePh')}">${esc(s.note || '')}</textarea></div>
      <button class="btn go big block">${icon('check')}${t('feedback.save')}</button>
    </form>`);
}

function sheetSkip(id) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s) return;
  const makeup = suggestMakeup(s, state.sessions, state.profile, today);
  openSheet(t('feedback.skipTitle'), `
    <p>${t('feedback.skipText')}</p>
    <div class="actions-col">
      ${makeup ? `<button type="button" class="btn primary block" data-action="move-session" data-id="${esc(s.id)}" data-date="${makeup}">${esc(t('session.moveTo', fmtDate(makeup, { weekday: 'long' })))}</button>` : ''}
      <button type="button" class="btn block" data-action="confirm-skip" data-id="${esc(s.id)}">${t('feedback.skipOnly')}</button>
      <button type="button" class="btn quiet block" data-action="close-sheet" autofocus>${t('common.cancel')}</button>
    </div>`);
}

function sheetEdit(id, date) {
  const existing = state.sessions.find((x) => x.id === id);
  const picks = selectedSports();
  const s = existing || { sportId: picks[0], type: 'easy', date: date || today, duration: state.profile.minutes, intensity: 2, note: '' };
  const sportIds = [...new Set([...picks, s.sportId])].filter(Boolean);
  const types = [...new Set([...EDIT_TYPES, s.type])];
  openSheet(existing ? t('common.edit') : t('session.new'), `
    <form class="stack-lg" data-form="session" data-id="${esc(existing?.id || '')}">
      <div class="field"><label for="s-sport">${t('session.sport')}</label>
        <select class="input" id="s-sport" name="sportId">${sportIds.map((sid) => `<option value="${esc(sid)}" ${sid === s.sportId ? 'selected' : ''}>${esc(sportName(sid))}</option>`).join('')}</select></div>
      <div class="field"><label for="s-type">${t('session.type')}</label>
        <select class="input" id="s-type" name="type" data-change="type">${types.map((ty) => `<option value="${ty}" ${ty === s.type ? 'selected' : ''}>${t(`types.${TYPE_INTENSITY[ty] ? ty : 'free'}`)}</option>`).join('')}</select></div>
      <div class="field"><label for="s-date">${t('session.date')}</label>
        <input class="input" id="s-date" name="date" type="date" required value="${esc(s.date)}"></div>
      <div class="field"><label for="s-duration">${t('session.duration')}</label>
        <input class="input" id="s-duration" name="duration" type="number" inputmode="numeric" min="5" max="900" required value="${s.duration}"></div>
      <fieldset class="field"><legend>${t('session.intensity')}</legend>
        <div class="choices even">${[1, 2, 3, 4, 5].map((n) => choice('intensity', n, `${n}`, s.intensity === n, { extra: `aria-label="${t('intensity')[n]}"` })).join('')}</div>
        <p class="hint">1 = ${t('intensity')[1]}, 5 = ${t('intensity')[5]}</p></fieldset>
      <div class="field"><label for="s-note">${t('session.note')} <span class="muted small">(${t('common.optional')})</span></label>
        <textarea class="input" id="s-note" name="note" maxlength="400" placeholder="${t('session.notePh')}">${esc(s.note || '')}</textarea></div>
      <div class="actions-col">
        <button class="btn primary big block">${t('common.save')}</button>
        ${existing ? `<button type="button" class="btn danger block" data-action="delete-session" data-id="${esc(existing.id)}">${t('common.delete')}</button>` : ''}
      </div>
    </form>`);
}

function sheetGoal(id, kind) {
  const existing = goalOf(id);
  const g = existing || { kind, priority: state.goals.some((x) => x.kind === 'event' && x.priority === 'A' && x.date >= today) ? 'B' : 'A' };
  const ids = [...new Set([...selectedSports(), ...(g.sports || [])])];
  openSheet(t(g.kind === 'performance' ? 'goals.performance' : 'goals.event'), `
    <form class="stack-lg" data-form="goal" data-id="${esc(existing?.id || '')}" novalidate>
      ${goalFields(g, ids)}
      <div class="actions-col">
        <button class="btn primary big block">${t('common.save')}</button>
        ${existing ? `<button type="button" class="btn danger block" data-action="delete-goal" data-id="${esc(existing.id)}">${t('common.delete')}</button>` : ''}
      </div>
    </form>`);
}

function sheetSport() {
  openSheet(t('profile.ownSport'), `
    <form class="stack-lg" data-form="sport" novalidate>
      <div class="field"><label for="sp-name">${t('profile.ownSportName')}</label>
        <input class="input" id="sp-name" name="name" maxlength="30" required autocomplete="off" autofocus></div>
      <fieldset class="field"><legend>${t('profile.ownSportKind')}</legend>
        <div class="choices">${['endurance', 'strength', 'mobility', 'skill'].map((k) => choice('kind', k, t(`kinds.${k}`), k === 'endurance')).join('')}</div></fieldset>
      <fieldset class="field"><legend class="sr">Farbe</legend>
        <div class="choices">${CUSTOM_COLORS.map((c, i) => choice('color', c, `<span class="sr">${i + 1}</span>`, i === 3, { cls: 'swatch-choice', style: `--c:${c}` })).join('')}</div></fieldset>
      <button class="btn primary big block">${t('common.add')}</button>
    </form>`);
}

function sheetSettings() {
  const picked = state.profile.sports;
  const all = [...BUILTIN_SPORTS, ...state.customSports.map((c) => sportOf(c.id))];
  const canInstall = installPrompt || typeof Navigator.prototype.install === 'function';
  openSheet(t('settings.title'), `
    <fieldset class="field"><legend>${t('settings.language')}</legend>
      <div class="choices">${Object.entries(LANGS).map(([k, v]) => choice('lang', k, v, getLang() === k, { extra: 'data-change="lang"' })).join('')}</div></fieldset>
    <form class="stack-lg" data-form="settings" novalidate>
      <h2>${t('settings.training')}</h2>
      <fieldset class="field"><legend>${t('profile.sports')}</legend>
        <div class="choices">${all.map((s) => choice('sports', s.id, esc(sportName(s.id)), picked.includes(s.id), { type: 'checkbox', style: `--pick:${s.color}` })).join('')}
          <button type="button" class="btn" data-action="add-sport">${icon('plus')}${t('profile.ownSport')}</button></div>
        ${state.customSports.length ? `<div class="row wrap">${state.customSports.map((c) => `<button type="button" class="btn quiet small" data-action="delete-sport" data-id="${esc(c.id)}">${esc(c.name)}: ${t('common.delete')}</button>`).join('')}</div>` : ''}
      </fieldset>
      ${profileFields(state.profile)}
      <p class="error" role="alert" data-error></p>
      <button class="btn primary big block">${t('common.save')}</button>
    </form>
    <button type="button" class="btn primary block" data-action="devices">${t('devices.open')}</button>
    <section class="stack">
      <h2>${t('settings.data')}</h2>
      <p class="small muted">${t('settings.exportHint')} ${t('settings.offline')}</p>
      <div class="actions-row">
        <button type="button" class="btn" data-action="export">${t('settings.export')}</button>
        <label class="btn">${t('settings.import')}<input type="file" accept="application/json,.json" class="sr" data-change="import"></label>
      </div>
      <button type="button" class="btn block" data-action="install" ${canInstall ? '' : 'hidden'}>${t('settings.install')}</button>
      <button type="button" class="btn danger block" data-action="reset">${t('settings.reset')}</button>
    </section>`);
}

function sheetDevices(message = '') {
  const g = state.garmin;
  const connected = Boolean(g.key && g.relay);
  const picks = selectedSports();
  const how = (title, text) => `<details class="how"><summary>${t(title)}</summary><p class="small">${t(text)}</p></details>`;
  openSheet(t('devices.title'), `
    <p class="notice" role="status" data-device-status>${esc(message)}</p>
    <section class="card stack">
      <h3>${t('devices.garminTitle')}</h3>
      <p class="small">${t('devices.garminText')}
        <a href="https://github.com/jessehaemmerle/trainingsplaner#garmin-synchronisierung" target="_blank" rel="noopener">${t('devices.garminGuide')}</a></p>
      <form class="stack" data-form="garmin" novalidate>
        <div class="field"><label for="g-key">${t('devices.garminKey')}</label>
          <input class="input" id="g-key" name="key" type="password" autocomplete="off" spellcheck="false" maxlength="300" value="${esc(g.key)}">
          <p class="hint">${t('devices.garminKeyHint')}
            <a href="https://connect.garmin.com/app/settings/personalApiToken" target="_blank" rel="noopener">${t('devices.garminKeyLink')}</a></p></div>
        <div class="field"><label for="g-relay">${t('devices.garminRelay')}</label>
          <input class="input" id="g-relay" name="relay" type="url" inputmode="url" autocomplete="off" spellcheck="false" maxlength="200" value="${esc(g.relay)}" placeholder="${t('devices.garminRelayPh')}"></div>
        <p class="error" role="alert" data-error></p>
        <button class="btn primary block">${t(connected ? 'devices.garminSync' : 'devices.garminSave')}</button>
        <p class="small muted">${g.last ? esc(t('devices.garminLast', fmtLong(g.last))) : t('devices.garminNever')}</p>
        ${g.key || g.relay ? `<button type="button" class="btn quiet block" data-action="garmin-disconnect">${t('devices.garminDisconnect')}</button>` : ''}
      </form>
    </section>
    <section class="card stack">
      <h3>${t('devices.filesTitle')}</h3>
      <p class="small">${t('devices.filesText')}</p>
      <div class="field"><label for="d-fallback">${t('devices.fallback')}</label>
        <select class="input" id="d-fallback"><option value="">–</option>${picks.map((id) => `<option value="${esc(id)}">${esc(sportName(id))}</option>`).join('')}</select></div>
      <label class="btn primary block">${t('devices.pick')}<input type="file" multiple accept=".fit,.tcx,.gpx,.zip,.xml" class="sr" data-change="activity-files"></label>
      ${how('devices.howGarmin', 'devices.howGarminText')}${how('devices.howApple', 'devices.howAppleText')}${how('devices.howOther', 'devices.howOtherText')}
    </section>
    <section class="card stack">
      <h3>${t('devices.exportTitle')}</h3>
      <div class="stack"><button type="button" class="btn block" data-action="export-ics">${t('devices.calendar')}</button><p class="small">${t('devices.calendarText')}</p></div>
      <div class="stack"><button type="button" class="btn block" data-action="export-workouts">${t('devices.workouts')}</button><p class="small">${t('devices.workoutsText')}</p></div>
    </section>`);
}

const deviceStatus = (msg) => { const el = $('[data-device-status]'); if (el) el.textContent = msg; };

function download(name, data, type) {
  const blob = new Blob([data], { type });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Applies activities from a watch and lets the plan react to them. */
function importActivities(list, fallbackSport) {
  const result = applyActivities(state.sessions, list, { fallbackSport: sports.has(fallbackSport) ? fallbackSport : null, makeId: () => newId() });
  if (result.matched + result.created) replan(nextMonday());
  return result;
}

let syncing = false;
async function syncGarmin({ quiet = false } = {}) {
  const g = state.garmin;
  if (syncing || !g.key || !g.relay) return;
  syncing = true;
  if (!quiet) deviceStatus(t('devices.syncing'));
  try {
    const from = g.last && g.last > addDays(today, -27) ? addDays(g.last, -3) : addDays(today, -30);
    const list = await fetchGarminActivities({ key: g.key, base: g.relay, startDate: from, endDate: today });
    const result = importActivities(list);
    g.last = today;
    saveState(state);
    render();
    if (!quiet) sheetDevices(t('devices.result', result));
    else if (result.matched + result.created) toast(`Garmin: ${t('devices.result', result)}`);
  } catch (error) {
    const key = { 'garmin-network': 'errNetwork', 'garmin-auth': 'errAuth' }[error.message] || 'errHttp';
    if (!quiet) deviceStatus(t(`devices.${key}`));
  } finally {
    syncing = false;
  }
}

function sheetReset() {
  openSheet(t('settings.resetTitle'), `
    <p>${t('settings.resetText')}</p>
    <div class="actions-col">
      <button type="button" class="btn block" data-action="close-sheet" autofocus>${t('common.cancel')}</button>
      <button type="button" class="btn danger block" data-action="confirm-reset">${t('settings.resetYes')}</button>
    </div>`);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const VIEWS = { today: viewToday, plan: viewPlan, goals: viewGoals, progress: viewProgress };
const currentTab = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today');

function render() {
  setLang(state.lang || detectLang());
  sports = sportMap(state.customSports);
  document.title = t('appName');
  const view = $('#view');
  const tabs = $('#tabs');
  $('#app').classList.toggle('is-onboarding', !state.onboarded);
  tabs.hidden = !state.onboarded;
  if (!state.onboarded) {
    view.innerHTML = viewOnboarding();
    return;
  }
  const tab = currentTab();
  view.innerHTML = VIEWS[tab]();
  tabs.setAttribute('aria-label', t('appName'));
  tabs.innerHTML = `<ul>${TABS.map((k) => `<li><a href="#${k}" ${k === tab ? 'aria-current="page"' : ''}>${icon(k)}${t(`nav.${k}`)}</a></li>`).join('')}</ul>`;
  ui.fresh = null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function finishOnboarding(goal) {
  if (goal) state.goals.push(goal);
  state.onboarded = true;
  state.lang = getLang();
  replan();
  history.replaceState(null, '', '#today');
  commit();
  window.scrollTo(0, 0);
}

const actions = {
  'ob-next'(el) {
    const form = $('#ob-form');
    if (form) {
      readProfile(form);
      const err = ui.step === 1 && !state.profile.sports.length ? 'profile.needSport' : ui.step === 2 && !state.profile.days.length ? 'profile.needDay' : null;
      if (err) { form.querySelector('[data-error]').textContent = t(err); return; }
      if (ui.step === 2 && !state.profile.days.includes(state.profile.longDay)) state.profile.longDay = state.profile.days.at(-1);
    }
    ui.step++;
    saveState(state);
    render();
    window.scrollTo(0, 0);
  },
  'ob-back'() {
    const form = $('#ob-form');
    if (form && ui.step < 3) readProfile(form);
    ui.step = Math.max(0, ui.step - 1);
    render();
    window.scrollTo(0, 0);
  },
  'ob-finish'() {
    const goal = readGoal($('#ob-form'));
    if (goal) finishOnboarding(goal);
  },
  'ob-skip': () => finishOnboarding(null),

  'open-session': (el) => sheetSession(el.dataset.id),
  'done-session': (el) => sheetFeedback(el.dataset.id),
  'skip-session': (el) => sheetSkip(el.dataset.id),
  'edit-session': (el) => sheetEdit(el.dataset.id),
  'add-session': (el) => sheetEdit(null, el.dataset.date),
  'confirm-skip'(el) {
    const s = state.sessions.find((x) => x.id === el.dataset.id);
    if (!s) return;
    s.status = 'skipped';
    replan(nextMonday());
    closeSheet(); commit(); toast(t('feedback.skipped'));
  },
  'move-session'(el) {
    const s = state.sessions.find((x) => x.id === el.dataset.id);
    if (!s || !isValidISO(el.dataset.date)) return;
    s.date = el.dataset.date;
    s.locked = true;
    closeSheet(); commit(); toast(t('session.moved'));
  },
  'reopen-session'(el) {
    const s = state.sessions.find((x) => x.id === el.dataset.id);
    if (!s) return;
    s.status = 'planned';
    delete s.rpe; delete s.feeling;
    closeSheet(); commit();
  },
  'delete-session'(el) {
    state.sessions = state.sessions.filter((x) => x.id !== el.dataset.id);
    closeSheet(); commit(); toast(t('session.deleted'));
  },

  'week-prev'() { ui.week = addDays(ui.week, -7); render(); },
  'week-next'() { ui.week = addDays(ui.week, 7); render(); },
  'week-today'() { ui.week = weekStart(today); render(); },
  regenerate() { replan(); commit(); toast(t('plan.regenerated')); },

  'add-goal': (el) => sheetGoal(null, el.dataset.kind),
  'edit-goal': (el) => sheetGoal(el.dataset.id),
  'delete-goal'(el) {
    const id = el.dataset.id;
    state.goals = state.goals.filter((g) => g.id !== id);
    state.sessions = state.sessions.filter((s) => s.goalId !== id || s.status !== 'planned');
    replan();
    closeSheet(); commit(); toast(t('goals.deleted'));
  },

  settings: () => sheetSettings(),
  devices: () => sheetDevices(),
  'garmin-disconnect'() {
    state.garmin = { key: '', relay: '', last: null };
    saveState(state);
    sheetDevices(t('devices.garminDisconnected'));
  },
  'export-ics'() {
    const open = state.sessions.filter((s) => s.status === 'planned' && s.date >= today);
    if (!open.length) { deviceStatus(t('devices.noOpen')); return; }
    const events = open.map((s) => ({
      id: s.id, date: s.date,
      title: `${sportName(s.sportId)}: ${sessionTitle(s)}, ${s.duration} ${t('common.min')}`,
      description: `${t(`typeDesc.${TYPE_INTENSITY[s.type] ? s.type : 'free'}`)}${s.note ? `\n${s.note}` : ''}`,
    }));
    download('trainingsplaner.ics', buildIcs(events, t('appName')), 'text/calendar');
  },
  'export-workouts'() {
    const until = addDays(today, 13);
    const open = state.sessions.filter((s) => s.status === 'planned' && s.date >= today && s.date <= until && s.type !== 'race');
    if (!open.length) { deviceStatus(t('devices.noOpen')); return; }
    const files = open.map((s) => {
      const name = `${s.date.slice(8)}.${s.date.slice(5, 7)}. ${sessionTitle(s)}`;
      return { name: `${s.date}-${slug(`${sportName(s.sportId)} ${sessionTitle(s)}`)}.fit`, data: encodeWorkout(s, name, t('devices.steps')) };
    });
    download(`garmin-workouts-${today}.zip`, zipStore(files), 'application/zip');
  },
  'add-sport'() {
    const form = $('#ob-form') || $('[data-form=settings]');
    if (form) readProfile(form);
    sheetSport();
  },
  'delete-sport'(el) {
    const id = el.dataset.id;
    readProfile($('[data-form=settings]'));
    state.customSports = state.customSports.filter((c) => c.id !== id);
    state.profile.sports = state.profile.sports.filter((s) => s !== id);
    sports = sportMap(state.customSports);
    state.sessions = state.sessions.filter((s) => s.sportId !== id || s.status === 'done');
    for (const g of state.goals) g.sports = g.sports.filter((s) => s !== id);
    state.goals = state.goals.filter((g) => g.sports.length);
    if (state.profile.sports.length) replan();
    saveState(state); render(); sheetSettings();
  },
  export() {
    // The Garmin key is a credential and stays out of the backup file.
    const copy = { ...state, garmin: { ...state.garmin, key: '' } };
    download(`trainingsplaner-backup-${today}.json`, JSON.stringify(copy, null, 2), 'application/json');
  },
  reset: () => sheetReset(),
  async 'confirm-reset'() {
    const lang = getLang();
    await clearState();
    state = { ...emptyState(), lang };
    ui.step = 0; ui.week = weekStart(today);
    history.replaceState(null, '', location.pathname);
    closeSheet(); commit();
    window.scrollTo(0, 0);
  },
  async install(el) {
    if (el.getAttribute('aria-disabled') === 'true') return;
    el.setAttribute('aria-disabled', 'true');
    try {
      if (typeof Navigator.prototype.install === 'function') {
        await navigator.install();
        el.hidden = true;
      } else if (installPrompt) {
        const prompt = installPrompt;
        installPrompt = null;
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') { closeSheet(); toast(t('settings.installed')); }
        if (!installPrompt) el.hidden = true;
      }
    } catch (error) {
      if (error.name !== 'AbortError') console.error(error);
    } finally {
      el.removeAttribute('aria-disabled');
    }
  },
  'close-sheet': () => closeSheet(),
};

const forms = {
  'ob-next': () => actions['ob-next'](),
  'ob-finish': () => actions['ob-finish'](),
  feedback(form) {
    const s = state.sessions.find((x) => x.id === form.dataset.id);
    if (!s) return;
    const fd = new FormData(form);
    s.status = 'done';
    s.feeling = Math.min(5, Math.max(1, Number(fd.get('feeling')) || 3));
    s.rpe = Math.min(10, Math.max(1, Number(fd.get('rpe')) || 5));
    s.duration = Math.min(900, Math.max(5, Math.round(Number(fd.get('duration')) || s.duration)));
    s.note = String(fd.get('note') || '').trim().slice(0, 400) || undefined;
    ui.fresh = s.id;
    replan(nextMonday());
    closeSheet(); commit(); toast(t('feedback.saved'));
  },
  session(form) {
    const fd = new FormData(form);
    const date = String(fd.get('date'));
    if (!isValidISO(date) || !sports.has(fd.get('sportId'))) return;
    let s = state.sessions.find((x) => x.id === form.dataset.id);
    if (!s) {
      s = { id: newId(), status: 'planned' };
      state.sessions.push(s);
    }
    Object.assign(s, {
      sportId: fd.get('sportId'),
      type: TYPE_INTENSITY[fd.get('type')] ? fd.get('type') : 'free',
      date,
      duration: Math.min(900, Math.max(5, Math.round(Number(fd.get('duration')) || 45))),
      intensity: Math.min(5, Math.max(1, Number(fd.get('intensity')) || 2)),
      note: String(fd.get('note') || '').trim().slice(0, 400) || undefined,
      locked: true,
    });
    state.sessions.sort((a, b) => a.date.localeCompare(b.date) || b.intensity - a.intensity);
    ui.week = weekStart(date);
    closeSheet(); commit(); toast(t('session.saved'));
  },
  goal(form) {
    const existing = goalOf(form.dataset.id);
    const goal = readGoal(form, existing);
    if (!goal) return;
    if (existing) {
      Object.assign(existing, goal);
      // The race session follows its goal to the new date.
      state.sessions = state.sessions.filter((s) => s.goalId !== goal.id || s.status !== 'planned');
    } else state.goals.push(goal);
    replan();
    closeSheet(); commit(); toast(t('goals.saved'));
  },
  sport(form) {
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim().slice(0, 30);
    if (!name) { form.querySelector('[name=name]').focus(); return; }
    const c = {
      id: newId('c'), name,
      kind: ['endurance', 'strength', 'mobility', 'skill'].includes(fd.get('kind')) ? fd.get('kind') : 'endurance',
      color: CUSTOM_COLORS.includes(fd.get('color')) ? fd.get('color') : CUSTOM_COLORS[3],
    };
    state.customSports.push(c);
    state.profile.sports.push(c.id);
    sports = sportMap(state.customSports);
    saveState(state);
    if (state.onboarded) { render(); sheetSettings(); } else { closeSheet(); render(); }
  },
  garmin(form) {
    const fd = new FormData(form);
    const key = String(fd.get('key') || '').trim();
    const relay = String(fd.get('relay') || '').trim().replace(/\/+$/, '');
    const err = !key || !relay ? 'devices.garminNeed' : !isRelayUrl(relay) ? 'devices.relayInvalid' : null;
    if (err) { form.querySelector('[data-error]').textContent = t(err); return; }
    form.querySelector('[data-error]').textContent = '';
    Object.assign(state.garmin, { key, relay });
    saveState(state);
    syncGarmin();
  },
  settings(form) {
    readProfile(form);
    const err = !state.profile.sports.length ? 'profile.needSport' : !state.profile.days.length ? 'profile.needDay' : null;
    if (err) { form.querySelector('[data-error]').textContent = t(err); return; }
    if (!state.profile.days.includes(state.profile.longDay)) state.profile.longDay = state.profile.days.at(-1);
    replan();
    closeSheet(); commit(); toast(t('settings.savedReplan'));
  },
};

const changes = {
  lang(el) {
    state.lang = el.value;
    setLang(el.value);
    saveState(state);
    const inSheet = sheet().open;
    const form = $('#ob-form');
    if (form && ui.step < 3) readProfile(form);
    render();
    if (inSheet) sheetSettings();
  },
  'ob-kind'(el) { ui.goalKind = el.value; render(); },
  type(el) {
    const n = TYPE_INTENSITY[el.value];
    const radio = el.form.querySelector(`[name=intensity][value="${n}"]`);
    if (radio) radio.checked = true;
  },
  async 'activity-files'(el) {
    const files = [...(el.files || [])];
    if (!files.length) return;
    const fallback = $('#d-fallback')?.value || '';
    deviceStatus(t('devices.reading'));
    const list = [];
    const problems = [];
    for (const file of files) {
      try {
        list.push(...await readActivityFile(file, { since: addDays(today, -60) }));
      } catch (error) {
        problems.push(error.message === 'zip-too-large' ? t('devices.zipTooLarge') : t('devices.fileError', file.name));
      }
    }
    const result = importActivities(list, fallback);
    saveState(state);
    render();
    sheetDevices([list.length || !problems.length ? t('devices.result', result) : '', ...problems].filter(Boolean).join(' '));
    const select = $('#d-fallback');
    if (select) select.value = fallback;
  },
  async import(el) {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || !data.profile || !Array.isArray(data.sessions)) throw new Error('shape');
      const garminKey = state.garmin.key;
      state = normalise(data);
      if (!state.garmin.key) state.garmin.key = garminKey;
      ui.week = weekStart(today);
      closeSheet(); commit(); toast(t('settings.imported'));
    } catch {
      closeSheet(); toast(t('settings.importError'));
    }
  },
};

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  forms[form.dataset.form]?.(form);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset?.change) changes[el.dataset.change]?.(el);
  if (el.name === 'preset' && el.value) {
    const preset = EVENT_PRESETS.find((p) => p.id === el.value);
    const name = el.form.querySelector('[name=name]');
    if (!name.value.trim() || EVENT_PRESETS.some((p) => name.value === t(`presets.${p.id}`))) name.value = t(`presets.${preset.id}`);
    for (const box of el.form.querySelectorAll('[name=gsports]')) box.checked = preset.sports.includes(box.value);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.dataset?.input !== 'rpe') return;
  const n = Number(e.target.value);
  $('[data-rpe-num]').textContent = n;
  $('[data-rpe-text]').textContent = t('feedback.rpeScale')[n];
});

// Light dismiss for browsers without <dialog closedby>.
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const dialog = sheet();
  const outside = (e) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e); });
  dialog.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e)) dialog.close(); });
}

window.addEventListener('hashchange', () => {
  if (!state.onboarded) return;
  closeSheet();
  render();
  window.scrollTo(0, 0);
  $('#view').focus({ preventScroll: true });
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { flush(); return; }
  if (todayISO() !== today) {
    today = todayISO();
    ui.week = weekStart(today);
    extendPlan();
    render();
    syncGarmin({ quiet: true });
  }
});
window.addEventListener('pagehide', () => flush());

/** Keeps a rolling plan alive: adds new weeks once the generated ones run out. */
function extendPlan() {
  if (!state.onboarded || !selectedSports().length) return;
  const last = state.sessions.reduce((max, s) => (s.date > max ? s.date : max), '');
  if (last < addDays(today, 21)) {
    replan(last >= today ? nextMonday() : today);
    saveState(state);
  }
}

async function boot() {
  state = await loadState();
  sports = sportMap(state.customSports);
  setLang(state.lang || detectLang());
  extendPlan();
  render();
  if (state.onboarded) syncGarmin({ quiet: true });
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
