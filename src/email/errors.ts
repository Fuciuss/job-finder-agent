import type { EmailEnv } from "./resend.js";
import { sendEmail } from "./resend.js";

export type FailureEmailEnv = EmailEnv & {
  JOB_FINDER_ADMIN_URL?: string;
};

export type FailureEmailSourceRun = {
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

export type SendFailureEmailInput = {
  trigger: string;
  status?: string;
  startedAt?: string;
  scheduledTime?: string;
  finishedAt?: string;
  sourceRuns?: FailureEmailSourceRun[];
  assessmentError?: string;
  emailDigestError?: string;
  hardError?: string;
  message?: string;
};

export type SendFailureEmailResult = {
  status: "sent" | "skipped";
  reason?: string;
  subject?: string;
  messageId?: string;
};

export async function sendFailureEmail(
  env: FailureEmailEnv,
  input: SendFailureEmailInput,
): Promise<SendFailureEmailResult> {
  if (!env.JOB_FINDER_RESEND_API_KEY || !env.SENDER_EMAIL || !env.RECIPIENT_EMAIL) {
    return {
      status: "skipped",
      reason: "Resend email environment is not fully configured.",
    };
  }

  const subject = buildSubject(input);
  const result = await sendEmail(env, {
    subject,
    text: renderTextFailure(input, env),
    html: renderHtmlFailure(input, env),
  });

  return {
    status: "sent",
    subject,
    messageId: result.id,
  };
}

function buildSubject(input: SendFailureEmailInput): string {
  const count = issueCount(input);
  const trigger = input.trigger || "unknown trigger";
  return `Job Finder Agent error: ${count} issue${count === 1 ? "" : "s"} (${trigger})`;
}

function issueCount(input: SendFailureEmailInput): number {
  return Math.max(
    1,
    (input.sourceRuns ?? []).filter((run) => !run.ok).length +
      (input.assessmentError ? 1 : 0) +
      (input.emailDigestError ? 1 : 0) +
      (input.hardError ? 1 : 0),
  );
}

function renderTextFailure(input: SendFailureEmailInput, env: FailureEmailEnv): string {
  const failedRuns = (input.sourceRuns ?? []).filter((run) => !run.ok);
  const lines = [
    "Job Finder Agent failure notification",
    "",
    `Status: ${input.status ?? "failed"}`,
    `Trigger: ${input.trigger}`,
    `Started: ${input.startedAt ?? "unknown"}`,
    `Finished: ${input.finishedAt ?? new Date().toISOString()}`,
  ];

  if (input.scheduledTime) {
    lines.push(`Scheduled time: ${input.scheduledTime}`);
  }

  lines.push("", input.message ?? "One or more execution errors occurred.", "");

  if (input.hardError) {
    lines.push("Hard error", input.hardError, "");
  }

  if (failedRuns.length) {
    lines.push("Failed source runs", "");
    for (const run of failedRuns) {
      lines.push(
        `${run.sourceKey} | ${run.location ?? "no location"} | ${run.purpose}`,
        `Run ID: ${run.runId}`,
        `Error: ${run.error ?? "Unknown error"}`,
        "",
      );
    }
  }

  if (input.assessmentError) {
    lines.push("Assessment error", input.assessmentError, "");
  }

  if (input.emailDigestError) {
    lines.push("Digest email error", input.emailDigestError, "");
  }

  if (input.sourceRuns?.length) {
    lines.push("All source run summary", "");
    for (const run of input.sourceRuns) {
      lines.push(
        [
          run.ok ? "OK" : "FAILED",
          run.sourceKey,
          run.location ?? "no location",
          `raw=${run.rawCount ?? "n/a"}`,
          `filtered=${run.filteredCount ?? "n/a"}`,
          `new=${run.newCount ?? "n/a"}`,
          `changed=${run.changedCount ?? "n/a"}`,
          `unchanged=${run.unchangedCount ?? "n/a"}`,
        ].join(" | "),
      );
    }
    lines.push("");
  }

  lines.push(`Admin: ${adminUrl(env)}`);

  return lines.join("\n").trim() + "\n";
}

function renderHtmlFailure(input: SendFailureEmailInput, env: FailureEmailEnv): string {
  const failedRuns = (input.sourceRuns ?? []).filter((run) => !run.ok);
  return `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f6f7f9;color:#17202a;font-family:Arial,sans-serif;">
  <main style="max-width:760px;margin:0 auto;padding:24px;">
    <h1 style="font-size:22px;margin:0 0 8px;">Job Finder Agent failure notification</h1>
    <p style="margin:0 0 16px;color:#5f6b7a;">${escapeHtml(
      input.message ?? "One or more execution errors occurred.",
    )}</p>
    <section style="background:#ffffff;border:1px solid #d7dce2;border-radius:8px;padding:14px;margin:0 0 12px;">
      ${row("Status", input.status ?? "failed")}
      ${row("Trigger", input.trigger)}
      ${row("Started", input.startedAt ?? "unknown")}
      ${input.scheduledTime ? row("Scheduled time", input.scheduledTime) : ""}
      ${row("Finished", input.finishedAt ?? new Date().toISOString())}
    </section>
    ${input.hardError ? errorBlock("Hard error", input.hardError) : ""}
    ${
      failedRuns.length
        ? `<h2 style="font-size:16px;margin:24px 0 10px;">Failed source runs</h2>
          ${failedRuns
            .map(
              (run) => `
              <section style="background:#ffffff;border:1px solid #d7dce2;border-radius:8px;padding:14px;margin:0 0 12px;">
                <h3 style="font-size:15px;margin:0 0 8px;">${escapeHtml(run.sourceKey)} - ${escapeHtml(
                  run.location ?? "no location",
                )}</h3>
                ${row("Purpose", run.purpose)}
                ${row("Run ID", run.runId)}
                ${row("Error", run.error ?? "Unknown error")}
              </section>`,
            )
            .join("")}`
        : ""
    }
    ${input.assessmentError ? errorBlock("Assessment error", input.assessmentError) : ""}
    ${input.emailDigestError ? errorBlock("Digest email error", input.emailDigestError) : ""}
    ${
      input.sourceRuns?.length
        ? `<h2 style="font-size:16px;margin:24px 0 10px;">All source runs</h2>
          <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #d7dce2;">
            <thead>
              <tr>
                ${["Status", "Source", "Location", "Raw", "Filtered", "New", "Changed", "Unchanged"]
                  .map((heading) => `<th style="${cellStyle()}">${escapeHtml(heading)}</th>`)
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${input.sourceRuns.map(renderRunRow).join("")}
            </tbody>
          </table>`
        : ""
    }
    <p style="margin:18px 0 0;"><a href="${escapeAttribute(adminUrl(env))}">Open admin</a></p>
  </main>
</body>
</html>`;
}

function renderRunRow(run: FailureEmailSourceRun): string {
  const values = [
    run.ok ? "OK" : "FAILED",
    run.sourceKey,
    run.location ?? "no location",
    String(run.rawCount ?? "n/a"),
    String(run.filteredCount ?? "n/a"),
    String(run.newCount ?? "n/a"),
    String(run.changedCount ?? "n/a"),
    String(run.unchangedCount ?? "n/a"),
  ];

  return `<tr>${values
    .map((value) => `<td style="${cellStyle()}">${escapeHtml(value)}</td>`)
    .join("")}</tr>`;
}

function errorBlock(title: string, message: string): string {
  return `
    <section style="background:#fff6f6;border:1px solid #e5b4b4;border-radius:8px;padding:14px;margin:0 0 12px;">
      <h2 style="font-size:16px;margin:0 0 8px;">${escapeHtml(title)}</h2>
      <pre style="white-space:pre-wrap;margin:0;font-family:Arial,sans-serif;">${escapeHtml(message)}</pre>
    </section>`;
}

function row(label: string, value: string): string {
  return `<p style="margin:0 0 6px;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function cellStyle(): string {
  return "border:1px solid #d7dce2;padding:8px;text-align:left;font-size:13px;vertical-align:top;";
}

function adminUrl(env: FailureEmailEnv): string {
  return (env.JOB_FINDER_ADMIN_URL ?? "https://job-finder-agent.rees-e2c.workers.dev/admin").replace(
    /\/+$/,
    "",
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
