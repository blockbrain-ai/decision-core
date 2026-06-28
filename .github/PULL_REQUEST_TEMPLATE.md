<!--
Thanks for contributing to Decision Core! A few notes:
- Every PR is reviewed and governed before it merges. Opening a PR does not guarantee a merge.
- Sign off your commits for the DCO: `git commit -s` (adds a Signed-off-by line). CI checks this.
-->

## What & why

<!-- What does this change, and why? Link any related issue (e.g. "Closes #123"). -->

## Scope / safety

Decision Core is a safety library, so please help reviewers by stating scope:

- [ ] Does this touch the **decision hot path** — the PDP/PEP, deny-wins arbitration, the tamper-evident
      audit/evidence chain, or the SDK **default enforcement mode**? If **yes**, explain why and how the
      existing guarantees are preserved. If **no**, say so (e.g. "docs/CLI/onboarding-layer only").
- [ ] Behaviour changes are covered by tests (added or updated).

## Checklist

- [ ] Commits are **signed off** for the [DCO](https://developercertificate.org/): `git commit -s`
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass locally
- [ ] Docs updated if behaviour or claims changed — and consistent with [`docs/STATUS-LEDGER.md`](../docs/STATUS-LEDGER.md)
