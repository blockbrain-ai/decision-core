# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-28 — initial public release

Published to npm as [`@blockbrainlabs/decision-core`](https://www.npmjs.com/package/@blockbrainlabs/decision-core).

First open-source release of Decision Core: a portable, deterministic, deny-wins policy
decision governor for AI agents with a tamper-evident audit trail. No database, no LLM, and
no network are required in the decision path. Surfaces: SDK, CLI, MCP (stdio), and HTTP.

### Added
- Deny-wins policy engine with deny-unknown / default-deny backstop, autonomy levels, and
  trust routing.
- Policy packs (personal, team, fintech, healthcare, saas) and a pack conflict-detector with
  an `analyze` CLI and a zero-conflicts golden test across all reference packs.
- Tamper-evident, hash-linked evidence chain; in-memory and SQLite persistence tiers.
- Integrations: **Hermes** (recommended; proven end-to-end through a committed drop-in
  e2e harness) and **OpenClaw** (experimental).

### Hardened for launch
- **Integrity**: the record **timestamp is now folded into `auditHash`**, so re-ordering or
  editing a record in time breaks chain verification. Content-addressed chains (clause
  versions) intentionally remain timestamp-independent.
- **Policy events**: enforcement now emits a distinct `policy.blocked` event on block
  (previously `policy.enforced` was emitted for both allow and block).
- **API honesty**: the unsupported `postgres` persistence tier was removed from the public
  type (memory + sqlite are supported; Postgres is roadmapped). MCP is documented as
  **stdio-only** (a remote HTTP/streamable MCP transport is roadmapped).
- **Security docs**: documented that `requiredRoles` is a scoping predicate, not an auth
  gate, with the guidance to keep deny-unknown enabled on public/untrusted surfaces; added a
  regression test pinning the behavior.

### Fixed (drop-in correctness, from the pre-release readiness pass)
- SDK: `ActionApprovalDecision` now carries the action name into policy matching, so the
  documented README quickstart returns the correct verdicts.
- Hermes: hook matches Hermes's real calling convention (`duration_ms`); audit timing is
  recorded correctly.
- `serve`: a default in-memory evidence sink makes the audit trail work out of the box.
- OpenClaw: hook contract aligned to OpenClaw's real plugin API (marked experimental).
- MCP: `list_clauses` renamed to `list_policy_rules` to reflect what it returns.

[0.1.0]: https://github.com/blockbrain-ai/decision-core/releases/tag/v0.1.0
