# Hermes Integration Guide

## Prerequisites

- Hermes agent configured at `~/.hermes/` or `HERMES_HOME`
- Decision Core installed: `npm install @blockbrainlabs/decision-core`

## Setup

```bash
decision-core setup --agent hermes --profile auto
```

This detects your Hermes configuration, reads memory files (with consent), and generates `.decision-core/` artifacts.

## Existing Hermes or G-Brain installs

If Hermes and G-Brain are already running, keep them in place. The setup flow is
additive:

1. run `decision-core setup --agent hermes --profile auto --dry-run --json` first
2. review the inferred profile, detected memory sources, and generated artifacts
3. rerun without `--dry-run` once the profile looks right
4. wire the Hermes Decision Core plugin to the generated policy pack
5. if you already have G-Brain, reuse it as the Decision Core evidence sink

You do not need to migrate existing memories into a new store.

## Runtime Notes From The Verified Deployment

The generated `.decision-core/` artifacts are only part of the integration. The
live host still needs correct Hermes runtime wiring:

- keep per-agent Decision Core secrets in `~/.config/decision-core/agent.env`
  and reference them from `~/.hermes/config.yaml` with `${DC_API_KEY}` and
  `${DC_AGENT_ID}`
- if Hermes runs under systemd, load both
  `~/.config/decision-core/agent.env` and `~/.hermes/.env`
- use `systemctl status hermes-gateway-<agent>` as the source of truth for
  service state; some Hermes builds misreport `hermes gateway status --system`
  even when the service is running correctly
- keep `terminal.backend` on a real terminal runtime such as `local`, `docker`,
  `singularity`, `modal`, or `ssh`
- search backends such as `brave-free` belong under Hermes web settings

If you use Brave Free for search, treat it as search-only. `web_search` works,
but `web_extract` still needs a real extract backend such as Firecrawl, Tavily,
Exa, or Parallel. Until one is configured, either deny `web_extract` in policy
or leave it disabled in Hermes.

## What Gets Detected

- `HERMES_HOME` env var or `~/.hermes/` directory
- `~/.hermes/config.yaml` — harness configuration
- `~/.hermes/memories/MEMORY.md` — built-in memory
- `~/.hermes/memories/USER.md` — user profile
- `memory.provider` in config — active memory provider

## Generated Integration

The setup generates `integrations/hermes.yaml` with:
- Decision evaluation middleware configuration
- Tool risk mappings
- Provider routing (uses Hermes provider by default)

This file is advisory output for the host integration. It does not, by itself,
install or activate the Hermes plugin.

## Memory Evidence

If you consent, setup reads:
- `MEMORY.md` for agent context
- `USER.md` for user profile
- Active provider memories via `hermes memory search`

## Active Memory Provider

Hermes supports multiple memory providers. If one is active, setup can also query it:
- **mem0** — see [mem0.md](../../skills/agent-onboard/references/memory-systems/mem0.md)
- **honcho** — see [honcho.md](../../skills/agent-onboard/references/memory-systems/honcho.md)
- **holographic, hindsight, byterover, openviking, retaindb, supermemory** — generic export via Hermes CLI

## Post-Setup

1. Review generated policies in `.decision-core/policies/`
2. Validate: `decision-core validate .decision-core/policies/000-baseline.md`
3. Lint: `decision-core lint .decision-core/policies/`
4. Verify: `decision-core doctor`
5. Install or update the Hermes runtime plugin from `integrations/hermes/`
6. If using G-Brain evidence write-back, configure the Decision Core HTTP
   service with the G-Brain HTTP transport variables documented in
   [gbrain.md](gbrain.md)
7. If running Hermes as a service, verify the unit with `systemctl status` after
   restart or reboot before trusting the deployment
