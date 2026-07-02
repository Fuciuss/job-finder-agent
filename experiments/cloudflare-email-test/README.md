# Cloudflare Email Test

Small Worker experiment for sending one fixed-recipient test email through Cloudflare Email Service.

## Prerequisites

- The sender domain is onboarded under Cloudflare Email Service.
- Cloudflare DNS is authoritative for that domain.
- `wrangler` is installed and logged in.
- The recipient is allowed by the account/plan. On free setup, use a verified destination address.

## Configure

Create local variables:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```bash
SENDER_EMAIL=noreply@yourdomain.com
RECIPIENT_EMAIL=you@example.com
TEST_TOKEN=a-long-random-token
```

The `wrangler.toml` email binding has `remote = true`, so `wrangler dev` will send real emails through Cloudflare Email Service.

## Run A Local Real Send

Start the Worker:

```bash
wrangler dev
```

In another terminal:

```bash
curl -X POST http://localhost:8787 \
  -H "Authorization: Bearer a-long-random-token" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Cloudflare email test","text":"Hello from the job finder email test."}'
```

Successful response:

```json
{
  "ok": true,
  "messageId": "...",
  "to": "you@example.com",
  "from": "noreply@yourdomain.com",
  "subject": "Cloudflare email test"
}
```

## Deploy

Set production variables as Worker secrets:

```bash
wrangler secret put SENDER_EMAIL
wrangler secret put RECIPIENT_EMAIL
wrangler secret put TEST_TOKEN
wrangler deploy
```

Then POST to the deployed Worker URL with the same bearer token header.
