# Team Policy Pack

## Who This Is For

Engineering teams sharing an AI agent for collaborative work. You need moderate governance: reads are free, but writes to shared resources need oversight.

## What's Included

### Rules

| Rule | Action | Purpose |
|------|--------|---------|
| allow-read-tools | allow | Free read access across all surfaces |
| approve-shared-writes | approve_required | Gate writes to shared resources |
| allow-personal-writes | allow | Personal workspace writes are unblocked |
| approve-publish | approve_required | Publishing/deploying needs team sign-off |
| block-destructive | deny | No deletion on shared or admin surfaces |
| deny-admin-default | deny | Admin surface blocked by default |
| approve-admin-read | approve_required | Admin reads with explicit approval |

### Surfaces

- **shared** — Team documents, code, and configurations
- **personal** — Individual workspace (drafts, notes)
- **admin** — Settings, permissions, integrations

### Trust Tiers

- **standard** — No approval needed (personal workspace)
- **elevated** — Approval for modifications (shared resources)
- **restricted** — Denied by default (admin operations)

## What This Pack Does NOT Cover

- Financial transaction controls (use `fintech`)
- Patient data protection (use `healthcare`)
- Multi-tenant isolation (use `saas`)
- Regulatory compliance audit trails
- Role-based access control beyond surface grouping

## Customization Tips

- Add team-specific surfaces (e.g., `staging`, `production`) with appropriate trust tiers
- Adjust `approve-publish` tools list for your deployment toolchain
- Add time-window rules to restrict operations outside work hours
- Consider adding rate limits for shared resource modifications
