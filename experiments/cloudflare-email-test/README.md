# Cloudflare Worker Resend Email Test

Small Worker experiment for sending one fixed-recipient test email through Resend from a Cloudflare Worker.

## Prerequisites

- The sender domain is verified in Resend, or you are using Resend's sandbox sender/recipient limits.
- The parent project `.env` contains `JOB_FINDER_RESEND_API_KEY`.
- `wrangler` is installed and logged in.

## Configure

Create local Worker variables:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```bash
SENDER_EMAIL=noreply@yourdomain.com
RECIPIENT_EMAIL=you@example.com
TEST_TOKEN=a-long-random-token
```

The `dev` script loads both `../../.env` and `.dev.vars`, so `JOB_FINDER_RESEND_API_KEY` can stay in the parent project `.env`.

## Run A Local Real Send

Start the Worker:

```bash
npm run dev
```

In another terminal:

```bash
curl -X POST http://localhost:8787 \
  -H "Authorization: Bearer a-long-random-token" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Resend email test","text":"Hello from the job finder email test."}'
```

Successful response:

```json
{
  "ok": true,
  "provider": "resend",
  "messageId": "...",
  "to": "you@example.com",
  "from": "noreply@yourdomain.com",
  "subject": "Resend email test"
}
```

## Deploy

Set production variables as Worker secrets:

```bash
wrangler secret put JOB_FINDER_RESEND_API_KEY
wrangler secret put SENDER_EMAIL
wrangler secret put RECIPIENT_EMAIL
wrangler secret put TEST_TOKEN
wrangler deploy
```

Then POST to the deployed Worker URL with the same bearer token header.
