# Cloudflare Scrape Probe

A read-only reachability probe that answers one question:

> Do the AI Jobs Australia bootstrap (HTML + JS bundle) and the Supabase REST
> endpoint work when the request comes from a **Cloudflare IP** instead of a
> laptop?

It replicates the discovery logic in
`operation-leverage/upmarket-ai/scripts/scrape_aijobs_australia.py` (same script
and Supabase-config regexes, same REST call), so a green probe means the real
Worker scraper will reach its data.

## The one thing that matters: run it from Cloudflare's network

A plain `wrangler dev` runs the Worker **locally**, so `fetch()` egresses from
**your** IP — it does *not* test the Cloudflare-IP question. Use one of:

```bash
npm run dev:remote      # wrangler dev --remote — runs on Cloudflare's edge
# or
npm run deploy          # deploy to a *.workers.dev URL, then curl it
```

Compare the `egress.ip` field between `npm run dev` and `npm run dev:remote` —
they should differ, and only the remote one reflects production.

## Run it

No configuration is required for the full bootstrap test:

```bash
npm install
npm run dev:remote
```

Then in another terminal:

```bash
curl -s http://localhost:8787 | jq
```

(If you set `TEST_TOKEN` in `.dev.vars`, add `-H "Authorization: Bearer <token>"`.)

## Reading the output

```jsonc
{
  "ok": true,                         // both bootstrap and Supabase succeeded
  "mode": "full-bootstrap",
  "egress": { "ip": "...", "colo": "SYD", "loc": "AU" },
  "verdict": {
    "htmlReachable": true,            // /jobs returned 200 and was NOT a challenge page
    "configDiscovered": true,         // Supabase URL + anon key found in a JS chunk
    "supabaseReachable": true         // REST endpoint answered with rows/count
  },
  "discovery": {
    "looksLikeChallenge": false,      // <-- if true, a CF IP is being challenged
    "scriptCount": 27,
    "scriptsScanned": 12,
    "supabaseUrl": "https://xxxx.supabase.co",
    "anonKeyPrefix": "eyJhbGciOiJ…"   // key is never printed in full
  },
  "supabase": { "status": 200, "approvedTotal": "513", "sampleId": "..." }
}
```

Key checks:

- `verdict.htmlReachable: false` **and** `discovery.looksLikeChallenge: true`
  → the HTML bootstrap is being bot-challenged from Cloudflare IPs. This is the
  main risk. Mitigation: cache the Supabase config so the bootstrap is a rare
  fallback, or route that one fetch through a proxy/Apify.
- `verdict.supabaseReachable: true` while the bootstrap fails → the hot path is
  fine; only the first-boot discovery needs a workaround.
- `supabase.approvedTotal` should be a plausible job count (hundreds).

## Test the cached-config hot path

In production the Worker will cache the discovered Supabase URL + anon key and
hit Supabase directly, only re-scraping the bundle if the key stops working.
Test that path (skips the HTML entirely):

```bash
# in .dev.vars
AIJOBS_SUPABASE_URL=https://xxxxxxxx.supabase.co
AIJOBS_SUPABASE_ANON_KEY=eyJ...
```

Response `mode` becomes `"cached-config (bootstrap skipped)"`.

## Note on LinkedIn / Apify

The LinkedIn lane is not probed here — it goes through the Apify API, which is a
normal server-to-server call and does not have the Cloudflare-IP concern. If you
want to confirm it too, the only test that matters is that a `fetch()` to the
Apify API from a Worker returns 200; there is no IP-blocking risk.

## Cleanup

This is a throwaway experiment. Once the probe is green, delete the deployed
Worker (`wrangler delete`) — the real scraper doesn't need it.
