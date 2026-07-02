import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "../db/schema.js";
import { assessJobWithOpenRouter } from "../ai/openrouter.js";

type JobDatabase = DrizzleD1Database<typeof schema>;

type AssessOptions = {
  limit?: number;
  openRouter?: {
    apiKey?: string;
    model?: string;
    maxAssessments?: number;
    minDeterministicScore?: number;
  };
};

type ListingForAssessment = {
  id: string;
  title: string;
  companyName: string;
  location: string | null;
  employmentType: string | null;
  workplaceType: string | null;
  seniority: string | null;
  descriptionText: string | null;
  rawItem: Record<string, unknown>;
};

export type JobAssessment = {
  fitScore: number;
  fitLabel: (typeof schema.fitLabels)[number];
  fitRationale: string;
  fitStrengths: string[];
  fitGaps: string[];
};

export type AssessUnprocessedListingsResult = {
  assessedCount: number;
  llmAssessedCount: number;
  llmSkippedCount: number;
  llmErrorCount: number;
  labels: Record<(typeof schema.fitLabels)[number], number>;
};

/*
 * Deterministic first-pass scoring.
 *
 * This bakes in the July 2, 2026 search brief rather than calling an LLM:
 * Rees is looking for paid work near serious AI operating problems, especially
 * production/near-production GenAI, workflow integration, evals, QA, governance,
 * reliability, adoption, and value measurement. The goal is not perfect ranking;
 * it is to mark each new source listing as processed once so the app does not
 * reassess the same source job on every daily run.
 */
export async function assessUnprocessedListings(
  db: JobDatabase,
  options: AssessOptions = {},
): Promise<AssessUnprocessedListingsResult> {
  const now = new Date();
  const openRouter = options.openRouter;
  const maxLlmAssessments = openRouter?.maxAssessments ?? 40;
  const minDeterministicScore = openRouter?.minDeterministicScore ?? 50;
  const listings = await db
    .select({
      id: schema.jobListings.id,
      title: schema.jobListings.title,
      companyName: schema.jobListings.companyName,
      location: schema.jobListings.location,
      employmentType: schema.jobListings.employmentType,
      workplaceType: schema.jobListings.workplaceType,
      seniority: schema.jobListings.seniority,
      descriptionText: schema.jobListings.descriptionText,
      rawItem: schema.jobListings.rawItem,
    })
    .from(schema.jobListings)
    .where(eq(schema.jobListings.processingStatus, "unprocessed"))
    .limit(options.limit ?? 500);

  const labels = emptyLabelCounts();
  let llmAssessedCount = 0;
  let llmSkippedCount = 0;
  let llmErrorCount = 0;

  for (const listing of listings) {
    const deterministicAssessment = assessListing(listing);
    let assessment = deterministicAssessment;

    if (
      openRouter?.apiKey &&
      deterministicAssessment.fitScore >= minDeterministicScore &&
      llmAssessedCount < maxLlmAssessments
    ) {
      try {
        assessment = await assessJobWithOpenRouter({
          apiKey: openRouter.apiKey,
          model: openRouter.model,
          listing,
          deterministicAssessment,
        });
        llmAssessedCount += 1;
      } catch (error) {
        llmErrorCount += 1;
        assessment = withLlmFallbackNote(deterministicAssessment, error);
      }
    } else if (openRouter?.apiKey) {
      llmSkippedCount += 1;
    }

    labels[assessment.fitLabel] += 1;

    await db
      .update(schema.jobListings)
      .set({
        processingStatus: "processed",
        processingError: null,
        processedAt: now,
        fitScore: assessment.fitScore,
        fitLabel: assessment.fitLabel,
        fitRationale: assessment.fitRationale,
        fitStrengths: assessment.fitStrengths,
        fitGaps: assessment.fitGaps,
        assessedAt: now,
      })
      .where(eq(schema.jobListings.id, listing.id));
  }

  return {
    assessedCount: listings.length,
    llmAssessedCount,
    llmSkippedCount,
    llmErrorCount,
    labels,
  };
}

