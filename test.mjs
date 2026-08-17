/**
 * roost worker · behavioural test suite
 *
 * Exercises the real request router exported by worker.js against an in-memory
 * KV stub that implements the three methods the worker uses (get/put/list).
 * Every assertion below was derived by running the worker and observing its
 * actual Response — not from reading the source. Zero dependencies; run with
 * `node test.mjs` (also wired as `npm test`).
 */

import assert from 'node:assert/strict';
import worker from './worker.js';

/* ── in-memory Cloudflare-KV stub ─────────────────────────────────────────
   Mirrors the subset the worker calls: get(key), put(key,val), list({prefix}).
   list() returns keys sorted, matching KV's lexical ordering. */
function makeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, val) { store.set(key, val); },
    async list({ prefix } = {}) {
      const names = [...store.keys()].filter(k => !prefix || k.startsWith(prefix)).sort();
      return { keys: names.map(name => ({ name })) };
    },
    store,
  };
}
const envWith = seed => ({ ROOST_KV: makeKV(seed) });

/* drive the worker's fetch handler and hand back {res, body, kv} */
async function hit(path, { method, payload, env } = {}) {
  const kv = env || envWith();
  const init = { method: method || 'GET' };
  if (payload !== undefined) { init.body = JSON.stringify(payload); init.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request('http://roost.local' + path, init), kv);
  const raw = await res.text();
  let body; try { body = JSON.parse(raw); } catch { body = raw; }
  return { res, body, kv };
}

/* swap the global fetch the worker uses to reach a host manifest, then restore */
async function withManifestFetch(responder, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async url => responder(String(url));
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const manifestOk = body => new Response(JSON.stringify(body), { status: 200 });

/* a fixture with two hosts and three stays (two under wishwood, one under fenstead) */
const seeded = () => envWith({
  'host:wishwood': JSON.stringify({ id: 'wishwood', name: 'Wishwood', domain: 'https://x.example', review_score: 4.8 }),
  'host:fenstead': JSON.stringify({ id: 'fenstead', name: 'Fenstead', domain: 'https://y.example', review_score: 4.9 }),
  'stays:wishwood:a': JSON.stringify({ id: 'a', name: 'Cabin A', price_from: 85 }),
  'stays:wishwood:b': JSON.stringify({ id: 'b', name: 'Cabin B', price_from: 120 }),
  'stays:fenstead:c': JSON.stringify({ id: 'c', name: 'Hut C', price_from: 110 }),
});

/* ── minimal runner ───────────────────────────────────────────────────── */
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (err) { failed++; console.error(`FAIL ${name}\n     ${err && err.message}`); }
}

