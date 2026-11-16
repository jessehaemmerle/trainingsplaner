import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import {
  parseFit, parseTcx, parseGpx, scanAppleHealth, appleHealthStream, parseGarminActivities, sportFromText, applyActivities, fetchGarminActivities, readActivityFile,
} from '../app/js/devices.js';
import { buildIcs, encodeFit, encodeWorkout, workoutSteps, zipStore } from '../app/js/exporters.js';
import relay from '../integrations/garmin-relay-worker.js';

const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

test('sport labels from different vendors', () => {
  const cases = {
    running: 'run', trail_running: 'trail', Biking: 'bike', indoor_cycling: 'bike', lap_swimming: 'swim', TraditionalStrengthTraining: 'strength',
    CoreTraining: 'core', Yoga: 'mobility', Hiking: 'hike', CrossCountrySkiing: 'xcski', backcountry_skiing: 'skitour', bouldering: 'climb',
    StairClimbing: null, Other: null, '': null,
  };
  for (const [label, id] of Object.entries(cases)) assert.equal(sportFromText(label), id, label);
});

test('FIT activity written by the official Garmin SDK', () => {
  const [a] = parseFit(buf(readFileSync(new URL('./fixtures/garmin-activity.fit', import.meta.url))));
  assert.deepEqual(
    { sport: a.sport, duration: a.duration, distance: a.distance, avgHr: a.avgHr, maxHr: a.maxHr, calories: a.calories, ascent: a.ascent, source: a.source },
    { sport: 'trail', duration: 50, distance: 8424, avgHr: 148, maxHr: 171, calories: 612, ascent: 230, source: 'Garmin' },
  );
  assert.throws(() => parseFit(new Uint8Array(20).buffer), /not-fit/);
});

test('FIT with big-endian fields, developer fields and a multisport file', () => {
  const start = Math.floor(Date.parse('2026-11-14T08:00:00Z') / 1000) - 631065600;
  const file = encodeFit([
    { global: 0, fields: [[0, 'enum', 4], [1, 'u16', 32]] },
    { global: 18, fields: [[2, 'u32', start], [5, 'enum', 5], [8, 'u32', 1800000], [9, 'u32', 150000]] },
    { global: 18, fields: [[2, 'u32', start + 2000], [5, 'enum', 2], [8, 'u32', 3600000], [16, 'u8', 0xff]] },
  ]);
  const list = parseFit(buf(file));
  assert.deepEqual(list.map((a) => [a.sport, a.duration, a.distance, a.avgHr, a.source]), [['swim', 30, 1500, null, 'FIT'], ['bike', 60, null, null, 'FIT']]);
});

