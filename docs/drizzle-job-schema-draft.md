# Drizzle Job Monitoring Schema Draft

Date: 2026-07-02

Status: Phase 1 schema direction.

The schema is intentionally source-local. It does not try to dedupe LinkedIn and AI Jobs Australia against each other yet. Phase 1 only needs to avoid reprocessing the same job from the same source.

## Core Rule

The dedupe key is:

```text
source_key + source_job_id
```

Examples:

- LinkedIn Jobs: `linkedin_jobs + 4423994610`
- AI Jobs Australia: `aijobs_australia + 60abacdb-1a29-4288-8485-e59a5cbecbf5`

If the same source returns the same source job ID again, update `last_seen_at` and keep the existing listing. Do not score it again and do not email it again.

## Real Schema File

The implementation schema lives at:

```text
src/db/schema.ts
```

It uses Drizzle's SQLite/D1 dialect:

- `sqliteTable`
- `text(..., { mode: "json" })`
- `integer(..., { mode: "timestamp_ms" })`
- app-generated text IDs

## Tables

### `job_runs`

Stores one scrape/search run.

Useful fields:

- source key
- purpose
- location
- query payload
- raw artifact path
- raw/filtered/new/changed/unchanged counts
- status/error

### `job_listings`

Stores one source-specific listing.

This is the main dedupe table.

Important constraints:

```text
unique(source_key, source_job_id)
unique(source_key, normalized_source_url)
```

Important state:

- `processing_status`: `unprocessed`, `processing`, `processed`, `failed`, `skipped`
- `processed_at`
- fit score/label/rationale
- `assessed_at`
- `emailed_at`
- `first_seen_at`
- `last_seen_at`
- `last_changed_at`
- content hash

## Ingest Flow

For each returned job:

1. Identify the source.
2. Compute `source_job_id`.
3. Normalize the source URL.
4. Compute `content_hash`.
5. Upsert `job_listings` by `(source_key, source_job_id)`.
6. If the listing is new, leave `processing_status = "unprocessed"` and store `first_seen_run_id`.
7. If the listing already exists and content is unchanged, update `last_seen_at` and `last_seen_run_id` only.
8. If the listing already exists and content changed, update fields and `last_changed_at`; decide later whether Phase 1 should reprocess changed listings.
9. Score only listings where `processing_status = "unprocessed"`.
10. Email only listings where `emailed_at is null`.

## What This Avoids For Now

Phase 1 deliberately avoids:

- source registry table
- run/listing observation join table
- separate assessment table
- email batch tables
- canonical jobs
- cross-source matching
- source-to-source duplicate merging
- first-party ATS identity matching
- people-routing tables

Those can be added later if same-role duplicates across sources become a real problem.

## References Checked

- Cloudflare D1 overview: https://developers.cloudflare.com/d1/
- Cloudflare D1 JSON querying: https://developers.cloudflare.com/d1/sql-api/query-json/
- Cloudflare D1 indexing guidance: https://developers.cloudflare.com/d1/best-practices/use-indexes/
- Drizzle Cloudflare D1 guide: https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1
- Drizzle SQLite column types: https://orm.drizzle.team/docs/sqlite/column-types
