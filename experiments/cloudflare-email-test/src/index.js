function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function getBearerToken(request) {
  const authorization = request.headers.get("authorization") ?? "";

  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-test-token") ?? "";
}

function requireEnv(env, name) {
  const value = env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return jsonResponse({
        ok: true,
        service: "job-finder-email-test",
        usage: "POST with Authorization: Bearer <TEST_TOKEN> to send one fixed-recipient test email.",
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { ok: false, error: "Method not allowed. Use POST." },
        { status: 405, headers: { allow: "GET, POST" } },
      );
    }

    try {
      const testToken = requireEnv(env, "TEST_TOKEN");
      const suppliedToken = getBearerToken(request);

      if (suppliedToken !== testToken) {
        return jsonResponse({ ok: false, error: "Unauthorized" }, { status: 401 });
      }

      const sender = requireEnv(env, "SENDER_EMAIL");
      const recipient = requireEnv(env, "RECIPIENT_EMAIL");
      const body = await request.json().catch(() => ({}));
      const sentAt = new Date().toISOString();
      const subject = body.subject ?? "Cloudflare Email Service test - job-finder-agent";
      const text =
        body.text ??
        `Cloudflare Email Service test from job-finder-agent.\n\nSent at: ${sentAt}`;
      const html =
        body.html ??
        `<p>Cloudflare Email Service test from <strong>job-finder-agent</strong>.</p><p>Sent at: ${sentAt}</p>`;

      const result = await env.EMAIL.send({
        to: recipient,
        from: sender,
        subject,
        text,
        html,
      });

      return jsonResponse({
        ok: true,
        messageId: result.messageId,
        to: recipient,
        from: sender,
        subject,
      });
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: error.message,
          code: error.code,
        },
        { status: 500 },
      );
    }
  },
};
