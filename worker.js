/**
 * roost · stays-protocol aggregator worker
 *
 * Endpoints:
 *   GET  /                 discovery
 *   GET  /registry         all known hosts
 *   GET  /host/:id         host detail + stays
 *   POST /host/:id/refresh trigger fresh fetch of host's stays.json
 *   POST /apply            host application (queued for review)
 *   GET  /protocol         JSON schema for stays-protocol v1
 *
 * Cron: every hour pulls /stays.json from every registered host, updates KV.
 *
 * KV: ROOST_KV
 *   host:<id>           host registry entry
 *   stays:<host>:<id>   individual stay (from host's manifest)
 *   ical:<host>:<id>    parsed availability
 *   apply:<timestamp>   application queue
 */

const VERSION = '1.0.0';
const SEAL = '◊·κ=1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (d, s = 200) => new Response(JSON.stringify(d, null, 2), {
  status: s, headers: { 'Content-Type': 'application/json', ...CORS },
});

async function kvList(env, prefix) {
  const list = await env.ROOST_KV.list({ prefix });
  return Promise.all(list.keys.map(async k => {
    const raw = await env.ROOST_KV.get(k.name);
    return raw ? JSON.parse(raw) : null;
  })).then(x => x.filter(Boolean));
}

/* ─── Fetch + parse a host's stays.json ─── */
async function fetchHostManifest(domain) {
  const candidates = [
    `${domain.replace(/\/$/, '')}/stays.json`,
    `${domain.replace(/\/$/, '')}/.well-known/stays`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (res.ok) return { url, manifest: await res.json() };
    } catch {}
  }
  return null;
}

function validateManifest(m) {
  if (!m || typeof m !== 'object') return 'not an object';
  if (m.protocol !== 'stays-protocol/1.0') return `unknown protocol: ${m.protocol}`;
  if (!m.host?.id || !m.host?.name || !m.host?.domain) return 'host.{id,name,domain} required';
  if (!Array.isArray(m.stays) || m.stays.length === 0) return 'stays must be non-empty array';
  for (const s of m.stays) {
    if (!s.id || !s.name || !s.book_url || typeof s.sleeps !== 'number' || typeof s.price_from !== 'number') {
      return `stay missing required field: ${JSON.stringify(s)}`;
    }
  }
  return null;
}

async function refreshHost(env, hostId) {
  const raw = await env.ROOST_KV.get(`host:${hostId}`);
  if (!raw) return { error: 'unknown host' };
  const host = JSON.parse(raw);
  const result = await fetchHostManifest(host.domain);
  if (!result) return { error: 'manifest unreachable' };
  const err = validateManifest(result.manifest);
  if (err) return { error: `invalid manifest: ${err}` };

  // Store each stay individually
  for (const s of result.manifest.stays) {
    await env.ROOST_KV.put(`stays:${hostId}:${s.id}`, JSON.stringify({ ...s, host: hostId, fetched: Date.now() }));
  }
  // Update host meta
  host.lastRefresh = Date.now();
  host.staysCount = result.manifest.stays.length;
  host.priceFrom = Math.min(...result.manifest.stays.map(s => s.price_from));
  host.manifestUrl = result.url;
  await env.ROOST_KV.put(`host:${hostId}`, JSON.stringify(host));
  return { ok: true, host: hostId, stays: result.manifest.stays.length };
}

async function refreshAll(env) {
  const hosts = await kvList(env, 'host:');
  const results = [];
  for (const h of hosts) {
    results.push(await refreshHost(env, h.id));
  }
  return results;
}

/* ─── Cron entry ─── */
async function scheduled(_event, env) {
  return refreshAll(env);
}

/* ─── Router ─── */
async function handle(req, env) {
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (path === '/' || path === '/health') {
    const hosts = await kvList(env, 'host:');
    const stays = await kvList(env, 'stays:');
    return json({
      service: 'roost',
      version: VERSION,
      seal: SEAL,
      status: 'ok',
      counts: { hosts: hosts.length, stays: stays.length },
      endpoints: ['GET /', 'GET /registry', 'GET /host/:id', 'POST /host/:id/refresh', 'POST /apply', 'GET /protocol'],
    });
  }

  if (path === '/registry' && method === 'GET') {
    const hosts = await kvList(env, 'host:');
    const stays = await kvList(env, 'stays:');
    return json({
      version: 1,
      updated: new Date().toISOString(),
      members: hosts,
      stays,
      stats: {
        members: hosts.length,
        stays: stays.length,
        avg_review: hosts.reduce((a, h) => a + (h.review_score || 0), 0) / Math.max(1, hosts.length),
      },
    });
  }

  if (path.startsWith('/host/') && path.endsWith('/refresh') && method === 'POST') {
    const id = path.split('/')[2];
    return json(await refreshHost(env, id));
  }

  if (path.startsWith('/host/') && method === 'GET') {
    const id = path.split('/')[2];
    const raw = await env.ROOST_KV.get(`host:${id}`);
    if (!raw) return json({ error: 'not found' }, 404);
    const host = JSON.parse(raw);
    const stays = await kvList(env, `stays:${id}:`);
    return json({ host, stays });
  }

  if (path === '/apply' && method === 'POST') {
    const body = await req.json();
    const id = `apply:${Date.now()}`;
    await env.ROOST_KV.put(id, JSON.stringify({ ...body, received: new Date().toISOString(), status: 'pending' }));
    return json({ ok: true, queued: id });
  }

  if (path === '/protocol' && method === 'GET') {
    // Mirror of the JSON Schema for convenience
    return json({
      protocol: 'stays-protocol/1.0',
      schemaUrl: 'https://roost.land/protocol/stays-protocol-v1.json',
      see: 'https://sjgant80-hub.github.io/roost/protocol.html',
    });
  }

  return json({ error: 'not found' }, 404);
}

export default { fetch: handle, scheduled };
