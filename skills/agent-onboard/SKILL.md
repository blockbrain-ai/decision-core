# Agent Onboarding Skill

Guide a user through Decision Core setup using detection, memory evidence, and adaptive interview.

## Mode Selection

Before starting setup, determine which mode the user needs:

- **Personal mode** (default): One agent, one user. No identity registry, no access policy, no per-agent tokens. Use this when the user says "just me", "personal", "solo developer", or doesn't mention teams/organisations.
- **Organisation mode** (opt-in): Multiple agents with role-based policies and information isolation. Use this when the user mentions staff agents, roles, teams, multi-agent, or a business with separate departments.

Ask: "Are you setting up Decision Core for yourself (personal mode) or for a team/business with multiple agents (organisation mode)?"

### Personal Mode Steps

1. **Detect environment** — Call `dc_setup_detect` to scan for harness, tools, provider env vars, and memory sources.
2. **Request memory consent** — Show detected sources. Ask which may be read. Ask if write-back is permitted.
3. **Gather memory evidence** — For each consented source, follow the instructions in `references/memory-systems/<source>.md`. Return a `MemoryEvidenceExport` JSON per source.
4. **Infer profile** — Call `dc_setup_infer` with the evidence exports. Review suggested fields. Tell the user what was inferred and what still needs answers.
5. **Interview for missing fields** — Ask only the questions from the interview plan. Use defaults from the mode. Do not ask about fields already inferred.
6. **Generate artifacts** — Call `dc_setup_generate` with the confirmed profile. Review generated policy contents with the user.
7. **Write artifacts** — Write each returned artifact to `.decision-core/<path>` exactly as returned unless the user chose another output directory.
8. **Validate** — Call `dc_setup_validate` to check policies parse, lint, and pass scenario generation. If files were written, also run the CLI validation commands when available.
9. **Verify runtime setup** — Confirm `.decision-core/policy-pack.yaml` and `decision-core.yaml` exist, then run `decision-core doctor`. Tell the user that non-dry-run setup is active for local runtime evaluation.

Personal mode does NOT create `agents.yaml`, `access-policy.yaml`, or `agent-auth.yaml`. Do not mention these files to personal-mode users.

### Organisation Mode Steps

1. **Detect environment** — Same as personal mode.
2. **Request memory consent** — Same as personal mode.
3. **Gather memory evidence** — Same as personal mode.
4. **Infer profile** — Same as personal mode, but set profile to `business` or `enterprise`.
5. **Interview for org structure** — In addition to the standard interview, ask:
   - "How many agent roles will you have? List them (e.g., CEO, Finance, Operations, Compliance, Product)."
   - "Which information classifications exist? (e.g., public, financial-confidential, hr-restricted)"
   - "For each classification, which roles may access it?"
   - "Which tools require approval, and from which role?"
6. **Generate artifacts** — Call `dc_setup_generate` with the confirmed profile. This produces the standard policy pack.
7. **Generate org artifacts** — Run `decision-core org init` to create template `agents.yaml` and `access-policy.yaml`. Guide the user through reviewing and editing these files based on the interview answers.
8. **Provision agents** — Run `decision-core provision` to generate per-agent tokens, env files, and mount manifests.
9. **Verify** — Run `decision-core provision --verify` to confirm the entire setup is consistent: policy pack, agent registry, access policy, token bindings, brain mounts, and tool inventory.
10. **Run negative tests** — Verify that lower-permission agents cannot access restricted resources. Example: a finance agent should not be able to read HR data.

See [Organisation Deployment Security](../docs/ORG-DEPLOYMENT-SECURITY.md) for the threat model and trust boundaries.

## Stop Conditions

- Stop if validation fails and the user does not want to fix.
- Stop if the user cancels at any point.
- Never write files without explicit confirmation.
- Never copy raw API keys or secrets into evidence or policies.

## Memory Consent Protocol

1. Show detected memory sources: name, kind, detection signals.
2. Ask: "May setup read from [source]?" per detected source.
3. Ask: "May setup write a short onboarding summary back after approval?"
4. Proceed only with consented sources.

## References

- [Profile Schema](references/profile-schema.md)
- [Memory Sources](references/memory-sources.md)
- [Provider Selection](references/provider-selection.md)
- [Export Format](references/memory-systems/provider-export-format.md)
- Source-specific: `references/memory-systems/<source>.md`
