#!/usr/bin/env node
import { readFileSync } from "node:fs";

const configPath = process.env.WRANGLER_CONFIG ?? "wrangler.toml";
const config = readFileSync(configPath, "utf8");

const accountId =
  process.env.CLOUDFLARE_ACCOUNT_ID ??
  matchTomlString(config, "account_id") ??
  fail("Missing Cloudflare account ID. Set CLOUDFLARE_ACCOUNT_ID or account_id in wrangler.toml.");
const workerName =
  process.env.WORKER_NAME ??
  matchTomlString(config, "name") ??
  fail("Missing Worker name. Set WORKER_NAME or name in wrangler.toml.");

const workersSubdomain = process.env.WORKERS_DEV_SUBDOMAIN ?? "rees-e2c";
const hostname =
  process.env.ACCESS_HOSTNAME ?? `${workerName}.${workersSubdomain}.workers.dev`;
const appName = process.env.ACCESS_APP_NAME ?? "Job Finder Agent Admin";
const sessionDuration = process.env.ACCESS_SESSION_DURATION ?? "24h";
const allowedEmails = csv(process.env.ACCESS_ALLOWED_EMAILS ?? "rees@fucius.ai");
const protectedPaths = csv(process.env.ACCESS_PATHS ?? "/admin/*,/api/admin/*,/api/run-scan");
const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

const appBody = {
  name: appName,
  type: "self_hosted",
  domain: `${hostname}${protectedPaths[0]}`,
  app_launcher_visible: false,
  path_cookie_attribute: true,
  session_duration: sessionDuration,
  destinations: protectedPaths.map((path) => ({
    type: "public",
    uri: `${hostname}${path}`,
  })),
  policies: [
    {
      name: "Allow configured emails",
      decision: "allow",
      precedence: 1,
      include: allowedEmails.map((email) => ({ email: { email } })),
      session_duration: sessionDuration,
    },
  ],
};

if (dryRun) {
  console.log(JSON.stringify({ accountId, appBody }, null, 2));
  process.exit(0);
}

if (!apiToken) {
  fail(
    [
      "Missing CLOUDFLARE_API_TOKEN.",
      "Create an API token with Cloudflare Zero Trust / Access application write permission,",
      "then run: CLOUDFLARE_API_TOKEN=... npm run access:configure",
    ].join(" "),
  );
}

const existing = await findExistingApplication(appName);
const result = existing
  ? await cloudflareApi("PUT", `/access/apps/${existing.id}`, appBody)
  : await cloudflareApi("POST", "/access/apps", appBody);

console.log(
  JSON.stringify(
    {
      ok: true,
      action: existing ? "updated" : "created",
      appId: result.id,
      appName: result.name,
      domain: result.domain,
      protectedDestinations: appBody.destinations.map((destination) => destination.uri),
      allowedEmails,
      publicRoutesLeftAlone: [`${hostname}/health`],
    },
    null,
    2,
  ),
);

async function findExistingApplication(name) {
  const params = new URLSearchParams({
    name,
    exact: "true",
    per_page: "50",
  });
  const apps = await cloudflareApi("GET", `/access/apps?${params.toString()}`);
  return apps.find((app) => app.name === name) ?? null;
}

async function cloudflareApi(method, path, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    const details = payload?.errors?.length ? payload.errors : payload;
    throw new Error(
      `Cloudflare API ${method} ${path} failed with ${response.status}: ${JSON.stringify(details)}`,
    );
  }

  return payload.result;
}

function matchTomlString(source, key) {
  return source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1] ?? null;
}

function csv(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
