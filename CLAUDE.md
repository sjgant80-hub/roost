# CLAUDE.md · working rules for this repository

Context and constraints for any AI coding agent editing roost.

## What this repo is

roost is two things that must stay separable:

1. **stays-protocol v1** — an open JSON manifest hosts publish at `/stays.json`
   on their own domain. Formal schema: `protocol/stays-protocol-v1.json`.
2. **the aggregator** — `worker.js`, a Cloudflare Worker that discovers hosts,
   pulls and validates their manifests hourly, indexes stays into `ROOST_KV`,
   and answers a small read-mostly JSON API. It sends guests to each stay's own
   `book_url`. It never takes payment or holds funds.

The static site (`index.html`, `host.html`, `protocol.html`, `governance.html`,
`howitworks.html`) is the human-facing surface. `data/registry.json` is the seed
registry. See `SPEC.md` for the design note and `README.md` for the overview.

## Ground rules

- **The protocol is a contract.** Do not change the required manifest fields
  (`protocol`, `host.{id,name,domain}`, each stay's
  `{id,name,book_url,sleeps,price_from}`) or the `stays-protocol/1.0` constant
  without bumping the protocol version in both the schema and `worker.js`.
- **Keep the KV keyspace flat and prefixed** (`host:`, `stays:<host>:`,
  `apply:`). Read paths rely on `list({prefix})`; do not introduce a key layout
  that needs a secondary index.
- **No middleman creep.** roost indexes and redirects. Do not add checkout,
  payment capture, or anything that makes roost hold a booking or money.
- **Validation stays strict and message-first.** `validateManifest` returns a
  reason string on the first violation; keep those messages stable and testable.

## Tests

- `npm test` runs `node test.mjs` — a zero-dependency suite that imports
  `worker.js` and drives `worker.fetch` against an in-memory KV stub.
- Every assertion is derived from observed output. When you change routing or
  the refresh logic, run the suite and update the assertions to the new observed
  values; never weaken an assertion just to make it pass.
- CI (`.github/workflows/ci.yml`) runs the suite on every push and pull request.

## Style

- Vanilla ES modules, zero runtime dependencies. Keep it that way — the Worker
  ships as a single file.
- Prefer small pure helpers (`validateManifest`, `fetchHostManifest`) that are
  callable and assertable in isolation.
