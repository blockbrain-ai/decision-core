# Decision Core — status ledger (proven vs planned)

The single honest source of truth for what Decision Core **actually enforces and proves today** versus what
is experimental or planned. When docs, README, or marketing language disagree with this ledger, the ledger
wins — fix the other copy.

- **License:** Apache-2.0 (`LICENSE` + `NOTICE`). Contributions are accepted under the Developer Certificate of
  Origin (DCO) — every commit must be signed off (`git commit -s`).
- **Last verified:** `blockbrain-ai/decision-core` **public** `main` (verified code head `ac546d5`; launch-prep
  PRs #23–#28 added Apache-2.0 + DCO, the `@blockbrainlabs/decision-core` rename, showcase README, maintainers,
  and contributor scaffolding). **Published: `@blockbrainlabs/decision-core@0.1.0` on npm** (see Launch posture
  below). The real Hermes drop-in E2E (below) was proven on `ac546d5` and the package was install-smoke-tested
  from the registry after publish.
- **How "proven" is established:** the full local gate (`typecheck` · `lint` · `test` 2520 pass/4 skip ·
  `build` · `npm audit` 0 vulns), the standing tarball smoke (`npm run smoke:tarball` — pack → no
  secrets/local-state → install → SDK + CLI), the Hermes drop-in driver (`test/hermes-dropin-e2e/driver.py`,
  which fails unless the plugin loads, both hooks register, a deny rule and deny-unknown block, an allowed
  tool really dispatches, and concrete audit records land), and the governed-merge evidence in the control
  plane (`DECISION-CORE-LAUNCH/13`).
- **Last real Hermes E2E:** at `ac546d5`, the drop-in driver ran through real Hermes `0.14.0` / git
  `edb2d9105` (`model_tools.handle_function_call`) against a live server — plugin loaded, both hooks
  registered, `payment_send` denied by rule, `exfiltrate_secrets` denied by deny-unknown (fail-closed),
  `read_file` allowed + dispatched, 4 audit records with numeric timing. `PASS=true`.

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

**LAUNCHED — 2026-06-28.** Decision Core is **public** (`github.com/blockbrain-ai/decision-core`) and
**published to npm** as **`@blockbrainlabs/decision-core@0.1.0`** under **Apache-2.0**
(shasum `f8d48aeeee2c0e2d2ce6af8ba75b9105786a2122`, integrity
`sha512-wCBAkfC5YmbYy3p9Vkw2pLIpjYs6WsZCFiFZNAYQfIcSZFN5I9VauHd3B8YtU4/fylqOKNBvUA595PiXPDNTWQ==`).
Post-publish install-from-registry smoke passed (SDK deny-unknown → `deny`; CLI `--help`).

Contribution is open, merge authority is not: anyone can fork, open issues, and submit PRs; **`main` is
branch-protected** (only `nood-co1` + the `blockbrain-scanner` merge identity can push; force-push/deletion
blocked) and every PR is governed (DCO sign-off + CI `gate` + MADE: external forks run `runsc`
validation-only → human approval → trusted-merge; no auto-merge). Contributor scaffolding (PR/issue
templates, CODEOWNERS) is in place.

The trust-core + onboarding-UX + launch-IP queues all landed through the governed flow (Apache-2.0 relicense,
npm rename, showcase README, maintainers, contributor scaffolding). Track status in the control plane
(`docs/03-CURRENT-STATE.md`, `DECISION-CORE-LAUNCH/`).
