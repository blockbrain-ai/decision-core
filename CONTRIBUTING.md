# Contributing to Decision Core

Thanks for your interest in contributing! Decision Core is a portable, deterministic
deny-wins policy governor for AI agents. Correctness and a clean, dependency-light core
matter more here than features.

## Getting started

```bash
git clone https://github.com/blockbrain-ai/decision-core.git
cd decision-core
npm install
npm test          # vitest run
```

Requires Node.js >= 20.

## Quality gates (must pass before a PR)

```bash
npm run typecheck   # tsc --noEmit, strict
npm run lint        # oxlint
npm test            # full suite
npm run build       # tsc -> dist/
```

CI runs all of these. PRs that drop the test count or introduce type/lint errors will not
be merged.

## Conventions

- **TypeScript strict**, ES modules, Node16 resolution.
- **Tests live next to source**: `foo.ts` → `foo.test.ts`. Integration tests live under
  `test/`.
- **Contracts are the single source of truth**: types and validation live in
  `src/contracts/*` as Zod schemas — change the contract first.
- **No `console.log`** — use the structured logger (`src/utils/logger.ts`, pino).
- **No new mandatory runtime dependency** without discussion. The core must keep running
  with no DB, no LLM, and no network in the decision path.
- **Never weaken** the deny-wins default, the deny-unknown backstop, or the tamper-evident
  audit chain. Changes touching `src/policy`, `src/knowledge/enforcement`, or
  `src/integrity` get extra review.
- **No secrets** in the repo or tests (use the synthetic fixtures).

## Pull requests

1. Fork and branch from `main`.
2. Keep changes focused; add or update tests for behaviour you change.
3. Describe the user-facing effect and call out anything touching a security chokepoint.
4. By contributing you agree your work is licensed under the project's MIT license.

## Reporting bugs

Open a GitHub issue with a minimal reproduction (a small policy pack + the call and the
verdict you expected vs got). For **security** issues, follow [`SECURITY.md`](./SECURITY.md)
— do not open a public issue.
