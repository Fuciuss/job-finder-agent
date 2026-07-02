# Drizzle Job Monitoring Schema Draft

Date: 2026-07-02

Status: Phase 1 schema direction.

The schema is intentionally source-local. It does not try to dedupe LinkedIn and AI Jobs Australia against each other yet. Phase 1 only needs to avoid reprocessing the same job from the same source.

## Core Rule

The dedupe key is:

```text
source_id + source_job_id
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

### `job_sources`

Stores source definitions such as:

- `linkedin_jobs`
- `aijobs_australia`

### `job_runs`

Stores one scrape/search run.

Useful fields:

- source
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
unique(source_id, source_job_id)
unique(source_id, normalized_source_url)
```

Important state:

- `processing_status`: `unprocessed`, `processing`, `processed`, `failed`, `skipped`
- `processed_at`
- `first_seen_at`
- `last_seen_at`
- `last_changed_at`
- `latest_content_hash`

### `job_run_listings`

Stores the fact that a listing appeared in a run.

This keeps run history without duplicating the listing itself.

Useful fields:

- run
- listing
- input URL
- matched query
- raw item
- content hash
- first-seen flag
- content-changed flag

### `job_assessments`

Stores fit scoring and rationale for one source listing.

The uniqueness key is:

```text
listing_id + assessment_version + resume_version + goals_version
```

That allows later reassessment if the scoring prompt, resume, or goals change.

### `email_batches`

Stores outbound email sends.

### `email_batch_items`

Stores listings included in emails.

The schema currently makes `listing_id` unique here so a listing can only be emailed once in Phase 1.

## Ingest Flow

For each returned job:

1. Identify the source.
2. Compute `source_job_id`.
3. Normalize the source URL.
4. Compute `latest_content_hash`.
5. Upsert `job_listings` by `(source_id, source_job_id)`.
6. Insert a `job_run_listings` observation for the run.
7. If the listing is new, leave `processing_status = "unprocessed"`.
8. If the listing already exists and content is unchanged, update `last_seen_at` only.
9. If the listing already exists and content changed, update fields and `last_changed_at`; decide later whether Phase 1 should reprocess changed listings.
10. Score only listings where `processing_status = "unprocessed"`.
11. Email only listings that do not already exist in `email_batch_items`.

## What This Avoids For Now

Phase 1 deliberately avoids:

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
