# Decision Core — status ledger (proven vs planned)

The single honest source of truth for what Decision Core **actually enforces and proves today** versus what
is experimental or planned. When docs, README, or marketing language disagree with this ledger, the ledger
wins — fix the other copy.

- **Last verified:** `blockbrain-ai/decision-core` `main @ 18e714e` (19 governed PRs: trust-core launch
  hardening, doc/publish safety, and the full onboarding gap-closure programme). A post-onboarding residual
  hardening branch also passed the same gate; replace this line with the merged SHA before public flip.
- **How "proven" is established:** the full local gate (`typecheck` · `lint` · `test` 2520 pass/4 skip ·
  `build` · `npm audit` 0 vulns), the standing tarball smoke (`npm run smoke:tarball` — pack → no
  secrets/local-state → install → SDK + CLI), the Hermes drop-in driver (`test/hermes-dropin-e2e/driver.py`,
  which fails unless the plugin loads, both hooks register, a deny rule and deny-unknown block, an allowed
  tool really dispatches, and concrete audit records land), and the governed-merge evidence in the control
  plane (`DECISION-CORE-LAUNCH/13`).

## Surfaces

| Surface | Status | Notes |
|---|---|---|
| **SDK** (`createDecisionCore`, `createPolicyGuard`, `evaluate`) | **Proven** | In-process host is the trust boundary. Default enforcement mode is `enforce`. |
| **CLI** (`decision-core …`, `serve`) | **Proven** | Onboarding loop: `setup` (observe-first) → `observations [--recommend]` → `enforce` (promote). `doctor` reports the live mode. `evaluate` threads `agentRegistryPath` + `enforcementMode`. |
| **MCP** (stdio) | **Proven (read-only)** | 6 read-only tools always available (incl. `dc_observations`). The policy-**mutating** tools (`ingest_policy`, `compile_rules`, `dc_enforce`) are **off by default** — `allowPolicyMutations` opt-in only. stdio is a local trust boundary; no per-call network identity. |
| **HTTP** (`createHttpServer`) | **Proven** | Org-mode binds every request to the **authenticated identity's tenant** (not a static default). Non-org drops request-supplied roles. Localhost bind by default. |

## Core capabilities (with the governed change that proves each)

| Capability | Status | Evidence |
|---|---|---|
| Deny-wins policy evaluation + tamper-evident hash-linked audit chain | **Proven** | core + PR-1 |
| Pipeline enforcement: role-scoped + threshold rules fire through `createDecisionCore().evaluate()` | **Proven** | PR-2 |
| Fail-closed config: invalid `decision-core.yaml` throws (no silent fail-open) | **Proven** | PR-2 |
| Trusted roles: network surfaces never honor request-supplied `callerRoles` | **Proven** | PR-2 / PR-4b |
| Observe mode (non-blocking shadow) + onboarding observe-first default | **Proven** | PR-3 |
| Observe is **visible**: persisted by default in observe mode, announced on activation, `doctor` nudge | **Proven** | onboarding 1 |
| Observations review (`observations` / `dc_observations`, redacted — no tool args) + recommendations | **Proven** | onboarding 2-3 |
| Observe→enforce **promote** (`enforce` / `dc_enforce`): backup + diff + validate + rollback; `dc_enforce` mutating-gated | **Proven** | onboarding 3 |
| **Executive decisions** at onboarding: explicit allow/ask/block per dangerous capability → top-priority rules | **Proven** | onboarding 4 |
| Separation of Duties on approval resolution (no self-approval w/o break-glass) | **Proven** | PR-4a |
| Org-mode tenant isolation (per-request identity tenant) | **Proven** | PR-4b |
| MCP mutating-tool gating; glob cannot be evaded by a newline | **Proven** | PR-4c |
| Role-scoping checked **before** thresholds; action names reject control chars; fail-closed audit canonicalization; router-mode provider-policy re-enforcement | **Proven** | PR-4d |
| **Deny-unknown default** | **OFF by default** | Load a policy pack (or set `denyUnknownDefault`) before relying on deny-wins for unknown actions. Stated in README. |
| **Enforcement default** | **`enforce`** | The SDK/library never silently runs in `observe`; only onboarding (non-enterprise) or explicit config chooses `observe`. |

## Integrations

| Integration | Status | Notes |
|---|---|---|
| **Hermes** (Python runtime) | **Proven end-to-end** | Enforces in `pre_tool_call`, audits in `post_tool_call`, through Hermes's real `handle_function_call` dispatch. Release proof = the hardened drop-in driver. Last-verified Hermes checkout is recorded in `integrations/hermes/plugin.yaml` and `test/hermes-dropin-e2e/README.md`. |
| **OpenClaw** (TypeScript runtime) | **Experimental** | In-process hook plugin aligned with OpenClaw's plugin API, **not yet verified through a full OpenClaw agent loop**. Run behind `failMode: 'closed'`. |
| **G-Brain / memory sources** | **Adapter** | Detection + onboarding wiring; not a runtime enforcement surface. |

## Persistence

- **memory** (default) — proven. **sqlite** (optional native dep) — proven; degrades gracefully when the
  binding can't load (skip-when-unavailable + actionable error). No other tier ships (a Postgres tier was
  removed from the public schema in PR-1).

## Explicitly NOT proven / out of scope (today)

- A full OpenClaw agent-loop end-to-end run (the adapter is experimental — see above).
- A multi-tenant HTTP server beyond per-request identity→tenant binding (each token operates on its own
  tenant; the server is not a cross-tenant broker).
- Any Postgres/managed persistence tier (not shipped).
- LLM-dependent behavior in the core path (the core is fully deterministic; no LLM required).

## Launch posture

The trust-core launch-blocker queue and onboarding-UX gap-closure queue are clear through `18e714e`: this
ledger, the hardened Hermes E2E harness, standing tarball-smoke CI gate, observe-first onboarding loop,
observations/recommend/promote flow, executive decisions, live discovery, profile write-back, maintenance loop,
and full onboarding E2E have landed through the governed flow. Public flip + `npm publish` remain a separate
explicit human launch decision because both are hard to reverse. Track status in the control plane
(`docs/03-CURRENT-STATE.md`, `DECISION-CORE-LAUNCH/`).
