import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { renderAdminErrorPage, renderAdminPage, type AdminStatusData } from "./admin/page.js";
import { createDatabase, type AppEnv } from "./db/client.js";
import * as schema from "./db/schema.js";
import { sendJobDigest, type SendJobDigestResult } from "./email/digest.js";
import { sendFailureEmail, type SendFailureEmailResult } from "./email/errors.js";
import { sendEmail } from "./email/resend.js";
import { assessUnprocessedListings, type AssessUnprocessedListingsResult } from "./jobs/assess.js";
import { sourceKeys } from "./jobs/compute.js";
import {
  createJobRun,
  finishJobRun,
  ingestAiJobsAustraliaItems,
  ingestLinkedInItems,
  type IngestBatchResult,
} from "./jobs/ingest.js";
import {
  aiJobsAustraliaQueryPayload,
  fetchAiJobsAustraliaApprovedJobs,
} from "./sources/aijobs-australia.js";
import {
  DEFAULT_LINKEDIN_QUERIES,
  DEFAULT_LINKEDIN_LOCATIONS,
  fetchLinkedInJobsForLocation,
  linkedInCityQueryPayload,
} from "./sources/linkedin.js";

type AppDatabase = DrizzleD1Database<typeof schema>;

const SERVICE_NAME = "job-finder-agent";
const QUEUE_BINDING_NAME = "JOB_FINDER_QUEUE" as const;
const STALE_RUNNING_RUN_MINUTES = 5;
const LINKEDIN_JOBS_PER_QUERY = 25;

type DailyJobMonitorTrigger = "cron" | "manual";

type DailyJobMonitorQueueMessage = {
  type: "run_daily_job_monitor";
  trigger: DailyJobMonitorTrigger;
  jobRequestId: string;
  requestedAt: string;
  scheduledTime?: number;
  adminUrl?: string;
};

type Env = AppEnv & {
  JOB_FINDER_QUEUE?: Queue<DailyJobMonitorQueueMessage>;
};

type SourceRunSummary = {
  ok: boolean;
  sourceKey: string;
  purpose: string;
  location: string | null;
  runId: string;
  rawCount?: number;
  filteredCount?: number;
  newCount?: number;
  changedCount?: number;
  unchangedCount?: number;
  error?: string;
};

