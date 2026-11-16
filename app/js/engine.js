// Planning engine: turns sports + goals + availability into one periodised plan
// across all sports, checks manual edits for conflicts and summarises progress.
// Pure functions only – no DOM, no storage – so it can be tested with node:test.

import { addDays, diffDays, weekStart, weekday } from './dates.js';
import { sportMap } from './sports.js';

export const TYPE_INTENSITY = {
  easy: 2, long: 3, fartlek: 3, tempo: 4, intervals: 5, sharpen: 4, activation: 2, recovery: 1,
  strength: 3, strength_max: 4, strength_maintain: 2, core: 2, mobility: 1,
  technique: 2, skill_hard: 4, race: 5, test: 5, free: 2,
};
const INTENSITY_FACTOR = [0, 0.5, 0.7, 1, 1.3, 1.6];
const EXPECTED_RPE = [0, 2, 4, 6, 8, 9];
const MAX_HARD = { beginner: 1, intermediate: 2, advanced: 3 };
const LONG_CAP = { beginner: 150, intermediate: 240, advanced: 360 };
const PHASE_FACTOR = { base: 0.8, build: 1, peak: 1.1, taper: 0.7, race: 0.6, recover: 0.6 };
const DEMOTE = { tempo: 'easy', intervals: 'easy', sharpen: 'easy', strength_max: 'strength', skill_hard: 'technique' };

export const isHard = (s) => s.intensity >= 4;
export const isKey = (s) => isHard(s) || s.type === 'long';
const rankOf = (g) => (g.kind === 'performance' ? 2 : { A: 3, B: 2, C: 1 }[g.priority] || 1);
const isBigEvent = (g) => g.kind === 'event' && rankOf(g) >= 2;
const round5 = (n) => Math.max(15, Math.round(n / 5) * 5);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

let idCounter = 0;
export const newId = (prefix = 's') => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function sessionLoad(session, sports) {
  const sport = sports.get(session.sportId);
  return Math.round(session.duration * INTENSITY_FACTOR[session.intensity || 2] * (sport?.impact ?? 1));
}

// ---------------------------------------------------------------------------
// Season structure
// ---------------------------------------------------------------------------

/** Lays out the weeks of the season and assigns each a training phase. */
export function planWeeks(goals, today, minWeeks = 8) {
  const start = weekStart(today);
  const future = goals.filter((g) => g.date >= start).sort((a, b) => a.date.localeCompare(b.date));
  const last = future.at(-1);
  const count = clamp(last ? Math.floor(diffDays(start, last.date) / 7) + 2 : minWeeks, minWeeks, 60);

  const weeks = [];
  for (let i = 0; i < count; i++) {
    const ws = addDays(start, i * 7);
    const we = addDays(ws, 6);
    const ahead = future.filter((g) => g.date >= ws);
    const topRank = Math.max(0, ...ahead.map(rankOf));
    const driver = ahead.find((g) => rankOf(g) === topRank) || null;
    const toGoal = driver ? Math.floor(diffDays(ws, driver.date) / 7) : null;
    const prevStart = addDays(ws, -7);
    const afterEvent = goals.some((g) => isBigEvent(g) && g.date >= prevStart && g.date < ws);

    let phase = 'base';
    if (driver) {
      if (toGoal === 0) phase = 'race';
      else if (toGoal === 1) phase = 'taper';
      else if (toGoal <= 4) phase = 'peak';
      else if (toGoal <= 10) phase = 'build';
    }
    if (afterEvent && phase !== 'race') phase = 'recover';

    weeks.push({ index: i, start: ws, end: we, phase, toGoal, driverId: driver?.id ?? null, deload: false });
  }
  // Every fourth loading week is an easier one, unless a taper follows anyway.
  let streak = 0;
  weeks.forEach((w, i) => {
    const loading = ['base', 'build', 'peak'].includes(w.phase);
    streak = loading ? streak + 1 : 0;
    const next = weeks[i + 1];
    if (loading && streak === 4 && !(next && ['taper', 'race'].includes(next.phase))) {
      w.deload = true;
      streak = 0;
    }
  });
  return weeks;
}

