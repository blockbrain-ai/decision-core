---
schema_version: "1.0.0"
policy_id: dc.template.high-risk
title: High-Risk Compliance Screening Policy
owner: compliance@example.com
surfaces:
  - compliance.screening
tags:
  - compliance
  - high-risk
  - sanctions
  - template
---

# High-Risk Compliance Screening Policy

This template demonstrates structured policy authoring for critical-risk surfaces
that involve sanctions screening, protected attributes, and human oversight.

## Sanctions Check

```decision-core-clause
clause_id: dc.template.hr.001
clause_type: prohibition
condition:
  type: sanctions_match
  field: entity_name
  sanctionsLists:
    - OFAC
    - EU_SANCTIONS
    - UN_SANCTIONS
decision: deny
surface_id: compliance.screening
route_class: deterministic_only
safe_to_execute_without_model: true
evidence_required:
  - entity_name
  - entity_type
  - jurisdiction
rationale: Entities on any sanctions list must be denied immediately
owner: compliance@example.com
approval_required: false
protected_attribute_review: true
priority: 1000
```

## Entity Type Validation

```decision-core-clause
clause_id: dc.template.hr.002
clause_type: evidence_requirement
condition:
  type: field_presence
  fields: [entity_name, entity_type]
  allRequired: true
decision: escalate
surface_id: compliance.screening
route_class: deterministic_only
safe_to_execute_without_model: true
rationale: Screening requests must include entity name and type
owner: compliance@example.com
protected_attribute_review: true
priority: 900
```

## Jurisdiction Risk Assessment

```decision-core-clause
clause_id: dc.template.hr.003
clause_type: routing_constraint
condition:
  type: jurisdiction_match
  field: jurisdiction
  allowedJurisdictions: [US, CA, UK, EU, AU, NZ, JP, SG]
decision: allow
surface_id: compliance.screening
route_class: deterministic_first_a5_on_uncertain
safe_to_execute_without_model: false
evidence_required:
  - jurisdiction
  - entity_type
rationale: Low-risk jurisdictions can be processed; others require model assessment
owner: compliance@example.com
protected_attribute_review: true
priority: 500
```

## Human Oversight for High-Value Entities

```decision-core-clause
clause_id: dc.template.hr.004
clause_type: approval_requirement
condition:
  type: composite_and
  rules:
    - type: enum_match
      field: entity_type
      allowedValues: [organization]
    - type: boolean_required
      field: is_politically_exposed
      requiredValue: true
decision: escalate
surface_id: compliance.screening
route_class: frontier_or_human_required
safe_to_execute_without_model: false
evidence_required:
  - entity_name
  - entity_type
  - is_politically_exposed
  - jurisdiction
rationale: Politically exposed organizations require human review regardless of other factors
owner: compliance@example.com
approval_required: true
protected_attribute_review: true
priority: 2000
```
