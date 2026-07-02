import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "../db/schema.js";
import {
  computeAiJobsAustraliaListing,
  computeLinkedInListing,
  decideListingChange,
  type ListingComputeResult,
  type RawJobItem,
} from "./compute.js";

type JobDatabase = DrizzleD1Database<typeof schema>;

export type CreateJobRunInput = {
  sourceKey: string;
  purpose: string;
  location?: string | null;
  queryPayload: Record<string, unknown>;
  rawArtifactPath?: string | null;
};

export type JobRunHandle = {
  id: string;
  startedAt: Date;
};

export type IngestListingResult = {
  kind: "new" | "unchanged" | "changed";
  listingId: string;
  sourceKey: string;
  sourceJobId: string;
};

export type IngestBatchResult = {
  total: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  items: IngestListingResult[];
};

export async function createJobRun(
  db: JobDatabase,
  input: CreateJobRunInput,
  startedAt = new Date(),
): Promise<JobRunHandle> {
  const id = crypto.randomUUID();

  await db.insert(schema.jobRuns).values({
    id,
    sourceKey: input.sourceKey,
    purpose: input.purpose,
    location: input.location ?? null,
    queryPayload: input.queryPayload,
    rawArtifactPath: input.rawArtifactPath ?? null,
    startedAt,
    status: "running",
  });

  return { id, startedAt };
}

export async function finishJobRun(
  db: JobDatabase,
  runId: string,
  result:
    | {
        status: "succeeded";
        rawCount: number;
        filteredCount?: number | null;
        newCount: number;
        changedCount: number;
        unchangedCount: number;
      }
    | {
        status: "failed";
        error: string;
      },
  finishedAt = new Date(),
): Promise<void> {
  if (result.status === "failed") {
    await db
      .update(schema.jobRuns)
      .set({
        status: "failed",
        error: result.error,
        finishedAt,
      })
      .where(eq(schema.jobRuns.id, runId));
    return;
  }

  await db
    .update(schema.jobRuns)
    .set({
      status: "succeeded",
      rawCount: result.rawCount,
      filteredCount: result.filteredCount ?? null,
      newCount: result.newCount,
      changedCount: result.changedCount,
      unchangedCount: result.unchangedCount,
      finishedAt,
    })
    .where(eq(schema.jobRuns.id, runId));
}

export async function ingestAiJobsAustraliaItems(
  db: JobDatabase,
  runId: string,
  items: RawJobItem[],
  seenAt = new Date(),
): Promise<IngestBatchResult> {
  const computed = await Promise.all(
    items.map((item) => computeAiJobsAustraliaListing(item, runId, seenAt)),
  );
  return ingestComputedListings(db, computed, seenAt);
}

export async function ingestLinkedInItems(
  db: JobDatabase,
  runId: string,
  items: RawJobItem[],
  seenAt = new Date(),
): Promise<IngestBatchResult> {
  const computed = await Promise.all(
    items.map((item) => computeLinkedInListing(item, runId, seenAt)),
  );
  return ingestComputedListings(db, computed, seenAt);
}

export async function ingestComputedListings(
  db: JobDatabase,
  listings: ListingComputeResult[],
  seenAt = new Date(),
): Promise<IngestBatchResult> {
  const items: IngestListingResult[] = [];
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  for (const listing of listings) {
    const result = await ingestComputedListing(db, listing, seenAt);
    items.push(result);

    if (result.kind === "new") newCount += 1;
    if (result.kind === "changed") changedCount += 1;
    if (result.kind === "unchanged") unchangedCount += 1;
  }

  return {
    total: listings.length,
    newCount,
    changedCount,
    unchangedCount,
    items,
  };
}

export async function ingestComputedListing(
  db: JobDatabase,
  result: ListingComputeResult,
  seenAt = new Date(),
): Promise<IngestListingResult> {
  const [existing] = await db
    .select({
      id: schema.jobListings.id,
      contentHash: schema.jobListings.contentHash,
    })
    .from(schema.jobListings)
    .where(
      and(
        eq(schema.jobListings.sourceKey, result.identity.sourceKey),
        eq(schema.jobListings.sourceJobId, result.identity.sourceJobId),
      ),
    )
    .limit(1);

  const decision = decideListingChange(result.listing, existing ?? null, seenAt);

  if (decision.kind === "new") {
    const listingId = crypto.randomUUID();
    await db.insert(schema.jobListings).values({
      id: listingId,
      ...decision.listing,
    });

    return {
      kind: "new",
      listingId,
      sourceKey: result.identity.sourceKey,
      sourceJobId: result.identity.sourceJobId,
    };
  }

  await db
    .update(schema.jobListings)
    .set(decision.updates)
    .where(eq(schema.jobListings.id, decision.listingId));

  return {
    kind: decision.kind,
    listingId: decision.listingId,
    sourceKey: result.identity.sourceKey,
    sourceJobId: result.identity.sourceJobId,
  };
}
