#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

loadDotEnv(".env");

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  printUsage();
  process.exit(0);
}

const configPath = args.config ?? process.env.WRANGLER_CONFIG ?? "wrangler.toml";
const config = readFileSync(configPath, "utf8");
const accountId =
  args.accountId ??
  process.env.CLOUDFLARE_ACCOUNT_ID ??
  matchTomlString(config, "account_id") ??
  fail("Missing Cloudflare account ID. Set CLOUDFLARE_ACCOUNT_ID or account_id in wrangler.toml.");
const workerName =
  args.worker ??
  process.env.WORKER_NAME ??
  matchTomlString(config, "name") ??
  fail("Missing Worker name. Set WORKER_NAME or name in wrangler.toml.");
const apiToken =
  process.env.JOB_FINDER_CLOUDFLARE_API_TOKEN ??
  process.env.CLOUDFLARE_API_TOKEN ??
  fail("Missing JOB_FINDER_CLOUDFLARE_API_TOKEN in .env.");

const now = Date.now();
const lookbackMinutes = parseInteger(args.lookbackMinutes ?? args.lookback ?? "60", "lookback");
const from = args.from ? parseTimestamp(args.from, "from") : now - lookbackMinutes * 60 * 1000;
const to = args.to ? parseTimestamp(args.to, "to") : now;
const limit = parseInteger(args.limit ?? "50", "limit");
const view = args.view ?? "events";

const filters = [
  {
    key: "$metadata.service",
    operation: "eq",
    type: "string",
    value: workerName,
  },
];

if (args.level) {
  filters.push({
    key: "$metadata.level",
    operation: "eq",
    type: "string",
    value: args.level,
  });
}

if (args.url) {
  filters.push({
    key: "$metadata.url",
    operation: "includes",
    type: "string",
    value: args.url,
  });
}

if (args.requestId) {
  filters.push({
    key: "$metadata.requestId",
    operation: "eq",
    type: "string",
    value: args.requestId,
  });
}

const parameters = {
  datasets: args.dataset ? [args.dataset] : ["cloudflare-workers"],
  filterCombination: "and",
  filters,
  limit,
};

if (args.needle) {
  parameters.needle = {
    value: args.needle,
    isRegex: args.regex === "true" || args.regex === "1",
    matchCase: args.matchCase === "true" || args.matchCase === "1",
  };
}

const body = {
  queryId: args.queryId ?? `adhoc-${workerName}-${Date.now()}`,
  view,
  timeframe: { from, to },
  limit,
  dry: true,
  parameters,
};

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  },
);

const payload = await response.json().catch(() => null);

if (!response.ok || !payload?.success) {
  const details = payload?.errors?.length ? payload.errors : payload;
  fail(`Cloudflare logs query failed with ${response.status}: ${JSON.stringify(details, null, 2)}`);
}

if (args.raw === "true" || args.raw === "1") {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

printSummary(payload, { from, to, workerName, view });

function printSummary(payload, context) {
  const result = payload.result ?? {};
  const statistics = result.statistics ?? result.run?.statistics ?? {};

  console.log(
    JSON.stringify(
      {
        worker: context.workerName,
        view: context.view,
        timeframe: {
          from: new Date(context.from).toISOString(),
          to: new Date(context.to).toISOString(),
        },
        statistics,
      },
      null,
      2,
    ),
  );

  if (context.view === "events") {
    const events = result.events?.events ?? [];
    console.log(JSON.stringify({ count: result.events?.count ?? events.length }, null, 2));

    for (const event of events) {
      console.log(JSON.stringify(summarizeEvent(event), null, 2));
    }
    return;
  }

  if (context.view === "invocations") {
    const invocations = result.invocations ?? {};
    console.log(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(invocations).map(([requestId, events]) => [
            requestId,
            Array.isArray(events) ? events.map(summarizeEvent) : events,
          ]),
        ),
        null,
        2,
      ),
    );
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

function summarizeEvent(event) {
  const metadata = event.$metadata ?? {};
  const workers = event.$workers ?? {};
  return {
    timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : null,
    level: metadata.level ?? null,
    message: metadata.message ?? null,
    error: metadata.error ?? null,
    service: metadata.service ?? workers.scriptName ?? null,
    trigger: metadata.trigger ?? null,
    url: metadata.url ?? null,
    requestId: metadata.requestId ?? workers.requestId ?? null,
    type: metadata.type ?? null,
    eventType: workers.eventType ?? null,
    outcome: workers.outcome ?? null,
    statusCode: metadata.statusCode ?? null,
    cpuTimeMs: workers.cpuTimeMs ?? null,
    wallTimeMs: workers.wallTimeMs ?? null,
    source: event.source ?? null,
  };
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const key = match[1];
    if (process.env[key] !== undefined) continue;

    process.env[key] = parseEnvValue(match[2]);
  }
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }

    const equalsIndex = arg.indexOf("=");
    if (equalsIndex !== -1) {
      parsed[normalizeArgName(arg.slice(2, equalsIndex))] = arg.slice(equalsIndex + 1);
      continue;
    }

    const key = normalizeArgName(arg.slice(2));
    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function normalizeArgName(name) {
  return name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function parseTimestamp(value, name) {
  if (/^\d+$/.test(value)) return Number(value);

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) fail(`Invalid ${name} timestamp: ${value}`);
  return parsed;
}

function parseInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) fail(`Invalid ${name}: ${value}`);
  return parsed;
}

function matchTomlString(source, key) {
  return source.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1] ?? null;
}

function printUsage() {
  console.log(`Usage:
  npm run logs:query -- [options]

Options:
  --from <iso|ms>             Start time. Defaults to now minus --lookback.
  --to <iso|ms>               End time. Defaults to now.
  --lookback <minutes>        Lookback window when --from is omitted. Default: 60.
  --needle <text>             Full-text search across event fields.
  --level <level>             Filter by log level, for example info or error.
  --url <text>                Filter events whose URL includes this text.
  --request-id <id>           Filter by Cloudflare request ID.
  --limit <number>            Max events. Default: 50.
  --view <events|invocations> Query view. Default: events.
  --raw true                  Print the full Cloudflare API response.
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
