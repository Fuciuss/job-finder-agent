# Cloudflare D1 Migration Flow

Use one migration owner for D1 schema changes. Do not mix migration tracking systems.

Preferred flow:

1. Define the database schema in Drizzle TypeScript files.
2. Generate reviewed SQL migration files with `drizzle-kit generate`.
3. Apply migrations locally with `wrangler d1 migrations apply DB --local`.
4. Apply migrations to the remote Cloudflare D1 database with `wrangler d1 migrations apply DB --remote`.

In this flow, Drizzle owns schema authoring and SQL generation. Wrangler owns applying migrations to D1 and tracking which migrations have already run.

Avoid using `drizzle-kit push` or `drizzle-kit migrate` against production unless deliberately switching Drizzle to be the migration owner. Mixing Drizzle-applied changes with Wrangler-applied changes can cause migration history drift, where the live database schema, Drizzle's view of the schema, and Wrangler's migration table no longer agree.
