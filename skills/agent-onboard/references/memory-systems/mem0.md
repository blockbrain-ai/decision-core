# Mem0 Evidence Collection

## When This Applies

You detected `MEM0_API_KEY` env var, `mem0.json` config, or `mem0`/`mem0ai` in package dependencies. The user has granted read consent.

## How to Query

### Python SDK

```python
from mem0 import Memory
m = Memory()
results = m.search("<topic>", user_id="<user>")
```

### Node SDK

```typescript
import MemoryClient from "mem0ai";
const client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
const results = await client.search("<topic>", { user_id: "<user>" });
```

### Via Hermes or OpenClaw

If Mem0 is configured as a Hermes provider or OpenClaw plugin, use the host agent's existing access:

```bash
hermes memory search "<topic>"
```

## Search Topics

1. Agent tools and workflows
2. Business domain and operations
3. Compliance requirements (PII, finance, credentials, regulated data)
4. Blocked or denied action patterns
5. Existing policy or governance preferences

## Export Format

Return a `MemoryEvidenceExport` JSON. See [provider-export-format.md](provider-export-format.md).

Set `sourceKind` to `mem0`.

## Safety Rules

- Do not include raw API keys or bearer tokens in evidence items
- Mark items as `sensitive: true` if they contain personal or confidential information
- Do not require the user to create a new Mem0 account — use existing access only
- Limit summaries to 2000 characters
