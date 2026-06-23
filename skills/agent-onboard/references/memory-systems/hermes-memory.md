# Hermes Memory Evidence Collection

## When This Applies

You detected Hermes as the harness via `HERMES_HOME`, `~/.hermes/config.yaml`, or `~/.hermes/memories/`. The user has granted read consent.

## How to Query

### Built-in Memory Files

1. Read `~/.hermes/memories/MEMORY.md` — agent memory.
2. Read `~/.hermes/memories/USER.md` — user profile.
3. Run `hermes memory status` to check provider state.

### Active Provider

Check `~/.hermes/config.yaml` for `memory.provider` setting.

If a provider is active (mem0, honcho, holographic, hindsight, byterover, openviking, retaindb, supermemory):

```bash
hermes memory search "<topic>"
hermes memory export --format json
```

If the active provider is one of the Tier 1 sources (mem0, honcho), also consult the provider-specific reference doc.

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

Set `sourceKind` to `hermes-built-in` for memory files or `hermes-active-provider` for provider results.

## Safety Rules

- Do not include raw API keys, bearer tokens, or private keys
- Mark items as `sensitive: true` if they contain personal or confidential information
- Do not expose Hermes provider credentials in evidence items
- Limit summaries to 2000 characters
