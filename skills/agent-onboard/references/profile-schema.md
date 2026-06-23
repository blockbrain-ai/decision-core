# Onboarding Profile Schema

Use this reference when converting interview answers and memory evidence into a Decision Core setup profile.

Source files:

- `src/contracts/onboarding-profile.contracts.ts`
- `config/examples/profile-personal.yaml`
- `config/examples/profile-business.yaml`
- `config/examples/profile-enterprise.yaml`

## Required Shape

The profile must validate against `OnboardingProfileSchema`.

Required top-level fields:

- `schemaVersion`: always `1`
- `profileId`: stable setup identifier
- `createdAt` and `updatedAt`: ISO timestamps
- `mode`: `personal`, `team`, `business`, or `enterprise`
- `agent`: harness and detected tool context
- `userContext`: jobs and domain context
- `autonomy`: posture, default action, approval requirements, and blocked actions
- `provider`: `host`, `disabled`, `direct`, or `local`
- `memory`: detected and consented sources
- `data`: data classes and handling obligations
- `tools`: user-confirmed tool risk records
- `surfaces`: user-confirmed decision surfaces
- `policies`: selected or generated policy references
- `evidence`: redacted evidence summaries

## Agent Rules

- Memory evidence may suggest profile fields, but the user must confirm fields before they become policy inputs.
- Do not put raw memory text into policy rationale. Summarize the confirmed operational fact.
- Do not include secrets, bearer tokens, private keys, passwords, session cookies, or credential files.
- Prefer fewer, clear surfaces over many speculative surfaces.

## Mode Guidance

- `personal`: solo use, conservative default, ask before irreversible or external actions.
- `team`: shared workspace, approval for actions affecting other people or shared systems.
- `business`: customer, money, compliance, or production operations are in scope.
- `enterprise`: regulated, high-volume, or multi-team governance with stronger audit expectations.

## Tool Risk Fields

For each tool, fill:

- `name`
- `riskTier`: `1` low, `2` medium, `3` high, `4` blocked-by-default
- `canSpendMoney`
- `canDeleteData`
- `canContactPeople`
- `canPublishContent`
- `canDeployCode`
- `accessesSensitiveData`
- `defaultAction`: `allow`, `ask`, or `block`

If unsure, choose the safer value and ask the user to confirm.
