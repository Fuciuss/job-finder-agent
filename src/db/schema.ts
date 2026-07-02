import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/*
 * Phase 1 design:
 *
 * The only dedupe problem this version solves is "do not process the same
 * listing from the same source more than once." We are deliberately not trying
 * to prove that a LinkedIn listing and an AI Jobs Australia listing are the same
 * real-world role yet.
 *
 * The stable identity for a listing is:
 *
 *   source_id + source_job_id
 *
 * Examples:
 * - linkedin_jobs + 4423994610
 * - aijobs_australia + 60abacdb-1a29-4288-8485-e59a5cbecbf5
 *
 * Re-seeing the same listing should update last_seen_at and create run history,
 * but it should not trigger another assessment or another email.
 */

export const jobRunStatuses = ["running", "succeeded", "failed"] as const;
export const jobListingStatuses = ["active", "ignored", "stale", "closed"] as const;
export const processingStatuses = ["unprocessed", "processing", "processed", "failed", "skipped"] as const;
export const assessmentLabels = [
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

// Source definitions, not individual runs. Usually one row for LinkedIn Jobs
// and one row for AI Jobs Australia.
export const jobSources = sqliteTable("job_sources", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  createdAt: createdAt(),
});

// A single scrape/search execution. This is useful for auditability and for
// knowing which query/payload produced a listing on a given day.
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => jobSources.id),

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
    newListingCount: integer("new_listing_count"),
    changedListingCount: integer("changed_listing_count"),
    unchangedListingCount: integer("unchanged_listing_count"),

    error: text("error"),
  },
  (table) => ({
    sourceStartedIdx: index("job_runs_source_started_idx").on(table.sourceId, table.startedAt),
  }),
);

