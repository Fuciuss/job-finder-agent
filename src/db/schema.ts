import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/*
 * Phase 1 schema:
 *
 * Keep only what we need to avoid reprocessing the same listing from the same
 * source. We are not deduping across sources yet, so there is no canonical job
 * table and no source registry table.
 *
 * The stable listing identity is:
 *
 *   source_key + source_job_id
 *
 * Examples:
 * - linkedin_jobs + 4423994610
 * - aijobs_australia + 60abacdb-1a29-4288-8485-e59a5cbecbf5
 *
 * If that pair already exists, the listing has been seen before. Update
 * last_seen_at and skip assessment/email unless the content hash changed and we
 * later decide changed listings should be reprocessed.
 */

export const jobRunStatuses = ["running", "succeeded", "failed"] as const;
export const processingStatuses = [
  "unprocessed",
  "processing",
  "processed",
  "failed",
  "skipped",
] as const;
export const fitLabels = [
  "action_today",
  "verify",
  "people_route",
  "market_intel",
  "skip",
] as const;

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = () => new Date();

const id = (name = "id") =>
  text(name)
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp("created_at")
    .notNull()
    .$defaultFn(now);

const updatedAt = () =>
  timestamp("updated_at")
    .notNull()
    .$defaultFn(now)
    .$onUpdateFn(now);

// One scrape/search execution. This gives us run-level auditability without
// storing every run/listing observation in a separate join table yet.
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: id(),

    sourceKey: text("source_key").notNull(),
    purpose: text("purpose").notNull(),
    location: text("location"),

    queryPayload: text("query_payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    rawArtifactPath: text("raw_artifact_path"),

    startedAt: timestamp("started_at")
      .notNull()
      .$defaultFn(now),
    finishedAt: timestamp("finished_at"),
    status: text("status", { enum: jobRunStatuses }).notNull().default("running"),

    rawCount: integer("raw_count"),
    filteredCount: integer("filtered_count"),
    newCount: integer("new_count"),
    changedCount: integer("changed_count"),
    unchangedCount: integer("unchanged_count"),

    error: text("error"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    sourceStartedIdx: index("job_runs_source_started_idx").on(table.sourceKey, table.startedAt),
  }),
);

// One listing from one source. This table is both the dedupe state and the
// processing state for Phase 1.
export const jobListings = sqliteTable(
  "job_listings",
  {
    id: id(),

    sourceKey: text("source_key").notNull(),
    sourceJobId: text("source_job_id").notNull(),

    sourceUrl: text("source_url").notNull(),
    normalizedSourceUrl: text("normalized_source_url").notNull(),
    applyUrl: text("apply_url"),

    title: text("title").notNull(),
    companyName: text("company_name").notNull(),
    location: text("location"),
    city: text("city"),
    region: text("region"),
    country: text("country").notNull().default("Australia"),

    postedAt: timestamp("posted_at"),
    expiresAt: timestamp("expires_at"),
    employmentType: text("employment_type"),
    workplaceType: text("workplace_type"),
    seniority: text("seniority"),

    descriptionText: text("description_text"),
    descriptionHtml: text("description_html"),

    rawItem: text("raw_item", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),

    // Hash stable content only: title, company, location, apply URL, posted date,
    // and description. Exclude scrape time, LinkedIn tracking params, and
    // applicant count.
    contentHash: text("content_hash").notNull(),

    firstSeenRunId: text("first_seen_run_id").references(() => jobRuns.id),
    lastSeenRunId: text("last_seen_run_id").references(() => jobRuns.id),
    firstSeenAt: timestamp("first_seen_at")
      .notNull()
      .$defaultFn(now),
    lastSeenAt: timestamp("last_seen_at")
      .notNull()
      .$defaultFn(now),
    lastChangedAt: timestamp("last_changed_at"),

    processingStatus: text("processing_status", { enum: processingStatuses })
      .notNull()
      .default("unprocessed"),
    processingError: text("processing_error"),
    processedAt: timestamp("processed_at"),

    fitScore: integer("fit_score"),
    fitLabel: text("fit_label", { enum: fitLabels }),
    fitRationale: text("fit_rationale"),
    fitStrengths: text("fit_strengths", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    fitGaps: text("fit_gaps", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    assessedAt: timestamp("assessed_at"),

    emailedAt: timestamp("emailed_at"),
    emailSubject: text("email_subject"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    // Primary Phase 1 dedupe rule.
    sourceJobUnique: uniqueIndex("job_listings_source_job_unique").on(
      table.sourceKey,
      table.sourceJobId,
    ),
    // Fallback guard for sources where IDs are missing or unstable.
    sourceUrlUnique: uniqueIndex("job_listings_source_url_unique").on(
      table.sourceKey,
      table.normalizedSourceUrl,
    ),
    processingIdx: index("job_listings_processing_idx").on(table.processingStatus),
    sourceLastSeenIdx: index("job_listings_source_last_seen_idx").on(
      table.sourceKey,
      table.lastSeenAt,
    ),
    companyIdx: index("job_listings_company_idx").on(table.companyName),
  }),
);

export type JobRun = typeof jobRuns.$inferSelect;
export type NewJobRun = typeof jobRuns.$inferInsert;
export type JobListing = typeof jobListings.$inferSelect;
export type NewJobListing = typeof jobListings.$inferInsert;
