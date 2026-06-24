# Hermes drop-in e2e proof

This harness answers the question the unit tests cannot: **does the Decision
Core plugin actually enforce policy when dropped into a real, existing Hermes
installation — loaded by Hermes's own `PluginManager` and driven through the
real `model_tools.handle_function_call` dispatch path?**

Unlike `test/live-hosts/`, which invokes `mgr.invoke_hook()` directly, this
driver goes through Hermes's production tool-dispatch entry point, so it
exercises the exact path a model-initiated tool call takes.

## What it proves

Running `driver.py` against a real Hermes checkout + a running Decision Core
server verifies, end to end:

1. The plugin is discovered and enabled from `HERMES_HOME/plugins` via
   `plugins.enabled` (standalone-kind opt-in).
2. A policy-denied tool (`payment_send`) is **blocked at dispatch** by the
   `block-payments` deny rule.
3. An undeclared tool (`exfiltrate_secrets`) is **blocked** by deny-unknown
   (fail-closed).
4. An allowed tool passes the `pre_tool_call` hook and dispatches.
5. `post_tool_call` audit reaches the Decision Core server with numeric
   `duration_ms` timing (regression guard for the duration_ms/timing bug),
   and the records are visible via `GET /audit` — proving the default
   in-memory evidence sink wiring.

Last verified: 2026-06-24 against a local Hermes checkout reporting
`hermes_cli.__version__ = 0.14.0` and git `edb2d9105`
(`v2026.5.16-593-gedb2d9105`). Result: plugin loaded and registered
`pre_tool_call` + `post_tool_call`, 4 audit records, both denies enforced,
`read_file` allowed path dispatched. `PASS=true`.

## Why it is not in the default `npm test`

It requires a local Hermes checkout and a running server, so it cannot run in
a hermetic CI box. It is kept as a documented, repeatable manual gate to run
before any release that touches the Hermes integration.

## How to run

```bash
# 1. Build Decision Core
npm run build

# 2. Point HERMES_REPO at your Hermes checkout, then set up a
#    throwaway HERMES_HOME with the plugin + config (see hermes-config.yaml)
#    and a DC policy pack (see policy-pack.yaml).

# 3. Start the Decision Core server with the policy pack
node dist/src/surfaces/cli/bin.js serve \
  --port 3147 --bearer-token e2e-test-token --config <dir>/decision-core.yaml

# 4. Run the driver (Python venv with requests + pyyaml)
HERMES_REPO=<path-to-hermes> python test/hermes-dropin-e2e/driver.py
# → prints E2E-RESULTS {...} and exits 0 on PASS
```

Files:
- `driver.py` — the e2e driver (`HERMES_REPO`, `DC_URL`, and `DC_API_KEY`
  are environment overrides)
- `policy-pack.yaml` — DC policy pack (allow read_*, deny payment_*/delete_*)
- `hermes-config.yaml` — example Hermes `config.yaml` enabling the plugin