function assessListing(listing: ListingForAssessment): JobAssessment {
  let score = 30;
  const strengths: string[] = [];
  const gaps: string[] = [];
  const title = normalize(listing.title);
  const text = normalize(
    [
      listing.title,
      listing.companyName,
      listing.location,
      listing.employmentType,
      listing.workplaceType,
      listing.seniority,
      listing.descriptionText,
      rawText(listing.rawItem),
    ].join(" "),
  );

  for (const signal of TITLE_SIGNALS) {
    if (matches(title, signal.terms)) {
      score += signal.weight;
      strengths.push(signal.label);
    }
  }

  for (const signal of WORK_SIGNALS) {
    if (matches(text, signal.terms)) {
      score += signal.weight;
      strengths.push(signal.label);
    }
  }

  for (const signal of ENVIRONMENT_SIGNALS) {
    if (matches(text, signal.terms)) {
      score += signal.weight;
      strengths.push(signal.label);
    }
  }

  for (const signal of CAUTION_SIGNALS) {
    if (matches(text, signal.terms)) {
      score -= signal.weight;
      gaps.push(signal.label);
    }
  }

  if (matches(text, ["brisbane", "queensland", "qld"])) {
    score += 5;
    strengths.push("Brisbane or Queensland location signal");
  } else if (matches(text, ["sydney", "melbourne", "new south wales", "victoria"])) {
    score += 2;
    strengths.push("Relevant east-coast Australian market");
  }

  if (matches(title, ["senior", "lead", "principal", "staff", "architect"])) {
    score += 5;
    strengths.push("Senior enough to touch implementation decisions");
  }

  if (!listing.descriptionText || listing.descriptionText.length < 160) {
    score -= 6;
    gaps.push("Thin description; needs first-party verification before action");
  }

  if (!matches(text, ["ai", "genai", "generative", "llm", "machine learning", "ml"])) {
    score -= 15;
    gaps.push("Weak explicit AI signal");
  }

  const fitScore = clamp(score, 0, 100);
  const fitLabel = labelForScore(fitScore);
  const fitStrengths = unique(strengths).slice(0, 6);
  const fitGaps = unique(gaps).slice(0, 5);

  return {
    fitScore,
    fitLabel,
    fitStrengths,
    fitGaps,
    fitRationale: buildRationale(fitScore, fitLabel, fitStrengths, fitGaps),
  };
}

type Signal = {
  terms: string[];
  weight: number;
  label: string;
};

const TITLE_SIGNALS: Signal[] = [
  {
    terms: ["forward deployed", "field engineer"],
    weight: 26,
    label: "Forward-deployed or field-engineering role shape",
  },
  {
    terms: ["applied ai", "ai engineer", "genai engineer", "ai lead", "machine learning engineer"],
    weight: 22,
    label: "Applied AI engineering title",
  },
  {
    terms: ["solutions architect", "solution architect", "genai architect", "ai architect"],
    weight: 20,
    label: "AI solutions architecture title",
  },
  {
    terms: ["delivery lead", "program lead", "program manager", "product owner", "product manager"],
    weight: 16,
    label: "Delivery/product ownership role shape",
  },
  {
    terms: ["enablement", "adoption", "governance", "responsible ai", "data and ai consultant", "data & ai consultant"],
    weight: 15,
    label: "Enablement, governance, or consulting title",
  },
];

const WORK_SIGNALS: Signal[] = [
  {
    terms: ["production", "prod", "live system", "deployed", "scale", "operational"],
    weight: 10,
    label: "Production or near-production AI signal",
  },
  {
    terms: ["workflow", "process", "operations", "handoff", "stakeholder", "business process"],
    weight: 9,
    label: "Workflow-heavy implementation work",
  },
  {
    terms: ["integration", "api", "platform", "internal tools", "system design", "solution design"],
    weight: 8,
    label: "Integration and systems work",
  },
  {
    terms: ["evaluation", "evals", "qa", "quality", "reliability", "hallucination", "guardrails", "observability"],
    weight: 10,
    label: "AI quality, evals, or reliability pressure",
  },
  {
    terms: ["governance", "security", "privacy", "audit", "compliance", "risk", "responsible ai"],
    weight: 9,
    label: "Governance, risk, or compliance implementation",
  },
  {
    terms: ["rag", "retrieval", "document", "documents", "review", "checklist", "evidence", "completeness"],
    weight: 10,
    label: "RAG, document review, or evidence-checking overlap",
  },
  {
    terms: ["human in the loop", "human-in-the-loop", "approval", "review loop", "sign off", "sign-off"],
    weight: 8,
    label: "Human review loop signal",
  },
  {
    terms: ["adoption", "roi", "value", "measurement", "cost", "benefit", "outcomes"],
    weight: 7,
    label: "Value, adoption, or ROI measurement",
  },
  {
    terms: ["agentic", "agents", "llm", "large language model", "copilot", "automation"],
    weight: 7,
    label: "Current GenAI/agentic systems language",
  },
  {
    terms: ["mlops", "model ops", "modelops", "bedrock", "azure ai", "aws", "cloud"],
    weight: 6,
    label: "Cloud AI or model-ops environment",
  },
];