// ---------------------------------------------------------------------------
// Adaptation from feedback
// ---------------------------------------------------------------------------

/** Looks at the last three weeks of feedback and decides whether to ease or push. */
export function computeAdaptation(sessions, today) {
  const from = addDays(today, -21);
  const recent = sessions.filter((s) => s.date >= from && s.date < today && s.type !== 'race');
  const planned = recent.reduce((n, s) => n + s.duration, 0);
  const done = recent.filter((s) => s.status === 'done');
  const doneMin = done.reduce((n, s) => n + s.duration, 0);
  const rated = done.filter((s) => s.feeling);
  const rpeRated = done.filter((s) => s.rpe);
  const adherence = planned ? doneMin / planned : null;
  const feeling = rated.length ? rated.reduce((n, s) => n + s.feeling, 0) / rated.length : null;
  const rpeGap = rpeRated.length
    ? rpeRated.reduce((n, s) => n + (s.rpe - EXPECTED_RPE[s.intensity || 2]), 0) / rpeRated.length
    : null;

  const out = { factor: 1, hardCut: 0, reasons: [], adherence, feeling, rpeGap };
  if (recent.length < 3) return out;
  if (adherence < 0.5) { out.factor *= 0.8; out.reasons.push('missedMany'); }
  else if (adherence < 0.75) { out.factor *= 0.9; out.reasons.push('missedSome'); }
  const strained = (feeling !== null && rated.length >= 2 && feeling <= 2.2) || (rpeGap !== null && rpeRated.length >= 2 && rpeGap >= 2);
  if (strained) { out.factor *= 0.9; out.hardCut = 1; out.reasons.push('tooHard'); }
  if (!out.reasons.length && adherence >= 0.95 && feeling !== null && feeling >= 4 && (rpeGap === null || rpeGap <= 0)) {
    out.factor = 1.05; out.reasons.push('goingWell');
  }
  out.factor = Math.round(out.factor * 100) / 100;
  return out;
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

/**
 * Generates the plan. Past sessions, logged sessions and manually edited
 * (locked) sessions are kept; everything else from `from` onwards is rebuilt.
 */
export function generatePlan({ profile, goals = [], sessions = [], customSports = [] }, today, from = today) {
  const sports = sportMap(customSports);
  const selected = (profile.sports || []).filter((id) => sports.has(id));
  const weeks = planWeeks(goals, today);
  const adapt = computeAdaptation(sessions, today);
  const kept = sessions.filter((s) => s.date < from || s.status !== 'planned' || s.locked);
  const out = [...kept];
  if (!selected.length) return { sessions: sortSessions(out), weeks, adapt };

  const days = (profile.days?.length ? [...profile.days] : [1, 3, 5]).sort((a, b) => a - b);
  const ctx = { profile, sports, selected, goals, adapt, days, credit: new Map(selected.map((id) => [id, 0])) };

  const keyOn = (list, iso) => list.filter((s) => s.date === iso && isKey(s) && s.status !== 'skipped');
  let prevSundayKey = keyOn(kept, addDays(weeks[0].start, -1));
  for (const week of weeks) {
    const keptHere = kept.filter((s) => s.date >= week.start && s.date <= week.end);
    const fresh = buildWeek(ctx, week, keptHere, from, prevSundayKey);
    out.push(...fresh);
    prevSundayKey = keyOn([...keptHere, ...fresh], week.end);
  }
  return { sessions: sortSessions(out), weeks, adapt };
}

const sortSessions = (list) => list.sort((a, b) => a.date.localeCompare(b.date) || b.intensity - a.intensity);

function sportWeights(ctx, week, mainEvent) {
  const weights = new Map();
  const focus = new Map();
  for (const id of ctx.selected) {
    const kind = ctx.sports.get(id).kind;
    weights.set(id, kind === 'strength' ? 0.7 : kind === 'mobility' ? 0.5 : 1);
    focus.set(id, 1);
  }
  for (const g of ctx.goals) {
    if (g.date < week.start) continue;
    const wk = Math.floor(diffDays(week.start, g.date) / 7);
    if (wk > 16) continue;
    const closeness = wk <= 8 ? 1 : 1 - ((wk - 8) / 8) * 0.6;
    const mult = 1 + ([0, 0.4, 0.9, 1.6][rankOf(g)]) * closeness;
    for (const id of g.sports || []) if (focus.has(id)) focus.set(id, Math.max(focus.get(id), mult));
  }
  const driver = ctx.goals.find((g) => g.id === week.driverId);
  const sharpening = ['taper', 'race'].includes(week.phase) || mainEvent;
  for (const id of ctx.selected) {
    let w = weights.get(id) * focus.get(id);
    const target = mainEvent || driver;
    if (sharpening && target && !(target.sports || []).includes(id)) w *= 0.5;
    weights.set(id, w);
  }
  return { weights, focus };
}

function allocate(ctx, weights, n) {
  const counts = new Map(ctx.selected.map((id) => [id, 0]));
  const total = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  const cappedKinds = ctx.selected.every((id) => ctx.sports.get(id).kind !== 'endurance' && ctx.sports.get(id).kind !== 'skill');
  const capOf = (id) => (cappedKinds || ['endurance', 'skill'].includes(ctx.sports.get(id).kind) ? Infinity : 2);
  for (const id of ctx.selected) ctx.credit.set(id, ctx.credit.get(id) + (n * weights.get(id)) / total);
  for (let i = 0; i < n; i++) {
    const open = ctx.selected.filter((id) => counts.get(id) < capOf(id));
    const pool = open.length ? open : ctx.selected;
    const pick = pool.reduce((best, id) => (ctx.credit.get(id) > ctx.credit.get(best) + 1e-9 ? id : best), pool[0]);
    counts.set(pick, counts.get(pick) + 1);
    ctx.credit.set(pick, ctx.credit.get(pick) - 1);
  }
  for (const id of ctx.selected) ctx.credit.set(id, clamp(ctx.credit.get(id), -1.5, 1.5));
  return counts;
}

function typesFor(ctx, week, sport, k, { isFocus, inEvent, raceWeek, hasDriver }) {
  const level = ctx.profile.level || 'intermediate';
  const phase = week.phase;
  if (!k) return [];

  if (sport.kind === 'mobility') return Array(k).fill(sport.id === 'core' ? 'core' : 'mobility');

  if (sport.kind === 'strength') {
    let type;
    if (raceWeek || ['taper', 'race', 'recover'].includes(phase) || week.deload) type = 'strength_maintain';
    else if (!hasDriver) type = week.index % 8 < 4 ? 'strength' : 'strength_max';
    else if (phase === 'base') type = 'strength';
    else if (phase === 'build' || isFocus) type = 'strength_max';
    else type = 'strength_maintain';
    return Array(k).fill(type).map((t, i) => (i > 0 && t === 'strength_max' ? 'strength' : t));
  }

  if (sport.kind === 'skill') {
    const hard = ['build', 'peak'].includes(phase) && !week.deload && !raceWeek;
    return Array.from({ length: k }, (_, i) => (i === 0 && hard ? 'skill_hard' : 'technique'));
  }

  // Endurance sports
  if (phase === 'recover') return Array.from({ length: k }, (_, i) => (i === 0 ? 'easy' : 'recovery'));
  if (raceWeek) {
    if (!inEvent) return Array(k).fill('easy');
    return k === 1 ? ['activation'] : ['sharpen', ...Array(k - 2).fill('easy'), 'activation'];
  }
  if (phase === 'taper') {
    if (k === 1) return [isFocus ? 'sharpen' : 'easy'];
    if (k === 2) return ['sharpen', 'easy'];
    return ['sharpen', 'long', ...Array(k - 2).fill('easy')];
  }
  let quality = { base: 'fartlek', build: 'tempo', peak: 'intervals' }[phase] || 'fartlek';
  if (level === 'beginner' && quality === 'intervals') quality = 'tempo';
  if (level === 'beginner' && phase === 'base' && week.index < 3) quality = 'easy';
  if (week.deload) quality = phase === 'base' ? 'easy' : 'fartlek';
  if (sport.gentle) quality = 'easy';
  const prefersLong = sport.long >= 2.2;
  if (k === 1) return [isFocus ? (week.index % 2 ? quality : 'long') : prefersLong ? 'long' : 'easy'];
  const list = ['long', quality];
  for (let i = 2; i < k; i++) {
    if (i === 4 && level === 'advanced' && !week.deload && !sport.gentle) list.push(quality === 'intervals' ? 'tempo' : 'fartlek');
    else list.push('easy');
  }
  return list;
}

function durationFor(ctx, sport, type, factor) {
  const base = ctx.profile.minutes || 60;
  const level = ctx.profile.level || 'intermediate';
  if (sport.kind === 'mobility') return round5(clamp(base * sport.dur, 15, 45));
  const m = base * factor;
  if (type === 'long') return round5(Math.min(m * sport.long, LONG_CAP[level] * (sport.long >= 2 ? 1 : 0.6)));
  const mult = { easy: 0.9, recovery: 0.6, activation: 0.6, sharpen: 0.9 }[type] ?? 1;
  return round5(clamp(m * sport.dur * mult, 15, 120));
}

function buildWeek(ctx, week, kept, today, prevSundayKey) {
  if (week.end < today) return [];
  const { sports, profile } = ctx;
  const level = profile.level || 'intermediate';
  const dayOf = (iso) => diffDays(week.start, iso);
  const fresh = [];
  const live = kept.filter((s) => s.status !== 'skipped');

  // Goal sessions (race day / test day) are fixed points of the week.
  const goalsHere = ctx.goals.filter((g) => g.date >= week.start && g.date <= week.end);
  for (const g of goalsHere) {
    if (g.date < today || kept.some((s) => s.goalId === g.id)) continue;
    const sportId = (g.sports || []).find((id) => sports.has(id)) || ctx.selected[0];
    const type = g.kind === 'event' ? 'race' : 'test';
    fresh.push({
      id: newId(), date: g.date, sportId, type, goalId: g.id, status: 'planned', locked: false, phase: week.phase,
      intensity: 5, duration: g.kind === 'event' ? round5(clamp((profile.minutes || 60) * 1.5, 30, 240)) : round5(profile.minutes || 60),
    });
  }

  const mainEvent = goalsHere.filter(isBigEvent).sort((a, b) => rankOf(b) - rankOf(a) || a.date.localeCompare(b.date))[0] || null;
  // Events early next week still shape the end of this one.
  const eventDays = ctx.goals
    .filter((g) => g.date >= week.start && g.date <= addDays(week.end, 2))
    .map((g) => ({ day: dayOf(g.date), big: isBigEvent(g) }));

  const occupied = new Set([...live, ...fresh].map((s) => dayOf(s.date)));
  let free = ctx.days.filter((d) => addDays(week.start, d) >= today && !occupied.has(d));
  if (mainEvent) free = free.filter((d) => d < dayOf(mainEvent.date));

  let n = free.length;
  if (week.phase === 'recover') n = Math.ceil(n * 0.6);
  n = Math.min(n, 6 - occupied.size); // always leave one rest day
  if (n <= 0) return fresh;

  let factor = PHASE_FACTOR[week.phase] * ctx.adapt.factor;
  if (week.phase === 'base') factor = (0.75 + Math.min(week.index, 6) * 0.03) * ctx.adapt.factor;
  if (week.deload) factor *= 0.72;
  if (mainEvent && week.phase !== 'race') factor *= 0.8;

  const { weights, focus } = sportWeights(ctx, week, mainEvent);
  const counts = allocate(ctx, weights, n);
  const endurance = ctx.selected.filter((id) => sports.get(id).kind === 'endurance');
  const hasDriver = Boolean(week.driverId);

  let specs = [];
  for (const id of ctx.selected) {
    const sport = sports.get(id);
    const isFocus = focus.get(id) > 1.3 || (sport.kind === 'endurance' && endurance.length === 1);
    const inEvent = Boolean(mainEvent && (mainEvent.sports || []).includes(id));
    const types = typesFor(ctx, week, sport, counts.get(id), { isFocus, inEvent, raceWeek: Boolean(mainEvent), hasDriver });
    for (const type of types) specs.push({ sportId: id, type, weight: weights.get(id) });
  }

  // One shared budget of hard sessions across every sport.
  let budget = week.phase === 'recover' ? 0 : Math.max(1, MAX_HARD[level] - ctx.adapt.hardCut);
  budget -= [...live, ...fresh].filter(isHard).length;
  specs.sort((a, b) => b.weight - a.weight);
  for (const spec of specs) {
    if (TYPE_INTENSITY[spec.type] < 4) continue;
    if (budget > 0) budget--;
    else spec.type = DEMOTE[spec.type] || 'easy';
  }

  // Place sessions: long first, then hard, then strength, then the rest.
  const order = (s) => (s.type === 'long' ? 0 : TYPE_INTENSITY[s.type] >= 4 ? 1 : sports.get(s.sportId).kind === 'strength' ? 2 : 3 + (5 - TYPE_INTENSITY[s.type]));
  specs.sort((a, b) => order(a) - order(b) || b.weight - a.weight);
  const placed = new Map(); // day -> sessions on that day
  const put = (day, s) => placed.set(day, [...(placed.get(day) || []), s]);
  for (const s of prevSundayKey) put(-1, s);
  for (const s of [...live, ...fresh]) put(dayOf(s.date), s);
  const longDay = free.includes(profile.longDay) ? profile.longDay : free.at(-1);

  for (const spec of specs) {
    const s = { ...spec, intensity: sports.get(spec.sportId).intensity && TYPE_INTENSITY[spec.type] <= 2 ? sports.get(spec.sportId).intensity : TYPE_INTENSITY[spec.type] };
    const candidates = free.filter((d) => !(placed.get(d) || []).some((p) => p._new));
    if (!candidates.length) break;
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const d of candidates) {
      const sc = scoreDay(s, d, placed, eventDays, longDay, sports);
      if (sc > bestScore) { bestScore = sc; best = d; }
    }
    const session = {
      id: newId(), date: addDays(week.start, best), sportId: s.sportId, type: s.type, intensity: s.intensity,
      duration: durationFor(ctx, sports.get(s.sportId), s.type, factor), status: 'planned', locked: false, phase: week.phase,
    };
    fresh.push(session);
    put(best, { ...session, _new: true });
  }

  // Tight weeks can still force neighbours that do not go together: soften the generated one.
  const on = (iso) => [...live, ...fresh, ...(iso < week.start ? prevSundayKey : [])].filter((p) => p.date === iso);
  for (const s of fresh) {
    if (s.goalId) continue;
    const sport = sports.get(s.sportId);
    const before = on(addDays(s.date, -1));
    const after = on(addDays(s.date, 1));
    if (isHard(s) && ([...before, ...after, ...on(s.date)].some((p) => p !== s && isHard(p)) || after.some((p) => p.type === 'long'))) s.type = DEMOTE[s.type] || 'easy';
    const preEvent = eventDays.some((e) => e.day - dayOf(s.date) >= 1 && e.day - dayOf(s.date) <= (e.big ? 2 : 1));
    if (preEvent && isKey(s)) s.type = s.type === 'long' ? 'easy' : DEMOTE[s.type] || 'easy';
    if (preEvent && sport.kind === 'strength' && s.intensity >= 3) s.type = 'strength_maintain';
    if (sport.kind === 'strength' && s.intensity >= 3 && after.some((p) => isKey(p) && sports.get(p.sportId)?.kind === 'endurance')) s.type = 'strength_maintain';
    if (TYPE_INTENSITY[s.type] !== s.intensity && !(sport.intensity && TYPE_INTENSITY[s.type] <= 2)) {
      s.intensity = TYPE_INTENSITY[s.type];
      s.duration = durationFor(ctx, sport, s.type, factor);
    }
  }
  return fresh;
}

