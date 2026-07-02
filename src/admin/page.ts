export type AdminRun = {
  id: string;
  sourceKey: string;
  purpose: string;
  location: string | null;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  rawCount: number | null;
  filteredCount: number | null;
  newCount: number | null;
  changedCount: number | null;
  unchangedCount: number | null;
  error: string | null;
};

export type AdminListing = {
  id: string;
  sourceKey: string;
  sourceUrl: string;
  title: string;
  companyName: string;
  location: string | null;
  processingStatus: string;
  fitScore: number | null;
  fitLabel: string | null;
  fitRationale: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  emailedAt: Date | null;
};

export type AdminListingStats = {
  total: number;
  unprocessed: number;
  processed: number;
  failed: number;
  pendingEmail: number;
  actionToday: number;
  verify: number;
  peopleRoute: number;
  marketIntel: number;
  skip: number;
};

export type AdminStatusData = {
  ok: true;
  service: string;
  checkedAt: string;
  database: {
    binding: "DB";
    bound: boolean;
  };
  lastRun: AdminRun | null;
  listings: AdminListingStats;
  recentRuns: AdminRun[];
  failedRuns: AdminRun[];
  recentListings: AdminListing[];
};

export function renderAdminPage(data: AdminStatusData): string {
  const latestState = data.lastRun?.status ?? "no runs";
  const latestStarted = formatDateTime(data.lastRun?.startedAt ?? null);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Job Finder Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --surface: #ffffff;
      --surface-subtle: #f1f3f5;
      --line: #d7dce2;
      --line-strong: #b6bec8;
      --text: #17202a;
      --muted: #5f6b7a;
      --strong: #0f1720;
      --good: #166534;
      --warn: #9a3412;
      --bad: #b42318;
      --info: #075985;
      --shadow: 0 1px 2px rgba(15, 23, 32, 0.08);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      line-height: 1.45;
    }

    a {
      color: var(--info);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    .shell {
      width: min(1440px, 100%);
      margin: 0 auto;
      padding: 24px;
    }

    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }

    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .subtitle {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    button,
    .button {
      min-height: 36px;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      background: var(--surface);
      color: var(--strong);
      padding: 8px 12px;
      font: inherit;
      cursor: pointer;
      box-shadow: var(--shadow);
    }

    button.primary {
      background: #17202a;
      border-color: #17202a;
      color: #ffffff;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }

    .notice {
      display: none;
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
      padding: 10px 12px;
      white-space: pre-wrap;
    }

    .notice.show {
      display: block;
    }

    .notice.error {
      border-color: #f0b4ad;
      color: var(--bad);
      background: #fff7f6;
    }

    .grid {
      display: grid;
      gap: 16px;
      margin-top: 18px;
    }

    .metrics {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }

    .metric,
    .panel {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }

    .metric {
      min-height: 96px;
      padding: 14px;
    }

    .metric-label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .metric-value {
      margin-top: 8px;
      font-size: 28px;
      line-height: 1;
      font-weight: 700;
      color: var(--strong);
    }

    .metric-note {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .two-col {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
    }

    .panel {
      overflow: hidden;
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: var(--surface-subtle);
    }

    h2 {
      margin: 0;
      font-size: 15px;
      letter-spacing: 0;
    }

    .panel-meta {
      color: var(--muted);
      font-size: 12px;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 760px;
    }

    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #fbfcfd;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .status {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 600;
      background: var(--surface-subtle);
      color: var(--muted);
      white-space: nowrap;
    }

    .status.succeeded,
    .status.processed,
    .status.action_today {
      background: #eaf7ee;
      color: var(--good);
    }

    .status.running,
    .status.unprocessed,
    .status.verify,
    .status.people_route {
      background: #fff4e8;
      color: var(--warn);
    }

    .status.failed {
      background: #fff0ee;
      color: var(--bad);
    }

    .status.market_intel,
    .status.skip {
      background: #eef2f6;
      color: var(--muted);
    }

    .muted {
      color: var(--muted);
    }

    .nowrap {
      white-space: nowrap;
    }

    .truncate {
      max-width: 360px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .score {
      font-weight: 700;
      color: var(--strong);
    }

    .empty {
      padding: 22px 14px;
      color: var(--muted);
    }

    @media (max-width: 980px) {
      .shell {
        padding: 16px;
      }

      .topbar {
        flex-direction: column;
      }

      .actions {
        justify-content: flex-start;
      }

      .metrics,
      .two-col {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 560px) {
      .actions {
        width: 100%;
      }

      button,
      .button {
        flex: 1 1 100%;
      }

      h1 {
        font-size: 20px;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>Job Finder Admin</h1>
        <div class="subtitle">Checked ${escapeHtml(formatDateTime(data.checkedAt))}. Latest run: ${escapeHtml(latestState)} at ${escapeHtml(latestStarted)}.</div>
      </div>
      <div class="actions">
        <a class="button" href="/admin/status">JSON status</a>
        <button type="button" data-action="/admin/test-email">Send test email</button>
        <button class="primary" type="button" data-action="/admin/run-now">Run now</button>
      </div>
    </header>

    <div id="notice" class="notice" role="status" aria-live="polite"></div>

    <section class="grid metrics" aria-label="Summary metrics">
      ${metric("Total listings", data.listings.total, "All deduped source listings")}
      ${metric("Unprocessed", data.listings.unprocessed, "Awaiting assessment")}
      ${metric("Pending email", data.listings.pendingEmail, "No digest/email marker yet")}
      ${metric("Action today", data.listings.actionToday, "Strongest assessed matches")}
      ${metric("Failed", data.listings.failed, "Listings with processing errors")}
    </section>

    <section class="grid two-col">
      <div class="panel">
        <div class="panel-head">
          <h2>Recent Runs</h2>
          <span class="panel-meta">${data.recentRuns.length} shown</span>
        </div>
        ${renderRunsTable(data.recentRuns)}
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>Fit Labels</h2>
          <span class="panel-meta">processed listings</span>
        </div>
        ${renderLabelTable(data.listings)}
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <div class="panel-head">
          <h2>Recent Listings</h2>
          <span class="panel-meta">${data.recentListings.length} shown</span>
        </div>
        ${renderListingsTable(data.recentListings)}
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <div class="panel-head">
          <h2>Recent Failures</h2>
          <span class="panel-meta">${data.failedRuns.length} shown</span>
        </div>
        ${renderFailures(data.failedRuns)}
      </div>
    </section>
  </main>

  <script>
    const notice = document.getElementById("notice");
    const buttons = document.querySelectorAll("button[data-action]");

    function showNotice(text, isError = false) {
      notice.textContent = text;
      notice.className = isError ? "notice show error" : "notice show";
    }

    async function postAction(button) {
      const endpoint = button.getAttribute("data-action");
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "Working...";
      showNotice("Posting to " + endpoint + "...");

      try {
        const response = await fetch(endpoint, { method: "POST" });
        const data = await response.json();
        showNotice(JSON.stringify(data, null, 2), !response.ok || data.ok === false);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : String(error), true);
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => postAction(button));
    });
  </script>
</body>
</html>`;
}

export function renderAdminErrorPage(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Job Finder Admin Error</title>
  <style>
    body {
      margin: 0;
      background: #f6f7f9;
      color: #17202a;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(760px, 100%);
      margin: 0 auto;
      padding: 32px 20px;
    }

    .panel {
      background: #ffffff;
      border: 1px solid #d7dce2;
      border-radius: 8px;
      padding: 18px;
    }

    h1 {
      margin: 0 0 10px;
      font-size: 20px;
      letter-spacing: 0;
    }

    pre {
      white-space: pre-wrap;
      color: #b42318;
    }
  </style>
</head>
<body>
  <main>
    <div class="panel">
      <h1>Admin page failed to load</h1>
      <pre>${escapeHtml(message)}</pre>
    </div>
  </main>
</body>
</html>`;
}

function metric(label: string, value: number, note: string): string {
  return `<div class="metric">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value">${formatNumber(value)}</div>
    <div class="metric-note">${escapeHtml(note)}</div>
  </div>`;
}

function renderRunsTable(runs: AdminRun[]): string {
  if (runs.length === 0) {
    return `<div class="empty">No job runs recorded yet.</div>`;
  }

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Source</th>
          <th>Status</th>
          <th>Started</th>
          <th>Raw</th>
          <th>New</th>
          <th>Changed</th>
          <th>Unchanged</th>
        </tr>
      </thead>
      <tbody>
        ${runs
          .map(
            (run) => `<tr>
              <td>
                <div class="stack">
                  <strong>${escapeHtml(sourceLabel(run.sourceKey))}</strong>
                  <span class="muted">${escapeHtml(run.location ?? run.purpose)}</span>
                </div>
              </td>
              <td>${statusBadge(run.status)}</td>
              <td class="nowrap">${escapeHtml(formatDateTime(run.startedAt))}</td>
              <td>${formatCount(run.rawCount)}</td>
              <td>${formatCount(run.newCount)}</td>
              <td>${formatCount(run.changedCount)}</td>
              <td>${formatCount(run.unchangedCount)}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>`;
}

function renderLabelTable(stats: AdminListingStats): string {
  const rows = [
    ["action_today", "Action today", stats.actionToday],
    ["verify", "Verify", stats.verify],
    ["people_route", "People route", stats.peopleRoute],
    ["market_intel", "Market intel", stats.marketIntel],
    ["skip", "Skip", stats.skip],
  ];

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Label</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            ([key, label, count]) => `<tr>
              <td>${statusBadge(String(key), String(label))}</td>
              <td>${formatNumber(Number(count))}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>`;
}

function renderListingsTable(listings: AdminListing[]): string {
  if (listings.length === 0) {
    return `<div class="empty">No job listings recorded yet.</div>`;
  }

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>Source</th>
          <th>Fit</th>
          <th>Status</th>
          <th>Seen</th>
        </tr>
      </thead>
      <tbody>
        ${listings
          .map(
            (listing) => `<tr>
              <td>
                <div class="stack">
                  <a class="truncate" href="${escapeAttribute(safeHref(listing.sourceUrl))}" target="_blank" rel="noreferrer">${escapeHtml(listing.title)}</a>
                  <span class="muted truncate">${escapeHtml(listing.companyName)}${listing.location ? ` - ${escapeHtml(listing.location)}` : ""}</span>
                  ${listing.fitRationale ? `<span class="muted truncate">${escapeHtml(listing.fitRationale)}</span>` : ""}
                </div>
              </td>
              <td>${escapeHtml(sourceLabel(listing.sourceKey))}</td>
              <td>
                <div class="stack">
                  <span class="score">${listing.fitScore === null ? "-" : formatNumber(listing.fitScore)}</span>
                  ${listing.fitLabel ? statusBadge(listing.fitLabel) : `<span class="muted">unscored</span>`}
                </div>
              </td>
              <td>${statusBadge(listing.processingStatus)}</td>
              <td class="nowrap">${escapeHtml(formatDateTime(listing.firstSeenAt))}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>`;
}

function renderFailures(runs: AdminRun[]): string {
  if (runs.length === 0) {
    return `<div class="empty">No failed runs recorded.</div>`;
  }

  return `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Run</th>
          <th>Started</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        ${runs
          .map(
            (run) => `<tr>
              <td>
                <div class="stack">
                  <strong>${escapeHtml(sourceLabel(run.sourceKey))}</strong>
                  <span class="muted">${escapeHtml(run.location ?? run.purpose)}</span>
                </div>
              </td>
              <td class="nowrap">${escapeHtml(formatDateTime(run.startedAt))}</td>
              <td>${escapeHtml(run.error ?? "Unknown error")}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  </div>`;
}

function statusBadge(value: string, label = value): string {
  return `<span class="status ${escapeAttribute(value)}">${escapeHtml(label.replace(/_/g, " "))}</span>`;
}

function sourceLabel(sourceKey: string): string {
  if (sourceKey === "aijobs_australia") return "AI Jobs Australia";
  if (sourceKey === "linkedin_jobs") return "LinkedIn";
  return sourceKey.replace(/_/g, " ");
}

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : formatNumber(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-AU").format(value);
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  }).format(date);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function safeHref(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "#";
  } catch {
    return "#";
  }
}
