# Job monitoring functionality handover

Date: 2026-07-02
Scope: AI Jobs Australia and LinkedIn Jobs monitoring inside `operation-leverage/upmarket-ai/`

## Executive summary

We turned a one-off hiring-signal scrape into a repeatable manual monitoring system for AI-adjacent roles. It is not a scheduled service or cron job. It is a repo-local workflow with scripts, retained raw data, daily notes, and queue-update rules.

The system has two source lanes:

- AI Jobs Australia: the cleanest daily source because it has stable job IDs, dated snapshots, `current-jobs.json`, and generated summaries with `new_count`.
- LinkedIn Jobs: an Apify-backed sweep used for live city or national discovery, especially roles that do not appear on AI Jobs Australia.

The output is not just a job dump. Each run is meant to separate genuinely new roles from surfaced churn, score fit against the upmarket-AI access thesis, first-party verify only serious candidates, and update the existing application/ranking queues.

## Current state

Status: usable manual workflow.

Stable entry points:

- Playbook: `operation-leverage/upmarket-ai/briefs/daily-job-monitoring-playbook.md`
- AI Jobs Australia scraper: `operation-leverage/upmarket-ai/scripts/scrape_aijobs_australia.py`
- AI Jobs Australia runbook: `operation-leverage/upmarket-ai/raw-data/aijobs-australia/README.md`
- LinkedIn sweep script: `operation-leverage/upmarket-ai/scripts/run_brisbane_ai_jobs_sweep.py`
- LinkedIn delta comparator: `operation-leverage/upmarket-ai/scripts/compare_linkedin_job_sweeps.py`
- Daily output folder: `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/`

Latest formal daily monitoring note found: `pipeline/daily-job-monitoring/2026-06-09.md`.

Later raw LinkedIn data exists for 2026-06-22 under `raw-data/linkedin-jobs/`, but there is no matching dated daily note for that raw sweep.

## What was built

### 1. AI Jobs Australia scraper

File: `scripts/scrape_aijobs_australia.py`

Built on 2026-05-28 after rechecking the live site mechanics. The site is a client-rendered Next.js app, so plain HTML scraping only sees a loading shell. The scraper fetches the `/jobs` page, discovers current Next.js JavaScript chunks, extracts the public Supabase client config from the public bundle, queries approved jobs from the public Supabase REST endpoint, normalizes rows, writes a dated JSON snapshot, and writes a Markdown summary.

Default outputs:

- `raw-data/aijobs-australia/YYYY-MM-DD-jobs.json`
- `raw-data/aijobs-australia/YYYY-MM-DD-summary.md`
- `raw-data/aijobs-australia/current-jobs.json`

Useful behavior:

- Full scrapes replace `current-jobs.json` with the latest approved feed.
- Incremental runs using `--created-since` upsert into `current-jobs.json` by AI Jobs Australia job ID, but do not remove expired/missing jobs because partial feeds cannot prove removal.
- The generated summary records approved job count, new jobs versus the previous snapshot, top companies, and recent jobs.

Important caveat: AI Jobs Australia is third-party aggregator evidence. Do not quote its role text in outreach or applications until the first-party employer page is checked.

### 2. LinkedIn Jobs Apify sweep

File: `scripts/run_brisbane_ai_jobs_sweep.py`

This uses Apify actor `hKByXkMQaC5Qt9UMN` / `curious_coder/linkedin-jobs-scraper`. It needs `APIFY_API_KEY` or `APIFY_TOKEN`, normally loaded from `/Users/reespawson/Documents/Playground/agent-context/.env`.

Default query set:

- `AI Engineer`
- `GenAI`
- `Generative AI`
- `AI Product Manager`
- `AI Enablement`
- `AI Governance`
- `Machine Learning Engineer`
- `Automation AI`
- `Agentic AI`
- `MLOps`

The script writes two files:

- raw Apify response, including actor ID, purpose, location, queries, payload, metadata, and all returned items
- filtered AI-adjacent rows with a simple keyword score, role/company/location fields, LinkedIn/apply URLs, keyword hits, and phrase snippets

The script default output directory is still `/Users/reespawson/Documents/Playground/agent-context/outbound/tools/linkedin/output`. The daily monitoring runs usually passed `--output-dir raw-data/linkedin-jobs` so the artifacts stayed inside `operation-leverage/upmarket-ai/raw-data/`. Future runs should keep passing that local output directory unless the playbook is intentionally changed.