function scoreDay(s, d, placed, eventDays, longDay, sports) {
  let score = 0;
  const key = isKey(s);
  const strength = sports.get(s.sportId)?.kind === 'strength' && s.type !== 'strength_maintain';
  const gentle = s.intensity <= 2 && !strength;
  let nearest = 9;
  for (const [day, list] of placed) {
    const dist = Math.abs(day - d);
    if (day >= 0) nearest = Math.min(nearest, dist);
    for (const p of list) {
      const pKey = isKey(p);
      if (key && pKey && dist <= 1) score -= dist === 0 ? 60 : isHard(s) && isHard(p) ? 40 : 30;
      if (strength && pKey && day === d + 1) score -= 25;
      if (key && sports.get(p.sportId)?.kind === 'strength' && p.type !== 'strength_maintain' && day === d - 1) score -= 25;
    }
  }
  for (const e of eventDays) {
    if (e.big) {
      if (d === e.day - 1) score += s.type === 'activation' ? 40 : gentle ? -10 : -80;
      else if (s.type === 'activation') score -= 20;
      if (d === e.day - 2 && (key || strength)) score -= 40;
      if (d > e.day && !gentle) score -= 60;
    } else {
      if (d === e.day - 1 && (key || strength)) score -= 40;
      if (d === e.day + 1 && key) score -= 30;
    }
  }
  if (s.type === 'long') score += d === longDay ? 50 : d >= 5 ? 5 : 0;
  score += Math.min(nearest, 3) * 2;
  return score - d * 0.01;
}