/* ── discovery ────────────────────────────────────────────────────────── */
await test('GET / returns service discovery with zero counts on an empty registry', async () => {
  const { res, body } = await hit('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(body.service, 'roost');
  assert.equal(body.version, '1.0.0');
  assert.equal(body.status, 'ok');
  assert.deepEqual(body.counts, { hosts: 0, stays: 0 });
  assert.equal(body.endpoints.length, 6);
});

await test('GET / counts host: and stays: keys separately by prefix', async () => {
  const { body } = await hit('/', { env: seeded() });
  assert.equal(body.counts.hosts, 2);
  assert.equal(body.counts.stays, 3);
});

/* ── registry aggregation ─────────────────────────────────────────────── */
await test('GET /registry lists members + stays and computes the mean review score', async () => {
  const { res, body } = await hit('/registry', { env: seeded() });
  assert.equal(res.status, 200);
  assert.equal(body.version, 1);
  assert.equal(body.members.length, 2);
  assert.equal(body.stays.length, 3);
  assert.equal(body.stats.members, 2);
  assert.equal(body.stats.stays, 3);
  assert.equal(body.stats.avg_review, 4.85);   // (4.8 + 4.9) / 2, observed
});

await test('GET /registry avg_review is 0 when no host carries a score (guard against divide-by-zero)', async () => {
  const { body } = await hit('/registry', { env: envWith({ 'host:h': JSON.stringify({ id: 'h', name: 'H' }) }) });
  assert.equal(body.stats.members, 1);
  assert.equal(body.stats.avg_review, 0);
});

/* ── host detail ──────────────────────────────────────────────────────── */
await test('GET /host/:id returns the host plus only that host\'s stays', async () => {
  const { res, body } = await hit('/host/wishwood', { env: seeded() });
  assert.equal(res.status, 200);
  assert.equal(body.host.id, 'wishwood');
  assert.equal(body.stays.length, 2);            // fenstead's stay is prefix-excluded
  assert.deepEqual(body.stays.map(s => s.id).sort(), ['a', 'b']);
});

await test('GET /host/:id for an unknown id is a 404 error', async () => {
  const { res, body } = await hit('/host/missing', { env: seeded() });
  assert.equal(res.status, 404);
  assert.equal(body.error, 'not found');
});

/* ── protocol mirror + CORS + fallthrough ─────────────────────────────── */
await test('GET /protocol mirrors the stays-protocol identifier', async () => {
  const { res, body } = await hit('/protocol');
  assert.equal(res.status, 200);
  assert.equal(body.protocol, 'stays-protocol/1.0');
  assert.ok(body.schemaUrl.endsWith('stays-protocol-v1.json'));
});

await test('OPTIONS preflight is a 204 with permissive CORS and no body', async () => {
  const { res, body } = await hit('/', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET,POST,OPTIONS');
  assert.equal(body, '');
});

await test('an unrouted path falls through to a 404', async () => {
  const { res, body } = await hit('/nope');
  assert.equal(res.status, 404);
  assert.equal(body.error, 'not found');
});

/* ── application queue ────────────────────────────────────────────────── */
await test('POST /apply queues the application under an apply: key with pending status', async () => {
  const { body, kv } = await hit('/apply', { method: 'POST', payload: { name: 'New Host', email: 'a@b.c' } });
  assert.equal(body.ok, true);
  assert.ok(body.queued.startsWith('apply:'));
  const stored = JSON.parse(kv.ROOST_KV.store.get(body.queued));
  assert.equal(stored.status, 'pending');
  assert.equal(stored.name, 'New Host');
  assert.ok(typeof stored.received === 'string');
});

/* ── refresh: fetch + validate + index a host manifest ────────────────── */
await test('POST /host/:id/refresh validates the manifest, stores each stay, and records the minimum price', async () => {
  const env = envWith({ 'host:wishwood': JSON.stringify({ id: 'wishwood', name: 'Wishwood', domain: 'https://x.example' }) });
  const manifest = {
    protocol: 'stays-protocol/1.0',
    host: { id: 'wishwood', name: 'Wishwood', domain: 'https://x.example' },
    stays: [
      { id: 's1', name: 'Cabin', book_url: 'https://x.example/book/s1', sleeps: 2, price_from: 140 },
      { id: 's2', name: 'Yurt', book_url: 'https://x.example/book/s2', sleeps: 4, price_from: 90 },
    ],
  };
  const result = await withManifestFetch(
    url => url.endsWith('/stays.json') ? manifestOk(manifest) : new Response('x', { status: 404 }),
    () => hit('/host/wishwood/refresh', { method: 'POST', env }),
  );
  assert.equal(result.body.ok, true);
  assert.equal(result.body.stays, 2);
  assert.ok(env.ROOST_KV.store.has('stays:wishwood:s1'));
  assert.ok(env.ROOST_KV.store.has('stays:wishwood:s2'));
  const meta = JSON.parse(env.ROOST_KV.store.get('host:wishwood'));
  assert.equal(meta.priceFrom, 90);              // Math.min(140, 90), observed
  assert.equal(meta.staysCount, 2);
  assert.equal(meta.manifestUrl, 'https://x.example/stays.json');
});

await test('POST /host/:id/refresh reports an unknown host without touching the network', async () => {
  const { body } = await hit('/host/ghost/refresh', { method: 'POST' });
  assert.equal(body.error, 'unknown host');
});

await test('POST /host/:id/refresh rejects a manifest whose protocol tag is wrong', async () => {
  const env = envWith({ 'host:wishwood': JSON.stringify({ id: 'wishwood', name: 'W', domain: 'https://x.example' }) });
  const bad = { protocol: 'wrong/9', host: {}, stays: [] };
  const { body } = await withManifestFetch(
    () => manifestOk(bad),
    () => hit('/host/wishwood/refresh', { method: 'POST', env }),
  );
  assert.equal(body.error, 'invalid manifest: unknown protocol: wrong/9');
});

await test('POST /host/:id/refresh reports an unreachable manifest when every candidate URL fails', async () => {
  const env = envWith({ 'host:wishwood': JSON.stringify({ id: 'wishwood', name: 'W', domain: 'https://x.example' }) });
  const { body } = await withManifestFetch(
    () => new Response('down', { status: 500 }),
    () => hit('/host/wishwood/refresh', { method: 'POST', env }),
  );
  assert.equal(body.error, 'manifest unreachable');
});

/* ── summary ──────────────────────────────────────────────────────────── */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
