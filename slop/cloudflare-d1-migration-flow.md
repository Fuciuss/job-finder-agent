# Cloudflare D1 Migration Flow

Use one migration owner for D1 schema changes. Do not mix migration tracking systems.

Preferred flow:

1. Define the database schema in Drizzle TypeScript files.
2. Generate reviewed SQL migration files with `drizzle-kit generate`.
3. Apply migrations locally with `wrangler d1 migrations apply DB --local`.
4. Apply migrations to the remote Cloudflare D1 database with `wrangler d1 migrations apply DB --remote`.

In this flow, Drizzle owns schema authoring and SQL generation. Wrangler owns applying migrations to D1 and tracking which migrations have already run.

Avoid using `drizzle-kit push` or `drizzle-kit migrate` against production unless deliberately switching Drizzle to be the migration owner. Mixing Drizzle-applied changes with Wrangler-applied changes can cause migration history drift, where the live database schema, Drizzle's view of the schema, and Wrangler's migration table no longer agree.

## Project scripts

The project now has reusable scripts for this flow:

```bash
npm run db:create          # create/bind D1 and ensure migrations_dir = "drizzle"
npm run db:generate -- init
npm run db:migrate:local
npm run db:migrate:remote
npm run db:migrations      # list pending remote migrations
```

For a first-time setup, this should be enough:

```bash
npm run db:bootstrap
```

`db:bootstrap` creates the database if the `DB` binding is missing, generates SQL from Drizzle, and applies the migration. The create script is guarded so rerunning it does not create another database when `wrangler.toml` already has `binding = "DB"`.

## Future migration workflow

For normal future schema changes, do not rerun the bootstrap path. Use this flow:

1. Edit the Drizzle schema in `src/db/schema.ts`.
2. Generate a named SQL migration:

   ```bash
   npm run db:generate -- descriptive_migration_name
   ```

3. Review the generated SQL in `drizzle/*.sql`.
4. Apply it to the local D1 database:

   ```bash
   npm run db:migrate:local
   ```

5. Run the local Worker and smoke-test the affected endpoints:

   ```bash
   npm run dev
   ```

6. Apply it to the remote Cloudflare D1 database:

   ```bash
   npm run db:migrate:remote
   ```

7. Confirm there are no pending remote migrations:

   ```bash
   npm run db:migrations
   ```

8. Run the Worker dry-run deploy:

   ```bash
   npm run check
   ```

Then commit both the schema change and the generated `drizzle/` migration files together.

Rules for this project:

- Drizzle owns schema authoring and SQL generation.
- Wrangler owns applying migrations and tracking D1 migration state.
- Do not use `drizzle-kit push` against production.
- Do not use `drizzle-kit migrate` unless deliberately changing the migration owner away from Wrangler.
- Do not edit applied migration files after they have been applied remotely. Create a new migration instead.
- Keep `wrangler.toml`'s `[[d1_databases]]` binding and `migrations_dir = "drizzle"` in sync with the scripts.

Current D1 binding:

```text
binding = "DB"
database_name = "job-finder-agent"
database_id = "97dcc8f5-80c5-4b37-980b-a699141bba64"
migrations_dir = "drizzle"
```

## Verification on 2026-07-02

Verified flow:

1. `npm run db:generate -- init` generated `drizzle/0000_init.sql`.
2. `npm run db:create` created the remote D1 database in region `OC`.
3. `npm run db:migrate:local` applied `0000_init.sql` locally.
4. `npm run db:migrate:remote` applied `0000_init.sql` remotely.
5. `npm run db:migrations` returned `No migrations to apply`.
6. `npm run typecheck` passed.
7. `npm run check` passed and showed `env.DB (job-finder-agent)` as a Worker binding.
8. Local Wrangler dev confirmed:
   - `/health` sees `DB` configured.
   - `/admin/status` reads D1.
   - `/admin/run-now` writes a `job_runs` row.
   - local scheduled trigger writes a `job_runs` row.
9. Remote read-only D1 query confirmed these tables exist:
   - `d1_migrations`
   - `job_listings`
   - `job_runs`

One setup issue found and fixed: Wrangler saw two Cloudflare accounts, so `wrangler.toml` now pins the `rees@fucius.ai` account ID and the D1 scripts export that account ID when running Wrangler D1 commands.
