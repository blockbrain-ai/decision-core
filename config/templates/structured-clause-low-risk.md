---
schema_version: "1.0.0"
policy_id: dc.template.low-risk
title: Low-Risk Data Extraction Policy
owner: data-team@example.com
surfaces:
  - data.extraction
tags:
  - data
  - low-risk
  - template
---

# Low-Risk Data Extraction Policy

This template demonstrates structured policy authoring for low-risk surfaces
using deterministic rules that can execute without model involvement.

## Allowed Formats

```decision-core-clause
clause_id: dc.template.lr.001
clause_type: permission
condition:
  type: enum_match
  field: format
  allowedValues: [csv, json, xml, parquet]
decision: allow
surface_id: data.extraction
route_class: deterministic_only
safe_to_execute_without_model: true
rationale: Standard export formats are always allowed
priority: 50
```

## Row Count Threshold

```decision-core-clause
clause_id: dc.template.lr.002
clause_type: threshold
condition:
  type: threshold
  field: row_count
  operator: gte
  value: 1000000
decision: approve_required
surface_id: data.extraction
route_class: deterministic_only
safe_to_execute_without_model: true
evidence_required:
  - row_count
  - source
rationale: Extractions over 1M rows require approval to prevent resource exhaustion
owner: data-team@example.com
priority: 100
```

## Source Validation

```decision-core-clause
clause_id: dc.template.lr.003
clause_type: obligation
condition:
  type: field_presence
  fields: [source]
  allRequired: true
decision: deny
surface_id: data.extraction
route_class: deterministic_only
safe_to_execute_without_model: true
rationale: All extraction requests must specify a source
priority: 200
```
