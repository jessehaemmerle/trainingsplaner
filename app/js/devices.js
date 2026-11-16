// Watch & device integration, import side: reads activities from FIT, TCX and
// GPX files, Apple Health exports and the Garmin Personal API, and matches
// them to planned sessions. Pure functions, no DOM.

import { toISO } from './dates.js';

const FIT_EPOCH = 631065600; // seconds between 1970-01-01 and 1989-12-31 (UTC)
const pad = (n) => String(n).padStart(2, '0');
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const round = (v) => (v === null || v === undefined ? null : Math.round(v));

/** Maps any vendor's sport label to one of the app's sport ids, or null. */
export function sportFromText(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return null;
  const rules = [
    [/trail|ultra/, 'trail'],
    [/run|jog|treadmill/, 'run'],
    [/swim/, 'swim'],
    [/backcountry|skitour|skimo|skimountaineering/, 'skitour'],
    [/crosscountry|nordic|skateski|xcski/, 'xcski'],
    [/cycl|bik|ride|spinning/, 'bike'],
    [/core/, 'core'],
    [/strength|weight|gym/, 'strength'],
    [/yoga|pilates|flexib|stretch|mobility|mindandbody/, 'mobility'],
    [/stair|floorclimb/, null],
    [/boulder|climb/, 'climb'],
    [/hik|walk|mountaineer/, 'hike'],
  ];
  for (const [re, id] of rules) if (re.test(s)) return id;
  return null;
}

function fitSport(sport, sub) {
  if (sport === 1) return sub === 3 ? 'trail' : 'run';
  if (sport === 2 || sport === 21) return 'bike';
  if (sport === 5) return 'swim';
  if (sport === 11 || sport === 17 || sport === 16) return 'hike';
  if (sport === 12) return sub === 37 ? 'skitour' : 'xcski';
  if (sport === 13) return sub === 37 ? 'skitour' : null;
  if (sport === 31) return 'climb';
  if (sport === 4 || sport === 10) {
    if (sub === 20) return 'strength';
    if ([19, 43, 44].includes(sub)) return 'mobility';
  }
  return null;
}

function activity({ start, key, sport, rawSport, seconds, distance, avgHr, maxHr, calories, ascent, source, name, localDate, localTime }) {
  const d = start ? new Date(start) : null;
  return {
    key,
    date: localDate || toISO(d),
    time: localTime || (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''),
    sport: sport || null,
    rawSport: rawSport ? String(rawSport).slice(0, 40) : '',
    duration: Math.max(1, Math.round((seconds || 0) / 60)),
    distance: round(num(distance)) || null,
    avgHr: round(num(avgHr)),
    maxHr: round(num(maxHr)),
    calories: round(num(calories)),
    ascent: round(num(ascent)),
    source,
    name: name ? String(name).slice(0, 60) : '',
  };
}

// ---------------------------------------------------------------------------
// FIT (Garmin, Wahoo, Coros, Suunto, Polar, HealthFit …)
// ---------------------------------------------------------------------------

/** Parses a binary FIT activity file. Returns one activity per session message. */
export function parseFit(buffer) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(8, 12)) !== '.FIT') throw new Error('not-fit');
  const headerSize = bytes[0];
  const end = Math.min(bytes.length, headerSize + dv.getUint32(4, true));
  const defs = new Map();
  const sessions = [];
  let manufacturer = null;
  let pos = headerSize;

  while (pos < end) {
    const header = bytes[pos++];
    const compressed = (header & 0x80) !== 0;
    const local = compressed ? (header >> 5) & 0x3 : header & 0xf;
    if (!compressed && header & 0x40) {
      const little = bytes[pos + 1] === 0;
      const global = dv.getUint16(pos + 2, little);
      const count = bytes[pos + 4];
      pos += 5;
      const fields = [];
      for (let i = 0; i < count; i++, pos += 3) fields.push({ num: bytes[pos], size: bytes[pos + 1] });
      let devSize = 0;
      if (header & 0x20) {
        const devCount = bytes[pos++];
        for (let i = 0; i < devCount; i++, pos += 3) devSize += bytes[pos + 1];
      }
      defs.set(local, { global, little, fields, devSize });
      continue;
    }
    const def = defs.get(local);
    if (!def) throw new Error('fit-corrupt');
    const values = {};
    for (const f of def.fields) {
      if (def.global === 18 || def.global === 0) {
        let v = null;
        if (f.size === 1) v = bytes[pos] === 0xff ? null : bytes[pos];
        else if (f.size === 2) { v = dv.getUint16(pos, def.little); if (v === 0xffff) v = null; }
        else if (f.size === 4) { v = dv.getUint32(pos, def.little); if (v === 0xffffffff) v = null; }
        values[f.num] = v;
      }
      pos += f.size;
    }
    pos += def.devSize;
    if (def.global === 0 && values[1] != null) manufacturer = values[1];
    if (def.global === 18) sessions.push(values);
  }

  const source = manufacturer === 1 ? 'Garmin' : 'FIT';
  return sessions
    .filter((s) => s[2] != null || s[253] != null)
    .map((s) => {
      const startSec = (s[2] ?? s[253]) + FIT_EPOCH;
      const sport = fitSport(s[5], s[6]);
      return activity({
        start: startSec * 1000, key: `fit:${startSec}`, sport, rawSport: `${s[5] ?? ''}/${s[6] ?? ''}`,
        seconds: (s[8] ?? s[7] ?? 0) / 1000, distance: s[9] != null ? s[9] / 100 : null,
        avgHr: s[16], maxHr: s[17], calories: s[11], ascent: s[22], source,
      });
    });
}

