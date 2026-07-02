import type { AppEnv } from "../db/client.js";

const BASE_URL = "https://www.aijobsaustralia.com.au";
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_SCRIPTS = 60;

const SCRIPT_RE = /(?:src|href)=["']([^"']+\.js[^"']*)["']/g;
const SUPABASE_CONFIG_RE =
  /["'](https:\/\/[a-z0-9]+\.supabase\.co)["']\s*,\s*["'](eyJ[A-Za-z0-9._-]+)["']/;
const CHALLENGE_RE =
  /(cf-challenge|challenge-platform|cf-chl|Just a moment|Attention Required|DataDome|_Incapsula_|Access denied|are you a human|hcaptcha|recaptcha)/i;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const JOBS_SELECT = [
  "id",
  "title",
  "description",
  "requirements",
  "benefits",
  "location",
  "location_type",
  "job_type",
  "category",
  "created_at",
  "updated_at",
  "expires_at",
  "last_checked_at",
  "application_url",
  "application_method",
  "company_id",
  "company_name",
  "company_description",
  "company_website",
  "salary_min",
  "salary_max",
  "salary_period",
  "show_salary",
  "highlights",
  "is_featured",
  "role_summary_one_liner",
  "role_summary_plain_english",
  "ai_focus_percentage",
  "ai_focus_confidence",
  "ai_focus_rationale",
  "who_role_is_for_bullets",
  "who_role_is_not_for_bullets",
  "companies(id,name,description,website,logo_url)",
].join(",");

type SupabaseConfig = {
  url: string;
  anonKey: string;
  metadata: Record<string, unknown>;
};

export type FetchAiJobsAustraliaOptions = {
  pageSize?: number;
  maxScripts?: number;
};

export type SourceFetchResult = {
  items: Record<string, unknown>[];
  rawCount: number;
  total?: number | null;
  queryPayload: Record<string, unknown>;
};

export function aiJobsAustraliaQueryPayload(
  env: Pick<AppEnv, "AIJOBS_SUPABASE_URL" | "AIJOBS_SUPABASE_ANON_KEY">,
  options: FetchAiJobsAustraliaOptions = {},
): Record<string, unknown> {
  return {
    source: "AI Jobs Australia",
    baseUrl: BASE_URL,
    endpoint: "/rest/v1/jobs",
    table: "jobs",
    select: JOBS_SELECT,
    filters: {
      status: "eq.approved",
    },
    order: "created_at.desc",
    pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
    configMode:
      env.AIJOBS_SUPABASE_URL && env.AIJOBS_SUPABASE_ANON_KEY
        ? "cached-env"
        : "discover-nextjs-bundle",
  };
}

export async function fetchAiJobsAustraliaApprovedJobs(
  env: Pick<AppEnv, "AIJOBS_SUPABASE_URL" | "AIJOBS_SUPABASE_ANON_KEY">,
  options: FetchAiJobsAustraliaOptions = {},
): Promise<SourceFetchResult> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const config = await loadSupabaseConfig(env, options.maxScripts ?? DEFAULT_MAX_SCRIPTS);
  const { items, total, pagesFetched } = await fetchApprovedJobs(config, pageSize);

  return {
    items,
    rawCount: items.length,
    total,
    queryPayload: {
      ...aiJobsAustraliaQueryPayload(env, options),
      pagesFetched,
      total,
      config: config.metadata,
    },
  };
}

async function loadSupabaseConfig(
  env: Pick<AppEnv, "AIJOBS_SUPABASE_URL" | "AIJOBS_SUPABASE_ANON_KEY">,
  maxScripts: number,
): Promise<SupabaseConfig> {
  if (env.AIJOBS_SUPABASE_URL && env.AIJOBS_SUPABASE_ANON_KEY) {
    return {
      url: env.AIJOBS_SUPABASE_URL,
      anonKey: env.AIJOBS_SUPABASE_ANON_KEY,
      metadata: {
        mode: "cached-env",
        supabaseUrl: env.AIJOBS_SUPABASE_URL,
      },
    };
  }

  const jobsPage = await fetchText(`${BASE_URL}/jobs`);
  const looksLikeChallenge = CHALLENGE_RE.test(jobsPage.text);
  const scriptUrls = [
    ...new Set([...jobsPage.text.matchAll(SCRIPT_RE)].map((match) => absoluteUrl(match[1]))),
  ].sort();

  if (!jobsPage.response.ok || looksLikeChallenge || scriptUrls.length === 0) {
    throw new Error(
      `Could not bootstrap AI Jobs Australia. status=${jobsPage.response.status} challenge=${looksLikeChallenge} scripts=${scriptUrls.length}`,
    );
  }

  let scriptsScanned = 0;
  for (const scriptUrl of scriptUrls.slice(0, maxScripts)) {
    scriptsScanned += 1;

    let script: FetchTextResult;
    try {
      script = await fetchText(scriptUrl);
    } catch {
      continue;
    }

    if (!script.response.ok) continue;

    const match = SUPABASE_CONFIG_RE.exec(script.text);
    if (!match) continue;

    return {
      url: match[1],
      anonKey: match[2],
      metadata: {
        mode: "discovered-nextjs-bundle",
        htmlStatus: jobsPage.response.status,
        htmlBytes: jobsPage.text.length,
        scriptCount: scriptUrls.length,
        scriptsScanned,
        foundInScript: scriptUrl,
        supabaseUrl: match[1],
      },
    };
  }

  throw new Error(
    `Could not find public Supabase config in ${Math.min(maxScripts, scriptUrls.length)} AI Jobs Australia script chunks.`,
  );
}

async function fetchApprovedJobs(
  config: SupabaseConfig,
  pageSize: number,
): Promise<{
  items: Record<string, unknown>[];
  total: number | null;
  pagesFetched: number;
}> {
  const endpoint = new URL(`${config.url}/rest/v1/jobs`);
  endpoint.searchParams.set("select", JOBS_SELECT);
  endpoint.searchParams.set("status", "eq.approved");
  endpoint.searchParams.set("order", "created_at.desc");

  const items: Record<string, unknown>[] = [];
  let total: number | null = null;
  let pagesFetched = 0;

  for (let start = 0; ; start += pageSize) {
    const end = start + pageSize - 1;
    const response = await fetch(endpoint.toString(), {
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${config.anonKey}`,
        accept: "application/json",
        prefer: "count=exact",
        "range-unit": "items",
        range: `${start}-${end}`,
      },
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        `AI Jobs Australia Supabase request failed with status ${response.status}: ${summarizeBody(body)}`,
      );
    }

    if (!Array.isArray(body)) {
      throw new Error("AI Jobs Australia Supabase response was not a JSON array.");
    }

    pagesFetched += 1;
    const chunk = body.filter(isRecord);
    items.push(...chunk);

    total ??= parseContentRangeTotal(response.headers.get("content-range"));

    if (chunk.length < pageSize) break;
    if (total !== null && items.length >= total) break;
  }

  return { items, total, pagesFetched };
}

type FetchTextResult = {
  response: Response;
  text: string;
};

async function fetchText(url: string): Promise<FetchTextResult> {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/javascript,text/javascript,*/*",
    },
  });

  return {
    response,
    text: await response.text(),
  };
}

function absoluteUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, BASE_URL).toString();
}

function parseContentRangeTotal(value: string | null): number | null {
  if (!value || !value.includes("/")) return null;
  const rawTotal = value.split("/").at(-1);
  if (!rawTotal || rawTotal === "*") return null;

  const total = Number(rawTotal);
  return Number.isFinite(total) ? total : null;
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
