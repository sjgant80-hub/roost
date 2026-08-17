# SPEC · roost aggregator + stays-protocol v1

Design note for the aggregation layer. The formal manifest schema lives in
[`protocol/stays-protocol-v1.json`](protocol/stays-protocol-v1.json); the
runtime that consumes it is [`worker.js`](worker.js); the behavioural contract
is pinned by [`test.mjs`](test.mjs).

## 1. Problem

Hosts publish bookable stays from their own domain and want to be discoverable
without surrendering a booking cut, guest data, or control of the checkout. A
central marketplace that holds inventory recreates the platform it replaces. So
the source of truth stays with the host: a static `stays.json` on the host's own
domain. roost is only an **index over those manifests** plus a redirect to each
stay's `book_url`. No checkout, no payment, no held funds pass through roost.

## 2. Manifest (stays-protocol/1.0)

A host publishes `/stays.json` (aggregators also probe `/.well-known/stays`).
The object MUST carry:

- `protocol` — the constant string `stays-protocol/1.0`.
- `host` — object with at least `{ id, name, domain }`.
- `stays` — a non-empty array; each stay MUST have
  `{ id, name, book_url, sleeps:number, price_from:number }`.

`validateManifest()` enforces exactly these invariants and returns `null` on
success or a human-readable reason string on the first violation. The reason is
surfaced verbatim to the caller (for example
`invalid manifest: unknown protocol: wrong/9`) so a host fixing their manifest
gets an actionable message.

## 3. Storage model (Cloudflare KV)

One namespace, `ROOST_KV`, with a flat prefixed keyspace so a single `list()`
by prefix answers each read path:

| Key                       | Value                                             |
|---------------------------|---------------------------------------------------|
| `host:<id>`               | registry entry + last-refresh metadata            |
| `stays:<host>:<stayId>`   | one indexed stay, stamped with `host` and `fetched` |
| `apply:<timestamp>`       | a pending host application                         |

Because stays are keyed `stays:<host>:<stayId>`, the host-detail path lists by
the narrower prefix `stays:<host>:` and the global count lists by `stays:`,
without a secondary index.

## 4. Refresh cycle

`refreshHost()` is the core mutation:

1. Load `host:<id>`; a miss yields `{ error: 'unknown host' }` before any network call.
2. `fetchHostManifest(domain)` tries `<domain>/stays.json` then
   `<domain>/.well-known/stays`; if neither returns `ok`, `{ error: 'manifest unreachable' }`.
3. Validate; on failure, `{ error: 'invalid manifest: …' }`.
4. On success, write each stay under its `stays:<host>:<id>` key and update the
   host record with `lastRefresh`, `staysCount`, `manifestUrl`, and
   `priceFrom = Math.min(...price_from)` — the headline "from" price shown in the index.

`refreshAll()` fans this over every `host:` entry and is the body of the hourly
`scheduled` cron entry, so the index is eventually consistent with each host's
own published truth.

## 5. HTTP surface

All responses are JSON with permissive CORS (`*`), because the index is public,
read-mostly data any third-party aggregator may mirror.

| Method | Path                   | Result                                            |
|--------|------------------------|---------------------------------------------------|
| GET    | `/` or `/health`       | discovery: version, live counts, endpoint list    |
| GET    | `/registry`            | all members + stays + stats (incl. mean review)   |
| GET    | `/host/:id`            | one host and its stays (404 if unknown)           |
| POST   | `/host/:id/refresh`    | re-pull + re-index that host now                   |
| POST   | `/apply`               | queue a host application as `pending`              |
| GET    | `/protocol`            | pointer to the schema                              |
| OPTIONS| any                    | 204 preflight                                      |

Any other path is a 404 `{ error: 'not found' }`.

## 6. Failure posture

- A missing score never divides by zero: `avg_review` divides by
  `Math.max(1, hosts.length)`, so an empty or scoreless registry reports `0`.
- Manifest fetch and parse are wrapped; one unreachable or malformed host cannot
  abort a whole `refreshAll` sweep — each host's result is captured independently.
- The registry survives the aggregator: the protocol is CC0 and any party can
  build an alternate index over the same `stays.json` manifests.

## 7. What the tests pin

[`test.mjs`](test.mjs) drives `worker.fetch` against an in-memory KV stub and a
swappable manifest fetcher, asserting the observed behaviour of every path
above: prefix-scoped counts, the `4.85` mean over two scores, the divide-by-zero
guard, prefix-isolated host stays, the `apply:` queue entry, and each refresh
outcome (indexed with `priceFrom = 90`, unknown host, bad protocol, unreachable).
