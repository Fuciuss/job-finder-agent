# Cloudflare scrape reachability — findings

Date: 2026-07-02
Question: Will the AI Jobs Australia scraping method work when run from inside a
Cloudflare Worker (i.e. from Cloudflare egress IPs), not from a laptop?

## Verdict

Yes. The full bootstrap (HTML → JS bundle → Supabase config → Supabase REST)
succeeded end to end from a Cloudflare edge node. The main risk — the HTML/bundle
fetch being bot-challenged from a datacenter IP — did not occur.

## How it was tested

A read-only probe Worker was deployed to `*.workers.dev` and called once, so the
outbound requests genuinely egressed from Cloudflare's network (a plain local
`wrangler dev` egresses from the laptop IP and would not test this).

- Probe location: `experiments/cloudflare-scrape-probe/`
- Discovery logic mirrors `operation-leverage/upmarket-ai/scripts/scrape_aijobs_australia.py`
  (same script-URL and Supabase-config regexes, same PostgREST call).
- Deployed, called, then the deployed Worker was deleted. The experiment source
  remains in the repo for re-runs.

## Evidence

Egress confirmed to be Cloudflare, not local:

- Egress IP: `2a06:98c0:3600::103`
- Colo: `BNE` (Brisbane)
- Loc: `AU`

Per-stage result:

| Stage | Result |
|---|---|
| HTML bootstrap (`/jobs`) | `200`, ~22 KB, no bot challenge (`looksLikeChallenge: false`) |
| Config discovery | Found after scanning 21 of 29 JS chunks |
| Supabase URL | `https://hoggxijtowzzsugcnude.supabase.co` (anon key present, not recorded here) |
| Supabase REST | `206`, `content-range: 0-0/481` → 481 approved jobs, sample row returned |

Config was found in chunk `9293-1b5671b3c9885e53.js`. Chunk URLs carried a
`?dpl=dpl_...` deployment hash, which changes on every site deploy — so chunks
must be discovered from the live HTML each time, never hardcoded.

## Implications for the build

- Direct `fetch()` from a Worker is viable for AI Jobs Australia. No headless
  browser, proxy, or Apify needed for this source.
- Cache the discovered Supabase URL + anon key after first discovery and hit the
  single REST endpoint in steady state. Re-run the bundle scan only when the key
  stops working. Discovery cost 21 subrequests this run — wasteful to repeat
  daily. The probe supports testing this hot path via `AIJOBS_SUPABASE_*` vars.
- Known fragilities (unchanged): the anon key can rotate (fallback re-discovery
  handles it), and the `?dpl=` chunk hash rotates per site deploy (discover from
  live HTML, as the existing Python scraper does).

## Not tested

- LinkedIn / Apify lane. It is a server-to-server API call with no Cloudflare-IP
  concern, so it does not need this probe. A quick Apify reachability check could
  be added later if certainty is wanted.

## How to re-run

```bash
cd experiments/cloudflare-scrape-probe
npm run deploy            # then curl the printed *.workers.dev URL
# or
npm run dev:remote        # runs on Cloudflare's edge; curl http://localhost:8787
```

See `experiments/cloudflare-scrape-probe/README.md` for output interpretation.
