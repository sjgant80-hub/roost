# ◊ roost

> A cooperative marketplace owned by the hosts. Stays as a commons. Zero booking fees · ever · in any direction.

**Live:** [sjgant80-hub.github.io/roost](https://sjgant80-hub.github.io/roost/)

## What this is

A sovereign alternative to Airbnb / Booking.com built on three layers:

1. **stays-protocol v1** — open JSON spec for publishing bookable stays from your own domain ([read the spec](https://sjgant80-hub.github.io/roost/protocol.html))
2. **roost.land aggregator** — public marketplace that discovers hosts, indexes their stays, sends guests direct to the host's booking page (no checkout, no commission, no data harvested)
3. **roost cooperative** — member-owned governance · £20/mo flat · no per-booking fees · members elect their own council

Built so the protocol survives even if the aggregator dies. Any third party can build their own aggregator over the same protocol.

## Files

| File | Purpose |
|---|---|
| `index.html` | Public marketplace + browse + filter |
| `host.html` | For-hosts page + co-op pricing + application form |
| `protocol.html` | Full stays-protocol v1 spec |
| `worker.js` | Cloudflare Worker · hourly crawler · registry API |
| `wrangler.toml` | Deployment config |
| `data/registry.json` | Seed registry (12 founding hosts including Wishwood) |
| `protocol/stays-protocol-v1.json` | Formal JSON Schema |

## Founding hosts (12)

- **Wishwood Glamping & Forestry** · Canterbury, Kent (host #001 · the reference implementation)
- Fenstead Cabins · Norfolk Broads
- Carngorm Bothies · Cairngorms
- Tideline Shepherd Huts · Pembrokeshire
- Lochview Treehouse · Loch Awe
- White Peak Lodges · Peak District
- Salt Marsh Yurts · Suffolk Coast
- Moonwood Treehouses · Snowdonia
- Kerry Coastal Cottages · Ring of Kerry
- Hawthorn Hollow · Brecon Beacons
- Borrowdale Bothies · Lake District
- Winterfold Shed · Surrey Hills

(Wishwood is real and live; the other 11 are illustrative placeholders for the founding cohort. Replace with real members as they join.)

## Economics

On a £1,000 booking:
- Airbnb keeps £150 (15%)
- Booking.com keeps £170 (17%)
- **roost keeps £0** (Stripe fee £14 paid directly by host)
- Host receives £986

Per £1,000 booking: **£136 more in the host's pocket** vs Airbnb.

Aggregated across 12 hosts at ~£500k combined revenue: **~£75-85k/year stays in local hands instead of platform pockets**.

## Cooperative model

- £20/month flat OR £200/year (saves £40)
- First 100 members: founding-host status · lifetime fee lock at £20
- 1 host = 1 vote on all governance
- Surplus voted into features, lower fees, or host grants — never extracted
- No VCs · no exit · no acquisition

## Deployment

```bash
# 1. Push + Pages
git push origin main
gh api -X POST repos/sjgant80-hub/roost/pages -f 'source[branch]=main' -f 'source[path]=/'

# 2. Worker
wrangler kv:namespace create ROOST_KV
wrangler deploy
```

## License

- **Code:** MIT · use it · fork it
- **stays-protocol:** CC0 public domain · build your own aggregator over it

## Built by

[Simon Gant](https://www.ai-nativesolutions.com) · AI Native Solutions · Kent.
Part of the estate · sister to [Wishwood Engine](https://github.com/sjgant80-hub/wishwood) (the operator hub that powers host-side automation).

`◊ · κ = 1`
