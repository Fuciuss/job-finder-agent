import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "./schema.js";

export type AppDatabase = DrizzleD1Database<typeof schema>;

export type AppEnv = {
  DB?: D1Database;
  ADMIN_TOKEN?: string;
  RESEND_API_KEY?: string;
  SENDER_EMAIL?: string;
  RECIPIENT_EMAIL?: string;
};

export function createDatabase(env: Pick<AppEnv, "DB">): AppDatabase {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  return drizzle(env.DB, { schema });
}
