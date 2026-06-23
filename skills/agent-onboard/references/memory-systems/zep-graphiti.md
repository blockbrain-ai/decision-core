# Zep / Graphiti Evidence Collection

## When This Applies

You detected `ZEP_API_KEY` env var, `NEO4J_URI` env var, Zep packages in dependencies, or Graphiti configuration. The user has granted read consent.

## How to Query

### Zep Cloud SDK

```typescript
import { ZepClient } from "@getzep/zep-cloud";
const client = new ZepClient({ apiKey: process.env.ZEP_API_KEY });
const results = await client.memory.search(sessionId, { text: "<topic>" });
```

### Zep MCP Tools

If Zep MCP is configured, use the MCP search tools directly.

### Graphiti (Knowledge Graph)

If Graphiti is configured with Neo4j:

```python
from graphiti_core import Graphiti
graph = Graphiti(neo4j_uri, neo4j_user, neo4j_password)
results = await graph.search("<topic>")
```

Graphiti provides temporal and entity-based evidence that is particularly useful for inferring:
- Entity relationships (users, teams, systems)
- Temporal patterns (when things changed)
- Causal chains (why decisions were made)

## Search Topics

1. Agent tools and workflows
2. Business domain and operations
3. Compliance requirements (PII, finance, credentials, regulated data)
4. Blocked or denied action patterns
5. Existing policy or governance preferences

## Export Format

Return a `MemoryEvidenceExport` JSON. See [provider-export-format.md](provider-export-format.md).

Set `sourceKind` to `zep-graphiti`.

## Safety Rules

- Do not include raw API keys, bearer tokens, or Neo4j credentials in evidence items
- Mark items as `sensitive: true` if they contain personal or confidential information
- Do not require the user to create a new Zep account
- Limit summaries to 2000 characters
