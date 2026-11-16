// Garmin relay for the Trainingsplaner PWA (Cloudflare Worker, free plan).
//
// Garmin's Personal API does not answer requests that come straight from a
// web page (no CORS). This worker forwards exactly two read-only calls from
// your app to Garmin and adds the missing CORS headers. It stores nothing
// and logs nothing; your API key only passes through.
//
// Setup: see README, section "Garmin-Synchronisierung".
// 1. Put the address of your app into ALLOWED_ORIGINS.
// 2. Deploy, then enter the worker URL in the app under "Uhren & Geräte".

const ALLOWED_ORIGINS = [
  'https://jessehaemmerle.github.io',
  'http://localhost:8080',
];

const UPSTREAM = 'https://personal.connectapi.garmin.com';
const ROUTES = [
  { method: 'POST', path: '/personalapitoken-service/personal-api/personal-api-key/token' },
  { method: 'GET', path: '/activitylist-service/activities/search/activities' },
];

export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS).split(',').map((s) => s.trim()) : ALLOWED_ORIGINS).includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Accept',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (status, body = null, headers = {}) => new Response(body, { status, headers: { ...cors, ...headers } });

    if (!allowed) return reply(403, 'Origin not allowed');
    if (request.method === 'OPTIONS') return reply(204);

    const url = new URL(request.url);
    const route = ROUTES.find((r) => r.method === request.method && r.path === url.pathname);
    const auth = request.headers.get('Authorization');
    if (!route) return reply(404, 'Not found');
    if (!auth) return reply(401, 'Missing Authorization header');

    let upstream;
    try {
      upstream = await fetch((env.UPSTREAM || UPSTREAM) + url.pathname + url.search, {
        method: route.method,
        headers: { Authorization: auth, Accept: request.headers.get('Accept') || '*/*' },
      });
    } catch {
      return reply(502, 'Garmin not reachable');
    }
    return reply(upstream.status, upstream.body, {
      'Content-Type': upstream.headers.get('Content-Type') || 'text/plain',
      'Cache-Control': 'no-store',
    });
  },
};
