# Onboard Skill — Install Instructions

This skill is delivered through Decision Core's **MCP server**. It is not
configured inside the Hermes runtime plugin or the OpenClaw hook integration.

## What this skill needs

- a Decision Core MCP server
- access to `skills/onboard/SKILL.md`
- the four onboarding tools:
  - `dc_onboard_start`
  - `dc_onboard_answer`
  - `dc_onboard_generate`
  - `dc_onboard_validate`

## Start the MCP server

### Local install

```bash
decision-core serve --mcp
```

### On-demand with `npx`

```bash
npx -y @decision-core/core serve --mcp
```

## Claude Desktop or any MCP-capable client

```json
{
  "mcpServers": {
    "decision-core": {
      "command": "npx",
      "args": ["-y", "@decision-core/core", "serve", "--mcp"]
    }
  }
}
```

Then point the client at:

```text
node_modules/@decision-core/core/skills/onboard/SKILL.md
```

## Hermes and OpenClaw users

If you already use Hermes or OpenClaw:

- keep the existing host runtime as-is
- add Decision Core as a separate MCP server
- use this skill through the MCP-capable client session that is fronting the agent
- configure runtime enforcement separately with `integrations/hermes/` or the
  OpenClaw integration module under `dist/integrations/openclaw/` (runtime) /
  `integrations/openclaw/` (source companion)

Do **not** paste `dc_onboard_*` tool names into the Hermes enforcement plugin
config or the OpenClaw runtime hook config.

## Existing G-Brain installs

If G-Brain already exists, reuse it. The onboarding skill can infer profile
details from consented evidence without requiring a new memory store.

## CLI fallback

If your client cannot use MCP tools, the closest CLI fallback is:

```bash
decision-core setup
```

For adaptive setup with existing Hermes or G-Brain deployments, start with:

```bash
decision-core setup --dry-run --json
```
