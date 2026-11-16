// Local persistence in IndexedDB (one document), with a localStorage fallback
// for browsers that block IndexedDB (e.g. some private modes).

const DB = 'trainingsplaner';
const STORE = 'kv';
const KEY = 'state';
export const SCHEMA = 1;

export const emptyState = () => ({
  schema: SCHEMA,
  lang: null,
  onboarded: false,
  profile: { level: 'intermediate', days: [1, 3, 5, 6], minutes: 60, longDay: 6, sports: [] },
  customSports: [],
  goals: [],
  sessions: [],
  planStart: null,
});

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadState() {
  let data = null;
  try {
    data = await idb('readonly', (s) => s.get(KEY));
  } catch {
    try { data = JSON.parse(localStorage.getItem(DB) || 'null'); } catch { /* start fresh */ }
  }
  return normalise(data);
}

let timer = null;
let pending = null;
export function saveState(state) {
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flush, 150);
}

export async function flush() {
  if (!pending) return;
  const snapshot = JSON.parse(JSON.stringify(pending));
  pending = null;
  try {
    await idb('readwrite', (s) => s.put(snapshot, KEY));
  } catch {
    try { localStorage.setItem(DB, JSON.stringify(snapshot)); } catch { /* storage unavailable */ }
  }
}

export async function clearState() {
  pending = null;
  try { await idb('readwrite', (s) => s.delete(KEY)); } catch { /* ignore */ }
  try { localStorage.removeItem(DB); } catch { /* ignore */ }
}

/** Validates loaded or imported data and fills in anything missing. */
export function normalise(data) {
  const base = emptyState();
  if (!data || typeof data !== 'object' || Array.isArray(data)) return base;
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
  const p = data.profile && typeof data.profile === 'object' ? data.profile : {};
  return {
    schema: SCHEMA,
    lang: ['de', 'en'].includes(data.lang) ? data.lang : null,
    onboarded: Boolean(data.onboarded),
    profile: {
      level: ['beginner', 'intermediate', 'advanced'].includes(p.level) ? p.level : base.profile.level,
      days: [...new Set(arr(p.days).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))],
      minutes: num(p.minutes, 15, 180, 60),
      longDay: num(p.longDay, 0, 6, 6),
      sports: arr(p.sports).map((s) => str(s, 40)).filter(Boolean),
    },
    customSports: arr(data.customSports)
      .filter((c) => c && str(c.id) && str(c.name))
      .map((c) => ({
        id: str(c.id, 40), name: str(c.name, 30),
        kind: ['endurance', 'strength', 'mobility', 'skill'].includes(c.kind) ? c.kind : 'endurance',
        color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#3DDC97',
      })),
    goals: arr(data.goals)
      .filter((g) => g && str(g.id) && isDate(g.date))
      .map((g) => ({
        id: str(g.id, 40), kind: g.kind === 'performance' ? 'performance' : 'event', name: str(g.name, 60) || '?', date: g.date,
        sports: arr(g.sports).map((s) => str(s, 40)).filter(Boolean), priority: ['A', 'B', 'C'].includes(g.priority) ? g.priority : 'B',
      })),
    sessions: arr(data.sessions)
      .filter((s) => s && str(s.id) && isDate(s.date) && str(s.sportId) && str(s.type))
      .map((s) => ({
        id: str(s.id, 40), date: s.date, sportId: str(s.sportId, 40), type: str(s.type, 30),
        duration: num(s.duration, 5, 900, 45), intensity: num(s.intensity, 1, 5, 2),
        status: ['planned', 'done', 'skipped'].includes(s.status) ? s.status : 'planned',
        locked: Boolean(s.locked), phase: str(s.phase, 12) || undefined, goalId: str(s.goalId, 40) || undefined,
        note: str(s.note, 400) || undefined,
        rpe: s.rpe ? num(s.rpe, 1, 10, 5) : undefined, feeling: s.feeling ? num(s.feeling, 1, 5, 3) : undefined,
      })),
    planStart: isDate(data.planStart) ? data.planStart : null,
  };
}
