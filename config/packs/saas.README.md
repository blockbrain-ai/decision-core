# SaaS Policy Pack

## Who This Is For

Platform teams building multi-tenant SaaS applications. Suitable for API platforms, B2B tools, marketplace systems, and any service with tenant isolation requirements.

## What's Included

### Rules

| Rule | Action | Purpose |
|------|--------|---------|
| allow-public-api-read | allow | Public API reads without restriction |
| deny-cross-tenant | deny | Strict tenant isolation enforcement |
| allow-tenant-read | allow | Tenants read their own data |
| approve-tenant-write | approve_required | Tenant data writes need approval |
| rate-limit-api | deny | 10,000 ops/day rate limit |
| approve-user-data-modify | approve_required | User PII changes need approval |
| deny-user-data-delete | deny | User data deletion blocked |
| approve-admin-operations | approve_required | Admin ops need elevated trust |
| approve-billing | approve_required | Billing needs dual authorization |
| block-billing-destructive | deny | No destructive billing operations |
| allow-webhook-send | allow | Outbound webhooks permitted |
| cooldown-bulk-operations | deny | 15-min cooldown between bulk ops |

### Surfaces

- **public-api** — Public endpoints, rate-limited
- **tenant-data** — Tenant-scoped, isolated data
- **user-data** — End-user PII and preferences
- **admin** — Platform settings and configuration
- **billing** — Subscriptions and payments
- **integrations** — Webhooks and third-party connectors

### Trust Tiers

- **standard** — Public/integrations, rate-limited
- **elevated** — Tenant/user data, audit + approval for writes
- **restricted** — Admin/billing, dual authorization

## What This Pack Does NOT Cover

- Specific API gateway integration (rate limiting at gateway level)
- OAuth/OIDC token validation rules
- Feature flag governance
- Infrastructure scaling policies
- SLA enforcement rules
- Marketplace-specific vendor policies

## Customization Tips

- Adjust `rate-limit-api` to match your tier pricing
- Add tenant-tier-specific rules (free vs. paid vs. enterprise)
- Configure `cooldown-bulk-operations` based on your data volume
- Add webhook retry and failure handling rules
- Consider adding geographic routing rules for data residency
