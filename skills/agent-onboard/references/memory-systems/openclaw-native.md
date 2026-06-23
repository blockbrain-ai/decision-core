# OpenClaw Native Memory Evidence Collection

## When This Applies

You detected OpenClaw as the harness and found `MEMORY.md`, `memory/*.md` files, or `.openclaw/` configuration. The user has granted read consent.

## How to Query

### Filesystem (Always Available)

1. Read `MEMORY.md` in the workspace root — this is the agent's persistent memory index.
2. Read recent `memory/YYYY-MM-DD.md` daily notes (last 7-14 days).
3. Read `DREAMS.md` if present — contains aspirational/planning context.
4. Check `.openclaw/memory.json` for structured memory configuration.

### CLI (When Available)

If `openclaw memory search` is available:

```bash
openclaw memory search "<topic>"
```

### Plugin Memory Systems

OpenClaw may have memory plugins configured:
- `memory-core` / `memory-lancedb` — vector-backed memory
- `memory-wiki` — structured knowledge wiki with QMD format
- Honcho plugin — if configured, also see [honcho.md](honcho.md)

Check `openclaw.plugin.json` or `.openclaw/` for active plugins.

## Search Topics

1. Agent tools and workflows
2. Business domain and operations
3. Compliance requirements (PII, finance, credentials, regulated data)
4. Blocked or denied action patterns
5. Existing policy or governance preferences
6. Data handling rules
7. Approval workflows

## Export Format

Return a `MemoryEvidenceExport` JSON. See [provider-export-format.md](provider-export-format.md).

## Safety Rules

- Do not include raw API keys, bearer tokens, or private keys
- Mark items as `sensitive: true` if they contain personal or confidential information
- Limit summaries to 2000 characters
- Only read from the consented workspace — do not traverse parent directories
