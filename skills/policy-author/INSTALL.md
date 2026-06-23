# Policy Author Skill — Install Instructions

This skill is delivered through Decision Core's **MCP server**. It is separate
from the Hermes enforcement plugin and the OpenClaw runtime hook plugin.

## What this skill needs

- a Decision Core MCP server
- access to `skills/policy-author/SKILL.md`
- the four authoring tools:
  - `dc_author_from_text`
  - `dc_author_from_document`
  - `dc_author_review`
  - `dc_author_commit`

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
node_modules/@decision-core/core/skills/policy-author/SKILL.md
```

## Hermes and OpenClaw users

If you already run Hermes or OpenClaw:

- keep the existing host runtime and provider config
- add Decision Core as a separate MCP server for authoring workflows
- use the runtime plugin only for enforcement, not for exposing these authoring tools

Do **not** configure `dc_author_*` tool names inside the Hermes or OpenClaw
runtime plugin files.

## Existing G-Brain installs

If G-Brain already exists, the skill can author policies using evidence from
that existing memory system after consent. No separate migration step is
required.

## CLI fallback

If MCP tools are unavailable, use:

```bash
decision-core author --text "only finance can approve purchases"
decision-core author --document policy.md
decision-core lint .decision-core/policies/
```
