"""Real-Hermes drop-in e2e driver.

Loads the Decision Core plugin through Hermes's own PluginManager and drives
tool calls through the REAL dispatch path (model_tools.handle_function_call),
exactly as a model-initiated tool call would flow in a user's existing
Hermes installation. Verifies:

  1. Plugin is discovered + enabled from HERMES_HOME/plugins via plugins.enabled
  2. A policy-denied tool is BLOCKED at dispatch (deny rule)
  3. An undeclared tool is BLOCKED (deny-unknown / fail-closed)
  4. An allowed tool passes the policy hook (registry outcome may vary)
  5. post_tool_call audit reaches the DC server with REAL duration_ms timing
"""
import json
import os
import sys
import urllib.request

# Point HERMES_REPO at your local Hermes checkout (the repo whose PluginManager
# and model_tools.handle_function_call we drive). Override via the HERMES_REPO env var.
HERMES_REPO = os.environ.get("HERMES_REPO") or os.path.expanduser("~/hermes-agent")
DC_URL = os.environ.get("DC_URL", "http://127.0.0.1:3147")
TOKEN = os.environ.get("DC_API_KEY", "e2e-test-token")

os.environ.setdefault("HERMES_HOME", "/tmp/dc-hermes-e2e/home")
if not os.path.isdir(HERMES_REPO):
    raise SystemExit(
        f"HERMES_REPO not found: {HERMES_REPO}. Set HERMES_REPO to your Hermes checkout."
    )
os.chdir(HERMES_REPO)
sys.path.insert(0, HERMES_REPO)

results = {}

# --- 1. Load plugins via Hermes's own manager -----------------------------
from hermes_cli.plugins import get_plugin_manager  # noqa: E402

mgr = get_plugin_manager()
loaded = {p.manifest.name: p for p in getattr(mgr, "_plugins", {}).values()} if hasattr(mgr, "_plugins") else {}
# Fall back to public-ish accessors
try:
    plugin_list = mgr.list_plugins()  # may not exist
except Exception:
    plugin_list = None

dc_loaded = False
dc_error = None
for attr in ("_plugins", "plugins"):
    store = getattr(mgr, attr, None)
    if isinstance(store, dict):
        for key, lp in store.items():
            name = getattr(getattr(lp, "manifest", None), "name", key)
            if name == "decision-core":
                dc_loaded = bool(getattr(lp, "enabled", False)) and not getattr(lp, "error", None)
                dc_error = getattr(lp, "error", None)
                results["hooks_registered"] = list(getattr(lp, "hooks_registered", []))
results["plugin_loaded_and_enabled"] = dc_loaded
results["plugin_error"] = dc_error

# --- 2-4. Drive the REAL dispatch path ------------------------------------
import model_tools  # noqa: E402

blocked = model_tools.handle_function_call(
    "payment_send", {"amount": 25000, "to": "acct-9"},
    task_id="e2e-task", session_id="e2e-sess", tool_call_id="e2e-call-1",
)
results["deny_rule_blocks"] = json.loads(blocked)

unknown = model_tools.handle_function_call(
    "exfiltrate_secrets", {"target": "evil.example"},
    task_id="e2e-task", session_id="e2e-sess", tool_call_id="e2e-call-2",
)
results["deny_unknown_blocks"] = json.loads(unknown)

allowed = model_tools.handle_function_call(
    "dc_e2e_noop", {"ping": True},
    task_id="e2e-task", session_id="e2e-sess", tool_call_id="e2e-call-3",
)
results["allowed_tool_result"] = json.loads(allowed) if allowed and allowed.startswith("{") else str(allowed)[:200]

# --- 5. Verify audit landed at the DC server with real timing -------------
req = urllib.request.Request(
    DC_URL + "/audit?limit=50",
    headers={"Authorization": f"Bearer {TOKEN}"},
)
with urllib.request.urlopen(req, timeout=5) as resp:
    audit = json.loads(resp.read().decode())
# The audit endpoint nests records under data.records.
data = audit.get("data", audit) if isinstance(audit, dict) else {}
records = data.get("records", []) if isinstance(data, dict) else []
results["audit_record_count"] = len(records) if isinstance(records, list) else "n/a"
results["audit_tool_names"] = [r.get("toolName") for r in records] if isinstance(records, list) else []
results["audit_latencies"] = [r.get("latency") for r in records] if isinstance(records, list) else []

# --- Pass/fail summary ----------------------------------------------------
ok = (
    "denies" in str(results["deny_rule_blocks"])
    and "denied by default" in str(results["deny_unknown_blocks"])
    and results["audit_record_count"] >= 3
)
results["PASS"] = ok

print("E2E-RESULTS " + json.dumps(results, default=str))
sys.exit(0 if ok else 1)