### 3. LinkedIn delta comparator

File: `scripts/compare_linkedin_job_sweeps.py`

Added on 2026-05-29 to solve the biggest LinkedIn weakness: a role can be new to a scrape without being newly posted. The comparator loads the current filtered JSON, auto-finds the previous filtered file for the same `purpose` when possible, compares by job ID/link/apply URL/fallback company-title-location key, and writes JSON or Markdown summaries.

It reports:

- current and previous filtered counts
- new to filtered sweep
- new and posted today
- new but older/newly surfaced
- a table of new items with role, company, location, posted date, apply URL, and LinkedIn URL

### 4. Operating layer

Files:

- `briefs/daily-job-monitoring-playbook.md`
- `pipeline/daily-job-monitoring/README.md`
- `pipeline/daily-job-monitoring/TEMPLATE.md`

This is the hand-run process. A successful daily run should produce fresh raw source artifacts, one dated note, a short action list, and queue updates only for roles worth action.

Daily labels:

- `action_today`
- `verify`
- `people_route`
- `market_intel`
- `skip`

The intended queues are:

- Australia-wide roles: `pipeline/australia-wide-ai-role-ranking-2026-05-28.md`
- Brisbane execution queue: `pipeline/brisbane-ai-application-queue-2026-05-20.md`
- People routing: `pipeline/brisbane-ai-application-people-targets-2026-05-20.md` or a new dated people-target file if coverage is missing

## How to run it now

From the upmarket-AI folder:

```bash
cd /Users/reespawson/Documents/Playground/agent-context/operation-leverage/upmarket-ai
```

Run AI Jobs Australia:

```bash
python3 scripts/scrape_aijobs_australia.py
```

Run a Brisbane LinkedIn sweep into the local raw-data folder:

```bash
python3 scripts/run_brisbane_ai_jobs_sweep.py \
  --output-dir raw-data/linkedin-jobs \
  --purpose brisbane-upmarket-ai \
  --count 200
```

Run Melbourne or Sydney by changing `--location` and `--purpose`:

```bash
python3 scripts/run_brisbane_ai_jobs_sweep.py \
  --output-dir raw-data/linkedin-jobs \
  --location "Melbourne, Victoria, Australia" \
  --purpose melbourne-upmarket-ai \
  --count 200
```

Compare the latest filtered LinkedIn output:

```bash
python3 scripts/compare_linkedin_job_sweeps.py \
  raw-data/linkedin-jobs/<current-filtered-file>.json \
  --summary-output pipeline/daily-job-monitoring/YYYY-MM-DD-linkedin-brisbane-delta.md
```

Then create `pipeline/daily-job-monitoring/YYYY-MM-DD.md` from `TEMPLATE.md`, fill in source paths/counts, score the serious roles, first-party verify top candidates, and update only the existing queue files that need changing.

## What has already been proven

The AI Jobs Australia scraper was verified end to end on 2026-05-28. A live test scrape using `--created-since 2026-05-27` returned 24 jobs; the canonical current-list behavior was separately validated so a full scrape plus incremental upsert kept `current-jobs.json` deduped at 513 unique jobs.

The daily monitoring layer was formalized on 2026-05-29. The same session added the playbook, daily output folder, template, LinkedIn comparator, and a first full daily run. That run produced 517 AI Jobs Australia current roles with 11 new IDs, plus Brisbane and Australia-wide LinkedIn sweeps under `raw-data/linkedin-jobs/`.

Dated daily notes were produced for:

- 2026-05-29
- 2026-06-01
- 2026-06-02
- 2026-06-03
- 2026-06-04
- 2026-06-08
- 2026-06-09

The workflow has already surfaced and triaged real role candidates including Macquarie, Triskele, SoftwareOne, Insight, C9, BDO AI Labs, Softlink, NAB, Google, Databricks, Airwallex, The Lottery Corporation, Optus, Virgin Australia, Westpac, News Corp, Flight Centre Travel Group, Arinco, Wesfarmers, DINGO, and Datacom.

## Known caveats