// ---------------------------------------------------------------------------
// TCX and GPX (text based, parsed with regular expressions so it runs anywhere)
// ---------------------------------------------------------------------------

const tag = (xml, name) => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : null;
};
const unescapeXml = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function parseTcx(xml) {
  const out = [];
  for (const m of xml.matchAll(/<Activity\s+Sport="([^"]*)"[^>]*>([\s\S]*?)<\/Activity>/g)) {
    const body = m[2];
    const start = Date.parse(tag(body, 'Id') || '');
    if (Number.isNaN(start)) continue;
    let seconds = 0; let distance = 0; let calories = 0; let hrWeighted = 0; let hrSeconds = 0; let maxHr = null;
    for (const lap of body.matchAll(/<Lap[\s>][\s\S]*?<\/Lap>/g)) {
      const head = lap[0].split(/<Track[\s>]/)[0];
      const t = num(tag(head, 'TotalTimeSeconds')) || 0;
      seconds += t;
      distance += num(tag(head, 'DistanceMeters')) || 0;
      calories += num(tag(head, 'Calories')) || 0;
      const avg = num(tag(tag(head, 'AverageHeartRateBpm') || '', 'Value'));
      if (avg) { hrWeighted += avg * t; hrSeconds += t; }
      const max = num(tag(tag(head, 'MaximumHeartRateBpm') || '', 'Value'));
      if (max) maxHr = Math.max(maxHr || 0, max);
    }
    if (!seconds) continue;
    out.push(activity({
      start, key: `tcx:${Math.round(start / 1000)}`, sport: sportFromText(m[1]), rawSport: m[1], seconds,
      distance: distance || null, avgHr: hrSeconds ? hrWeighted / hrSeconds : null, maxHr, calories: calories || null, source: 'TCX',
    }));
  }
  return out;
}

const haversine = (a, b) => {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};