const ENVIRONMENT_SIGNALS: Signal[] = [
  {
    terms: ["enterprise", "customer", "users", "client", "consulting", "transformation"],
    weight: 5,
    label: "Real customer or enterprise delivery context",
  },
  {
    terms: ["healthcare", "insurance", "banking", "financial services", "government", "legal"],
    weight: 5,
    label: "Regulated or high-consequence domain",
  },
];

const CAUTION_SIGNALS: Signal[] = [
  {
    terms: ["prompt training", "prompt trainer", "prompt engineer only"],
    weight: 15,
    label: "Prompt training without clear delivery path",
  },
  {
    terms: ["chatbot prototype", "prototype only", "demo only", "proof of concept only"],
    weight: 11,
    label: "Prototype-only signal",
  },
  {
    terms: ["pure policy", "policy only", "framework only"],
    weight: 10,
    label: "Policy-heavy role without implementation signal",
  },
  {
    terms: ["presales", "pre-sales", "demo", "decks", "sales engineer"],
    weight: 8,
    label: "Presales-heavy signal",
  },
  {
    terms: ["intern", "graduate", "junior", "entry level"],
    weight: 18,
    label: "Too junior for the target role shape",
  },
  {
    terms: ["trainer", "teacher", "facilitator", "no-code"],
    weight: 10,
    label: "Training/no-code role may be too shallow",
  },
];

function labelForScore(score: number): JobAssessment["fitLabel"] {
  if (score >= 80) return "action_today";
  if (score >= 68) return "verify";
  if (score >= 58) return "people_route";
  if (score >= 42) return "market_intel";
  return "skip";
}

function buildRationale(
  score: number,
  label: JobAssessment["fitLabel"],
  strengths: string[],
  gaps: string[],
): string {
  const strengthText = strengths.length ? strengths.slice(0, 3).join("; ") : "few strong-fit signals";
  const gapText = gaps.length ? ` Gaps: ${gaps.slice(0, 2).join("; ")}.` : "";
  return `${label} (${score}/100): ${strengthText}.${gapText}`;
}

function withLlmFallbackNote(assessment: JobAssessment, error: unknown): JobAssessment {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...assessment,
    fitRationale: `${assessment.fitRationale} LLM assessment failed; deterministic fallback used.`,
    fitGaps: unique([
      ...assessment.fitGaps,
      `LLM assessment failed: ${message.slice(0, 160)}`,
    ]).slice(0, 5),
  };
}

function rawText(rawItem: Record<string, unknown>): string {
  const values = [
    rawItem.role_summary_one_liner,
    rawItem.role_summary_plain_english,
    rawItem.ai_focus_rationale,
    rawItem.requirements,
    rawItem.benefits,
    rawItem.highlights,
    rawItem.who_role_is_for_bullets,
    rawItem.who_role_is_not_for_bullets,
    rawItem.descriptionText,
    rawItem.descriptionHtml,
  ];

  return values.map((value) => flatten(value)).filter(Boolean).join(" ");
}

function flatten(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => flatten(item)).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(flatten).join(" ");
  return "";
}

function matches(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => termMatches(text, normalize(term)));
}

function termMatches(text: string, term: string): boolean {
  if (!term) return false;
  if (/^[a-z0-9]+$/.test(term) && term.length <= 3) {
    return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(text);
  }
  return text.includes(term);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyLabelCounts(): Record<(typeof schema.fitLabels)[number], number> {
  return {
    action_today: 0,
    verify: 0,
    people_route: 0,
    market_intel: 0,
    skip: 0,
  };
}
