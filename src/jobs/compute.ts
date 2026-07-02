import type { NewJobListing } from "../db/schema.js";

export const sourceKeys = {
  aiJobsAustralia: "aijobs_australia",
  linkedInJobs: "linkedin_jobs",
} as const;

export type SourceKey = (typeof sourceKeys)[keyof typeof sourceKeys];

export type RawJobItem = Record<string, unknown>;

export type ComputedJobListing = Omit<
  NewJobListing,
  "id" | "createdAt" | "updatedAt" | "processingStatus"
>;

export type ExistingListingSnapshot = {
  id: string;
  contentHash: string;
};

export type ListingComputeResult = {
  listing: ComputedJobListing;
  identity: {
    sourceKey: SourceKey;
    sourceJobId: string;
    normalizedSourceUrl: string;
  };
};

export type ListingChangeDecision =
  | {
      kind: "new";
      listing: ComputedJobListing;
    }
  | {
      kind: "unchanged";
      listingId: string;
      updates: Pick<ComputedJobListing, "lastSeenAt" | "lastSeenRunId">;
    }
  | {
      kind: "changed";
      listingId: string;
      updates: ChangedListingUpdates;
    };

export type ChangedListingUpdates = Pick<
  ComputedJobListing,
  | "sourceUrl"
  | "normalizedSourceUrl"
  | "applyUrl"
  | "title"
  | "companyName"
  | "location"
  | "city"
  | "region"
  | "country"
  | "postedAt"
  | "expiresAt"
  | "employmentType"
  | "workplaceType"
  | "seniority"
  | "descriptionText"
  | "descriptionHtml"
  | "rawItem"
  | "contentHash"
  | "lastSeenAt"
  | "lastSeenRunId"
  | "lastChangedAt"
>;

