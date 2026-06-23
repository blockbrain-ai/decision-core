# Memory Evidence Export Format

All memory sources must return evidence in this canonical JSON format. Decision Core validates and imports this schema during setup.

## Schema

```json
{
  "schemaVersion": 1,
  "sourceId": "unique-source-identifier",
  "sourceKind": "gbrain|mempalace|openclaw-native|hermes-built-in|hermes-active-provider|markdown-vault|obsidian-mcp|mem0|honcho|zep-graphiti|supermemory|cognee|letta|langmem|generic-mcp|none",
  "collectedBy": "user-agent|decision-core|manual",
  "collectedAt": "2026-01-01T00:00:00.000Z",
  "consent": {
    "readGranted": true,
    "writeBackGranted": false,
    "scope": ["onboarding"]
  },
  "items": [
    {
      "id": "unique-item-id",
      "summary": "Short summary of the evidence (max 2000 chars)",
      "sourceRef": "source-specific reference (slug, URL, file path)",
      "confidence": 0.85,
      "sensitive": false,
      "suggestedProfilePatch": {
        "mode": "business"
      }
    }
  ]
}
```

## Field Reference

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | Yes | Always `1` for this version |
| `sourceId` | string | Yes | Unique identifier for this source instance |
| `sourceKind` | enum | Yes | Memory source type from the supported list |
| `collectedBy` | enum | Yes | Who performed the collection |
| `collectedAt` | ISO 8601 | Yes | When evidence was collected |
| `consent.readGranted` | boolean | Yes | Whether read consent was given |
| `consent.writeBackGranted` | boolean | Yes | Whether write-back consent was given |
| `consent.scope` | string[] | Yes | Scope of the consent |
| `items[].id` | string | Yes | Unique item identifier |
| `items[].summary` | string | Yes | Short evidence summary |
| `items[].sourceRef` | string | Yes | Reference to original source |
| `items[].confidence` | number | Yes | 0.0 to 1.0 confidence score |
| `items[].sensitive` | boolean | Yes | Whether content is sensitive |
| `items[].suggestedProfilePatch` | object | No | Suggested profile field updates |

## suggestedProfilePatch

The optional `suggestedProfilePatch` field can suggest values for profile fields:

```json
{
  "mode": "business",
  "userContext": { "domain": "retail", "primaryJobs": ["order processing"] },
  "data": { "classes": ["pii", "financial"] }
}
```

Decision Core uses these as suggestions — user answers always override inferred values.

## What NOT to Include

- Raw API keys, bearer tokens, or private keys
- Large verbatim memory dumps (summarize instead)
- Sensitive details unrelated to policy onboarding
- Binary content

## Validation

Decision Core validates exports using `MemoryEvidenceExportSchema`. Invalid exports are rejected with error details. Use `validateExport()` to pre-check before submission.