// The main dedupe table. Each row is one source-specific listing, not a
// cross-source canonical job.
export const jobListings = sqliteTable(
  "job_listings",
  {
    id: id(),

    sourceId: text("source_id")
      .notNull()
      .references(() => jobSources.id),

    // Must be stable per source. For LinkedIn this is the numeric job ID; for
    // AI Jobs Australia this is the source UUID. If a future source lacks an ID,
    // derive one from a normalized source URL hash before inserting.
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

    latestRaw: text("latest_raw", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    // Hash of stable listing content. Do not include volatile fields like scrape
    // time, LinkedIn tracking params, or applicant count.
    latestContentHash: text("latest_content_hash").notNull(),

    status: text("status", { enum: jobListingStatuses }).notNull().default("active"),
    // This is the Phase 1 processing gate. Only unprocessed listings should be
    // assessed and considered for email.
    processingStatus: text("processing_status", { enum: processingStatuses })
      .notNull()
      .default("unprocessed"),
    processedAt: timestamp("processed_at"),
    processingError: text("processing_error"),

    firstSeenAt: timestamp("first_seen_at")
      .notNull()
      .$defaultFn(now),
    lastSeenAt: timestamp("last_seen_at")
      .notNull()
      .$defaultFn(now),
    lastChangedAt: timestamp("last_changed_at"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    // Primary source-local dedupe rule.
    sourceJobUnique: uniqueIndex("job_listings_source_job_unique").on(
      table.sourceId,
      table.sourceJobId,
    ),
    // Secondary guard for sources where IDs are missing or change unexpectedly.
    sourceUrlUnique: uniqueIndex("job_listings_source_url_unique").on(
      table.sourceId,
      table.normalizedSourceUrl,
    ),
    sourceLastSeenIdx: index("job_listings_source_last_seen_idx").on(
      table.sourceId,
      table.lastSeenAt,
    ),
    processingIdx: index("job_listings_processing_idx").on(table.processingStatus),
    companyIdx: index("job_listings_company_idx").on(table.companyName),
  }),
);

// Run history join table. This records that an existing listing appeared in a
// specific run without duplicating the listing itself.
export const jobRunListings = sqliteTable(
  "job_run_listings",
  {
    id: id(),

    runId: text("run_id")
      .notNull()
      .references(() => jobRuns.id),
    listingId: text("listing_id")
      .notNull()
      .references(() => jobListings.id),

    observedAt: timestamp("observed_at")
      .notNull()
      .$defaultFn(now),
    inputUrl: text("input_url").notNull().default(""),
    matchedQuery: text("matched_query"),

    contentHash: text("content_hash").notNull(),
    rawItem: text("raw_item", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),

    // These flags make daily reporting cheap without needing to compare the
    // current run to every previous run again.
    isFirstSeen: integer("is_first_seen", { mode: "boolean" }).notNull().default(false),
    isContentChanged: integer("is_content_changed", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => ({
    runListingInputUnique: uniqueIndex("job_run_listings_run_listing_input_unique").on(
      table.runId,
      table.listingId,
      table.inputUrl,
    ),
    listingObservedIdx: index("job_run_listings_listing_observed_idx").on(
      table.listingId,
      table.observedAt,
    ),
  }),
);

// Assessment output for one source listing. Keeping resume/goals/scoring
// versions in the uniqueness key lets us reassess later without overwriting old
// decisions.
export const jobAssessments = sqliteTable(
  "job_assessments",
  {
    id: id(),

    listingId: text("listing_id")
      .notNull()
      .references(() => jobListings.id),

    assessmentVersion: text("assessment_version").notNull(),
    resumeVersion: text("resume_version").notNull().default(""),
    goalsVersion: text("goals_version").notNull().default(""),

    fitScore: integer("fit_score"),
    label: text("label", { enum: assessmentLabels }),

    rationale: text("rationale"),
    strengths: text("strengths", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    gaps: text("gaps", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    evidence: text("evidence", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),

    createdAt: createdAt(),
  },
  (table) => ({
    assessmentUnique: uniqueIndex("job_assessments_unique").on(
      table.listingId,
      table.assessmentVersion,
      table.resumeVersion,
      table.goalsVersion,
    ),
    listingIdx: index("job_assessments_listing_idx").on(table.listingId),
  }),
);

// Email sends are stored separately from assessments so the app can know what
// has already been delivered.
export const emailBatches = sqliteTable("email_batches", {
  id: id(),
  subject: text("subject").notNull(),
  sentAt: timestamp("sent_at"),
  createdAt: createdAt(),
});

// Phase 1 makes listing_id globally unique in email items, which means one
// source listing can only be emailed once. If later we want reminder emails,
// loosen this constraint.
export const emailBatchItems = sqliteTable(
  "email_batch_items",
  {
    id: id(),

    emailBatchId: text("email_batch_id")
      .notNull()
      .references(() => emailBatches.id),
    listingId: text("listing_id")
      .notNull()
      .references(() => jobListings.id),
    assessmentId: text("assessment_id").references(() => jobAssessments.id),
  },
  (table) => ({
    batchListingUnique: uniqueIndex("email_batch_items_batch_listing_unique").on(
      table.emailBatchId,
      table.listingId,
    ),
    listingUnique: uniqueIndex("email_batch_items_listing_unique").on(table.listingId),
  }),
);

export const jobSourcesRelations = relations(jobSources, ({ many }) => ({
  runs: many(jobRuns),
  listings: many(jobListings),
}));

export const jobRunsRelations = relations(jobRuns, ({ one, many }) => ({
  source: one(jobSources, {
    fields: [jobRuns.sourceId],
    references: [jobSources.id],
  }),
  runListings: many(jobRunListings),
}));

export const jobListingsRelations = relations(jobListings, ({ one, many }) => ({
  source: one(jobSources, {
    fields: [jobListings.sourceId],
    references: [jobSources.id],
  }),
  runListings: many(jobRunListings),
  assessments: many(jobAssessments),
  emailItems: many(emailBatchItems),
}));

export const jobRunListingsRelations = relations(jobRunListings, ({ one }) => ({
  run: one(jobRuns, {
    fields: [jobRunListings.runId],
    references: [jobRuns.id],
  }),
  listing: one(jobListings, {
    fields: [jobRunListings.listingId],
    references: [jobListings.id],
  }),
}));

export const jobAssessmentsRelations = relations(jobAssessments, ({ one, many }) => ({
  listing: one(jobListings, {
    fields: [jobAssessments.listingId],
    references: [jobListings.id],
  }),
  emailItems: many(emailBatchItems),
}));

export const emailBatchesRelations = relations(emailBatches, ({ many }) => ({
  items: many(emailBatchItems),
}));

export const emailBatchItemsRelations = relations(emailBatchItems, ({ one }) => ({
  batch: one(emailBatches, {
    fields: [emailBatchItems.emailBatchId],
    references: [emailBatches.id],
  }),
  listing: one(jobListings, {
    fields: [emailBatchItems.listingId],
    references: [jobListings.id],
  }),
  assessment: one(jobAssessments, {
    fields: [emailBatchItems.assessmentId],
    references: [jobAssessments.id],
  }),
}));

export type JobSource = typeof jobSources.$inferSelect;
export type NewJobSource = typeof jobSources.$inferInsert;
export type JobRun = typeof jobRuns.$inferSelect;
export type NewJobRun = typeof jobRuns.$inferInsert;
export type JobListing = typeof jobListings.$inferSelect;
export type NewJobListing = typeof jobListings.$inferInsert;
export type JobRunListing = typeof jobRunListings.$inferSelect;
export type NewJobRunListing = typeof jobRunListings.$inferInsert;
export type JobAssessment = typeof jobAssessments.$inferSelect;
export type NewJobAssessment = typeof jobAssessments.$inferInsert;
export type EmailBatch = typeof emailBatches.$inferSelect;
export type NewEmailBatch = typeof emailBatches.$inferInsert;
export type EmailBatchItem = typeof emailBatchItems.$inferSelect;
export type NewEmailBatchItem = typeof emailBatchItems.$inferInsert;
