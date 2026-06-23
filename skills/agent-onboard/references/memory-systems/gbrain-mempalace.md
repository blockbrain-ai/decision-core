# G-Brain / MemPalace Evidence Collection

## When This Applies

You detected G-Brain or MemPalace as a configured memory source during `dc_setup_detect`. The user has granted read consent for this source.

## How to Query

### G-Brain (Direct or MCP)

If `GBrainClient` is available:

```typescript
const results = await client.search({ query: "<topic>", slugPrefix: "" });
```

Use an empty `slugPrefix` for unrestricted onboarding reads. The client only enforces `decisions/` prefix on writes.

If G-Brain MCP tools are available, use `gbrain_search` with the same query patterns.

### MemPalace (MCP)

Use MCP tools in this order:

1. `mempalace_search` — keyword search across all rooms
2. `mempalace_kg_query` — structured knowledge graph queries
3. `mempalace_list_rooms` / `mempalace_list_drawers` — explore organization

## Search Topics

Search for each of these topics and extract short summaries from results:

1. Agent tools and workflows
2. Business domain and operations
3. Compliance requirements (PII, finance, credentials, regulated data)
4. Blocked or denied action patterns
5. Existing policy or governance preferences
6. Data handling rules
7. Approval workflows

## Export Format

Return a `MemoryEvidenceExport` JSON object. See [provider-export-format.md](provider-export-format.md) for the full schema.

Each evidence item should contain:
- A short summary (not the full page content)
- A source reference (slug or drawer ID)
- Confidence score (0-1)
- Whether the content is sensitive

## Safety Rules

- Do not include raw API keys, bearer tokens, or private keys
- Mark items as `sensitive: true` if they contain personal or confidential information
- Do not copy large verbatim page contents — summarize and reference
- Only query within the consented scope
