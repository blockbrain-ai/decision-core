# Policy Packs

Pre-built policy configurations for common governance use cases. Each pack provides sensible defaults that can be customized for specific requirements.

## Available Packs

| Pack | Profile | Use Case |
|------|---------|----------|
| [personal](personal.yaml) | personal | Solo developer/agent with minimal ceremony |
| [team](team.yaml) | team | Engineering team sharing an agent |
| [fintech](fintech.yaml) | enterprise | Financial services with regulatory obligations |
| [healthcare](healthcare.yaml) | enterprise | Health-tech with patient data sensitivity |
| [saas](saas.yaml) | enterprise | Multi-tenant platform with API concerns |

## Usage

Reference a pack in your `decision-core.yaml`:

```yaml
policyPackPath: config/packs/personal.yaml
```

Or load programmatically:

```typescript
import { loadBundledPack } from './src/packs/pack-loader.js';

const pack = loadBundledPack('personal');
```

## Pack Structure

Each pack YAML contains:

- **name/version/description** — Pack metadata
- **profile** — Governance profile (personal, team, enterprise)
- **rules** — Policy rules with deny-wins semantics
- **surfaces** — Logical groupings with trust tier assignments
- **trustTiers** — Trust levels controlling approval and audit requirements
- **exampleTools** — Sample tool names the pack is designed to govern

## Customization

Packs are starting points. Copy a pack and modify it for your specific needs:

1. Start with the closest matching pack
2. Adjust rules and thresholds for your risk tolerance
3. Add surfaces specific to your application
4. Configure trust tiers to match your organization's approval workflows

## Important Notes

- Packs do not claim regulatory compliance — they are informed by common patterns
- Enterprise packs (fintech, healthcare, saas) default to restrictive postures
- The personal pack is intentionally permissive for low-friction solo use
- All packs enforce deny-wins: if any rule denies, the action is blocked
