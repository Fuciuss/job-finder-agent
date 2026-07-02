# Drizzle Job Monitoring Schema Draft

Date: 2026-07-02

Purpose: draft the Drizzle data model for deduplicated job monitoring across AI Jobs Australia, LinkedIn Jobs, and later sources.

The core design is two-layered:

1. `source_job_listings`: the exact listing returned by one source.
2. `canonical_jobs`: the real-world role we care about, which may appear on multiple sources.

Processing should happen from `job_events`, not directly from raw listings. A listing that appears again unchanged should update `last_seen_at` only. It should not trigger scoring or email delivery again.

## D1 Compatibility Note

Cloudflare D1 is SQLite-compatible, not Postgres. If D1 remains a likely deployment target, the schema should be designed against Drizzle's SQLite/D1 dialect first:

- Use `sqliteTable` from `drizzle-orm/sqlite-core`, not `pgTable`.
- Use `text` primary keys with app-generated IDs, or integer autoincrement IDs. This draft uses text IDs so they remain easy to move to Postgres later.
- Use `text(..., { mode: "json" })` instead of `jsonb`.
- Use `text(..., { enum: [...] })` for TypeScript enum inference. SQLite/D1 does not enforce enum values by itself, so validate in application code or add explicit check constraints later.
- Use `integer(..., { mode: "timestamp_ms" })` for indexed timestamps.
- Keep nullable values out of unique indexes where possible. SQLite treats `NULL` values as distinct, which can accidentally allow duplicate rows.

Cloudflare documents D1 as a managed database with SQLite SQL semantics, and Drizzle documents Cloudflare D1 support through the SQLite/D1 driver. D1 stores JSON as `TEXT` while still supporting JSON queries, so JSON columns in this draft use Drizzle's SQLite JSON text mode.

## D1-Compatible Drizzle Variant

This is the preferred starting point while the database target is uncertain.

```ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = (name = "id") =>
  text(name)
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const now = () => new Date();

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now);

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now)
    .$onUpdateFn(now);

export const jobSources = sqliteTable("job_sources", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  createdAt: createdAt(),
});

export const jobRuns = sqliteTable("job_runs", {
  id: id(),
  sourceId: text("source_id").notNull().references(() => jobSources.id),

  purpose: text("purpose").notNull(),
  location: text("location"),
  queryPayload: text("query_payload", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  rawArtifactPath: text("raw_artifact_path"),

  startedAt: integer("started_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),

  status: text("status", {
    enum: ["running", "succeeded", "failed"],
  }).notNull().default("running"),

  rawCount: integer("raw_count"),
  filteredCount: integer("filtered_count"),
  error: text("error"),
}, (table) => ({
  sourceStartedIdx: index("job_runs_source_started_idx").on(table.sourceId, table.startedAt),
}));

export const canonicalJobs = sqliteTable("canonical_jobs", {
  id: id(),

  canonicalKey: text("canonical_key").notNull().unique(),

  title: text("title").notNull(),
  companyName: text("company_name").notNull(),
  companyDomain: text("company_domain"),

  city: text("city"),
  region: text("region"),
  country: text("country").notNull().default("Australia"),

  employmentType: text("employment_type"),
  workplaceType: text("workplace_type"),
  seniority: text("seniority"),

  bestSourceUrl: text("best_source_url"),
  bestApplyUrl: text("best_apply_url"),
  firstPartyUrl: text("first_party_url"),

  postedAt: integer("posted_at", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),

  status: text("status", {
    enum: ["open", "stale", "closed", "ignored"],
  }).notNull().default("open"),

  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now),
  lastChangedAt: integer("last_changed_at", { mode: "timestamp_ms" }),

  latestContentHash: text("latest_content_hash"),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  companyIdx: index("canonical_jobs_company_idx").on(table.companyName),
  lastSeenIdx: index("canonical_jobs_last_seen_idx").on(table.lastSeenAt),
}));

export const sourceJobListings = sqliteTable("source_job_listings", {
  id: id(),

  sourceId: text("source_id").notNull().references(() => jobSources.id),
  canonicalJobId: text("canonical_job_id").references(() => canonicalJobs.id),

  sourceJobId: text("source_job_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  normalizedSourceUrl: text("normalized_source_url").notNull(),
  applyUrl: text("apply_url"),

  title: text("title").notNull(),
  companyName: text("company_name").notNull(),
  location: text("location"),

  postedAt: integer("posted_at", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),

  descriptionText: text("description_text"),
  descriptionHtml: text("description_html"),

  latestRaw: text("latest_raw", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  latestContentHash: text("latest_content_hash").notNull(),

  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now),
  lastChangedAt: integer("last_changed_at", { mode: "timestamp_ms" }),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  sourceJobUnique: uniqueIndex("source_job_listings_source_job_unique")
    .on(table.sourceId, table.sourceJobId),

  sourceUrlUnique: uniqueIndex("source_job_listings_source_url_unique")
    .on(table.sourceId, table.normalizedSourceUrl),

  canonicalIdx: index("source_job_listings_canonical_idx").on(table.canonicalJobId),
  lastSeenIdx: index("source_job_listings_last_seen_idx").on(table.lastSeenAt),
}));

export const jobObservations = sqliteTable("job_observations", {
  id: id(),

  runId: text("run_id").notNull().references(() => jobRuns.id),
  sourceListingId: text("source_listing_id").notNull().references(() => sourceJobListings.id),

  observedAt: integer("observed_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(now),

  inputUrl: text("input_url").notNull().default(""),
  matchedQuery: text("matched_query"),

  contentHash: text("content_hash").notNull(),
  rawItem: text("raw_item", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),

  isFirstSeen: integer("is_first_seen", { mode: "boolean" }).notNull().default(false),
  isContentChanged: integer("is_content_changed", { mode: "boolean" }).notNull().default(false),
}, (table) => ({
  runListingInputUnique: uniqueIndex("job_observations_run_listing_input_unique")
    .on(table.runId, table.sourceListingId, table.inputUrl),
}));

export const jobIdentifiers = sqliteTable("job_identifiers", {
  id: id(),

  canonicalJobId: text("canonical_job_id").notNull().references(() => canonicalJobs.id),
  sourceListingId: text("source_listing_id").references(() => sourceJobListings.id),

  identifierType: text("identifier_type").notNull(),
  identifierValue: text("identifier_value").notNull(),

  createdAt: createdAt(),
}, (table) => ({
  identifierUnique: uniqueIndex("job_identifiers_type_value_unique")
    .on(table.identifierType, table.identifierValue),
}));

export const jobEvents = sqliteTable("job_events", {
  id: id(),

  canonicalJobId: text("canonical_job_id").notNull().references(() => canonicalJobs.id),
  sourceListingId: text("source_listing_id").references(() => sourceJobListings.id),
  runId: text("run_id").references(() => jobRuns.id),

  eventType: text("event_type", {
    enum: ["new_job", "new_source", "content_changed", "resurfaced", "closed", "verified"],
  }).notNull(),
  eventHash: text("event_hash").notNull().unique(),

  payload: text("payload", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),

  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
}, (table) => ({
  unprocessedIdx: index("job_events_unprocessed_idx").on(table.processedAt),
  canonicalIdx: index("job_events_canonical_idx").on(table.canonicalJobId),
}));

export const jobAssessments = sqliteTable("job_assessments", {
  id: id(),

  canonicalJobId: text("canonical_job_id").notNull().references(() => canonicalJobs.id),

  assessmentVersion: text("assessment_version").notNull(),
  resumeVersion: text("resume_version").notNull().default(""),
  goalsVersion: text("goals_version").notNull().default(""),

  fitScore: integer("fit_score"),
  label: text("label", {
    enum: ["action_today", "verify", "people_route", "market_intel", "skip"],
  }),

  rationale: text("rationale"),
  strengths: text("strengths", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  gaps: text("gaps", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  evidence: text("evidence", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),

  createdAt: createdAt(),
}, (table) => ({
  assessmentUnique: uniqueIndex("job_assessments_unique")
    .on(table.canonicalJobId, table.assessmentVersion, table.resumeVersion, table.goalsVersion),
}));

export const emailBatches = sqliteTable("email_batches", {
  id: id(),
  subject: text("subject").notNull(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const emailBatchItems = sqliteTable("email_batch_items", {
  id: id(),

  emailBatchId: text("email_batch_id").notNull().references(() => emailBatches.id),
  jobEventId: text("job_event_id").notNull().references(() => jobEvents.id),
  canonicalJobId: text("canonical_job_id").notNull().references(() => canonicalJobs.id),
}, (table) => ({
  batchJobUnique: uniqueIndex("email_batch_items_batch_job_unique")
    .on(table.emailBatchId, table.canonicalJobId),

  eventUnique: uniqueIndex("email_batch_items_event_unique")
    .on(table.jobEventId),
}));
```

## Postgres Drizzle Variant

Keep this only if the project lands on Postgres.

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const jobRunStatus = pgEnum("job_run_status", [
  "running",
  "succeeded",
  "failed",
]);

export const canonicalJobStatus = pgEnum("canonical_job_status", [
  "open",
  "stale",
  "closed",
  "ignored",
]);

export const jobEventType = pgEnum("job_event_type", [
  "new_job",
  "new_source",
  "content_changed",
  "resurfaced",
  "closed",
  "verified",
]);

export const assessmentLabel = pgEnum("assessment_label", [
  "action_today",
  "verify",
  "people_route",
  "market_intel",
  "skip",
]);