const LINKEDIN_JOB_ID_RE = /\/jobs\/view\/[^/?#]*-(\d+)(?:[/?#]|$)/;
const MAX_DESCRIPTION_TEXT_LENGTH = 8_000;
const MAX_DESCRIPTION_HTML_LENGTH = 8_000;
const MAX_RAW_STRING_LENGTH = 2_000;
const TRACKING_PARAMS = new Set([
  "currentJobId",
  "eBP",
  "geoId",
  "pageNum",
  "position",
  "refId",
  "trackingId",
  "trk",
]);

export async function computeAiJobsAustraliaListing(
  item: RawJobItem,
  runId: string,
  seenAt = new Date(),
): Promise<ListingComputeResult> {
  const sourceJobId = requiredString(item.id, "AI Jobs Australia item.id");
  const sourceUrl =
    stringValue(item.url) ?? `https://www.aijobsaustralia.com.au/jobs/${sourceJobId}`;
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  const companyName =
    stringValue(item.company) ??
    stringValue(item.company_name) ??
    stringValue(nestedRecord(item.companies)?.name) ??
    "Unknown company";
  const title = stringValue(item.title) ?? "Untitled role";
  const location = stringValue(item.location);
  const applyUrl = normalizeNullableUrl(stringValue(item.application_url));
  const descriptionHtml = stringValue(item.description);
  const descriptionText = htmlToText(descriptionHtml);
  const contentHash = await computeContentHash({
    sourceKey: sourceKeys.aiJobsAustralia,
    sourceJobId,
    title,
    companyName,
    location,
    postedAt: stringValue(item.created_at),
    applyUrl,
    descriptionText,
  });

  return {
    identity: {
      sourceKey: sourceKeys.aiJobsAustralia,
      sourceJobId,
      normalizedSourceUrl,
    },
    listing: {
      sourceKey: sourceKeys.aiJobsAustralia,
      sourceJobId,
      sourceUrl,
      normalizedSourceUrl,
      applyUrl,
      title,
      companyName,
      location,
      city: cityFromLocation(location),
      region: regionFromLocation(location),
      country: "Australia",
      postedAt: parseDate(stringValue(item.created_at)),
      expiresAt: parseDate(stringValue(item.expires_at)),
      employmentType: joinedValue(item.job_type),
      workplaceType: stringValue(item.location_type),
      seniority: null,
      descriptionText,
      descriptionHtml,
      rawItem: item,
      contentHash,
      firstSeenRunId: runId,
      lastSeenRunId: runId,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      lastChangedAt: null,
      processingError: null,
      processedAt: null,
      fitScore: null,
      fitLabel: null,
      fitRationale: null,
      assessedAt: null,
      emailedAt: null,
      emailSubject: null,
    },
  };
}

export async function computeLinkedInListing(
  item: RawJobItem,
  runId: string,
  seenAt = new Date(),
): Promise<ListingComputeResult> {
  const sourceUrl = requiredString(item.link ?? item.url, "LinkedIn item.link");
  const normalizedSourceUrl = normalizeSourceUrl(sourceUrl);
  const sourceJobId =
    stringValue(item.id) ??
    stringValue(item.jobId) ??
    extractLinkedInJobId(sourceUrl) ??
    (await sha256Hex(normalizedSourceUrl));
  const title = stringValue(item.title) ?? "Untitled role";
  const companyName = stringValue(item.companyName ?? item.company) ?? "Unknown company";
  const location = stringValue(item.location);
  const applyUrl = normalizeNullableUrl(stringValue(item.applyUrl));
  const descriptionText = truncateNullable(
    stringValue(item.descriptionText),
    MAX_DESCRIPTION_TEXT_LENGTH,
  );
  const descriptionHtml = truncateNullable(
    stringValue(item.descriptionHtml),
    MAX_DESCRIPTION_HTML_LENGTH,
  );
  const postedAtText = dateTextValue(item.postedAt ?? item.postedAtTimestamp);
  const expiresAtText = dateTextValue(item.expireAt ?? item.expiresAt);
  const contentHash = await computeContentHash({
    sourceKey: sourceKeys.linkedInJobs,
    sourceJobId,
    title,
    companyName,
    location,
    postedAt: postedAtText,
    applyUrl,
    descriptionText,
  });

  return {
    identity: {
      sourceKey: sourceKeys.linkedInJobs,
      sourceJobId,
      normalizedSourceUrl,
    },
    listing: {
      sourceKey: sourceKeys.linkedInJobs,
      sourceJobId,
      sourceUrl,
      normalizedSourceUrl,
      applyUrl,
      title,
      companyName,
      location,
      city: cityFromLocation(location),
      region: regionFromLocation(location),
      country: countryFromLocation(location) ?? "Australia",
      postedAt: parseDate(postedAtText),
      expiresAt: parseDate(expiresAtText),
      employmentType: stringValue(item.employmentType),
      workplaceType: joinedValue(item.workplaceTypes),
      seniority: stringValue(item.seniorityLevel),
      descriptionText,
      descriptionHtml,
      rawItem: compactRawItem(item),
      contentHash,
      firstSeenRunId: runId,
      lastSeenRunId: runId,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      lastChangedAt: null,
      processingError: null,
      processedAt: null,
      fitScore: null,
      fitLabel: null,
      fitRationale: null,
      assessedAt: null,
      emailedAt: null,
      emailSubject: null,
    },
  };
}

export function decideListingChange(
  computed: ComputedJobListing,
  existing: ExistingListingSnapshot | null,
  seenAt = new Date(),
): ListingChangeDecision {
  if (!existing) {
    return { kind: "new", listing: computed };
  }

  if (existing.contentHash === computed.contentHash) {
    return {
      kind: "unchanged",
      listingId: existing.id,
      updates: {
        lastSeenAt: seenAt,
        lastSeenRunId: computed.lastSeenRunId,
      },
    };
  }

  return {
    kind: "changed",
    listingId: existing.id,
    updates: {
      sourceUrl: computed.sourceUrl,
      normalizedSourceUrl: computed.normalizedSourceUrl,
      applyUrl: computed.applyUrl,
      title: computed.title,
      companyName: computed.companyName,
      location: computed.location,
      city: computed.city,
      region: computed.region,
      country: computed.country,
      postedAt: computed.postedAt,
      expiresAt: computed.expiresAt,
      employmentType: computed.employmentType,
      workplaceType: computed.workplaceType,
      seniority: computed.seniority,
      descriptionText: computed.descriptionText,
      descriptionHtml: computed.descriptionHtml,
      rawItem: computed.rawItem,
      contentHash: computed.contentHash,
      lastSeenAt: seenAt,
      lastSeenRunId: computed.lastSeenRunId,
      lastChangedAt: seenAt,
    },
  };
}

export function normalizeSourceUrl(rawUrl: string): string {
  const url = new URL(rawUrl);

  if (url.hostname.endsWith("linkedin.com")) {
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname.startsWith("/jobs/view/")) {
      url.search = "";
      url.hash = "";
    }
  }

  if (url.hostname === "www.aijobsaustralia.com.au") {
    url.search = "";
    url.hash = "";
  }

  return url.toString();
}

