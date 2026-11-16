import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePlan, planWeeks, findConflicts, computeAdaptation, suggestMakeup, weekSummary, sessionStreak, isHard, isKey,
} from '../app/js/engine.js';
import { addDays, diffDays, weekStart, weekday, isoWeek } from '../app/js/dates.js';
import { sportMap } from '../app/js/sports.js';

const TODAY = '2026-11-16'; // a Monday
const sports = sportMap();
const profile = (over = {}) => ({ level: 'intermediate', days: [0, 1, 3, 5, 6], minutes: 60, longDay: 6, sports: ['run', 'bike', 'strength'], ...over });
const marathon = { id: 'g1', kind: 'event', name: 'Marathon', date: '2027-03-14', sports: ['run'], priority: 'A' };
const byWeek = (sessions, start) => sessions.filter((s) => s.date >= start && s.date <= addDays(start, 6));

test('date helpers', () => {
  assert.equal(weekday('2026-11-16'), 0);
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
  assert.equal(diffDays('2026-10-24', '2026-10-26'), 2); // across DST change
  assert.equal(isoWeek('2026-11-16'), 47);
  assert.equal(isoWeek('2027-01-01'), 53);
});

test('phases lead into the A event', () => {
  const weeks = planWeeks([marathon], TODAY);
  const raceWeek = weeks.find((w) => w.start === weekStart(marathon.date));
  assert.equal(raceWeek.phase, 'race');
  assert.equal(weeks[raceWeek.index - 1].phase, 'taper');
  assert.equal(weeks[raceWeek.index - 2].phase, 'peak');
  assert.equal(weeks[raceWeek.index - 6].phase, 'build');
  assert.equal(weeks[0].phase, 'base');
  assert.equal(weeks[raceWeek.index + 1].phase, 'recover');
  assert.ok(weeks.some((w) => w.deload));
});

test('without goals a rolling base plan is created', () => {
  const { sessions, weeks } = generatePlan({ profile: profile(), goals: [] }, TODAY);
  assert.equal(weeks.length, 8);
  assert.ok(weeks.every((w) => w.phase === 'base'));
  assert.equal(byWeek(sessions, TODAY).length, 5);
});

test('sessions only land on available days and every sport appears', () => {
  const p = profile();
  const { sessions } = generatePlan({ profile: p, goals: [marathon] }, TODAY);
  for (const s of sessions) if (s.type !== 'race') assert.ok(p.days.includes(weekday(s.date)), `${s.date} ${s.type}`);
  const first = byWeek(sessions, TODAY);
  assert.deepEqual([...new Set(first.map((s) => s.sportId))].sort(), ['bike', 'run', 'strength']);
  assert.equal(new Set(first.map((s) => s.date)).size, first.length, 'one session per day');
});

test('the goal sport gets the largest share', () => {
  const { sessions } = generatePlan({ profile: profile(), goals: [marathon] }, TODAY);
  const count = (id) => sessions.filter((s) => s.sportId === id).length;
  assert.ok(count('run') > count('bike'));
  assert.ok(count('run') > count('strength'));
});

test('hard sessions are capped per week and never back to back', () => {
  for (const level of ['beginner', 'intermediate', 'advanced']) {
    const p = profile({ level, days: [0, 1, 2, 3, 4, 5, 6], sports: ['run', 'bike', 'swim', 'strength', 'climb'] });
    const tri = { id: 'g2', kind: 'event', name: 'Tri', date: '2027-02-21', sports: ['swim', 'bike', 'run'], priority: 'A' };
    const { sessions, weeks } = generatePlan({ profile: p, goals: [tri] }, TODAY);
    const max = { beginner: 1, intermediate: 2, advanced: 3 }[level];
    for (const w of weeks) {
      const hard = byWeek(sessions, w.start).filter((s) => isHard(s) && s.type !== 'race');
      assert.ok(hard.length <= max, `${level} week ${w.index}: ${hard.length} hard`);
    }
    const hardDays = new Set(sessions.filter(isHard).map((s) => s.date));
    for (const d of hardDays) assert.ok(!hardDays.has(addDays(d, 1)), `${level}: hard on ${d} and next day`);
  }
});

test('race week: race session exists, nothing hard the day before, rest after', () => {
  const { sessions } = generatePlan({ profile: profile({ days: [0, 1, 2, 3, 4, 5, 6] }), goals: [marathon] }, TODAY);
  const race = sessions.find((s) => s.type === 'race');
  assert.equal(race.date, marathon.date);
  assert.equal(race.goalId, 'g1');
  const dayBefore = sessions.filter((s) => s.date === addDays(marathon.date, -1));
  assert.ok(dayBefore.every((s) => !isKey(s)));
  const week = byWeek(sessions, weekStart(marathon.date));
  assert.ok(week.every((s) => s.date <= marathon.date));
  const weekLoad = (start) => byWeek(sessions, start).filter((s) => s.type !== 'race').reduce((n, s) => n + s.duration, 0);
  assert.ok(weekLoad(weekStart(marathon.date)) < weekLoad(addDays(weekStart(marathon.date), -21)) * 0.6, 'taper cuts volume');
});

test('long session prefers the chosen long day', () => {
  const { sessions } = generatePlan({ profile: profile({ longDay: 5 }), goals: [marathon] }, TODAY);
  const longs = sessions.filter((s) => s.type === 'long' && s.sportId === 'run');
  assert.ok(longs.length > 5);
  assert.ok(longs.filter((s) => weekday(s.date) === 5).length / longs.length > 0.8);
});