export const jobSources = pgTable("job_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobRuns = pgTable("job_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id").notNull().references(() => jobSources.id),
  purpose: text("purpose").notNull(),
  location: text("location"),
  queryPayload: jsonb("query_payload").$type<Record<string, unknown>>().notNull(),
  rawArtifactPath: text("raw_artifact_path"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: jobRunStatus("status").notNull().default("running"),
  rawCount: integer("raw_count"),
  filteredCount: integer("filtered_count"),
  error: text("error"),
}, (table) => ({
  sourceStartedIdx: index("job_runs_source_started_idx").on(table.sourceId, table.startedAt),
}));

export const canonicalJobs = pgTable("canonical_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),

  canonicalKey: text("canonical_key").notNull().unique(),
  title: text("title").notNull(),
  companyName: text("company_name").notNull(),
  companyDomain: text("company_domain"),

  city: text("city"),
  region: text("region"),
  country: text("country").notNull().default("Australia"),

  employmentType: text("employment_type"),
  workplaceType: text("workplace_type"),
  seniority: text("seniority"),

  bestSourceUrl: text("best_source_url"),
  bestApplyUrl: text("best_apply_url"),
  firstPartyUrl: text("first_party_url"),

  postedAt: timestamp("posted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),

  status: canonicalJobStatus("status").notNull().default("open"),

  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),

  latestContentHash: text("latest_content_hash"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  companyIdx: index("canonical_jobs_company_idx").on(table.companyName),
  lastSeenIdx: index("canonical_jobs_last_seen_idx").on(table.lastSeenAt),
}));

export const sourceJobListings = pgTable("source_job_listings", {
  id: uuid("id").primaryKey().defaultRandom(),

  sourceId: uuid("source_id").notNull().references(() => jobSources.id),
  canonicalJobId: uuid("canonical_job_id").references(() => canonicalJobs.id),

  sourceJobId: text("source_job_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  normalizedSourceUrl: text("normalized_source_url").notNull(),
  applyUrl: text("apply_url"),

  title: text("title").notNull(),
  companyName: text("company_name").notNull(),
  location: text("location"),

  postedAt: timestamp("posted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),

  descriptionText: text("description_text"),
  descriptionHtml: text("description_html"),

  latestRaw: jsonb("latest_raw").$type<Record<string, unknown>>().notNull(),
  latestContentHash: text("latest_content_hash").notNull(),

  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceJobUnique: uniqueIndex("source_job_listings_source_job_unique")
    .on(table.sourceId, table.sourceJobId),

  sourceUrlUnique: uniqueIndex("source_job_listings_source_url_unique")
    .on(table.sourceId, table.normalizedSourceUrl),

  canonicalIdx: index("source_job_listings_canonical_idx").on(table.canonicalJobId),
  lastSeenIdx: index("source_job_listings_last_seen_idx").on(table.lastSeenAt),
}));

export const jobObservations = pgTable("job_observations", {
  id: uuid("id").primaryKey().defaultRandom(),

  runId: uuid("run_id").notNull().references(() => jobRuns.id),
  sourceListingId: uuid("source_listing_id").notNull().references(() => sourceJobListings.id),

  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  inputUrl: text("input_url"),
  matchedQuery: text("matched_query"),

  contentHash: text("content_hash").notNull(),
  rawItem: jsonb("raw_item").$type<Record<string, unknown>>().notNull(),

  isFirstSeen: boolean("is_first_seen").notNull().default(false),
  isContentChanged: boolean("is_content_changed").notNull().default(false),
}, (table) => ({
  runListingInputUnique: uniqueIndex("job_observations_run_listing_input_unique")
    .on(table.runId, table.sourceListingId, table.inputUrl),
}));

export const jobIdentifiers = pgTable("job_identifiers", {
  id: uuid("id").primaryKey().defaultRandom(),

  canonicalJobId: uuid("canonical_job_id").notNull().references(() => canonicalJobs.id),
  sourceListingId: uuid("source_listing_id").references(() => sourceJobListings.id),

  identifierType: text("identifier_type").notNull(),
  identifierValue: text("identifier_value").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  identifierUnique: uniqueIndex("job_identifiers_type_value_unique")
    .on(table.identifierType, table.identifierValue),
}));

export const jobEvents = pgTable("job_events", {
  id: uuid("id").primaryKey().defaultRandom(),

  canonicalJobId: uuid("canonical_job_id").notNull().references(() => canonicalJobs.id),
  sourceListingId: uuid("source_listing_id").references(() => sourceJobListings.id),
  runId: uuid("run_id").references(() => jobRuns.id),

  eventType: jobEventType("event_type").notNull(),
  eventHash: text("event_hash").notNull().unique(),

  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),

  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  unprocessedIdx: index("job_events_unprocessed_idx").on(table.processedAt),
  canonicalIdx: index("job_events_canonical_idx").on(table.canonicalJobId),
}));

