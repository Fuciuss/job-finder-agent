import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "./schema.js";

export type AppDatabase = DrizzleD1Database<typeof schema>;

export type AppEnv = {
  DB?: D1Database;
  AIJOBS_SUPABASE_URL?: string;
  AIJOBS_SUPABASE_ANON_KEY?: string;
  APIFY_TOKEN?: string;
  APIFY_API_KEY?: string;
  JOB_FINDER_OPENROUTER_API_KEY?: string;
  JOB_FINDER_OPENROUTER_MODEL?: string;
  JOB_FINDER_OPENROUTER_MAX_ASSESSMENTS?: string;
  JOB_FINDER_OPENROUTER_MIN_RULE_SCORE?: string;
  JOB_FINDER_RESEND_API_KEY?: string;
  JOB_FINDER_DIGEST_MAX_ITEMS?: string;
  JOB_FINDER_ADMIN_URL?: string;
  SENDER_EMAIL?: string;
  RECIPIENT_EMAIL?: string;
};

export function createDatabase(env: Pick<AppEnv, "DB">): AppDatabase {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  return drizzle(env.DB, { schema });
}
