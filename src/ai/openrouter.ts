import type { JobAssessment } from "../jobs/assess.js";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5-mini";

export type OpenRouterJobAssessmentInput = {
  apiKey: string;
  model?: string;
  listing: {
    id: string;
    title: string;
    companyName: string;
    location: string | null;
    employmentType: string | null;
    workplaceType: string | null;
    seniority: string | null;
    descriptionText: string | null;
  };
  deterministicAssessment: JobAssessment;
};

export async function assessJobWithOpenRouter(
  input: OpenRouterJobAssessmentInput,
): Promise<JobAssessment> {
  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
      "x-title": "job-finder-agent",
    },
    body: JSON.stringify({
      model: input.model ?? DEFAULT_OPENROUTER_MODEL,
      messages: [
        {
          role: "system",
          content: JOB_ASSESSMENT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: JSON.stringify(buildJobAssessmentPayload(input)),
        },
      ],
      temperature: 0.1,
      max_tokens: 900,
      response_format: {
        type: "json_schema",
        json_schema: JOB_ASSESSMENT_JSON_SCHEMA,
      },
    }),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}: ${summarizeBody(body)}`);
  }

  const content = extractMessageContent(body);
  const parsed = typeof content === "string" ? JSON.parse(content) : content;

  return normalizeAssessment(parsed, input.deterministicAssessment);
}

const JOB_ASSESSMENT_SYSTEM_PROMPT = [
  "You assess Australian AI job listings for Rees Pawson.",
  "Rees is an Applied AI Engineer in Brisbane with production voice AI, RAG, workflow automation, document review, healthcare, enterprise automation, and consulting delivery experience.",
  "He wants paid work that gets him closer to serious AI operating problems: production systems, real users, workflow integration, governance, reliability, evals/QA, adoption, cost, and ROI.",
  "Good roles include applied AI engineer/lead, forward deployed engineer, AI solutions architect, GenAI product owner/PM, AI delivery/program lead, AI enablement/adoption, responsible AI/governance implementation, and data/AI consultant.",
  "Caution flags include prompt training only, chatbot prototype only, pure policy without implementation, pure engineering without user/business exposure, pure presales demos/decks, very junior roles, and broad IP capture.",
  "Return only the requested JSON. Do not include source text that is not needed for the assessment.",
].join(" ");

const JOB_ASSESSMENT_JSON_SCHEMA = {
  name: "job_fit_assessment",
  strict: true,
  schema: {
    type: "object",
    properties: {
      fitScore: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "Overall fit score for Rees from 0 to 100.",
      },
      fitLabel: {
        type: "string",
        enum: ["action_today", "verify", "people_route", "market_intel", "skip"],
        description: "Action label for the listing.",
      },
      fitRationale: {
        type: "string",
        description: "One concise sentence explaining the label and score.",
      },
      fitStrengths: {
        type: "array",
        items: { type: "string" },
        minItems: 0,
        maxItems: 6,
        description: "Specific signals that make the role relevant.",
      },
      fitGaps: {
        type: "array",
        items: { type: "string" },
        minItems: 0,
        maxItems: 5,
        description: "Specific caveats, missing evidence, or reasons to deprioritize.",
      },
    },
    required: ["fitScore", "fitLabel", "fitRationale", "fitStrengths", "fitGaps"],
    additionalProperties: false,
  },
};

function buildJobAssessmentPayload(input: OpenRouterJobAssessmentInput): Record<string, unknown> {
  return {
    listing: {
      title: input.listing.title,
      companyName: input.listing.companyName,
      location: input.listing.location,
      employmentType: input.listing.employmentType,
      workplaceType: input.listing.workplaceType,
      seniority: input.listing.seniority,
      descriptionText: truncate(input.listing.descriptionText ?? "", 7000),
    },
    deterministicAssessment: input.deterministicAssessment,
    labelGuide: {
      action_today: "Strong fit worth first-party verification and action today.",
      verify: "Likely useful; verify first-party page before action.",
      people_route: "Company or team looks worth routing to people research even if the job itself is imperfect.",
      market_intel: "Useful market signal, not an immediate application target.",
      skip: "Too weak/noisy for this version.",
    },
  };
}

function extractMessageContent(body: unknown): unknown {
  const firstChoice = asRecord(asArray(asRecord(body).choices)[0]);
  const message = asRecord(firstChoice.message);
  const content = message.content;

  if (content === undefined || content === null || content === "") {
    throw new Error("OpenRouter response did not include message content.");
  }

  return content;
}

function normalizeAssessment(value: unknown, fallback: JobAssessment): JobAssessment {
  const record = asRecord(value);
  const fitScore = clamp(numberValue(record.fitScore) ?? fallback.fitScore, 0, 100);
  const fitLabel = fitLabelValue(record.fitLabel) ?? labelForScore(fitScore);
  const fitStrengths = stringArray(record.fitStrengths).slice(0, 6);
  const fitGaps = stringArray(record.fitGaps).slice(0, 5);
  const fitRationale =
    stringValue(record.fitRationale) ??
    `${fitLabel} (${fitScore}/100): ${fitStrengths.slice(0, 3).join("; ") || "LLM assessment returned limited rationale"}.`;

  return {
    fitScore,
    fitLabel,
    fitRationale,
    fitStrengths,
    fitGaps,
  };
}

function summarizeBody(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  const record = asRecord(value);
  const error = asRecord(record.error);
  const message = stringValue(error.message) ?? stringValue(record.message);
  if (message) return message.slice(0, 500);
  return JSON.stringify(value).slice(0, 500);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item))
    : [];
}

function fitLabelValue(value: unknown): JobAssessment["fitLabel"] | null {
  if (
    value === "action_today" ||
    value === "verify" ||
    value === "people_route" ||
    value === "market_intel" ||
    value === "skip"
  ) {
    return value;
  }

  return null;
}

function labelForScore(score: number): JobAssessment["fitLabel"] {
  if (score >= 80) return "action_today";
  if (score >= 68) return "verify";
  if (score >= 58) return "people_route";
  if (score >= 42) return "market_intel";
  return "skip";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}
