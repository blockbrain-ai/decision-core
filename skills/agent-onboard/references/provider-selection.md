# Provider Selection

Use this reference when deciding how Decision Core should handle model-provider access during setup.

Source files:

- `src/core/provider-profiles.ts`
- `src/core/provider-policy.ts`
- `src/core/credential-boundary.ts`
- `docs/ONBOARDING.md`

## Provider Modes

- `host`: reuse the agent harness provider boundary. This is the default for OpenClaw and Hermes.
- `disabled`: deterministic-only setup and enforcement. This is the default for generic or standalone personal setup.
- `direct`: Decision Core may call a provider through configured environment variable names.
- `local`: Decision Core may call a verified local endpoint.

## Selection Rules

1. Prefer `host` when the user already runs OpenClaw or Hermes with a working provider setup.
2. Prefer `disabled` when setup can be completed deterministically or when the user does not want Decision Core making model calls.
3. Use `direct` only when the user explicitly wants Decision Core to call providers itself.
4. Use `local` only when a local endpoint is detected or the user confirms it.
5. Never ask the user to paste API keys. Ask for environment variable names only.

## Lab Preference

If the user only wants to work with certain labs, record that preference in the provider profile and do not silently fall back across labs.

Examples:

- OpenAI-only: do not fall back to Anthropic or Google.
- Anthropic-only: do not fall back to OpenAI or OpenRouter.
- Local-only: block cloud provider routes.

## Agent Instructions

When provider details are uncertain, ask:

- "Should Decision Core reuse your agent's existing provider setup?"
- "Should Decision Core run deterministic-only unless you explicitly enable model calls?"
- "Are there labs or providers you do not want Decision Core to use?"
- "If direct provider calls are allowed, what environment variable name already stores the credential?"

Do not read or print credential values.
