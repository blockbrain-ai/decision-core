# G-Brain Decision Query Skill

## Name
`decision-query`

## Description
Query Decision Core's stored decisions from G-Brain memory. Retrieves prior decisions, patterns, and context for a given tenant and surface.

## Trigger
When an agent needs to recall prior decisions, understand decision patterns, or retrieve context about how similar actions were handled previously.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| tenantId | string | yes | Tenant scope for the query |
| surfaceId | string | no | Filter by surface (e.g., `code-review`, `deploy`) |
| action | string | no | Filter by action type |
| query | string | no | Free-text search within decision pages |
| limit | number | no | Max results (default: 10) |

## Slug Scope
All decision pages are stored under `decisions/<tenantId>/<surfaceId>/<decisionId>`.

## Example Usage

```
Query: "What decisions were made for code-review actions in tenant-a?"
→ decision-query(tenantId: "tenant-a", surfaceId: "code-review")

Query: "Find prior deploy approvals"
→ decision-query(tenantId: "tenant-a", surfaceId: "deploy", action: "approve")
```

## Returns

```json
{
  "pages": [
    {
      "slug": "decisions/tenant-a/code-review/dec-001",
      "title": "Decision: lint",
      "content": "{...}",
      "entities": ["code-review", "lint"],
      "createdAt": "2026-05-05T10:00:00Z"
    }
  ],
  "query": "code-review",
  "totalResults": 1
}
```

## Security Notes

- G-Brain is advisory memory — never the source of policy truth
- Decisions are scoped per-tenant; cross-tenant access is blocked client-side
- All writes validated against `decisions/` slug prefix before reaching G-Brain
