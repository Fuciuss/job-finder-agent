export type EmailEnv = {
  RESEND_API_KEY?: string;
  SENDER_EMAIL?: string;
  RECIPIENT_EMAIL?: string;
};

export type SendEmailInput = {
  subject: string;
  text: string;
  html?: string;
  to?: string;
  from?: string;
};

export type SendEmailResult = {
  id: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireEnv(env: EmailEnv, key: keyof EmailEnv): string {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export async function sendEmail(env: EmailEnv, input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = requireEnv(env, "RESEND_API_KEY");
  const from = input.from ?? requireEnv(env, "SENDER_EMAIL");
  const to = input.to ?? requireEnv(env, "RECIPIENT_EMAIL");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });

  const result = asRecord(await response.json().catch(() => ({})));

  if (!response.ok) {
    const message =
      stringValue(result.message) ??
      stringValue(result.error) ??
      `Resend request failed with status ${response.status}`;

    throw new Error(message);
  }

  const id = stringValue(result.id);

  if (!id) {
    throw new Error("Resend response did not include an email id.");
  }

  return { id };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
