# Compliance Audit Skill — Install Instructions

This skill is delivered through Decision Core's **MCP server**. It is not a
Hermes plugin config fragment or an OpenClaw runtime hook declaration.

## What this skill needs

- a Decision Core MCP server
- access to `skills/audit/SKILL.md`
- the three audit tools:
  - `dc_audit_run`
  - `dc_audit_gaps`
  - `dc_audit_evidence`

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
node_modules/@decision-core/core/skills/audit/SKILL.md
```

## Hermes and OpenClaw users

Use the audit skill through MCP, even if your runtime enforcement is handled by
Hermes or OpenClaw plugins. Keep the concerns separate:

- MCP skill flow for audit and review
- runtime plugin/module flow for enforcement

Do **not** add `dc_audit_*` tool names to the Hermes runtime plugin or the
OpenClaw hook integration.

## Existing Hermes or G-Brain installs

If Hermes and G-Brain already exist:

- keep the existing runtime and memory store
- point Decision Core at the existing G-Brain evidence sink
- run the audit skill against the active Decision Core deployment

## CLI fallback

If MCP tools are unavailable, use:

```bash
decision-core audit
decision-core audit --gaps-only
decision-core audit --evidence --correlation-id <id>
decision-core provision --verify
decision-core org report --format markdown
```