type DailyJobMonitorResult = {
  ok: boolean;
  status: "completed" | "completed_with_errors";
  trigger: DailyJobMonitorTrigger;
  startedAt: string;
  scheduledTime?: string;
  sourceRuns: SourceRunSummary[];
  assessment?: AssessUnprocessedListingsResult;
  assessmentError?: string;
  emailDigest?: SendJobDigestResult;
  emailDigestError?: string;
  failureEmail?: SendFailureEmailResult;
  failureEmailError?: string;
  message: string;
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers,
  });
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "text/html; charset=utf-8");

  return new Response(body, {
    ...init,
    headers,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logInfo(event: string, fields: Record<string, unknown> = {}): void {
  console.log({
    level: "info",
    service: SERVICE_NAME,
    event,
    ...fields,
  });
}

function logError(event: string, fields: Record<string, unknown> = {}): void {
  console.error({
    level: "error",
    service: SERVICE_NAME,
    event,
    ...fields,
  });
}

async function runDailyJobMonitor(
  env: Env,
  input: {
    trigger: DailyJobMonitorTrigger;
    scheduledTime?: number;
    adminUrl?: string;
  },
): Promise<DailyJobMonitorResult> {
  const db = createDatabase(env);
  const startedAt = new Date();
  const scheduledTime = input.scheduledTime
    ? new Date(input.scheduledTime).toISOString()
    : undefined;
  const startedMs = Date.now();

  logInfo("daily_job_monitor_started", {
    trigger: input.trigger,
    startedAt: startedAt.toISOString(),
    scheduledTime,
  });

  await failStaleRunningRuns(db, STALE_RUNNING_RUN_MINUTES);

  const sourceRuns: SourceRunSummary[] = [];
  sourceRuns.push(await runAiJobsAustralia(db, env));

  for (const location of DEFAULT_LINKEDIN_LOCATIONS) {
    sourceRuns.push(await runLinkedInCity(db, env, location));
  }

  let assessment: AssessUnprocessedListingsResult | undefined;
  let assessmentError: string | undefined;

  try {
    assessment = await assessUnprocessedListings(db, {
      openRouter: {
        apiKey: env.JOB_FINDER_OPENROUTER_API_KEY,
        model: env.JOB_FINDER_OPENROUTER_MODEL,
        maxAssessments: parseOptionalInteger(env.JOB_FINDER_OPENROUTER_MAX_ASSESSMENTS),
        minDeterministicScore: parseOptionalInteger(env.JOB_FINDER_OPENROUTER_MIN_RULE_SCORE),
      },
    });
    logInfo("job_assessment_completed", {
      assessedCount: assessment.assessedCount,
      llmAssessedCount: assessment.llmAssessedCount,
      llmSkippedCount: assessment.llmSkippedCount,
      llmErrorCount: assessment.llmErrorCount,
      labels: assessment.labels,
    });
  } catch (error) {
    assessmentError = errorMessage(error);
    logError("job_assessment_failed", { error: assessmentError });
  }

  let emailDigest: SendJobDigestResult | undefined;
  let emailDigestError: string | undefined;

  if (!assessmentError) {
    try {
      emailDigest = await sendJobDigest(db, env, {
        maxItems: parseOptionalInteger(env.JOB_FINDER_DIGEST_MAX_ITEMS),
        adminUrl: input.adminUrl ?? env.JOB_FINDER_ADMIN_URL,
        sourceSummary: {
          sourceRunCount: sourceRuns.length,
          jobSearchQueryCount: countJobSearchQueries(sourceRuns),
          llmAssessmentCount: assessment?.llmAssessedCount ?? 0,
          newCount: sumSourceRuns(sourceRuns, "newCount"),
          changedCount: sumSourceRuns(sourceRuns, "changedCount"),
          failedSourceRunCount: sourceRuns.filter((runResult) => !runResult.ok).length,
        },
      });
      logInfo("job_digest_completed", emailDigest);
    } catch (error) {
      emailDigestError = errorMessage(error);
      logError("job_digest_failed", { error: emailDigestError });
    }
  }

  const ok =
    sourceRuns.every((runResult) => runResult.ok) && !assessmentError && !emailDigestError;
  const result: DailyJobMonitorResult = {
    ok,
    status: ok ? "completed" : "completed_with_errors",
    trigger: input.trigger,
    startedAt: startedAt.toISOString(),
    scheduledTime,
    sourceRuns,
    assessment,
    assessmentError,
    emailDigest,
    emailDigestError,
    message: ok
      ? "Daily job monitor completed."
      : "Daily job monitor completed with one or more source, assessment, or email errors.",
  };

  if (!result.ok) {
    const notification = await sendFailureNotification(env, {
      trigger: result.trigger,
      status: result.status,
      startedAt: result.startedAt,
      scheduledTime: result.scheduledTime,
      finishedAt: new Date().toISOString(),
      sourceRuns: result.sourceRuns,
      assessmentError: result.assessmentError,
      emailDigestError: result.emailDigestError,
      message: result.message,
    });
    result.failureEmail = notification.failureEmail;
    result.failureEmailError = notification.failureEmailError;
  }

  logInfo("daily_job_monitor_completed", {
    ok: result.ok,
    status: result.status,
    trigger: result.trigger,
    durationMs: Date.now() - startedMs,
    sourceRunCount: sourceRuns.length,
    failedSourceRunCount: sourceRuns.filter((runResult) => !runResult.ok).length,
    newCount: sumSourceRuns(sourceRuns, "newCount"),
    changedCount: sumSourceRuns(sourceRuns, "changedCount"),
    unchangedCount: sumSourceRuns(sourceRuns, "unchangedCount"),
    jobSearchQueryCount: countJobSearchQueries(sourceRuns),
    assessedCount: assessment?.assessedCount ?? 0,
    llmAssessmentCount: assessment?.llmAssessedCount ?? 0,
    digestStatus: emailDigest?.status,
    digestItemCount: emailDigest?.itemCount ?? 0,
    failureEmailStatus: result.failureEmail?.status,
    failureEmailError: result.failureEmailError,
  });

  return result;
}

async function enqueueDailyJobMonitor(
  env: Env,
  input: {
    trigger: DailyJobMonitorTrigger;
    scheduledTime?: number;
    adminUrl?: string;
  },
): Promise<{
  ok: true;
  status: "queued";
  queueBinding: typeof QUEUE_BINDING_NAME;
  trigger: DailyJobMonitorTrigger;
  jobRequestId: string;
  requestedAt: string;
  scheduledTime?: string;
  backlogCount: number;
}> {
  const queue = getJobFinderQueue(env);
  const message: DailyJobMonitorQueueMessage = {
    type: "run_daily_job_monitor",
    trigger: input.trigger,
    jobRequestId: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
    scheduledTime: input.scheduledTime,
    adminUrl: input.adminUrl,
  };
  const sent = await queue.send(message, { contentType: "json" });

  const result = {
    ok: true as const,
    status: "queued" as const,
    queueBinding: QUEUE_BINDING_NAME,
    trigger: message.trigger,
    jobRequestId: message.jobRequestId,
    requestedAt: message.requestedAt,
    scheduledTime: message.scheduledTime ? new Date(message.scheduledTime).toISOString() : undefined,
    backlogCount: sent.metadata.metrics.backlogCount,
  };

  logInfo("daily_job_monitor_enqueued", result);

  return result;
}

async function processDailyJobMonitorQueueMessage(
  message: Message<DailyJobMonitorQueueMessage>,
  env: Env,
): Promise<void> {
  if (!isDailyJobMonitorQueueMessage(message.body)) {
    logError("daily_job_monitor_queue_invalid_message", {
      queueMessageId: message.id,
      attempts: message.attempts,
      body: message.body,
    });
    message.ack();
    return;
  }

  const body = message.body;
  logInfo("daily_job_monitor_queue_started", {
    queueMessageId: message.id,
    attempts: message.attempts,
    trigger: body.trigger,
    jobRequestId: body.jobRequestId,
    requestedAt: body.requestedAt,
    scheduledTime: body.scheduledTime ? new Date(body.scheduledTime).toISOString() : undefined,
  });

  try {
    const result = await runDailyJobMonitor(env, {
      trigger: body.trigger,
      scheduledTime: body.scheduledTime,
      adminUrl: body.adminUrl,
    });
    message.ack();
    logInfo("daily_job_monitor_queue_completed", {
      queueMessageId: message.id,
      attempts: message.attempts,
      trigger: body.trigger,
      jobRequestId: body.jobRequestId,
      ok: result.ok,
      status: result.status,
    });
  } catch (error) {
    const messageText = errorMessage(error);
    logError("daily_job_monitor_queue_failed", {
      queueMessageId: message.id,
      attempts: message.attempts,
      trigger: body.trigger,
      jobRequestId: body.jobRequestId,
      error: messageText,
    });
    await sendFailureNotification(env, {
      trigger: body.trigger,
      status: "failed",
      scheduledTime: body.scheduledTime ? new Date(body.scheduledTime).toISOString() : undefined,
      finishedAt: new Date().toISOString(),
      hardError: messageText,
      message: "Queued daily job monitor failed before it could return a normal result.",
    });
    message.ack();
  }
}

function getJobFinderQueue(env: Env): Queue<DailyJobMonitorQueueMessage> {
  if (!env.JOB_FINDER_QUEUE) {
    throw new Error(`${QUEUE_BINDING_NAME} queue binding is not configured.`);
  }

  return env.JOB_FINDER_QUEUE;
}

function isDailyJobMonitorQueueMessage(value: unknown): value is DailyJobMonitorQueueMessage {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<DailyJobMonitorQueueMessage>;
  return (
    candidate.type === "run_daily_job_monitor" &&
    (candidate.trigger === "manual" || candidate.trigger === "cron") &&
    typeof candidate.jobRequestId === "string" &&
    typeof candidate.requestedAt === "string" &&
    (candidate.scheduledTime === undefined || typeof candidate.scheduledTime === "number") &&
    (candidate.adminUrl === undefined || typeof candidate.adminUrl === "string")
  );
}

async function failStaleRunningRuns(db: AppDatabase, staleAfterMinutes: number): Promise<void> {
  const cutoff = new Date(Date.now() - staleAfterMinutes * 60 * 1000);
  const staleRuns = await db
    .select({
      id: schema.jobRuns.id,
      sourceKey: schema.jobRuns.sourceKey,
      purpose: schema.jobRuns.purpose,
      location: schema.jobRuns.location,
      startedAt: schema.jobRuns.startedAt,
    })
    .from(schema.jobRuns)
    .where(and(eq(schema.jobRuns.status, "running"), lt(schema.jobRuns.startedAt, cutoff)))
    .limit(20);

  if (staleRuns.length === 0) return;

  const error = `Marked failed because run was still running after ${staleAfterMinutes} minutes. The Worker invocation was likely canceled before finalization.`;

  for (const run of staleRuns) {
    await finishJobRun(db, run.id, { status: "failed", error });
  }

  logError("stale_running_job_runs_failed", {
    staleAfterMinutes,
    count: staleRuns.length,
    runIds: staleRuns.map((run) => run.id),
  });
}

async function sendFailureNotification(
  env: Env,
  input: Parameters<typeof sendFailureEmail>[1],
): Promise<{
  failureEmail?: SendFailureEmailResult;
  failureEmailError?: string;
}> {
  try {
    const failureEmail = await sendFailureEmail(env, input);
    logInfo("failure_email_completed", {
      status: failureEmail.status,
      reason: failureEmail.reason,
      subject: failureEmail.subject,
      messageId: failureEmail.messageId,
    });
    return { failureEmail };
  } catch (error) {
    const failureEmailError = errorMessage(error);
    logError("failure_email_failed", { error: failureEmailError });
    return { failureEmailError };
  }
}

async function runAiJobsAustralia(db: AppDatabase, env: Env): Promise<SourceRunSummary> {
  const purpose = "daily-aijobs-australia";
  const location = "Australia";
  const run = await createJobRun(db, {
    sourceKey: sourceKeys.aiJobsAustralia,
    purpose,
    location,
    queryPayload: aiJobsAustraliaQueryPayload(env),
  });
  logInfo("source_run_started", {
    sourceKey: sourceKeys.aiJobsAustralia,
    purpose,
    location,
    runId: run.id,
  });

  try {
    const fetched = await fetchAiJobsAustraliaApprovedJobs(env);
    await db
      .update(schema.jobRuns)
      .set({ queryPayload: fetched.queryPayload })
      .where(eq(schema.jobRuns.id, run.id));

    const ingest = await ingestAiJobsAustraliaItems(db, run.id, fetched.items);
    await finishSuccessfulRun(db, run.id, fetched.rawCount, ingest);

    const summary = sourceRunSummary({
      ok: true,
      sourceKey: sourceKeys.aiJobsAustralia,
      purpose,
      location,
      runId: run.id,
      rawCount: fetched.rawCount,
      ingest,
    });
    logInfo("source_run_completed", summary);

    return summary;
  } catch (error) {
    const message = errorMessage(error);
    await finishJobRun(db, run.id, { status: "failed", error: message });
    logError("source_run_failed", {
      sourceKey: sourceKeys.aiJobsAustralia,
      purpose,
      location,
      runId: run.id,
      error: message,
    });
    return {
      ok: false,
      sourceKey: sourceKeys.aiJobsAustralia,
      purpose,
      location,
      runId: run.id,
      error: message,
    };
  }
}

async function runLinkedInCity(
  db: AppDatabase,
  env: Env,
  location: string,
): Promise<SourceRunSummary> {
  const purpose = `daily-linkedin-${locationSlug(location)}`;
  const queryPayload = linkedInCityQueryPayload({ location, count: LINKEDIN_JOBS_PER_QUERY });
  const run = await createJobRun(db, {
    sourceKey: sourceKeys.linkedInJobs,
    purpose,
    location,
    queryPayload,
  });
  logInfo("source_run_started", {
    sourceKey: sourceKeys.linkedInJobs,
    purpose,
    location,
    runId: run.id,
  });

  try {
    const fetched = await fetchLinkedInJobsForLocation(env, {
      location,
      count: LINKEDIN_JOBS_PER_QUERY,
    });
    const ingest = await ingestLinkedInItems(db, run.id, fetched.items);
    await finishSuccessfulRun(db, run.id, fetched.rawCount, ingest);

    const summary = sourceRunSummary({
      ok: true,
      sourceKey: sourceKeys.linkedInJobs,
      purpose,
      location,
      runId: run.id,
      rawCount: fetched.rawCount,
      ingest,
    });
    logInfo("source_run_completed", summary);

    return summary;
  } catch (error) {
    const message = errorMessage(error);
    await finishJobRun(db, run.id, { status: "failed", error: message });
    logError("source_run_failed", {
      sourceKey: sourceKeys.linkedInJobs,
      purpose,
      location,
      runId: run.id,
      error: message,
    });
    return {
      ok: false,
      sourceKey: sourceKeys.linkedInJobs,
      purpose,
      location,
      runId: run.id,
      error: message,
    };
  }
}

async function finishSuccessfulRun(
  db: AppDatabase,
  runId: string,
  rawCount: number,
  ingest: IngestBatchResult,
): Promise<void> {
  await finishJobRun(db, runId, {
    status: "succeeded",
    rawCount,
    filteredCount: ingest.total,
    newCount: ingest.newCount,
    changedCount: ingest.changedCount,
    unchangedCount: ingest.unchangedCount,
  });
}

function sourceRunSummary(input: {
  ok: true;
  sourceKey: string;
  purpose: string;
  location: string | null;
  runId: string;
  rawCount: number;
  ingest: IngestBatchResult;
}): SourceRunSummary {
  return {
    ok: input.ok,
    sourceKey: input.sourceKey,
    purpose: input.purpose,
    location: input.location,
    runId: input.runId,
    rawCount: input.rawCount,
    filteredCount: input.ingest.total,
    newCount: input.ingest.newCount,
    changedCount: input.ingest.changedCount,
    unchangedCount: input.ingest.unchangedCount,
  };
}

function sumSourceRuns(sourceRuns: SourceRunSummary[], key: keyof SourceRunSummary): number {
  return sourceRuns.reduce((total, run) => {
    const value = run[key];
    return typeof value === "number" ? total + value : total;
  }, 0);
}

function countJobSearchQueries(sourceRuns: SourceRunSummary[]): number {
  return sourceRuns.reduce((total, run) => {
    if (run.sourceKey === sourceKeys.aiJobsAustralia) return total + 1;
    if (run.sourceKey === sourceKeys.linkedInJobs) return total + DEFAULT_LINKEDIN_QUERIES.length;
    return total;
  }, 0);
}

function locationSlug(location: string): string {
  return location.split(",")[0]?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown";
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function loadAdminStatus(env: Env): Promise<AdminStatusData> {
  const db = createDatabase(env);

  const [lastRun] = await db
    .select({
      id: schema.jobRuns.id,
      sourceKey: schema.jobRuns.sourceKey,
      purpose: schema.jobRuns.purpose,
      location: schema.jobRuns.location,
      status: schema.jobRuns.status,
      startedAt: schema.jobRuns.startedAt,
      finishedAt: schema.jobRuns.finishedAt,
      rawCount: schema.jobRuns.rawCount,
      filteredCount: schema.jobRuns.filteredCount,
      newCount: schema.jobRuns.newCount,
      changedCount: schema.jobRuns.changedCount,
      unchangedCount: schema.jobRuns.unchangedCount,
      error: schema.jobRuns.error,
    })
    .from(schema.jobRuns)
    .orderBy(desc(schema.jobRuns.startedAt))
    .limit(1);

  const recentRuns = await db
    .select({
      id: schema.jobRuns.id,
      sourceKey: schema.jobRuns.sourceKey,
      purpose: schema.jobRuns.purpose,
      location: schema.jobRuns.location,
      status: schema.jobRuns.status,
      startedAt: schema.jobRuns.startedAt,
      finishedAt: schema.jobRuns.finishedAt,
      rawCount: schema.jobRuns.rawCount,
      filteredCount: schema.jobRuns.filteredCount,
      newCount: schema.jobRuns.newCount,
      changedCount: schema.jobRuns.changedCount,
      unchangedCount: schema.jobRuns.unchangedCount,
      error: schema.jobRuns.error,
    })
    .from(schema.jobRuns)
    .orderBy(desc(schema.jobRuns.startedAt))
    .limit(12);

  const failedRuns = await db
    .select({
      id: schema.jobRuns.id,
      sourceKey: schema.jobRuns.sourceKey,
      purpose: schema.jobRuns.purpose,
      location: schema.jobRuns.location,
      status: schema.jobRuns.status,
      startedAt: schema.jobRuns.startedAt,
      finishedAt: schema.jobRuns.finishedAt,
      rawCount: schema.jobRuns.rawCount,
      filteredCount: schema.jobRuns.filteredCount,
      newCount: schema.jobRuns.newCount,
      changedCount: schema.jobRuns.changedCount,
      unchangedCount: schema.jobRuns.unchangedCount,
      error: schema.jobRuns.error,
    })
    .from(schema.jobRuns)
    .where(eq(schema.jobRuns.status, "failed"))
    .orderBy(desc(schema.jobRuns.startedAt))
    .limit(5);

  const [listingStats] = await db
    .select({
      total: sql<number>`count(*)`,
      unprocessed: sql<number>`coalesce(sum(case when ${schema.jobListings.processingStatus} = 'unprocessed' then 1 else 0 end), 0)`,
      processed: sql<number>`coalesce(sum(case when ${schema.jobListings.processingStatus} = 'processed' then 1 else 0 end), 0)`,
      failed: sql<number>`coalesce(sum(case when ${schema.jobListings.processingStatus} = 'failed' then 1 else 0 end), 0)`,
      pendingEmail: sql<number>`coalesce(sum(case when ${schema.jobListings.emailedAt} is null then 1 else 0 end), 0)`,
      actionToday: sql<number>`coalesce(sum(case when ${schema.jobListings.fitLabel} = 'action_today' then 1 else 0 end), 0)`,
      verify: sql<number>`coalesce(sum(case when ${schema.jobListings.fitLabel} = 'verify' then 1 else 0 end), 0)`,
      peopleRoute: sql<number>`coalesce(sum(case when ${schema.jobListings.fitLabel} = 'people_route' then 1 else 0 end), 0)`,
      marketIntel: sql<number>`coalesce(sum(case when ${schema.jobListings.fitLabel} = 'market_intel' then 1 else 0 end), 0)`,
      skip: sql<number>`coalesce(sum(case when ${schema.jobListings.fitLabel} = 'skip' then 1 else 0 end), 0)`,
    })
    .from(schema.jobListings);

  const recentListings = await db
    .select({
      id: schema.jobListings.id,
      sourceKey: schema.jobListings.sourceKey,
      sourceUrl: schema.jobListings.sourceUrl,
      title: schema.jobListings.title,
      companyName: schema.jobListings.companyName,
      location: schema.jobListings.location,
      processingStatus: schema.jobListings.processingStatus,
      fitScore: schema.jobListings.fitScore,
      fitLabel: schema.jobListings.fitLabel,
      fitRationale: schema.jobListings.fitRationale,
      firstSeenAt: schema.jobListings.firstSeenAt,
      lastSeenAt: schema.jobListings.lastSeenAt,
      emailedAt: schema.jobListings.emailedAt,
    })
    .from(schema.jobListings)
    .orderBy(desc(schema.jobListings.firstSeenAt))
    .limit(20);

  return {
    ok: true,
    service: "job-finder-agent",
    checkedAt: new Date().toISOString(),
    database: {
      binding: "DB",
      bound: true,
    },
    lastRun: lastRun ?? null,
    listings: listingStats ?? {
      total: 0,
      unprocessed: 0,
      processed: 0,
      failed: 0,
      pendingEmail: 0,
      actionToday: 0,
      verify: 0,
      peopleRoute: 0,
      marketIntel: 0,
      skip: 0,
    },
    recentRuns,
    failedRuns,
    recentListings,
  };
}

async function sendTestEmail(env: Env): Promise<unknown> {
  const sentAt = new Date().toISOString();
  logInfo("test_email_send_started", { provider: "resend" });
  const result = await sendEmail(env, {
    subject: "Job Finder Agent email test",
    text: `Job Finder Agent sent this test email through Resend.\n\nSent at: ${sentAt}`,
    html: `<p>Job Finder Agent sent this test email through Resend.</p><p>Sent at: ${sentAt}</p>`,
  });
  logInfo("test_email_send_completed", {
    provider: "resend",
    messageId: result.id,
    sentAt,
  });

  return {
    ok: true,
    provider: "resend",
    messageId: result.id,
    sentAt,
  };
}

async function sendTestFailureEmail(env: Env): Promise<unknown> {
  const sentAt = new Date().toISOString();
  logInfo("test_failure_email_send_started", { provider: "resend" });
  const result = await sendFailureNotification(env, {
    trigger: "manual-test",
    status: "test",
    startedAt: sentAt,
    finishedAt: sentAt,
    hardError: "This is a test failure notification from Job Finder Agent.",
    message: "Testing the error email path. No scrape failed.",
  });
  logInfo("test_failure_email_send_completed", result);

  return {
    ok: !result.failureEmailError,
    provider: "resend",
    sentAt,
    ...result,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "job-finder-agent",
        checkedAt: new Date().toISOString(),
        database: {
          binding: "DB",
          configured: Boolean(env.DB),
        },
      });
    }

    if (url.pathname === "/admin") {
      return Response.redirect(new URL("/admin/", request.url).toString(), 302);
    }

    if (url.pathname === "/admin/") {
      // This route is intentionally protected outside the Worker by Cloudflare
      // Access. Keep /health public and configure /admin/* as the Access boundary.
      try {
        return htmlResponse(renderAdminPage(await loadAdminStatus(env)));
      } catch (error) {
        return htmlResponse(renderAdminErrorPage(errorMessage(error)), { status: 500 });
      }
    }

    if (url.pathname === "/admin/status") {
      // This route is intentionally protected outside the Worker by Cloudflare
      // Access. Keep /health public and configure /admin/* as the Access boundary.
      try {
        return jsonResponse(await loadAdminStatus(env));
      } catch (error) {
        return jsonResponse({ ok: false, error: errorMessage(error) }, { status: 500 });
      }
    }

    if (url.pathname === "/admin/run-now") {
      // This route is intentionally protected outside the Worker by Cloudflare
      // Access. Keep /health public and configure /admin/* as the Access boundary.
      if (request.method !== "POST") {
        return jsonResponse(
          { ok: false, error: "Method not allowed. Use POST." },
          { status: 405, headers: { allow: "POST" } },
        );
      }

      try {
        const result = await enqueueDailyJobMonitor(env, {
          trigger: "manual",
          adminUrl: new URL("/admin", request.url).toString(),
        });
        return jsonResponse(result, { status: 202 });
      } catch (error) {
        const message = errorMessage(error);
        logError("daily_job_monitor_enqueue_failed", { trigger: "manual", error: message });
        return jsonResponse({ ok: false, error: message }, { status: 500 });
      }
    }

    if (url.pathname === "/admin/test-email") {
      // This route is intentionally protected outside the Worker by Cloudflare
      // Access. Keep /health public and configure /admin/* as the Access boundary.
      if (request.method !== "POST") {
        return jsonResponse(
          { ok: false, error: "Method not allowed. Use POST." },
          { status: 405, headers: { allow: "POST" } },
        );
      }

      try {
        return jsonResponse(await sendTestEmail(env));
      } catch (error) {
        const message = errorMessage(error);
        logError("test_email_send_failed", { provider: "resend", error: message });
        return jsonResponse({ ok: false, error: message }, { status: 500 });
      }
    }

    if (url.pathname === "/admin/test-error-email") {
      // This route is intentionally protected outside the Worker by Cloudflare
      // Access. Keep /health public and configure /admin/* as the Access boundary.
      if (request.method !== "POST") {
        return jsonResponse(
          { ok: false, error: "Method not allowed. Use POST." },
          { status: 405, headers: { allow: "POST" } },
        );
      }

      try {
        return jsonResponse(await sendTestFailureEmail(env));
      } catch (error) {
        const message = errorMessage(error);
        logError("test_failure_email_send_failed", { provider: "resend", error: message });
        return jsonResponse({ ok: false, error: message }, { status: 500 });
      }
    }

    return new Response("Hello from Job Finder Agent.\n", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      enqueueDailyJobMonitor(env, {
        trigger: "cron",
        scheduledTime: controller.scheduledTime,
      }).catch(async (error) => {
        const message = errorMessage(error);
        logError("daily_job_monitor_enqueue_failed", { trigger: "cron", error: message });
        await sendFailureNotification(env, {
          trigger: "cron",
          status: "failed",
          scheduledTime: new Date(controller.scheduledTime).toISOString(),
          finishedAt: new Date().toISOString(),
          hardError: message,
          message: "Daily job monitor could not be queued from the cron trigger.",
        });
        throw error;
      }),
    );
  },

  async queue(
    batch: MessageBatch<DailyJobMonitorQueueMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    for (const message of batch.messages) {
      await processDailyJobMonitorQueueMessage(message, env);
    }
  },
} satisfies ExportedHandler<Env, DailyJobMonitorQueueMessage>;
