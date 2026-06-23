# Generic MCP Memory Evidence Collection

## When This Applies

You detected an MCP memory server that does not match a Tier 0 or Tier 1 source (e.g., Supermemory, Cognee, Letta, or a custom MCP memory tool). The user has granted read consent.

## How to Query

1. List available MCP tools from the configured server.
2. Use the search/recall/query tool provided by the MCP server.
3. Search for each topic in the search topics list.
4. Extract short summaries from results.

Common MCP memory tool patterns:
- `recall` — search/retrieve memories
- `search` — keyword search
- `query` — structured query
- `get_memories` — list all memories

## Search Topics

1. Agent tools and workflows
2. Business domain and operations
3. Compliance requirements (PII, finance, credentials, regulated data)
4. Blocked or denied action patterns
5. Existing policy or governance preferences

## Export Format

Return a `MemoryEvidenceExport` JSON. See [provider-export-format.md](provider-export-format.md).

Set `sourceKind` to `generic-mcp`.

## Safety Rules

- Do not include raw API keys, bearer tokens, or private keys in evidence items
- Mark items as `sensitive: true` if they contain personal or confidential information
- Do not require the user to create new accounts or credentials
- Limit summaries to 2000 characters