- There is no scheduler. Activity logs explicitly concluded that the right deliverable was a lightweight repeatable manual system, not cron automation.
- AI Jobs Australia `--created-since` uses UTC midnight, not Australia/Brisbane local midnight. That is acceptable for rough refreshes but not exact local-day reporting.
- AI Jobs Australia can break if the site moves away from Supabase, the public bundle no longer exposes the config in the same pattern, or the jobs table schema changes.
- AI Jobs Australia role descriptions are mirrored aggregator content. Treat them as discovery evidence until first-party employer pages are verified.
- LinkedIn search is noisy and churn-heavy. Always separate `new_to_filtered_sweep` from `posted_today`.
- LinkedIn actor coverage can vary. On 2026-06-02, the Brisbane run returned only 8 raw items compared with 120 on the previous comparable run, so that day was explicitly marked low confidence.
- The 2026-06-09 run concluded that a 120-count LinkedIn city sweep was too narrow during active application periods and recommended count 200 for city sweeps.
- The default LinkedIn script output path still points to the shared outbound LinkedIn output folder. For this project, pass `--output-dir raw-data/linkedin-jobs` to keep artifacts local and reproducible.
- The workflow intentionally avoids creating outreach or CRM rows from job signals alone. A role can trigger people research, but the person still needs separate evidence and source URLs.

## Recommended next work

1. Run a fresh AI Jobs Australia scrape because the latest formal AI Jobs daily note is 2026-06-09.
2. Run fresh Brisbane, Sydney, and Melbourne LinkedIn sweeps with `--count 200` if the application sprint is active.
3. Write the missing daily note if the 2026-06-22 raw Brisbane LinkedIn sweep is still useful, or treat it as raw-only history.
4. Patch `daily-job-monitoring-playbook.md` and `TEMPLATE.md` so their LinkedIn examples consistently use `raw-data/linkedin-jobs/`.
5. Consider adding a wrapper script that runs AI Jobs Australia, runs selected LinkedIn city sweeps, calls the comparator, and creates a prefilled daily note. Keep it manual-triggered unless Rees explicitly wants scheduling.
6. Add an optional Brisbane-local date mode to the AI Jobs scraper if exact local-day deltas become important.

## Copy-paste prompt for the next agent

```text
Run the daily job monitoring workflow from /Users/reespawson/Documents/Playground/agent-context/operation-leverage/upmarket-ai.

Use:
- scripts/scrape_aijobs_australia.py
- scripts/run_brisbane_ai_jobs_sweep.py with --output-dir raw-data/linkedin-jobs and --count 200
- scripts/compare_linkedin_job_sweeps.py
- pipeline/daily-job-monitoring/TEMPLATE.md

Preserve raw artifact paths, identify genuinely new roles versus LinkedIn surfaced churn, first-party verify only the top candidates, write pipeline/daily-job-monitoring/YYYY-MM-DD.md, and update the existing Brisbane or Australia-wide queues only for roles worth action. Treat AI Jobs Australia as aggregator evidence until first-party verified.
```

## Sources used

- `operation-leverage/upmarket-ai/README.md`
- `operation-leverage/upmarket-ai/briefs/README.md`
- `operation-leverage/upmarket-ai/briefs/daily-job-monitoring-playbook.md`
- `operation-leverage/upmarket-ai/raw-data/README.md`
- `operation-leverage/upmarket-ai/raw-data/aijobs-australia/README.md`
- `operation-leverage/upmarket-ai/scripts/scrape_aijobs_australia.py`
- `operation-leverage/upmarket-ai/scripts/run_brisbane_ai_jobs_sweep.py`
- `operation-leverage/upmarket-ai/scripts/compare_linkedin_job_sweeps.py`
- `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/README.md`
- `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/TEMPLATE.md`
- `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/2026-05-29.md`
- `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/2026-06-01.md`
- `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/2026-06-02.md`
- `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/2026-06-03.md`
- `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/2026-06-04.md`
- `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/2026-06-08.md`
- `operation-leverage/upmarket-ai/pipeline/daily-job-monitoring/2026-06-09.md`
- `skills/linkedin-job-search/SKILL.md`
- `activity-capture/upmarket-ai/2026-05-25/2026-05-28.md`
- `activity-capture/upmarket-ai/2026-05-25/2026-05-29.md`
- `activity-capture/upmarket-ai/2026-06-01/2026-06-01.md`
- `activity-capture/upmarket-ai/2026-06-01/2026-06-02.md`
- `activity-capture/upmarket-ai/2026-06-01/2026-06-03.md`
