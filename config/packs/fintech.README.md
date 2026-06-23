# Fintech Policy Pack

## Who This Is For

Financial services teams with regulatory obligations. Suitable for payment processors, banking applications, trading platforms, and any system handling financial transactions.

## What's Included

### Rules

| Rule | Action | Purpose |
|------|--------|---------|
| allow-read-public | allow | Public market data freely accessible |
| approve-internal-read | allow | Internal data with audit trail |
| auto-approve-low-value | allow | Transactions < $1,000 auto-approved |
| approve-medium-value | approve_required | $1,000-$50,000 needs approval |
| deny-high-value | deny | > $50,000 requires manual processing |
| require-sanctions-check | approve_required | Counterparty screening mandatory |
| dual-auth-high-risk | approve_required | Dual authorization for high-risk ops |
| block-destructive | deny | No destructive financial operations |
| rate-limit-transactions | deny | Max 100 transactions/day |
| block-off-hours | deny | No high-value ops outside 06:00-22:00 |

### Surfaces

- **public** — Market data, non-sensitive information
- **internal** — Accounts, balances, positions
- **confidential** — Customer PII, transaction details
- **restricted** — High-value transfers, regulatory submissions

### Trust Tiers

- **standard** — Public data, no approval
- **elevated** — Internal data, audit required
- **restricted** — Confidential, approval + audit
- **critical** — Regulatory, dual authorization

## What This Pack Does NOT Cover

- Specific regulatory framework compliance (e.g., PCI-DSS, SOX)
- KYC/AML workflow orchestration beyond initial screening gates
- Real-time fraud detection rules
- Market-specific trading restrictions
- Currency-specific controls

## Customization Tips

- Adjust amount thresholds to match your transaction profile
- Add currency-specific rules if operating across multiple currencies
- Configure `block-off-hours` time windows for your timezone
- Add counterparty-specific rules for known high-risk entities
- Increase `rate-limit-transactions` based on your normal volume