test('TCX sums laps and ignores trackpoint distances', () => {
  const xml = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-11-15T07:30:00.000Z</Id>
    <Lap StartTime="x"><TotalTimeSeconds>1200.0</TotalTimeSeconds><DistanceMeters>4000</DistanceMeters><Calories>300</Calories>
      <AverageHeartRateBpm><Value>140</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>160</Value></MaximumHeartRateBpm>
      <Track><Trackpoint><DistanceMeters>99999</DistanceMeters></Trackpoint></Track></Lap>
    <Lap StartTime="y"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>2000</DistanceMeters><Calories>150</Calories>
      <AverageHeartRateBpm><Value>170</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>182</Value></MaximumHeartRateBpm></Lap>
  </Activity></Activities></TrainingCenterDatabase>`;
  const [a] = parseTcx(xml);
  assert.deepEqual([a.sport, a.duration, a.distance, a.avgHr, a.maxHr, a.calories], ['run', 30, 6000, 150, 182, 450]);
});

test('GPX derives duration, distance and heart rate', () => {
  const xml = `<gpx><trk><name>Morning Ride</name><type>cycling</type><trkseg>
    <trkpt lat="47.0" lon="11.0"><time>2026-11-15T08:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>120</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="47.01" lon="11.0"><time>2026-11-15T08:30:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
  </trkseg></trk></gpx>`;
  const [a] = parseGpx(xml);
  assert.deepEqual([a.sport, a.duration, a.avgHr, a.maxHr, a.name], ['bike', 30, 130, 140, 'Morning Ride']);
  assert.ok(Math.abs(a.distance - 1112) < 5);
  assert.equal(parseGpx('<gpx><trk><trkseg><trkpt lat="1" lon="1"><time>2026-11-15T08:00:00Z</time></trkpt><trkpt lat="1" lon="1.001"><time>2026-11-15T08:10:00Z</time></trkpt></trkseg></trk></gpx>')[0].sport, null);
});

const HEALTH = `<?xml version="1.0"?><HealthData locale="de_AT">
 <Record type="HKQuantityTypeIdentifierStepCount" value="12"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="42.5" durationUnit="min" sourceName="Apple Watch" startDate="2026-11-10 06:45:00 +0100" endDate="2026-11-10 07:27:30 +0100">
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="x" endDate="y" sum="8.2" unit="km"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="151" minimum="98" maximum="176" unit="count/min"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeYoga" duration="30" durationUnit="min" totalDistance="0" startDate="2026-11-12 19:00:00 +0100" endDate="x"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="60" durationUnit="min" totalDistance="20" totalDistanceUnit="mi" startDate="2020-01-01 10:00:00 +0100" endDate="x"/>
</HealthData>`;

test('Apple Health XML is scanned as a stream, in arbitrary chunks', async () => {
  async function* chunks(size) { for (let i = 0; i < HEALTH.length; i += size) yield HEALTH.slice(i, i + size); }
  for (const size of [7, 64, 100000]) {
    const list = await scanAppleHealth(chunks(size), '2026-01-01');
    assert.deepEqual(list.map((a) => [a.date, a.time, a.sport, a.duration, a.distance, a.avgHr]), [
      ['2026-11-10', '06:45', 'run', 43, 8200, 151],
      ['2026-11-12', '19:00', 'mobility', 30, null, null],
    ], `chunk size ${size}`);
  }
  assert.equal((await scanAppleHealth(chunks(50))).length, 3);
});

test('Apple Health export.zip: finds the localised XML and inflates it', async () => {
  const enc = new TextEncoder();
  const entries = [
    { name: 'apple_health_export/export_cda.xml', data: enc.encode('<ClinicalDocument/>'.repeat(400)), deflate: true },
    { name: 'apple_health_export/Exportieren.xml', data: enc.encode(HEALTH), deflate: true },
    { name: 'apple_health_export/workout-routes/route.gpx', data: enc.encode('<gpx/>'), deflate: false },
  ];
  const u16 = (v) => [v & 255, v >> 8]; const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const parts = []; const central = []; let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const name = enc.encode(e.name);
    const meta = [...u16(20), ...u16(0), ...u16(e.deflate ? 8 : 0), ...u16(0), ...u16(0), ...u32(0), ...u32(body.length), ...u32(e.data.length), ...u16(name.length), ...u16(0)];
    const local = Uint8Array.from([...u32(0x04034b50), ...meta, ...name]);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...meta, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    parts.push(local, body); offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const zip = new File([...parts, ...central, Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(3), ...u16(3), ...u32(cdSize), ...u32(offset), ...u16(0)])], 'Export.zip');
  const list = await readActivityFile(zip, { since: '2026-01-01' });
  assert.deepEqual(list.map((a) => a.sport), ['run', 'mobility']);
  await assert.rejects(appleHealthStream(new Blob(['not a zip at all, just some text'])), /not-zip/);
});

test('Garmin activity list JSON', () => {
  const list = parseGarminActivities([
    { activityId: 123, activityName: 'Morning Run', startTimeLocal: '2026-11-15 07:30:00', activityType: { typeKey: 'running' }, duration: 3012.4, distance: 8400.2, averageHR: 148, maxHR: 171, calories: 610, elevationGain: 55 },
    { activityId: 124, startTimeLocal: '2026-11-15T18:00:00.0', activityType: { typeKey: 'strength_training' }, duration: 1800 },
    { activityId: 125, startTimeLocal: 'bad', duration: 10 },
    null,
  ]);
  assert.deepEqual(list.map((a) => [a.key, a.date, a.time, a.sport, a.duration]), [['garmin:123', '2026-11-15', '07:30', 'run', 50], ['garmin:124', '2026-11-15', '18:00', 'strength', 30]]);
  assert.deepEqual(parseGarminActivities({ error: 'x' }), []);
});

test('activities are matched to the plan, added, and never imported twice', () => {
  let n = 0;
  const makeId = () => `new${n++}`;
  const sessions = [
    { id: 'a', date: '2026-11-15', sportId: 'run', type: 'tempo', intensity: 4, duration: 60, status: 'planned' },
    { id: 'b', date: '2026-11-15', sportId: 'strength', type: 'strength', intensity: 3, duration: 40, status: 'planned' },
    { id: 'c', date: '2026-11-16', sportId: 'bike', type: 'easy', intensity: 2, duration: 60, status: 'planned' },
  ];
  const acts = [
    { key: 'garmin:1', date: '2026-11-15', time: '07:30', sport: 'trail', duration: 52, distance: 8400, avgHr: 148, source: 'Garmin', name: 'Run' },
    { key: 'garmin:2', date: '2026-11-15', time: '18:00', sport: 'swim', duration: 30, source: 'Garmin', name: 'Pool' },
    { key: 'gpx:9', date: '2026-11-16', time: '09:00', sport: null, duration: 70, source: 'GPX' },
  ];
  const r1 = applyActivities(sessions, acts, { makeId });
  assert.deepEqual(r1, { matched: 1, created: 1, duplicates: 0, unknown: 1 });
  const a = sessions.find((s) => s.id === 'a');
  assert.deepEqual([a.status, a.duration, a.type, a.actual.distance, a.actual.source, a.extId], ['done', 52, 'tempo', 8400, 'Garmin', 'garmin:1']);
  assert.equal(sessions.find((s) => s.id === 'b').status, 'planned');
  const swim = sessions.find((s) => s.sportId === 'swim');
  assert.deepEqual([swim.status, swim.locked, swim.note], ['done', true, 'Pool']);
  const r2 = applyActivities(sessions, acts, { makeId, fallbackSport: 'bike' });
  assert.deepEqual(r2, { matched: 1, created: 0, duplicates: 2, unknown: 0 });
  assert.equal(sessions.find((s) => s.id === 'c').status, 'done');
  // The same run arriving again from a FIT file is recognised by day, sport and duration.
  const r3 = applyActivities(sessions, [{ key: 'fit:777', date: '2026-11-15', time: '07:30', sport: 'run', duration: 51, source: 'FIT' }], { makeId });
  assert.equal(r3.duplicates, 1);
  assert.equal(sessions.length, 4);
});

test('workout steps and FIT workout files', () => {
  const total = (steps) => steps.reduce((n, s) => n + (s.repeat ? s.repeat * s.steps.reduce((m, x) => m + x.seconds, 0) : s.seconds), 0);
  for (const type of ['tempo', 'intervals', 'sharpen', 'fartlek', 'easy', 'long', 'recovery', 'strength']) {
    for (const duration of [30, 45, 60, 90]) {
      const steps = workoutSteps({ sportId: 'run', type, duration });
      assert.ok(Math.abs(total(steps) - duration * 60) <= 600, `${type} ${duration}: ${total(steps) / 60} min`);
      assert.ok(steps.every((s) => s.repeat || s.seconds >= 60));
    }
  }
  assert.equal(workoutSteps({ sportId: 'swim', type: 'intervals', duration: 60 })[1].steps[0].zone, null);
  const file = encodeWorkout({ sportId: 'run', type: 'intervals', duration: 60 }, 'Intervalle', {}, new Date('2026-11-16T10:00:00Z'));
  assert.equal(String.fromCharCode(...file.subarray(8, 12)), '.FIT');
  assert.equal(new DataView(file.buffer).getUint32(4, true), file.length - 16);
  assert.deepEqual(parseFit(buf(file)), [], 'a workout file contains no activity');
});

test('zip and calendar export', () => {
  const zip = zipStore([{ name: 'a.fit', data: Uint8Array.of(1, 2, 3) }, { name: 'b.fit', data: Uint8Array.of(4) }]);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(zip.length - 12, true), 2);
  assert.equal(dv.getUint32(14, true), 0x55bc801d, 'crc32 of 01 02 03');
  const ics = buildIcs([{ id: 's1', date: '2026-12-31', title: 'Laufen: Tempo, 60 min', description: 'a;b\nc' }], 'Plan', new Date('2026-11-16T10:00:00Z'));
  assert.match(ics, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.match(ics, /SUMMARY:Laufen: Tempo\\, 60 min/);
  assert.match(ics, /DESCRIPTION:a\\;b\\nc/);
  assert.ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
});

test('Garmin sync through the relay worker', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push([init.method, url, init.headers.Authorization]);
    if (url.endsWith('/token')) return init.headers.Authorization === 'ApiKey good' ? new Response('jwt-token\n') : new Response('', { status: 401 });
    return Response.json([{ activityId: 1, startTimeLocal: '2026-11-15 07:30:00', activityType: { typeKey: 'cycling' }, duration: 3600 }]);
  };
  try {
    const viaRelay = (origin) => (url, init = {}) => relay.fetch(new Request(url, { ...init, headers: { ...init.headers, Origin: origin } }));
    const args = { base: 'https://relay.example/', startDate: '2026-11-01', endDate: '2026-11-16' };
    const list = await fetchGarminActivities({ ...args, key: 'good', fetchFn: viaRelay('https://jessehaemmerle.github.io') });
    assert.deepEqual(list.map((a) => [a.sport, a.duration]), [['bike', 60]]);
    assert.deepEqual(seen[1], ['GET', 'https://personal.connectapi.garmin.com/activitylist-service/activities/search/activities?start=0&limit=100&startDate=2026-11-01&endDate=2026-11-16', 'Bearer jwt-token']);
    await assert.rejects(fetchGarminActivities({ ...args, key: 'bad', fetchFn: viaRelay('https://jessehaemmerle.github.io') }), /garmin-auth/);
    await assert.rejects(fetchGarminActivities({ ...args, key: 'good', fetchFn: viaRelay('https://evil.example') }), /garmin-auth/);
    await assert.rejects(fetchGarminActivities({ ...args, key: 'good', fetchFn: async () => { throw new TypeError('Failed to fetch'); } }), /garmin-network/);

    const pre = await relay.fetch(new Request('https://relay.example/x', { method: 'OPTIONS', headers: { Origin: 'https://jessehaemmerle.github.io' } }));
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://jessehaemmerle.github.io');
    const other = await relay.fetch(new Request('https://relay.example/userprofile-service/userprofile/settings', { headers: { Origin: 'https://jessehaemmerle.github.io', Authorization: 'Bearer x' } }));
    assert.equal(other.status, 404, 'only the two needed routes are forwarded');
  } finally {
    globalThis.fetch = realFetch;
  }
});
