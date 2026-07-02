# Cloudflare Access Programmatic Configuration

Date: 2026-07-02

Cloudflare Access can be configured programmatically, but not through `wrangler.toml` alone.

## Key distinction

`wrangler.toml` owns Worker deployment concerns:

- Worker name and entrypoint
- `workers.dev` enable/disable
- custom routes
- cron triggers
- bindings such as D1, Queues, R2, Email, Workflows

Cloudflare Access lives in Cloudflare Zero Trust:

- protected hostname/path
- login method
- allowed emails/groups
- session duration
- Access application policy

## Programmatic options

Use Terraform/OpenTofu for repo-managed infrastructure once this app stabilizes. Use the Cloudflare API for scripts or one-off automation.

Wrangler is not the right owner for full Access app and policy configuration.

Example Terraform shape:

```hcl
resource "cloudflare_zero_trust_access_policy" "only_rees" {
  account_id = var.cloudflare_account_id
  name       = "Only Rees"
  decision   = "allow"

  include {
    email = ["rees@example.com"]
  }
}

resource "cloudflare_zero_trust_access_application" "job_finder" {
  account_id       = var.cloudflare_account_id
  name             = "Job Finder Agent"
  domain           = "job-finder-agent.YOUR_SUBDOMAIN.workers.dev"
  type             = "self_hosted"
  session_duration = "24h"

  policies = [
    cloudflare_zero_trust_access_policy.only_rees.id
  ]
}
```

If the app later moves to a custom domain, change the Access application domain to something like:

```hcl
domain = "jobs.yourdomain.com"
```

## Practical recommendation

For the first deploy, configuring Access once in the Cloudflare dashboard is acceptable. When the app has a stable hostname and deployment shape, move Access into Terraform/OpenTofu so the security boundary is reproducible from source control.