export async function computeContentHash(parts: {
  sourceKey: SourceKey;
  sourceJobId: string;
  title: string;
  companyName: string;
  location?: string | null;
  postedAt?: string | null;
  applyUrl?: string | null;
  descriptionText?: string | null;
}): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      sourceKey: parts.sourceKey,
      sourceJobId: parts.sourceJobId,
      title: normalizeText(parts.title).toLowerCase(),
      companyName: normalizeText(parts.companyName).toLowerCase(),
      location: normalizeText(parts.location).toLowerCase(),
      postedAt: normalizeDateText(parts.postedAt),
      applyUrl: normalizeNullableUrl(parts.applyUrl),
      descriptionText: normalizeText(parts.descriptionText),
    }),
  );
}

export function extractLinkedInJobId(url: string): string | null {
  return LINKEDIN_JOB_ID_RE.exec(url)?.[1] ?? null;
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateNullable(value: string | null, maxLength: number): string | null {
  if (!value || value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

function compactRawItem(item: RawJobItem): RawJobItem {
  return Object.fromEntries(
    Object.entries(item).map(([key, value]) => [key, compactRawValue(key, value)]),
  );
}

function compactRawValue(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (key === "descriptionText") return truncateNullable(value, MAX_DESCRIPTION_TEXT_LENGTH);
    if (key === "descriptionHtml") return truncateNullable(value, MAX_DESCRIPTION_HTML_LENGTH);
    return truncateNullable(value, MAX_RAW_STRING_LENGTH);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => compactRawValue(key, item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [
        nestedKey,
        compactRawValue(nestedKey, nestedValue),
      ]),
    );
  }

  return value;
}

function dateTextValue(value: unknown): string | null {
  const text = stringValue(value);
  if (text) return text;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function requiredString(value: unknown, label: string): string {
  const text = stringValue(value);
  if (!text) {
    throw new Error(`Missing required field: ${label}`);
  }
  return text;
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function joinedValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const joined = value.map((item) => String(item).trim()).filter(Boolean).join(", ");
    return joined || null;
  }
  return stringValue(value);
}

function htmlToText(html: string | null): string | null {
  if (!html) return null;
  return normalizeText(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeDateText(value: string | null | undefined): string | null {
  const date = parseDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function normalizeNullableUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeSourceUrl(value);
  } catch {
    return value.trim();
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = new Date(isoDateOnly ? `${trimmed}T00:00:00.000Z` : trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cityFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  return location.split(",")[0]?.trim() || null;
}

function regionFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[1] ?? null;
  const stateMatch = /\b(NSW|VIC|QLD|ACT|SA|WA|TAS|NT)\b/i.exec(location);
  return stateMatch?.[1]?.toUpperCase() ?? null;
}

function countryFromLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? null;
}