// ---------------------------------------------------------------------------
// Conflict check for manual edits
// ---------------------------------------------------------------------------

/** Returns warnings for one week (Monday ISO date). */
export function findConflicts(sessions, goals, profile, sports, start) {
  const end = addDays(start, 6);
  const active = sessions.filter((s) => s.status !== 'skipped');
  const week = active.filter((s) => s.date >= start && s.date <= end);
  const out = [];
  if (!week.length) return out;
  const byDay = (iso) => active.filter((s) => s.date === iso);
  const level = profile.level || 'intermediate';

  for (let d = 0; d < 7; d++) {
    const iso = addDays(start, d);
    const today = byDay(iso);
    const hardToday = today.filter(isHard);
    if (hardToday.length > 1) out.push({ code: 'doubleHard', date: iso, ids: hardToday.map((s) => s.id) });
    const next = byDay(addDays(iso, 1));
    if (hardToday.length && next.some(isHard) && d < 6) {
      out.push({ code: 'hardBackToBack', date: iso, ids: [...hardToday, ...next.filter(isHard)].map((s) => s.id) });
    }
    const heavyLift = today.filter((s) => sports.get(s.sportId)?.kind === 'strength' && s.intensity >= 3);
    const nextKey = next.filter((s) => isKey(s) && sports.get(s.sportId)?.kind === 'endurance' && s.type !== 'race');
    if (heavyLift.length && nextKey.length) out.push({ code: 'strengthBeforeKey', date: iso, ids: [...heavyLift, ...nextKey].map((s) => s.id) });
  }

  const hardCount = week.filter((s) => isHard(s) && s.type !== 'race' && s.type !== 'test').length;
  if (hardCount > MAX_HARD[level]) out.push({ code: 'tooManyHard', date: start, n: hardCount, max: MAX_HARD[level] });

  if (new Set(week.map((s) => s.date)).size === 7) out.push({ code: 'noRestDay', date: start });

  const load = (list) => list.reduce((n, s) => n + sessionLoad(s, sports), 0);
  // Compare with the heaviest of the previous four weeks so easy or race weeks do not trigger a false alarm.
  const span = (a, b) => load(active.filter((s) => s.date >= addDays(start, a) && s.date < addDays(start, b) && s.type !== 'race'));
  const now = load(week.filter((s) => s.type !== 'race'));
  const before = Math.max(span(-7, 0), span(-14, -7), span(-21, -14), span(-28, -21));
  if (before >= 120 && now > before * 1.3) out.push({ code: 'loadJump', date: start, pct: Math.round((now / before - 1) * 100) });

  for (const g of goals) {
    if (g.kind !== 'event' || g.date < start || g.date > addDays(end, 2)) continue;
    const big = rankOf(g) >= 2;
    for (const back of big ? [1, 2] : [1]) {
      const iso = addDays(g.date, -back);
      if (iso < start || iso > end) continue;
      const risky = byDay(iso).filter((s) => isKey(s) || (sports.get(s.sportId)?.kind === 'strength' && s.intensity >= 3));
      if (risky.length) out.push({ code: 'hardBeforeEvent', date: iso, goal: g.name, ids: risky.map((s) => s.id) });
    }
    if (g.date <= end) {
      const extra = byDay(g.date).filter((s) => s.goalId !== g.id && s.intensity >= 2 && s.type !== 'race');
      if (extra.length) out.push({ code: 'eventDayExtra', date: g.date, goal: g.name, ids: extra.map((s) => s.id) });
    }
  }
  return out;
}