export const jobAssessments = pgTable("job_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),

  canonicalJobId: uuid("canonical_job_id").notNull().references(() => canonicalJobs.id),

  assessmentVersion: text("assessment_version").notNull(),
  resumeVersion: text("resume_version"),
  goalsVersion: text("goals_version"),

  fitScore: integer("fit_score"),
  label: assessmentLabel("label"),

  rationale: text("rationale"),
  strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
  gaps: jsonb("gaps").$type<string[]>().notNull().default([]),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  assessmentUnique: uniqueIndex("job_assessments_unique")
    .on(table.canonicalJobId, table.assessmentVersion, table.resumeVersion, table.goalsVersion),

  fitScoreCheck: sql`check (${table.fitScore} is null or (${table.fitScore} >= 0 and ${table.fitScore} <= 100))`,
}));

export const emailBatches = pgTable("email_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  subject: text("subject").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailBatchItems = pgTable("email_batch_items", {
  id: uuid("id").primaryKey().defaultRandom(),

  emailBatchId: uuid("email_batch_id").notNull().references(() => emailBatches.id),
  jobEventId: uuid("job_event_id").notNull().references(() => jobEvents.id),
  canonicalJobId: uuid("canonical_job_id").notNull().references(() => canonicalJobs.id),
}, (table) => ({
  batchJobUnique: uniqueIndex("email_batch_items_batch_job_unique")
    .on(table.emailBatchId, table.canonicalJobId),

  eventUnique: uniqueIndex("email_batch_items_event_unique")
    .on(table.jobEventId),
}));
```

## Source Job Identity

`sourceJobId` should always be populated so ingest can use a simple upsert.

Recommended source IDs:

- AI Jobs Australia: the UUID from the `id` field.
- LinkedIn Jobs: the actor `id`, or the numeric ID parsed from `/jobs/view/...-4423994610`.
- Fallback: a stable hash of the normalized source URL.

`normalizedSourceUrl` should remove tracking parameters such as `position`, `pageNum`, `refId`, and `trackingId` from LinkedIn URLs before uniqueness checks.

## Canonical Job Identity

`canonicalKey` should be generated by application code, not manually authored.

Suggested inputs, in priority order:

1. First-party ATS requisition ID if available.
2. First-party apply URL if available.
3. Company domain plus normalized title plus normalized city.
4. Company name plus normalized title plus normalized city as a fallback.

The canonical match should be deliberately conservative. It is better to temporarily keep two canonical jobs separate than to merge different roles at the same company.

## Content Hash

Use `latestContentHash` to detect whether a listing changed materially.

Suggested hash inputs:

- normalized title
- normalized company
- normalized location
- normalized posted date
- normalized apply URL
- normalized description text

Do not include volatile fields like applicant count, tracking IDs, search query URL, scrape time, or LinkedIn `refId`.

## Ingest Rules

For each returned job:

1. Compute `sourceJobId`.
2. Normalize source URL and apply URL.
3. Compute `latestContentHash`.
4. Upsert `source_job_listings` by `(source_id, source_job_id)`.
5. Create a `job_observations` row for the current run.
6. Match or create `canonical_jobs`.
7. If the canonical job is new, create `job_events.new_job`.
8. If the canonical job already exists but this source listing is new, create `job_events.new_source`.
9. If the source listing exists and content hash changed, create `job_events.content_changed`.
10. If the source listing exists and content hash is unchanged, update `last_seen_at` only.
11. Score and summarize only unprocessed `job_events`.
12. Email only events that are not already represented in `email_batch_items`.

This means LinkedIn churn or repeated search visibility updates the database but does not repeatedly trigger expensive scoring or daily email noise.

## Open Design Questions

- Should Phase 1 target D1-first and only move to Postgres if the workflow outgrows SQLite-style constraints?
- Should internal IDs stay as app-generated text UUIDs for portability, or use D1 integer autoincrement IDs for simplicity?
- Should `company` become its own normalized table now, or stay embedded until we need employer-level routing?
- Should `location` become structured during ingest, or is `city`, `region`, `country` enough for Phase 1?
- Do we want a separate `first_party_verifications` table for employer-page checks?
- Should `job_events.resurfaced` ever produce an email, or should resurfacing remain internal telemetry only?

## References Checked

- Cloudflare D1 overview: https://developers.cloudflare.com/d1/
- Cloudflare D1 JSON querying: https://developers.cloudflare.com/d1/sql-api/query-json/
- Cloudflare D1 indexing guidance: https://developers.cloudflare.com/d1/best-practices/use-indexes/
- Drizzle Cloudflare D1 guide: https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1
- Drizzle SQLite column types: https://orm.drizzle.team/docs/sqlite/column-types
