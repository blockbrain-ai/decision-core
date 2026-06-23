# Healthcare Policy Pack

## Who This Is For

Health-tech teams handling patient data. Suitable for EHR integrations, clinical decision support, telehealth platforms, and health data analytics systems. HIPAA-informed but not a compliance guarantee.

## What's Included

### Rules

| Rule | Action | Purpose |
|------|--------|---------|
| allow-admin-read | allow | Administrative data freely readable |
| approve-phi-access | approve_required | PHI reads need approval + audit |
| approve-phi-write | approve_required | PHI writes need approval + audit |
| approve-clinical-tools | approve_required | Clinical tools at elevated trust |
| deny-phi-export-default | deny | PHI export blocked by default |
| approve-phi-export-authorized | approve_required | Authorized export needs dual auth |
| block-destructive | deny | No deletion of patient data |
| block-cross-patient | deny | No bulk/batch cross-patient access |
| allow-scheduling | allow | Scheduling operations permitted |
| audit-all-decisions | allow | Clinical decisions require audit trail |

### Surfaces

- **administrative** — Scheduling, billing codes, facility info
- **clinical** — Decision support, assessments, recommendations
- **phi** — Patient records, diagnoses, treatments
- **phi-export** — Data transmission, reporting, sharing

### Trust Tiers

- **standard** — Administrative, no special controls
- **elevated** — Clinical, audit trail required
- **restricted** — PHI, approval + full audit
- **critical** — PHI export, dual authorization

## What This Pack Does NOT Cover

- Full HIPAA compliance (this is a starting point, not certification)
- BAA (Business Associate Agreement) enforcement
- Specific EHR system integration rules
- State-level health privacy regulations
- Research data use agreements
- Patient consent management workflows

## Customization Tips

- Add role-based rules matching your organization's clinical roles
- Configure specific tool patterns for your EHR system's API
- Add time-window restrictions for non-emergency PHI access
- Consider adding rules for research vs. clinical data access paths
- Add specific evidence requirements matching your compliance program
