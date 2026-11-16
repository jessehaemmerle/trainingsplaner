// Watch & device integration, export side: calendar files for any watch and
// structured FIT workouts for Garmin devices. Pure functions, no DOM.

const FIT_EPOCH = 631065600;
const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Structured workout steps
// ---------------------------------------------------------------------------

const ENDURANCE_ZONES = ['run', 'trail', 'bike', 'hike', 'xcski', 'skitour'];

/**
 * Breaks a session into steps: [{ kind, seconds, zone }] where an entry may
 * also be { repeat: n, steps: [...] }. kind: warmup | work | recover | cooldown | steady.
 */
export function workoutSteps(session) {
  const total = Math.max(5, session.duration) * 60;
  const zones = ENDURANCE_ZONES.includes(session.sportId);
  const z = (n) => (zones ? n : null);
  const step = (kind, seconds, zone = null) => ({ kind, seconds: Math.round(seconds), zone });
  const framed = (warm, reps, work, rest, zone) => {
    const block = reps * (work + rest);
    const cool = Math.max(300, total - warm - block);
    return [step('warmup', warm, z(2)), { repeat: reps, steps: [step('work', work, z(zone)), step('recover', rest, z(1))] }, step('cooldown', cool, z(1))];
  };
  const warm = total >= 2700 ? 900 : 600;
  switch (session.type) {
    case 'tempo': {
      const work = Math.max(300, Math.round((total - warm - 600 - 360) / 2 / 60) * 60);
      return framed(warm, 2, work, 180, 4);
    }
    case 'intervals': {
      const reps = Math.min(8, Math.max(3, Math.floor((total - warm - 600) / 300)));
      return framed(warm, reps, 180, 120, 5);
    }
    case 'sharpen':
      return framed(600, 4, 120, 180, 4);
    case 'fartlek': {
      const reps = Math.min(8, Math.max(4, Math.floor((total - 900) / 180)));
      return framed(600, reps, 60, 120, 4);
    }
    case 'recovery':
      return [step('steady', total, z(1))];
    case 'easy': case 'long': case 'activation':
      return [step('steady', total, z(2))];
    default:
      return [step('steady', total)];
  }
}

