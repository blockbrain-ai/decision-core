# OpenClaw Integration Guide

## Prerequisites

- OpenClaw workspace with `openclaw.config.ts` or `.openclaw/` directory
- Decision Core installed: `npm install @blockbrainlabs/decision-core`

## Setup

```bash
decision-core setup --agent openclaw --profile auto
```

This detects your OpenClaw workspace, reads memory files (with consent), and generates `.decision-core/` artifacts.

## Existing OpenClaw installs

If OpenClaw is already installed, keep the existing workspace and provider
configuration. The setup flow only generates Decision Core policy and
integration artifacts around that host:

1. run `decision-core setup --agent openclaw --profile auto --dry-run --json`
2. review the detected tools and memory sources
3. rerun without `--dry-run` once the generated profile is correct
4. wire the Decision Core OpenClaw integration module to the generated pack and
   registry files

## What Gets Detected

- `openclaw.config.ts` / `openclaw.config.json` — harness identification
- `MEMORY.md` — native memory for profile inference
- `memory/*.md` — daily notes for context
- `openclaw.plugin.json` — tool declarations
- `.mcp.json` — MCP server tools

## Generated Integration

The setup generates `integrations/openclaw.yaml` with:
- Policy evaluation hook configuration
- Tool risk mappings from detected tools
- Provider routing (uses OpenClaw's configured provider by default)

This file is advisory output for the host integration. It does not register the
plugin automatically inside OpenClaw.

## Memory Evidence

If you consent, setup reads:
- `MEMORY.md` for high-level agent context
- Recent `memory/*.md` files for operational patterns
- `.openclaw/memory.json` for structured memory config

This evidence helps infer profile mode, data classes, and tool risk tiers — reducing interview questions.

## Provider Mode

Default: `host` — reuses OpenClaw's existing provider configuration.

Other options:
- `disabled` — deterministic-only, no model calls
- `direct` — Decision Core calls its own provider
- `local` — uses a local model endpoint

## Post-Setup

1. Review generated policies in `.decision-core/policies/`
2. Run validation: `decision-core validate .decision-core/policies/000-baseline.md`
3. Run lint: `decision-core lint .decision-core/policies/`
4. Verify: `decision-core doctor`
5. Wire the OpenClaw integration module from the Decision Core package:
   - repo checkout/source companion: `integrations/openclaw/`
   - packaged runtime code: `dist/integrations/openclaw/`

This is currently a manual host integration path, not a native
`openclaw plugins install @blockbrainlabs/decision-core` package install.
