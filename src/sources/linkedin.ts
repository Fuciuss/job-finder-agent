import type { AppEnv } from "../db/client.js";

export const LINKEDIN_APIFY_ACTOR_ID = "hKByXkMQaC5Qt9UMN";

export const DEFAULT_LINKEDIN_QUERIES = [
  "AI Engineer",
  "GenAI",
  "Generative AI",
  "AI Product Manager",
  "AI Enablement",
  "AI Governance",
  "Machine Learning Engineer",
  "Automation AI",
  "Agentic AI",
  "MLOps",
] as const;

export const DEFAULT_LINKEDIN_LOCATIONS = [
  "Brisbane, Queensland, Australia",
  "Sydney, New South Wales, Australia",
  "Melbourne, Victoria, Australia",
] as const;

export type FetchLinkedInJobsOptions = {
  location: string;
  queries?: readonly string[];
  count?: number;
  scrapeCompany?: boolean;
};

export type LinkedInSourceFetchResult = {
  items: Record<string, unknown>[];
  rawCount: number;
  queryPayload: LinkedInActorPayload & {
    actorId: string;
    location: string;
    queries: readonly string[];
  };
};

type LinkedInActorPayload = {
  urls: string[];
  scrapeCompany: boolean;
  count: number;
  splitByLocation: boolean;
};

export function linkedInCityQueryPayload(
  options: FetchLinkedInJobsOptions,
): LinkedInSourceFetchResult["queryPayload"] {
  const queries = options.queries ?? DEFAULT_LINKEDIN_QUERIES;
  return {
    actorId: LINKEDIN_APIFY_ACTOR_ID,
    location: options.location,
    queries,
    ...buildLinkedInActorPayload({
      ...options,
      queries,
    }),
  };
}

export async function fetchLinkedInJobsForLocation(
  env: Pick<AppEnv, "APIFY_TOKEN" | "APIFY_API_KEY">,
  options: FetchLinkedInJobsOptions,
): Promise<LinkedInSourceFetchResult> {
  const token = env.APIFY_TOKEN ?? env.APIFY_API_KEY;
  if (!token) {
    throw new Error("Missing APIFY_TOKEN or APIFY_API_KEY.");
  }

  const queryPayload = linkedInCityQueryPayload(options);
  const response = await fetch(
    `https://api.apify.com/v2/acts/${LINKEDIN_APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&clean=true`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        urls: queryPayload.urls,
        scrapeCompany: queryPayload.scrapeCompany,
        count: queryPayload.count,
        splitByLocation: queryPayload.splitByLocation,
      }),
    },
  );

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `LinkedIn Apify request failed with status ${response.status}: ${summarizeBody(body)}`,
    );
  }

  if (!Array.isArray(body)) {
    throw new Error(`LinkedIn Apify response was not a JSON array: ${summarizeBody(body)}`);
  }

  const items = body.filter(isRecord);
  return {
    items,
    rawCount: items.length,
    queryPayload,
  };
}

function buildLinkedInActorPayload(options: FetchLinkedInJobsOptions): LinkedInActorPayload {
  const queries = options.queries ?? DEFAULT_LINKEDIN_QUERIES;
  return {
    urls: queries.map((query) => buildLinkedInJobsSearchUrl(query, options.location)),
    scrapeCompany: options.scrapeCompany ?? false,
    count: options.count ?? 200,
    splitByLocation: false,
  };
}

function buildLinkedInJobsSearchUrl(keywords: string, location: string): string {
  const url = new URL("https://www.linkedin.com/jobs/search/");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("location", location);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function summarizeBody(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  if (isRecord(value)) {
    const message = value.message ?? value.error ?? value.details;
    if (typeof message === "string") return message.slice(0, 500);
  }
  return JSON.stringify(value).slice(0, 500);
}
