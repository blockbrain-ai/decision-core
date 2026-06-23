# Honcho Evidence Collection

## When This Applies

You detected `HONCHO_API_KEY` env var, `honcho.json` config, or `honcho-ai` in package dependencies. The user has granted read consent.

## How to Query

### Python SDK

```python
from honcho import Honcho
client = Honcho()
# Search user/entity context
results = client.apps.users.sessions.list(app_id, user_id)
```

### Via Hermes or OpenClaw

If Honcho is configured as a Hermes provider or OpenClaw plugin:

```bash
hermes memory search "<topic>"
```

### API Endpoints

If using the hosted API:
- `GET /apps/{app_id}/users/{user_id}/sessions` — list sessions
- `GET /apps/{app_id}/users/{user_id}/metamessages` — entity-level context

## Search Topics

1. Agent tools and workflows
2. Business domain and operations
3. Compliance requirements (PII, finance, credentials, regulated data)
4. Blocked or denied action patterns
5. Existing policy or governance preferences

## Export Format

Return a `MemoryEvidenceExport` JSON. See [provider-export-format.md](provider-export-format.md).

Set `sourceKind` to `honcho`.

## Safety Rules

- Do not include raw API keys or bearer tokens in evidence items
- Mark items as `sensitive: true` if they contain personal or confidential information
- Do not require the user to create a new Honcho account
- Limit summaries to 2000 characters
