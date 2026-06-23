# Conformance CLI

The `decision-core conformance` command runs org-mode conformance scenarios and manages regression baselines. It is separate from `npm test` and the `run-tests` command.

## Running Conformance Before Release

```bash
# Run all org-mode scenarios
decision-core conformance --suite org-mode

# Run smoke tests only (quick verification)
decision-core conformance --suite org-mode --tags smoke

# Check for regressions against the stored baseline
decision-core conformance --check-baseline

# Output as JSON (for CI integration)
decision-core conformance --suite org-mode --format json
```

## Flags

| Flag | Description |
|------|-------------|
| `--suite <name>` | Run a named scenario suite (e.g. `org-mode`) |
| `--tags <tags>` | Comma-separated tag filter (e.g. `smoke`, `release-blocking`) |
| `--check-baseline` | Compare current results against `regression-baseline.json` |
| `--update-baseline` | Regenerate `regression-baseline.json` from current results |
| `--format <fmt>` | Output format: `markdown` (default) or `json` |

## Interpreting Baseline Comparison

When you run `--check-baseline`, the output shows:

- **Regressed**: scenarios that previously passed but now fail (exit code 1)
- **Improved**: scenarios that previously failed but now pass
- **Added**: new scenarios not in the baseline
- **Removed**: baseline scenarios no longer present
- **Unchanged**: scenarios with the same result

## Updating the Baseline

After intentional changes to scenarios or policy rules, update the baseline:

```bash
decision-core conformance --update-baseline
```

This regenerates `test/scenarios/org-mode/regression-baseline.json`. Commit the updated baseline alongside your changes.

## Exit Codes

- **0**: All scenarios passed (or no regressions in `--check-baseline` mode)
- **1**: At least one scenario failed, or a regression was detected

Release-blocking scenarios (tagged `releaseBlocking: true` in YAML) cause a non-zero exit even if other failures are present.

## Tagging Scenarios

Add tags to YAML scenario files at the file level or per-scenario:

```yaml
# File-level tags (applied to all scenarios in the file)
tags: [rbac, smoke]

scenarios:
  - name: "CFO finance report access — allow"
    tags: [release-blocking]      # Per-scenario tags (merged with file-level)
    releaseBlocking: true          # Marks as release-blocking
    steps:
      - name: "CFO can read finance reports"
        agentId: cfo-agent
        method: POST
        path: /evaluate
        body:
          surfaceId: finance-reporting
          action: finance-report-read
        expect:
          status: 200
          verdict: allow
```

Available tags: `smoke`, `release-blocking`, `rbac`, `isolation`, `approval`, `tool-drift`, `security`, `spoofing`, `red-team`.

## Baseline JSON Format

Each entry in `regression-baseline.json` stores:

```json
{
  "scenarioId": "rbac-scenarios.yaml::CFO finance report access — allow",
  "fixtureVersion": "1.0.0",
  "expectedResult": "pass",
  "actualResult": "pass",
  "timestamp": "2026-05-09T07:24:28.584Z"
}
```

## Skipping Non-Runnable Scenarios

Some scenarios (e.g. spoofing tests requiring custom tokens) cannot be run by the conformance CLI. Mark them with `conformanceSkip: true` in the YAML file. These are excluded from conformance runs but remain in the YAML for documentation and E2E test use.
