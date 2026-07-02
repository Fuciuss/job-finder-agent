import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import type { EmailEnv } from "./resend.js";
import { sendEmail } from "./resend.js";
import * as schema from "../db/schema.js";

type JobDatabase = DrizzleD1Database<typeof schema>;
type DigestEnv = EmailEnv & {
  JOB_FINDER_ADMIN_URL?: string;
};

type DigestLabel = "action_today" | "verify" | "people_route";

export type SendJobDigestInput = {
  maxItems?: number;
  adminUrl?: string;
  sourceSummary?: {
    sourceRunCount: number;
    jobSearchQueryCount: number;
    llmAssessmentCount: number;
    newCount: number;
    changedCount: number;
    failedSourceRunCount: number;
  };
};

export type SendJobDigestResult = {
  status: "sent" | "skipped";
  reason?: string;
  subject?: string;
  messageId?: string;
  itemCount: number;
  labelCounts: Record<DigestLabel, number>;
};

type DigestListing = {
  id: string;
  sourceKey: string;
  sourceUrl: string;
  applyUrl: string | null;
  title: string;
  companyName: string;
  location: string | null;
  fitScore: number | null;
  fitLabel: DigestLabel;
  fitRationale: string | null;
  fitStrengths: string[];
  fitGaps: string[];
  firstSeenAt: Date;
};

const DIGEST_LABELS: DigestLabel[] = ["action_today", "verify", "people_route"];
const DEFAULT_MAX_ITEMS = 30;

export async function sendJobDigest(
  db: JobDatabase,
  env: DigestEnv,
  input: SendJobDigestInput = {},
): Promise<SendJobDigestResult> {
  if (!env.JOB_FINDER_RESEND_API_KEY || !env.SENDER_EMAIL || !env.RECIPIENT_EMAIL) {
    return {
      status: "skipped",
      reason: "Resend email environment is not fully configured.",
      itemCount: 0,
      labelCounts: emptyLabelCounts(),
    };
  }

  const listings = await loadDigestListings(db, input.maxItems ?? DEFAULT_MAX_ITEMS);
  const labelCounts = countLabels(listings);

  if (listings.length === 0) {
    return {
      status: "skipped",
      reason: "No unemailed action_today, verify, or people_route listings.",
      itemCount: 0,
      labelCounts,
    };
  }

  const subject = buildSubject(listings);
  const sentAt = new Date();
  const result = await sendEmail(env, {
    subject,
    text: renderTextDigest(listings, input.sourceSummary, input.adminUrl ?? env.JOB_FINDER_ADMIN_URL),
    html: renderHtmlDigest(listings, input.sourceSummary, input.adminUrl ?? env.JOB_FINDER_ADMIN_URL),
  });

  for (const listing of listings) {
    await db
      .update(schema.jobListings)
      .set({
        emailedAt: sentAt,
        emailSubject: subject,
      })
      .where(eq(schema.jobListings.id, listing.id));
  }

  return {
    status: "sent",
    subject,
    messageId: result.id,
    itemCount: listings.length,
    labelCounts,
  };
}

async function loadDigestListings(db: JobDatabase, limit: number): Promise<DigestListing[]> {
  const rows = await db
    .select({
      id: schema.jobListings.id,
      sourceKey: schema.jobListings.sourceKey,
      sourceUrl: schema.jobListings.sourceUrl,
      applyUrl: schema.jobListings.applyUrl,
      title: schema.jobListings.title,
      companyName: schema.jobListings.companyName,
      location: schema.jobListings.location,
      fitScore: schema.jobListings.fitScore,
      fitLabel: schema.jobListings.fitLabel,
      fitRationale: schema.jobListings.fitRationale,
      fitStrengths: schema.jobListings.fitStrengths,
      fitGaps: schema.jobListings.fitGaps,
      firstSeenAt: schema.jobListings.firstSeenAt,
    })
    .from(schema.jobListings)
    .where(
      and(
        isNull(schema.jobListings.emailedAt),
        inArray(schema.jobListings.fitLabel, DIGEST_LABELS),
      ),
    )
    .orderBy(desc(schema.jobListings.fitScore), desc(schema.jobListings.firstSeenAt))
    .limit(limit);

  return rows
    .filter((row): row is typeof row & { fitLabel: DigestLabel; firstSeenAt: Date } =>
      Boolean(row.fitLabel && DIGEST_LABELS.includes(row.fitLabel as DigestLabel) && row.firstSeenAt),
    )
    .map((row) => ({
      ...row,
      fitLabel: row.fitLabel,
      fitStrengths: row.fitStrengths ?? [],
      fitGaps: row.fitGaps ?? [],
    }));
}

function buildSubject(listings: DigestListing[]): string {
  const counts = countLabels(listings);
  const parts = [
    counts.action_today ? `${counts.action_today} action today` : null,
    counts.verify ? `${counts.verify} verify` : null,
    counts.people_route ? `${counts.people_route} people route` : null,
  ].filter(Boolean);

  return `Job Finder Agent: ${listings.length} role${listings.length === 1 ? "" : "s"} to review${
    parts.length ? ` (${parts.join(", ")})` : ""
  }`;
}

