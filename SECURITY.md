# Security Policy

Decision Core is a security tool: a deterministic, deny-wins policy governor with a
tamper-evident audit trail. We take vulnerabilities seriously.

## Reporting a vulnerability

**Please do not open public issues for security vulnerabilities.**

Report privately to **security@blockbrain.au** (or **admin@blockbrain.au**). Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal policy pack / call sequence is ideal),
- affected version(s) and environment.

We aim to acknowledge within 3 business days and to agree a coordinated disclosure
timeline with you. You may also use GitHub's **private vulnerability reporting** on this
repository.

## Supported versions

Decision Core is pre-1.0. Security fixes target the latest `0.x` minor release. Pin a
version and watch releases for advisories.

## Security model (what is and isn't guaranteed)

The full threat model is in [`docs/SECURITY.md`](./docs/SECURITY.md). Key load-bearing
properties:

- **Deny-wins arbitration** — if any matched rule denies, the decision is denied.
- **Deny-unknown / default-deny** — when *no* rule matches, the action is denied by
  default (via the deny-unknown wrapper). **Keep deny-unknown enabled on any public or
  untrusted surface.** Note that `requiredRoles` on a rule is a *scoping* predicate (which
  callers a rule is about), not an authentication gate — a role-scoped rule simply does not
  apply to a caller who lacks the role, and it is the deny-unknown backstop that blocks an
  unidentified caller for whom no allow rule applies.
- **Tamper-evident evidence chain** — each record's `auditHash` is hash-linked to the
  previous record and folds in the record's payload **and timestamp**, so reordering or
  editing a record (including its time) breaks chain verification.
- **No secrets in the decision path** — no LLM, no network, no DB are required to reach a
  verdict; credentials (when a model/provider is configured) are validated without being
  logged.

## Known limitations (v0.1)

- **Token rotation / key IDs**: agent tokens are bound via salted hashes with agent-id
  mismatch checks, but there is no built-in rotation or `kid` mechanism yet (roadmapped).
- **OpenClaw integration** is **experimental** — the contract is aligned to OpenClaw's real
  plugin API but has not been driven through a full live agent loop. Run it behind
  `failMode: 'closed'`.
- **Persistence**: in-memory (default) and SQLite are supported; a Postgres tier is
  roadmapped.