test('regenerating keeps logged and locked sessions', () => {
  const state = { profile: profile(), goals: [marathon] };
  const first = generatePlan(state, TODAY).sessions;
  first[0].status = 'done';
  const manual = { id: 'manual', date: addDays(TODAY, 9), sportId: 'swim', type: 'free', intensity: 2, duration: 30, status: 'planned', locked: true };
  const second = generatePlan({ ...state, sessions: [...first, manual] }, addDays(TODAY, 2)).sessions;
  assert.ok(second.some((s) => s.id === first[0].id && s.status === 'done'));
  assert.ok(second.some((s) => s.id === 'manual'));
  assert.equal(second.filter((s) => s.date === manual.date).length, 1, 'locked session blocks its day');
  assert.equal(second.filter((s) => s.type === 'race').length, 1);
});

test('performance goals get a test session and a B event gets its race', () => {
  const goals = [
    marathon,
    { id: 'g3', kind: 'event', name: '10k', date: '2027-01-17', sports: ['run'], priority: 'B' },
    { id: 'g4', kind: 'performance', name: 'Squat 100', date: '2026-12-19', sports: ['strength'] },
  ];
  const { sessions } = generatePlan({ profile: profile(), goals }, TODAY);
  assert.equal(sessions.filter((s) => s.type === 'race').length, 2);
  const t = sessions.find((s) => s.type === 'test');
  assert.equal(t.date, '2026-12-19');
  assert.equal(t.sportId, 'strength');
});

test('conflict check flags risky manual edits', () => {
  const mk = (id, date, sportId, type, intensity, duration = 60) => ({ id, date, sportId, type, intensity, duration, status: 'planned' });
  const list = [
    mk('a', '2026-11-17', 'run', 'intervals', 5),
    mk('b', '2026-11-18', 'bike', 'tempo', 4),
    mk('c', '2026-11-19', 'strength', 'strength', 3),
    mk('d', '2026-11-20', 'run', 'long', 3),
    mk('e', '2026-11-21', 'bike', 'intervals', 5),
  ];
  const goals = [{ id: 'g', kind: 'event', name: 'Race', date: '2026-11-22', sports: ['run'], priority: 'A' }];
  const codes = findConflicts(list, goals, profile(), sports, '2026-11-16').map((c) => c.code);
  for (const code of ['hardBackToBack', 'strengthBeforeKey', 'tooManyHard', 'hardBeforeEvent']) assert.ok(codes.includes(code), code);
  const clean = generatePlan({ profile: profile(), goals: [marathon] }, TODAY);
  for (const w of clean.weeks) {
    const found = findConflicts(clean.sessions, [marathon], profile(), sports, w.start);
    assert.deepEqual(found, [], `generated week ${w.index} is conflict free`);
  }
});

test('feedback eases or pushes the plan', () => {
  const mk = (i, status, extra = {}) => ({ id: `h${i}`, date: addDays(TODAY, -i - 1), sportId: 'run', type: 'easy', intensity: 2, duration: 60, status, ...extra });
  const missed = [0, 2, 4, 6, 8].map((i) => mk(i, 'skipped'));
  assert.equal(computeAdaptation(missed, TODAY).factor, 0.8);
  const tough = [0, 2, 4, 6].map((i) => mk(i, 'done', { feeling: 1, rpe: 9 }));
  const a = computeAdaptation(tough, TODAY);
  assert.equal(a.factor, 0.9);
  assert.equal(a.hardCut, 1);
  const great = [0, 2, 4, 6].map((i) => mk(i, 'done', { feeling: 5, rpe: 3 }));
  assert.equal(computeAdaptation(great, TODAY).factor, 1.05);
  const eased = generatePlan({ profile: profile(), goals: [], sessions: missed }, TODAY).sessions.filter((s) => s.date >= TODAY);
  const normal = generatePlan({ profile: profile(), goals: [] }, TODAY).sessions;
  const total = (l) => l.reduce((n, s) => n + s.duration, 0);
  assert.ok(total(eased) < total(normal));
});

test('makeup day, summary and streak', () => {
  const mk = (id, date, type, intensity, status = 'planned') => ({ id, date, sportId: 'run', type, intensity, duration: 60, status });
  const list = [mk('a', '2026-11-16', 'tempo', 4), mk('b', '2026-11-19', 'long', 3)];
  assert.equal(suggestMakeup(list[0], list, { days: [0, 1, 2, 3, 4, 5, 6] }, TODAY), '2026-11-17');
  assert.equal(suggestMakeup(list[0], list, { days: [0, 3, 5] }, TODAY), '2026-11-21');
  const hist = [mk('x', '2026-11-13', 'easy', 2, 'skipped'), mk('y', '2026-11-14', 'easy', 2, 'done'), mk('z', '2026-11-15', 'easy', 2, 'done'), mk('t', TODAY, 'easy', 2)];
  assert.equal(sessionStreak(hist, TODAY), 2);
  const sum = weekSummary(hist, sports, '2026-11-09');
  assert.equal(sum.done, 120);
  assert.equal(sum.skippedCount, 1);
});

test('rebuilding from next week leaves the current week untouched', () => {
  const state = { profile: profile(), goals: [marathon] };
  const first = generatePlan(state, TODAY).sessions;
  const wednesday = addDays(TODAY, 2);
  const second = generatePlan({ ...state, sessions: first }, wednesday, addDays(TODAY, 7)).sessions;
  const ids = (list) => byWeek(list, TODAY).map((s) => s.id).sort();
  assert.deepEqual(ids(second), ids(first));
  assert.equal(second.length, first.length);
});
