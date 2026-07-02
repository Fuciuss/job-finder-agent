import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

export const jobSources = sqliteTable("job_sources", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  baseUrl: text("base_url"),
  createdAt: createdAt(),
});

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

export const jobListings = sqliteTable(
  "job_listings",
  {
    id: id(),

    sourceId: text("source_id")
      .notNull()
      .references(() => jobSources.id),

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
    latestContentHash: text("latest_content_hash").notNull(),

    status: text("status", { enum: jobListingStatuses }).notNull().default("active"),
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
    sourceJobUnique: uniqueIndex("job_listings_source_job_unique").on(
      table.sourceId,
      table.sourceJobId,
    ),
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

export const emailBatches = sqliteTable("email_batches", {
  id: id(),
  subject: text("subject").notNull(),
  sentAt: timestamp("sent_at"),
  createdAt: createdAt(),
});

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