export function parseGpx(xml) {
  const out = [];
  for (const trk of xml.matchAll(/<trk[\s>][\s\S]*?<\/trk>/g)) {
    const body = trk[0];
    const head = body.split(/<trkseg[\s>]/)[0];
    let first = null; let last = null; let prev = null; let distance = 0; let hrSum = 0; let hrN = 0; let maxHr = null;
    for (const p of body.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)) {
      const lat = num(/lat="([^"]+)"/.exec(p[1])?.[1]);
      const lon = num(/lon="([^"]+)"/.exec(p[1])?.[1]);
      const time = Date.parse(tag(p[2], 'time') || '');
      if (!Number.isNaN(time)) { first ??= time; last = time; }
      if (lat !== null && lon !== null) { if (prev) distance += haversine(prev, [lat, lon]); prev = [lat, lon]; }
      const hr = num(tag(p[2], 'hr'));
      if (hr) { hrSum += hr; hrN++; maxHr = Math.max(maxHr || 0, hr); }
    }
    if (first === null || last === null || last <= first) continue;
    const type = unescapeXml(tag(head, 'type'));
    const name = unescapeXml(tag(head, 'name'));
    out.push(activity({
      start: first, key: `gpx:${Math.round(first / 1000)}`, sport: sportFromText(type) || sportFromText(name), rawSport: type, seconds: (last - first) / 1000,
      distance: distance || null, avgHr: hrN ? hrSum / hrN : null, maxHr, source: 'GPX', name,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Apple Health export (export.zip or the XML inside it)
// ---------------------------------------------------------------------------

const attr = (s, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(s)?.[1] ?? null;

function appleWorkout(xml) {
  const open = xml.slice(0, xml.indexOf('>') + 1);
  const startDate = attr(open, 'startDate');
  const duration = num(attr(open, 'duration'));
  if (!startDate || !duration) return null;
  const unit = attr(open, 'durationUnit') || 'min';
  const seconds = duration * (unit === 's' ? 1 : unit === 'h' ? 3600 : 60);
  const type = (attr(open, 'workoutActivityType') || '').replace('HKWorkoutActivityType', '');
  const toMeters = (value, u) => (value === null ? null : value * (u === 'mi' ? 1609.344 : u === 'm' ? 1 : 1000));
  let distance = toMeters(num(attr(open, 'totalDistance')), attr(open, 'totalDistanceUnit'));
  let avgHr = null; let maxHr = null; let calories = num(attr(open, 'totalEnergyBurned'));
  for (const st of xml.matchAll(/<WorkoutStatistics\b[^>]*>/g)) {
    const kind = attr(st[0], 'type') || '';
    if (/Distance/.test(kind) && distance === null) distance = toMeters(num(attr(st[0], 'sum')), attr(st[0], 'unit'));
    if (/HeartRate$/.test(kind)) { avgHr = num(attr(st[0], 'average')); maxHr = num(attr(st[0], 'maximum')); }
    if (/ActiveEnergyBurned/.test(kind) && calories === null) calories = num(attr(st[0], 'sum'));
  }
  const epoch = Date.parse(startDate.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'));
  return activity({
    key: `apple:${Number.isNaN(epoch) ? startDate : Math.round(epoch / 1000)}`, localDate: startDate.slice(0, 10), localTime: startDate.slice(11, 16),
    sport: sportFromText(type), rawSport: type, seconds, distance, avgHr, maxHr, calories, source: 'Apple Health',
  });
}

/**
 * Scans the (possibly huge) Apple Health XML as a stream of text chunks and
 * returns the workouts on or after `since` (ISO date).
 */
export async function scanAppleHealth(chunks, since = '0000-00-00') {
  const out = [];
  let buffer = '';
  const drain = (final) => {
    const re = /<Workout\s[^>]*?(?:\/>|>[\s\S]*?<\/Workout>)/g;
    let consumed = 0;
    for (let m = re.exec(buffer); m; m = re.exec(buffer)) {
      consumed = m.index + m[0].length;
      const a = appleWorkout(m[0]);
      if (a && a.date >= since) out.push(a);
    }
    const open = buffer.indexOf('<Workout ', consumed);
    // Keep an unfinished workout element, otherwise only a short tail.
    buffer = final ? '' : open >= 0 ? buffer.slice(open) : buffer.slice(Math.max(consumed, buffer.length - 16));
  };
  for await (const chunk of chunks) {
    buffer += chunk;
    if (buffer.length > 262144) drain(false);
  }
  drain(true);
  return out;
}

/** Finds the main XML inside an Apple Health export.zip and returns it as a text stream. */
export async function appleHealthStream(blob) {
  const tailSize = Math.min(blob.size, 66000);
  const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not-zip');
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new Error('zip-too-large');
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const decoder = new TextDecoder();
  let best = null;
  for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50;) {
    const nameLen = cd.getUint16(p + 28, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    const entry = { name, method: cd.getUint16(p + 10, true), size: cd.getUint32(p + 20, true), offset: cd.getUint32(p + 42, true) };
    // The main file is localised ("export.xml", "Exportieren.xml" …): take the largest top-level XML that is not the CDA document.
    if (/\.xml$/i.test(name) && !/cda/i.test(name) && name.split('/').length <= 2 && (!best || entry.size > best.size)) best = entry;
    p += 46 + nameLen + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
  }
  if (!best) throw new Error('no-health-xml');
  if (best.size === 0xffffffff || best.offset === 0xffffffff) throw new Error('zip-too-large');
  const local = new DataView(await blob.slice(best.offset, best.offset + 30).arrayBuffer());
  const start = best.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  let stream = blob.slice(start, start + best.size).stream();
  if (best.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  else if (best.method !== 0) throw new Error('zip-method');
  return stream.pipeThrough(new TextDecoderStream());
}

// ---------------------------------------------------------------------------
// Garmin Personal API (activity list JSON)
// ---------------------------------------------------------------------------

export function parseGarminActivities(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.activities) ? json.activities : [];
  const out = [];
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const local = String(a.startTimeLocal || '').replace('T', ' ');
    const seconds = num(a.duration) ?? num(a.movingDuration) ?? num(a.elapsedDuration);
    if (!/^\d{4}-\d{2}-\d{2}/.test(local) || !seconds) continue;
    const typeKey = a.activityType?.typeKey || a.activityType?.parentTypeKey || a.activityType || '';
    out.push(activity({
      key: a.activityId != null ? `garmin:${a.activityId}` : `garmin:${local}`, localDate: local.slice(0, 10), localTime: local.slice(11, 16),
      sport: sportFromText(typeKey), rawSport: typeKey, seconds, distance: a.distance, avgHr: a.averageHR, maxHr: a.maxHR,
      calories: a.calories, ascent: a.elevationGain, source: 'Garmin', name: a.activityName,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// File dispatch and matching
// ---------------------------------------------------------------------------

/** Reads one user-selected file of any supported kind. */
export async function readActivityFile(file, { since } = {}) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.fit')) return parseFit(await file.arrayBuffer());
  if (name.endsWith('.zip')) return scanAppleHealth(await appleHealthStream(file), since);
  if (name.endsWith('.tcx')) return parseTcx(await file.text());
  if (name.endsWith('.gpx')) return parseGpx(await file.text());
  if (name.endsWith('.xml')) return scanAppleHealth(file.stream().pipeThrough(new TextDecoderStream()), since);
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (String.fromCharCode(...head.subarray(8, 12)) === '.FIT') return parseFit(await file.arrayBuffer());
  throw new Error('unknown-format');
}

const RELATED = [['run', 'trail'], ['hike', 'trail'], ['strength', 'core'], ['mobility', 'core']];
const related = (a, b) => a === b || RELATED.some((pair) => pair.includes(a) && pair.includes(b));

/**
 * Applies imported activities to the sessions: a planned session of the same
 * day and sport is marked done with the recorded values, anything else becomes
 * a new completed session. Activities already imported are skipped.
 */
export function applyActivities(sessions, activities, { fallbackSport = null, makeId } = {}) {
  const result = { matched: 0, created: 0, duplicates: 0, unknown: 0 };
  const sorted = [...activities].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  for (const a of sorted) {
    const sport = a.sport || fallbackSport;
    if (!sport) { result.unknown++; continue; }
    const sameDay = sessions.filter((s) => s.date === a.date);
    const twin = sameDay.some((s) => s.extId === a.key
      || (s.extId && related(s.sportId, sport) && Math.abs(s.duration - a.duration) <= 2));
    if (twin) { result.duplicates++; continue; }
    const actual = { source: a.source };
    for (const k of ['distance', 'avgHr', 'maxHr', 'calories', 'ascent']) if (a[k]) actual[k] = a[k];
    const candidates = sameDay
      .filter((s) => s.status === 'planned' && !s.extId && related(s.sportId, sport))
      .sort((x, y) => (y.sportId === sport) - (x.sportId === sport) || Math.abs(x.duration - a.duration) - Math.abs(y.duration - a.duration));
    if (candidates.length) {
      Object.assign(candidates[0], { status: 'done', duration: a.duration, actual, extId: a.key });
      result.matched++;
    } else {
      sessions.push({
        id: makeId(), date: a.date, sportId: sport, type: 'free', intensity: 2, duration: a.duration,
        status: 'done', locked: true, actual, extId: a.key, note: a.name || undefined,
      });
      result.created++;
    }
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || b.intensity - a.intensity);
  return result;
}

// ---------------------------------------------------------------------------
// Garmin sync
// ---------------------------------------------------------------------------

export const GARMIN_API = 'https://personal.connectapi.garmin.com';

/**
 * Fetches recent activities from the Garmin Personal API. Garmin does not
 * allow calls from web pages, so `base` is normally the user's own relay.
 * Throws Error('garmin-network' | 'garmin-auth' | 'garmin-http').
 */
export async function fetchGarminActivities({ key, base = GARMIN_API, startDate, endDate, fetchFn = fetch }) {
  const root = String(base || GARMIN_API).replace(/\/+$/, '');
  const call = async (path, init) => {
    let res;
    try { res = await fetchFn(root + path, init); } catch { throw new Error('garmin-network'); }
    if (res.status === 401 || res.status === 403) throw new Error('garmin-auth');
    if (!res.ok) throw new Error('garmin-http');
    return res;
  };
  const tokenRes = await call('/personalapitoken-service/personal-api/personal-api-key/token', { method: 'POST', headers: { Accept: '*/*', Authorization: `ApiKey ${key}` } });
  const token = (await tokenRes.text()).trim();
  if (!token) throw new Error('garmin-auth');
  const query = new URLSearchParams({ start: '0', limit: '100', startDate, endDate });
  const listRes = await call(`/activitylist-service/activities/search/activities?${query}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  let json;
  try { json = await listRes.json(); } catch { throw new Error('garmin-http'); }
  return parseGarminActivities(json);
}
