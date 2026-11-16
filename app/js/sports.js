// Sport catalogue. `kind` drives which session types the planner uses:
//   endurance – long / tempo / interval structure
//   strength  – gym sessions, never the day before a key session
//   mobility  – light, may share a day with another session
//   skill     – technique-driven (e.g. climbing)

export const BUILTIN_SPORTS = [
  { id: 'run', kind: 'endurance', color: '#FF5A4E', art: 'run', impact: 1.1, dur: 1, long: 1.6, group: 'endurance' },
  { id: 'bike', kind: 'endurance', color: '#FFC93C', art: 'bike', impact: 0.9, dur: 1.3, long: 2, group: 'endurance' },
  { id: 'swim', kind: 'endurance', color: '#2EC4F1', art: 'swim', impact: 0.85, dur: 0.75, long: 1.3, group: 'endurance' },
  { id: 'strength', kind: 'strength', color: '#8B5CF6', art: 'strength', impact: 1, dur: 0.8, long: 1, group: 'power' },
  { id: 'core', kind: 'mobility', color: '#FF8A3D', art: 'core', impact: 0.8, dur: 0.4, long: 1, group: 'power', intensity: 2 },
  { id: 'mobility', kind: 'mobility', color: '#FF7AC3', art: 'mobility', impact: 0.6, dur: 0.5, long: 1, group: 'power', intensity: 1 },
  { id: 'trail', kind: 'endurance', color: '#3DDC97', art: 'trail', impact: 1.2, dur: 1.1, long: 1.8, group: 'outdoor' },
  { id: 'hike', kind: 'endurance', color: '#9BD63B', art: 'hike', impact: 0.8, dur: 1.5, long: 2.4, group: 'outdoor', gentle: true },
  { id: 'skitour', kind: 'endurance', color: '#7FD8FF', art: 'skitour', impact: 1, dur: 1.5, long: 2.2, group: 'outdoor' },
  { id: 'xcski', kind: 'endurance', color: '#B8A6FF', art: 'xcski', impact: 0.95, dur: 1.1, long: 1.8, group: 'outdoor' },
  { id: 'climb', kind: 'skill', color: '#FFA15C', art: 'climb', impact: 0.9, dur: 1.2, long: 1, group: 'outdoor' },
];

export const CUSTOM_COLORS = ['#FF5A4E', '#FFC93C', '#2EC4F1', '#3DDC97', '#8B5CF6', '#FF7AC3', '#FF8A3D', '#9BD63B'];

const KIND_DEFAULTS = {
  endurance: { impact: 1, dur: 1, long: 1.6 },
  strength: { impact: 1, dur: 0.8, long: 1 },
  mobility: { impact: 0.6, dur: 0.5, long: 1, intensity: 1 },
  skill: { impact: 0.9, dur: 1, long: 1 },
};

/** Builds the full sport lookup including the user's own sports. */
export function sportMap(customSports = []) {
  const map = new Map(BUILTIN_SPORTS.map((s) => [s.id, s]));
  for (const c of customSports) {
    map.set(c.id, { ...KIND_DEFAULTS[c.kind] || KIND_DEFAULTS.endurance, art: 'custom', group: 'custom', custom: true, ...c });
  }
  return map;
}

/** Event presets offered when adding a competition. */
export const EVENT_PRESETS = [
  { id: '5k', sports: ['run'] },
  { id: '10k', sports: ['run'] },
  { id: 'half', sports: ['run'] },
  { id: 'marathon', sports: ['run'] },
  { id: 'trailrace', sports: ['trail'] },
  { id: 'granfondo', sports: ['bike'] },
  { id: 'triathlon', sports: ['swim', 'bike', 'run'] },
  { id: 'openwater', sports: ['swim'] },
  { id: 'skimo', sports: ['skitour'] },
  { id: 'xcrace', sports: ['xcski'] },
  { id: 'summit', sports: ['hike'] },
];
