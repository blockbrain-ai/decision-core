# Decision Core Onboarding

## Quick Start

```bash
npm install @decision-core/core
decision-core setup
```

Setup detects your agent harness, memory sources, and provider configuration, then generates structured policies under `.decision-core/`.

## Fresh Install vs Existing Deployments

Decision Core onboarding supports both:

- **fresh installs** — no existing harness or memory system yet
- **existing installs** — Hermes, OpenClaw, G-Brain, or other memory sources are already in place

For existing installs, the recommended flow is:

1. run `decision-core setup --dry-run --json` first
2. confirm the detected harness, memory sources, and provider mode
3. review the generated `.decision-core/` artifacts before activation
4. keep the existing Hermes/OpenClaw/G-Brain data where it already lives
5. add Decision Core around the current host instead of rebuilding the host from scratch

If you already have G-Brain, configure Decision Core to reuse it as the evidence
sink. Do not create a second memory system unless you explicitly want one.

For existing Hermes + G-Brain deployments specifically:

- keep Hermes and G-Brain running where they already live
- prefer the G-Brain HTTP transport over the CLI transport when G-Brain HTTP is
  using a PGLite-backed store
- keep `DC_API_KEY` and `DC_AGENT_ID` in per-agent env files and reference them
  from Hermes config with `${...}` rather than pasting raw secrets into YAML
- keep search-provider values such as `brave-free` under Hermes web settings, not
  under `terminal.backend`
- verify service-managed Hermes agents with `systemctl status`; some Hermes
  builds misreport `hermes gateway status --system`

## Agent-Led Setup

The recommended path is to let your existing agent drive setup:

1. Install Decision Core
2. Load the `agent-onboard` skill (`skills/agent-onboard/SKILL.md`)
3. The agent calls `dc_setup_detect` to scan your environment
4. The agent asks for memory read consent
5. The agent gathers evidence from consented sources
6. The agent calls `dc_setup_infer` with evidence
7. The agent asks remaining interview questions
8. The agent calls `dc_setup_generate` to produce artifacts
9. The agent writes returned artifacts to `.decision-core/`
10. The agent calls `dc_setup_validate` to verify policies
11. The agent verifies the active runtime pack with `decision-core doctor`

## CLI Setup

For manual or scripted use:

```bash
# Auto-detect everything, interactive interview for missing fields
decision-core setup

# Specify harness and mode explicitly
decision-core setup --agent openclaw --profile business

# Import memory evidence from a file
decision-core setup --memory-export evidence.json

# Dry run — generates artifacts without writing to disk
decision-core setup --dry-run --json

# Full flags
decision-core setup \
  --agent auto \
  --profile personal \
  --provider disabled \
  --memory-source none \
  --output .decision-core \
  --dry-run \
  --json
```

## Setup Phases

### 1. Detection

Setup scans for:
- **Agent harness**: OpenClaw, Hermes, generic Node.js, or standalone
- **Provider env vars**: Anthropic, OpenAI, Google, Mistral, Groq, Cohere, Together, OpenRouter, Ollama, LM Studio
- **Tool manifests**: `.mcp.json`, `openclaw.plugin.json`, `CLAUDE.md`
- **Memory sources**: G-Brain, MemPalace, OpenClaw native, Hermes, Obsidian/Markdown, Mem0, Honcho, Zep/Graphiti

### 2. Memory Evidence

With your consent, setup reads detected memory sources to infer:
- Profile mode (personal/team/business/enterprise)
- Autonomy posture
- Data classifications
- Primary jobs and tool requirements

Memory evidence informs recommendations but never becomes policy truth. All generated policies are based on confirmed profile fields.

### 3. Interview

Setup asks only for missing or low-confidence fields. Users with strong memory evidence may answer fewer than 5 questions. The full question set:

1. Personal, team, business, or enterprise?
2. What harness? (only if not detected)
3. What are the agent's most important jobs?
4. Which tools can change external state?
5. Can the agent spend money, delete data, contact people, publish, deploy, or access sensitive data?
6. What actions always require approval?
7. Provider mode — reuse harness, deterministic-only, direct, or local?
8. Which memory sources may setup inspect?
9. May setup write a summary back to memory?

### 4. Generation

Setup produces `.decision-core/` with:

```
.decision-core/
  decision-core.profile.yaml
  decision-core.config.yaml
  surface-contracts.yaml
  policies/
    000-baseline.md         # Default action and unknown-action routing
    010-tools.md            # Tool risk tiers and approval gates
    020-data.md             # Data classification handling
    030-provider-routing.md # Provider mode configuration
    040-memory-sources.md   # Consented memory sources
  tests/
    generated-scenarios.json
  reports/
    onboarding-report.md
  rollback-manifest.json
```

All policies use structured `decision-core-clause` blocks with frontmatter.

### 5. Validation and Runtime Use

Before writing the active runtime pack, setup runs:
- Schema validation on the profile
- Structured document parsing on all policies
- Policy linting for errors
- Secret scanning

After a non-dry-run setup, `.decision-core/policy-pack.yaml` and the root `decision-core.yaml` are active for local CLI and SDK evaluation. Run `decision-core doctor` to verify the install before relying on enforcement.

## Harness-Specific Guides

- [OpenClaw Integration](INTEGRATION-GUIDES/openclaw-onboarding.md)
- [Hermes Integration](INTEGRATION-GUIDES/hermes-onboarding.md)
- [Generic Integration](INTEGRATION-GUIDES/generic-onboarding.md)

## Provider Modes

| Mode | Description |
|------|-------------|
| `host` | Reuses the harness's existing provider (default for OpenClaw/Hermes) |
| `disabled` | Deterministic-only, no model calls |
| `direct` | Decision Core calls a provider using env var references |
| `local` | Uses a verified local model endpoint |

Setup never asks for raw API keys. It references env var names only.

## Personal vs Organisation Mode

Decision Core has two deployment modes:

- **Personal mode** (default): one agent, one user. Use `decision-core setup` or `quickStart()`. No identity registry, no access policy, no per-agent tokens. This is the path described above.

- **Organisation mode** (opt-in): multiple agents with role-based policies. Use `decision-core org init` to generate `agents.yaml`, `access-policy.yaml`, and role-scoped policy packs. Then `decision-core provision` generates per-agent tokens and configs.

Personal mode is unchanged by the organisation mode features. If you're running a single agent, use personal mode. Organisation mode adds complexity that is only necessary for multi-agent deployments with information isolation requirements.

See [Organisation Deployment Security](./ORG-DEPLOYMENT-SECURITY.md) for the full org-mode threat model and setup flow.

## Memory Sources

See [memory-sources.md](../skills/agent-onboard/references/memory-sources.md) for the full list of supported sources, detection hints, and agent instructions.

## Security

- All memory reads require explicit consent per source
- Write-back requires separate explicit consent
- Secrets are never serialized into artifacts
- PII is redacted from evidence before profile inference
- Generated policies are validated before runtime use
