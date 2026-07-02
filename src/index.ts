import { desc, sql } from "drizzle-orm";

import { createDatabase, type AppEnv } from "./db/client.js";
import * as schema from "./db/schema.js";
import { sendEmail } from "./email/resend.js";
import { createJobRun, finishJobRun } from "./jobs/ingest.js";

type Env = AppEnv;

type DailyJobMonitorTrigger = "cron" | "manual";

type DailyJobMonitorResult = {
  ok: boolean;
  status: "not_implemented";
  runId: string;
  trigger: DailyJobMonitorTrigger;
  startedAt: string;
  scheduledTime?: string;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runDailyJobMonitor(
  env: Env,
  input: {
    trigger: DailyJobMonitorTrigger;
    scheduledTime?: number;
  },
): Promise<DailyJobMonitorResult> {
  const db = createDatabase(env);
  const startedAt = new Date();
  const scheduledTime = input.scheduledTime
    ? new Date(input.scheduledTime).toISOString()
    : undefined;
  const run = await createJobRun(
    db,
    {
      sourceKey: "daily_monitor",
      purpose: "daily-job-monitor",
      location: null,
      queryPayload: {
        trigger: input.trigger,
        scheduledTime,
      },
    },
    startedAt,
  );

  console.log("daily job monitor triggered", {
    trigger: input.trigger,
    runId: run.id,
    startedAt: startedAt.toISOString(),
    scheduledTime,
  });

  await finishJobRun(db, run.id, {
    status: "succeeded",
    rawCount: 0,
    filteredCount: 0,
    newCount: 0,
    changedCount: 0,
    unchangedCount: 0,
  });

  return {
    ok: true,
    status: "not_implemented",
    runId: run.id,
    trigger: input.trigger,
    startedAt: startedAt.toISOString(),
    scheduledTime,
    message: "Cron/manual entry point is wired. Scrape, ingest, assess, and email steps are next.",
  };
}

async function loadAdminStatus(env: Env): Promise<unknown> {
  const db = createDatabase(env);

  const [lastRun] = await db
    .select({
      id: schema.jobRuns.id,
      sourceKey: schema.jobRuns.sourceKey,
      purpose: schema.jobRuns.purpose,
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

  const [listingStats] = await db
    .select({
      total: sql<number>`count(*)`,
      unprocessed: sql<number>`coalesce(sum(case when ${schema.jobListings.processingStatus} = 'unprocessed' then 1 else 0 end), 0)`,
      pendingEmail: sql<number>`coalesce(sum(case when ${schema.jobListings.emailedAt} is null then 1 else 0 end), 0)`,
    })
    .from(schema.jobListings);

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
      pendingEmail: 0,
    },
  };
}

async function sendTestEmail(env: Env): Promise<unknown> {
  const sentAt = new Date().toISOString();
  const result = await sendEmail(env, {
    subject: "Job Finder Agent email test",
    text: `Job Finder Agent sent this test email through Resend.\n\nSent at: ${sentAt}`,
    html: `<p>Job Finder Agent sent this test email through Resend.</p><p>Sent at: ${sentAt}</p>`,
  });

  return {
    ok: true,
    provider: "resend",
    messageId: result.id,
    sentAt,
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
      try {
        const result = await runDailyJobMonitor(env, { trigger: "manual" });
        return jsonResponse(result);
      } catch (error) {
        return jsonResponse({ ok: false, error: errorMessage(error) }, { status: 500 });
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
        return jsonResponse({ ok: false, error: errorMessage(error) }, { status: 500 });
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
      runDailyJobMonitor(env, {
        trigger: "cron",
        scheduledTime: controller.scheduledTime,
      }).catch((error) => {
        console.error("daily job monitor failed", { error: errorMessage(error) });
        throw error;
      }),
    );
  },
} satisfies ExportedHandler<Env>;
