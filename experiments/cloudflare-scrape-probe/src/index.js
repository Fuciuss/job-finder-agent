// Reachability probe for the job-finder scrapers, run from Cloudflare's network.
//
// It answers one question: do the AI Jobs Australia bootstrap (HTML + JS bundle)
// and the Supabase REST endpoint work when the request egresses from a Cloudflare
// IP instead of a laptop? Run it with `wrangler dev --remote` or deploy it, because
// a plain local `wrangler dev` egresses from your own IP and would not test that.
//
// The discovery logic here mirrors scripts/scrape_aijobs_australia.py exactly.

const BASE_URL = "https://www.aijobsaustralia.com.au";

// Same patterns as the Python scraper.
const SCRIPT_RE = /(?:src|href)=["']([^"']+\.js[^"']*)["']/g;
const SUPABASE_CONFIG_RE =
  /["'](https:\/\/[a-z0-9]+\.supabase\.co)["']\s*,\s*["'](eyJ[A-Za-z0-9._-]+)["']/;

// Markers that indicate a bot-challenge / interstitial rather than real content.
// These frequently return HTTP 200, so status alone is not enough.
const CHALLENGE_RE =
  /(cf-challenge|challenge-platform|cf-chl|Just a moment|Attention Required|DataDome|_Incapsula_|Access denied|are you a human|hcaptcha|recaptcha)/i;

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

// A browser-ish UA. The Python scraper uses a custom UA; a real browser UA is a
// stricter test of whether we get through bot protection, so we use one here.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchText(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/javascript,text/javascript,*/*",
      ...extraHeaders,
    },
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

function absoluteUrl(pathOrUrl) {
  return new URL(pathOrUrl, BASE_URL).toString();
}

// Report the IP this Worker egresses from, so the difference between local dev
// (your IP) and --remote / deployed (a Cloudflare IP) is visible in the output.
async function egressIp() {
  try {
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
      headers: { "user-agent": UA },
    });
    const text = await res.text();
    const ip = /ip=([^\n]+)/.exec(text)?.[1] ?? null;
    const loc = /loc=([^\n]+)/.exec(text)?.[1] ?? null;
    const colo = /colo=([^\n]+)/.exec(text)?.[1] ?? null;
    return { ip, loc, colo };
  } catch (error) {
    return { error: error.message };
  }
}

// Step 1-3: fetch /jobs, find JS chunks, extract the public Supabase config.
async function discoverConfig(maxScripts) {
  const jobs = await fetchText(`${BASE_URL}/jobs`);
  const looksLikeChallenge = CHALLENGE_RE.test(jobs.text);

  const scriptUrls = [
    ...new Set([...jobs.text.matchAll(SCRIPT_RE)].map((m) => absoluteUrl(m[1]))),
  ].sort();

  const result = {
    htmlStatus: jobs.status,
    htmlBytes: jobs.text.length,
    looksLikeChallenge,
    scriptCount: scriptUrls.length,
    sampleScripts: scriptUrls.slice(0, 5),
    scriptsScanned: 0,
    configFound: false,
    supabaseUrl: null,
    anonKeyPrefix: null,
    foundInScript: null,
  };

  if (jobs.status !== 200 || looksLikeChallenge || scriptUrls.length === 0) {
    return result; // bootstrap blocked or empty — stop here, config unreachable
  }

  const toScan = scriptUrls.slice(0, maxScripts);
  for (const scriptUrl of toScan) {
    result.scriptsScanned += 1;
    let script;
    try {
      script = await fetchText(scriptUrl);
    } catch {
      continue;
    }
    if (script.status !== 200) continue;
    const match = SUPABASE_CONFIG_RE.exec(script.text);
    if (match) {
      result.configFound = true;
      result.supabaseUrl = match[1];
      result.anonKeyPrefix = match[2].slice(0, 12) + "…"; // never echo the full key
      result.foundInScript = scriptUrl;
      // stash the real key on a non-enumerable field for the caller, not the output
      Object.defineProperty(result, "_anonKey", { value: match[2] });
      break;
    }
  }
  return result;
}

// Step 4: hit the Supabase REST endpoint the way the real scraper will. We only
// ask for one id and an exact count, so this is cheap and proves reachability.
async function probeSupabase(supabaseUrl, anonKey) {
  const url = `${supabaseUrl}/rest/v1/jobs?select=id&status=eq.approved&order=created_at.desc`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        accept: "application/json",
        prefer: "count=exact",
        "range-unit": "items",
        range: "0-0",
      },
    });
    const contentRange = res.headers.get("content-range");
    const total = contentRange?.includes("/")
      ? contentRange.split("/").pop()
      : null;
    let sampleId = null;
    try {
      const body = await res.json();
      if (Array.isArray(body) && body[0]) sampleId = body[0].id ?? null;
    } catch {
      /* non-JSON body (error/challenge) — leave sampleId null */
    }
    return {
      status: res.status,
      ok: res.ok,
      contentRange,
      approvedTotal: total,
      sampleId,
    };
  } catch (error) {
    return { error: error.message };
  }
}

export default {
  async fetch(request, env) {
    // Optional token gate: only enforced if TEST_TOKEN is configured.
    if (env.TEST_TOKEN) {
      const auth = request.headers.get("authorization") ?? "";
      const supplied = auth.startsWith("Bearer ")
        ? auth.slice(7).trim()
        : request.headers.get("x-test-token") ?? "";
      if (supplied !== env.TEST_TOKEN) {
        return jsonResponse({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const maxScripts = Number(env.MAX_SCRIPTS ?? 60);
    const egress = await egressIp();

    // Cached-config hot path: if the config is supplied as vars, skip the HTML
    // bootstrap entirely — this mirrors the production steady state.
    if (env.AIJOBS_SUPABASE_URL && env.AIJOBS_SUPABASE_ANON_KEY) {
      const supabase = await probeSupabase(
        env.AIJOBS_SUPABASE_URL,
        env.AIJOBS_SUPABASE_ANON_KEY,
      );
      return jsonResponse({
        ok: supabase.ok === true,
        mode: "cached-config (bootstrap skipped)",
        egress,
        supabase,
      });
    }

    // Full bootstrap path: HTML -> JS bundle -> config -> Supabase.
    const discovery = await discoverConfig(maxScripts);
    let supabase = null;
    if (discovery.configFound) {
      supabase = await probeSupabase(discovery.supabaseUrl, discovery._anonKey);
    }

    const bootstrapOk =
      discovery.htmlStatus === 200 &&
      !discovery.looksLikeChallenge &&
      discovery.configFound;

    return jsonResponse({
      ok: bootstrapOk && supabase?.ok === true,
      mode: "full-bootstrap",
      egress,
      verdict: {
        htmlReachable: discovery.htmlStatus === 200 && !discovery.looksLikeChallenge,
        configDiscovered: discovery.configFound,
        supabaseReachable: supabase?.ok === true,
      },
      discovery,
      supabase,
    });
  },
};