/** Finds a later free day in the same week to catch up on a skipped session. */
export function suggestMakeup(session, sessions, profile, today) {
  const end = addDays(weekStart(session.date), 6);
  const active = sessions.filter((s) => s.status !== 'skipped' && s.id !== session.id);
  const from = session.date > today ? session.date : today;
  for (let iso = addDays(from, 1); iso <= end; iso = addDays(iso, 1)) {
    if (active.some((s) => s.date === iso)) continue;
    if (profile.days?.length && !profile.days.includes(weekday(iso))) continue;
    const neighbours = active.filter((s) => Math.abs(diffDays(s.date, iso)) === 1);
    if (isKey(session) && neighbours.some(isKey)) continue;
    if (neighbours.some((s) => s.type === 'race') || active.some((s) => s.type === 'race' && s.date === iso)) continue;
    return iso;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function weekSummary(sessions, sports, start) {
  const end = addDays(start, 6);
  const week = sessions.filter((s) => s.date >= start && s.date <= end);
  const sum = { start, count: week.length, doneCount: 0, skippedCount: 0, planned: 0, done: 0, load: 0, hard: 0, bySport: {} };
  for (const s of week) {
    sum.planned += s.duration;
    if (s.status !== 'skipped') { sum.load += sessionLoad(s, sports); if (isHard(s)) sum.hard++; }
    if (s.status === 'done') {
      sum.doneCount++; sum.done += s.duration;
      sum.bySport[s.sportId] = (sum.bySport[s.sportId] || 0) + s.duration;
    }
    if (s.status === 'skipped') sum.skippedCount++;
  }
  return sum;
}

/** Number of sessions completed in a row, counting back from today. */
export function sessionStreak(sessions, today) {
  const past = sessions.filter((s) => s.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  let streak = 0;
  for (const s of past) {
    if (s.status === 'done') streak++;
    else if (s.status === 'planned' && s.date === today) continue;
    else break;
  }
  return streak;
}
