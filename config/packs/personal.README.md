# Personal Policy Pack

## Who This Is For

Solo developers, individual researchers, or anyone using an AI agent for personal productivity. You want basic safety guardrails without the overhead of approval workflows.

## What's Included

### Rules

| Rule | Action | Purpose |
|------|--------|---------|
| allow-read-tools | allow | Read, search, and list without friction |
| allow-write-tools | allow | Create and modify content freely |
| block-destructive | deny | Prevent accidental deletion or data loss |
| block-admin | deny | Prevent system-level changes |
| allow-general | allow | Default-allow for everything else |

### Surfaces

- **default** — General-purpose surface for all operations
- **personal-workspace** — Your personal workspace with full access

### Trust Tiers

- **standard** — No approval required, no audit overhead

## What This Pack Does NOT Cover

- Multi-user access control (use the `team` pack)
- Financial transaction governance (use the `fintech` pack)
- Sensitive data protection (use `healthcare` or `saas`)
- Audit trails or compliance logging
- Approval workflows

## Customization Tips

- Add specific tool patterns to `block-destructive` if you have custom destructive tools
- Remove `allow-general` if you prefer an explicit-allow model
- Add a `require-confirmation` rule for tools you want to approve case-by-case