// ---------------------------------------------------------------------------
// FIT encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
function fitCrc(bytes, crc = 0) {
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

const BASE = { enum: [0x00, 1], u8: [0x02, 1], u16: [0x84, 2], u32: [0x86, 4], u32z: [0x8c, 4] };

/**
 * Encodes messages as a FIT file. Each message is
 * { global, fields: [[fieldNumber, type, value], …] } with type one of
 * enum | u8 | u16 | u32 | u32z | string.
 */
export function encodeFit(messages) {
  const out = [];
  const push16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const push32 = (v) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  for (const msg of messages) {
    const fields = msg.fields.map(([number, type, value]) => {
      if (type === 'string') {
        const text = [...encoder.encode(String(value)).subarray(0, 60), 0];
        return { number, base: 0x07, size: text.length, write: () => out.push(...text) };
      }
      const [base, size] = BASE[type];
      return { number, base, size, write: () => (size === 1 ? out.push(value & 0xff) : size === 2 ? push16(value) : push32(value)) };
    });
    out.push(0x40, 0, 0); // definition message, local type 0, little endian
    push16(msg.global);
    out.push(fields.length);
    for (const f of fields) out.push(f.number, f.size, f.base);
    out.push(0x00); // data message
    for (const f of fields) f.write();
  }
  const header = [14, 0x10, 0, 0, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54]; // ".FIT"
  header[2] = 2132 & 0xff; header[3] = 2132 >> 8;
  header[4] = out.length & 0xff; header[5] = (out.length >>> 8) & 0xff; header[6] = (out.length >>> 16) & 0xff; header[7] = (out.length >>> 24) & 0xff;
  const headerCrc = fitCrc(header);
  header.push(headerCrc & 0xff, headerCrc >> 8);
  const body = [...header, ...out];
  const crc = fitCrc(body);
  body.push(crc & 0xff, crc >> 8);
  return new Uint8Array(body);
}

// FIT sport / sub-sport per app sport.
const FIT_SPORT = {
  run: [1, 0], trail: [1, 3], bike: [2, 0], swim: [5, 0], strength: [10, 20], core: [10, 20], mobility: [10, 43],
  hike: [17, 0], xcski: [12, 0], skitour: [13, 37], climb: [31, 0],
};
const INTENSITY = { work: 0, steady: 0, recover: 4, warmup: 2, cooldown: 3 };

/** Builds a Garmin-compatible FIT workout file for one planned session. */
export function encodeWorkout(session, name, stepNames = {}, created = new Date()) {
  const [sport, sub] = FIT_SPORT[session.sportId] || [0, 0];
  const flat = [];
  for (const s of workoutSteps(session)) {
    if (s.repeat) {
      const from = flat.length;
      flat.push(...s.steps);
      flat.push({ repeatFrom: from, times: s.repeat });
    } else flat.push(s);
  }
  const messages = [
    { global: 0, fields: [[0, 'enum', 5], [1, 'u16', 255], [2, 'u16', 0], [3, 'u32z', 1], [4, 'u32', Math.floor(created.getTime() / 1000) - FIT_EPOCH]] },
    { global: 26, fields: [[4, 'enum', sport], [11, 'enum', sub], [6, 'u16', flat.length], [8, 'string', name]] },
  ];
  flat.forEach((s, i) => {
    if (s.repeatFrom !== undefined) {
      messages.push({ global: 27, fields: [[254, 'u16', i], [1, 'enum', 6], [2, 'u32', s.repeatFrom], [3, 'enum', 2], [4, 'u32', s.times], [7, 'enum', 0]] });
      return;
    }
    const fields = [[254, 'u16', i]];
    if (stepNames[s.kind]) fields.push([0, 'string', stepNames[s.kind]]);
    fields.push([1, 'enum', 0], [2, 'u32', s.seconds * 1000]);
    if (s.zone) fields.push([3, 'enum', 1], [4, 'u32', s.zone]);
    else fields.push([3, 'enum', 2], [4, 'u32', 0]);
    fields.push([7, 'enum', INTENSITY[s.kind] ?? 0]);
    messages.push({ global: 27, fields });
  });
  return encodeFit(messages);
}

// ---------------------------------------------------------------------------
// ZIP (stored, no compression) to bundle several workout files
// ---------------------------------------------------------------------------

let crcTable = null;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: Uint8Array }] → Uint8Array of a ZIP archive. */
export function zipStore(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = encoder.encode(f.name);
    const meta = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc32(f.data)), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034b50), ...meta, ...name]);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...meta, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    parts.push(local, f.data);
    offset += local.length + f.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const out = new Uint8Array(offset + cdSize + end.length);
  let p = 0;
  for (const part of [...parts, ...central, end]) { out.set(part, p); p += part.length; }
  return out;
}

// ---------------------------------------------------------------------------
// Calendar (.ics)
// ---------------------------------------------------------------------------

const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
function fold(line) {
  const bytes = encoder.encode(line);
  if (bytes.length <= 73) return line;
  // Fold on character boundaries so multi-byte characters stay intact.
  const out = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > 73) { out.push(current); current = ' '; size = 1; }
    current += ch; size += n;
  }
  out.push(current);
  return out.join('\r\n');
}

/** events: [{ id, date: 'YYYY-MM-DD', title, description }] → iCalendar text with all-day events. */
export function buildIcs(events, calendarName, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const day = (iso) => iso.replace(/-/g, '');
  const next = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Trainingsplaner//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(calendarName)}`];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@trainingsplaner`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(next(e.date))}`,
      `SUMMARY:${icsText(e.title)}`, `DESCRIPTION:${icsText(e.description || '')}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export const slug = (s) => String(s).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'workout';