function renderTextDigest(
  listings: DigestListing[],
  sourceSummary: SendJobDigestInput["sourceSummary"],
  adminUrl?: string,
): string {
  const lines = [
    "Job Finder Agent daily digest",
    "",
    renderSourceSummaryText(sourceSummary),
    renderAdminLinkText(adminUrl),
    "",
  ].filter((line) => line !== null);

  for (const label of DIGEST_LABELS) {
    const group = listings.filter((listing) => listing.fitLabel === label);
    if (group.length === 0) continue;

    lines.push(label, "");
    for (const listing of group) {
      lines.push(
        `${listing.companyName} - ${listing.title}`,
        `Score: ${listing.fitScore ?? "unknown"} | Location: ${listing.location ?? "unknown"} | Source: ${sourceLabel(listing.sourceKey)}`,
        `Why: ${listing.fitRationale ?? "No rationale captured."}`,
        `Apply: ${listing.applyUrl ?? "verify first-party page"}`,
        `Source: ${listing.sourceUrl}`,
      );

      if (listing.fitStrengths.length) {
        lines.push(`Strengths: ${listing.fitStrengths.join("; ")}`);
      }

      if (listing.fitGaps.length) {
        lines.push(`Gaps: ${listing.fitGaps.join("; ")}`);
      }

      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}

function renderHtmlDigest(
  listings: DigestListing[],
  sourceSummary: SendJobDigestInput["sourceSummary"],
  adminUrl?: string,
): string {
  const groups = DIGEST_LABELS.map((label) => ({
    label,
    listings: listings.filter((listing) => listing.fitLabel === label),
  })).filter((group) => group.listings.length > 0);

  return `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f6f7f9;color:#17202a;font-family:Arial,sans-serif;">
  <main style="max-width:760px;margin:0 auto;padding:24px;">
    <h1 style="font-size:22px;margin:0 0 6px;">Job Finder Agent daily digest</h1>
    ${renderSourceSummaryHtml(sourceSummary)}
    ${renderAdminLinkHtml(adminUrl)}
    ${groups
      .map(
        (group) => `
          <h2 style="font-size:16px;margin:24px 0 10px;">${escapeHtml(labelTitle(group.label))}</h2>
          ${group.listings.map(renderHtmlListing).join("")}
        `,
      )
      .join("")}
  </main>
</body>
</html>`;
}

function renderHtmlListing(listing: DigestListing): string {
  return `
    <article style="background:#ffffff;border:1px solid #d7dce2;border-radius:8px;padding:14px;margin:0 0 12px;">
      <h3 style="font-size:16px;line-height:1.3;margin:0 0 4px;">
        ${escapeHtml(listing.companyName)} - ${escapeHtml(listing.title)}
      </h3>
      <p style="margin:0 0 8px;color:#5f6b7a;">
        Score ${escapeHtml(String(listing.fitScore ?? "unknown"))} · ${escapeHtml(listing.location ?? "unknown location")} · ${escapeHtml(sourceLabel(listing.sourceKey))}
      </p>
      <p style="margin:0 0 10px;">${escapeHtml(listing.fitRationale ?? "No rationale captured.")}</p>
      ${renderHtmlList("Strengths", listing.fitStrengths)}
      ${renderHtmlList("Gaps", listing.fitGaps)}
      <p style="margin:10px 0 0;">
        ${
          listing.applyUrl
            ? `<a href="${escapeAttribute(listing.applyUrl)}">Apply</a> · `
            : ""
        }<a href="${escapeAttribute(listing.sourceUrl)}">Source</a>
      </p>
    </article>`;
}

function renderHtmlList(title: string, items: string[]): string {
  if (!items.length) return "";

  return `
    <p style="margin:8px 0 4px;color:#5f6b7a;">${escapeHtml(title)}</p>
    <ul style="margin:0 0 8px 18px;padding:0;">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>`;
}

function renderSourceSummaryText(
  sourceSummary: SendJobDigestInput["sourceSummary"],
): string | null {
  if (!sourceSummary) return null;

  return [
    `Source runs: ${sourceSummary.sourceRunCount}`,
    `Job search queries: ${sourceSummary.jobSearchQueryCount}`,
    `LLM assessments: ${sourceSummary.llmAssessmentCount}`,
    `New listings: ${sourceSummary.newCount}`,
    `Changed listings: ${sourceSummary.changedCount}`,
    `Failed source runs: ${sourceSummary.failedSourceRunCount}`,
  ].join("\n");
}

function renderSourceSummaryHtml(sourceSummary: SendJobDigestInput["sourceSummary"]): string {
  if (!sourceSummary) return "";

  return `<p style="margin:0 0 16px;color:#5f6b7a;">Source runs: ${sourceSummary.sourceRunCount} · Job search queries: ${sourceSummary.jobSearchQueryCount} · LLM assessments: ${sourceSummary.llmAssessmentCount} · New listings: ${sourceSummary.newCount} · Changed listings: ${sourceSummary.changedCount} · Failed source runs: ${sourceSummary.failedSourceRunCount}</p>`;
}

function renderAdminLinkText(adminUrl?: string): string | null {
  return adminUrl ? `Admin summary: ${adminUrl}` : null;
}

function renderAdminLinkHtml(adminUrl?: string): string {
  if (!adminUrl) return "";

  return `<p style="margin:0 0 18px;"><a href="${escapeAttribute(adminUrl)}" style="display:inline-block;background:#17202a;color:#ffffff;text-decoration:none;border-radius:6px;padding:9px 12px;">Open admin summary</a></p>`;
}

function countLabels(listings: DigestListing[]): Record<DigestLabel, number> {
  const counts = emptyLabelCounts();
  for (const listing of listings) {
    counts[listing.fitLabel] += 1;
  }
  return counts;
}

function emptyLabelCounts(): Record<DigestLabel, number> {
  return {
    action_today: 0,
    verify: 0,
    people_route: 0,
  };
}

function sourceLabel(sourceKey: string): string {
  if (sourceKey === "aijobs_australia") return "AI Jobs Australia";
  if (sourceKey === "linkedin_jobs") return "LinkedIn Jobs";
  return sourceKey;
}

function labelTitle(label: DigestLabel): string {
  if (label === "action_today") return "Action Today";
  if (label === "verify") return "Verify";
  return "People Route";
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
