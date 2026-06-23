# Hermes Agent Integration Guide

This guide covers integrating Decision Core as a policy enforcement plugin for the Hermes Agent framework.

## Overview

Hermes is a message-orchestration agent framework. Decision Core ships a **Python plugin** that communicates with the Decision Core HTTP server over localhost. The plugin registers `pre_tool_call` and `post_tool_call` hooks — every tool invocation is evaluated against policy before execution, and outcomes are recorded for audit.

```
User Message → Hermes Agent → pre_tool_call hook → HTTP POST /evaluate → Decision Core → verdict
                                                                                          │
                                                  allow → tool executes ←─────────────────┘
                                                  deny → tool blocked with reason
                                                  approve_required → tool blocked ("Approval required: ...")
                                                                                          │
                                          post_tool_call hook → HTTP POST /record-execution ← ──────┘
```

The plugin is a pure Python package — it does **not** embed the TypeScript SDK. It requires a running Decision Core HTTP server (see [HTTP Integration](./http.md)).

## Prerequisites

1. Decision Core HTTP server running on localhost:

```bash
# org-mode / production
sudo systemctl enable --now decision-core

# single-agent / development
DECISION_CORE_BEARER_TOKEN=<token> decision-core serve --port 3100
```

2. Python 3.10+ with `requests`:

```bash
pip install requests
```

## Plugin Directory Structure

The plugin ships at `integrations/hermes/` inside the Decision Core package:

```
integrations/hermes/
├── __init__.py               # register(ctx) entry point
├── plugin.yaml               # Hermes plugin manifest
├── decision_core_bridge.py   # HTTP client for /evaluate and /record-execution
├── hooks.py                  # pre_tool_call / post_tool_call factories
├── requirements.txt          # requests>=2.28.0,<3.0.0
└── test_hooks.py             # 54 pytest test cases
```

## Setup

### 1. Copy the plugin into your Hermes plugins directory

```bash
cp -r node_modules/@decision-core/core/integrations/hermes \
      /path/to/hermes/plugins/decision-core
```

### 2. Install Python dependencies

```bash
pip install -r /path/to/hermes/plugins/decision-core/requirements.txt
```

If the host Python is externally managed (PEP 668), use a plugin-local virtual
environment instead of system `pip`:

```bash
python3 -m venv /path/to/hermes/plugins/decision-core/.venv
source /path/to/hermes/plugins/decision-core/.venv/bin/activate
pip install -r /path/to/hermes/plugins/decision-core/requirements.txt
```

### 3. Configure the plugin

The plugin keys are declared in `plugin.yaml`, but the current implementation
loads them from Hermes `config.yaml` via `hermes_cli.config.load_config()`.
Place the settings under `plugins.settings.decision-core`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `dc_base_url` | string | `http://127.0.0.1:3100` | Decision Core HTTP server URL |
| `dc_api_key` | string | *(required)* | Bearer token for API authentication |
| `dc_surface_id` | string | `hermes` | Surface identifier in evaluation requests |
| `dc_fail_mode` | string | `closed` | `closed` blocks on bridge error; `open` logs and allows |
| `dc_timeout_seconds` | number | `5` | HTTP request timeout |
| `dc_agent_id` | string | *(optional)* | Agent identity for org mode. Must match `agents.yaml` agentId. |

Use environment variable references for secrets so credentials stay in a single
source file. Hermes expands `${VAR}` at runtime from the process environment.

```yaml
plugins:
  enabled:
    - decision-core
  settings:
    decision-core:
      dc_base_url: "http://127.0.0.1:3100"
      dc_api_key: "${DC_API_KEY}"
      dc_agent_id: "${DC_AGENT_ID}"
      dc_surface_id: "hermes"
      dc_fail_mode: "closed"
      dc_timeout_seconds: 5
```

Do **not** paste raw tokens into `config.yaml`. Keep `DC_API_KEY` and
`DC_AGENT_ID` in the per-agent env file (e.g.
`/home/<agent>/.config/decision-core/agent.env`) and ensure the Hermes process
has them in its environment — either via an `EnvironmentFile=` in the systemd
unit, or by sourcing the file before running Hermes manually.

Keep the Hermes terminal runtime separate from web/search backends. Values like
`brave-free` belong under `web.backend` / `web.search_backend`, not
`terminal.backend`. `terminal.backend` must remain one of Hermes' terminal
runtimes such as `local`, `docker`, `singularity`, `modal`, or `ssh`.

### 4. Start the Decision Core server

For org-mode deployments (multiple agents with per-agent tokens):

```bash
# systemd service (recommended for production)
sudo systemctl enable --now decision-core
```

For single-agent or development setups:

```bash
DECISION_CORE_BEARER_TOKEN=<token> decision-core serve --port 3100
```

For localhost-only development without auth:

```bash
decision-core serve --port 3100 --allow-unauthenticated-local
```

## How Action Names Work

The DC plugin sends the **raw Hermes tool function name** as the `action` field
in every `/evaluate` request. It does not translate tool names into dot-style
domain names — the action is whatever Hermes calls the tool internally.

For example, when the agent calls the file-search tool, the plugin sends
`action: "search_files"`, not `action: "file.search"` or `action: "public.search"`.

This means your policy pack must have rules whose `actionTypePattern` matches
the Hermes function names listed below, **or** uses `denyUnknownDefault: false`
(not recommended for production).

### Hermes Tool Function Reference

The table below lists every built-in Hermes tool function name grouped by
toolset. These are the exact strings sent as `action` in `/evaluate` requests.

| Toolset | Function Names | Default |
|---------|---------------|---------|
| **web** | `web_search`, `web_extract` | enabled |
| **browser** | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_back`, `browser_press`, `browser_get_images`, `browser_vision`, `browser_console` | enabled |
| **browser-cdp** | `browser_cdp`, `browser_dialog` | enabled |
| **terminal** | `terminal`, `process` | enabled |
| **file** | `read_file`, `write_file`, `patch`, `search_files` | enabled |
| **code_execution** | `execute_code` | enabled |
| **vision** | `vision_analyze` | enabled |
| **video** | `video_analyze` | disabled |
| **image_gen** | `image_generate` | enabled |
| **video_gen** | `video_generate` | disabled |
| **tts** | `text_to_speech` | enabled |
| **skills** | `skills_list`, `skill_view`, `skill_manage` | enabled |
| **todo** | `todo` | enabled |
| **memory** | `memory` | enabled |
| **session_search** | `session_search` | enabled |
| **clarify** | `clarify` | enabled |
| **delegation** | `delegate_task` | enabled |
| **cronjob** | `cronjob` | enabled |
| **messaging** | `send_message` | enabled |
| **computer_use** | `computer_use` | enabled |
| **moa** | `mixture_of_agents` | disabled |
| **x_search** | `x_search` | disabled |

Disabled toolsets are not presented to the model and will not generate
`/evaluate` requests unless explicitly enabled in `hermes tools`.

MCP tools registered at runtime use a prefixed name (e.g.
`mcp_servername_toolname`). Add policy rules for those names once you know
which MCP servers are configured.

`web_extract` needs a real extraction backend. If Hermes is configured with
Brave Free for search, `web_search` works but `web_extract` does not. In that
case, configure `web.extract_backend` separately or deny `web_extract` in policy
until the extract backend exists.

### Writing Policy Rules For Hermes Tools

Use `actionTypePattern` with the exact function name or a glob pattern:

```yaml
# Exact match — one tool, one rule
- name: allow-web-search
  actionTypePattern: "web_search"
  defaultVerdict: allow
  enabled: true

# Glob — all browser tools
- name: allow-browser-tools
  actionTypePattern: "browser_*"
  requiredRoles: [owner, executive, operations]
  defaultVerdict: allow
  enabled: true
```

See the [Policy Authoring Guide](../POLICY-AUTHORING-GUIDE.md#designing-a-hermes-policy-pack)
for a full worked example of role-based tool authorization.

### Command-Aware Action Refinement (Skills)

Hermes skills (Google Workspace, Linear, Notion, etc.) execute through the
`terminal` or `execute_code` tools. Without refinement, the DC plugin would send
`action: "terminal"` for both a Gmail search and a Gmail send — making it
impossible to enforce different policies on read vs. write operations.

The plugin solves this with **command-aware action refinement**. Before sending
the `/evaluate` request, the `pre_tool_call` hook inspects the `command`
argument for known skill script patterns and maps them to granular action names:

```
terminal("python google_api.py gmail send --to ...")
  → action: "google.gmail.send"    (not "terminal")

terminal("python google_api.py calendar list")
  → action: "google.calendar.list" (not "terminal")

terminal("ls -la /tmp")
  → action: "terminal"             (no match — unchanged)
```

#### Supported Skill Mappings

| Skill Script | Service | Operations | Action Names |
|---|---|---|---|
| `google_api.py` | gmail | search, get, send, reply, labels, modify | `google.gmail.*` |
| `google_api.py` | calendar | list, create, delete | `google.calendar.*` |
| `google_api.py` | drive | search, get, upload, download, create-folder, share, delete | `google.drive.*` |
| `google_api.py` | contacts | list | `google.contacts.list` |
| `google_api.py` | sheets | get, create, update, append | `google.sheets.*` |
| `google_api.py` | docs | get, create, append | `google.docs.*` |

Unrecognized operations fall back to `google.<service>.<operation>` — still
refined, still auditable, just not in the pre-defined map.

#### Example: Allow Reading But Require Approval For Sending

```yaml
rules:
  # Read operations — open to all roles
  - name: google-allow-gmail-search
    actionTypePattern: "google.gmail.search"
    defaultVerdict: allow
    enabled: true

  - name: google-allow-gmail-get
    actionTypePattern: "google.gmail.get"
    defaultVerdict: allow
    enabled: true

  # Write operations — approval required, leadership only
  - name: google-approve-gmail-send
    actionTypePattern: "google.gmail.send"
    requiredRoles: [owner, managing-director, executive, ceo]
    requireApproval: true
    approverRole: owner
    enabled: true

  - name: google-approve-gmail-reply
    actionTypePattern: "google.gmail.reply"
    requiredRoles: [owner, managing-director, executive, ceo]
    requireApproval: true
    approverRole: owner
    enabled: true
```

With this configuration:
- The agent can search and read emails freely
- Attempting to send or reply triggers: *"Approval required: ..."*
- Non-leadership agents are denied outright (no role match + `denyUnknownDefault`)

#### Adding Custom Skill Mappings

To add refinement for other skills (Linear, Notion, etc.), add patterns to the
`_SKILL_ACTION_MAP` dict and a regex in `hooks.py`. The pattern matches against
the full `command` string passed to the terminal tool.

## How It Works

### Plugin Registration

When Hermes loads the plugin, it calls `register(ctx)` in `__init__.py`:

```python
from hermes_cli.config import load_config

def register(ctx: PluginContext) -> None:
    cfg = load_config()
    settings = cfg.get("plugins", {}).get("settings", {}).get("decision-core", {})

    bridge = DecisionCoreBridge(
        base_url=settings.get("dc_base_url", "http://127.0.0.1:3100"),
        api_key=settings.get("dc_api_key", ""),
        timeout=float(settings.get("dc_timeout_seconds", 5)),
        agent_id=settings.get("dc_agent_id"),
    )

    ctx.register_hook("pre_tool_call", make_pre_tool_call_hook(
        bridge=bridge,
        surface_id=settings.get("dc_surface_id", "hermes"),
        fail_mode=settings.get("dc_fail_mode", "closed"),
    ))
    ctx.register_hook("post_tool_call", make_post_tool_call_hook(
        bridge=bridge,
        surface_id=settings.get("dc_surface_id", "hermes"),
    ))
```

### pre_tool_call — Policy Evaluation

Before each tool executes, the hook sends a `POST /evaluate` request:

```json
{
  "surfaceId": "hermes",
  "action": "shell_exec",
  "context": {
    "args": {"cmd": "rm -rf /tmp/data"},
    "user": "alice"
  }
}
```

The Decision Core server responds with a verdict:

```json
{
  "status": "ok",
  "data": {
    "verdict": "deny",
    "matchedPolicies": [
      {"reason": "destructive shell commands blocked by safety policy"}
    ]
  }
}
```

The hook maps verdicts to Hermes hook results:

| Decision Core Verdict | Hermes Hook Result | Effect |
|----------------------|-------------------|--------|
| `allow` | `{"action": "pass"}` | Tool executes normally |
| `deny` | `{"action": "block", "message": "..."}` | Tool blocked; reason shown to agent |
| `approve_required` | `{"action": "block", "message": "Approval required: ..."}` | Tool blocked; Hermes has no native pause/approval, so approval-required maps to a block with an explanatory message |

### post_tool_call — Audit Recording

After a tool executes, the hook sends a `POST /record-execution` request to
capture the outcome:

```json
{
  "surface": "hermes",
  "toolName": "shell_exec",
  "result": {"stdout": "ok"},
  "timing_ms": 42.5,
  "correlationId": "corr-123"
}
```

Recording is fire-and-forget — errors are logged but never block the agent.

## Failure Modes

The `dc_fail_mode` configuration controls what happens when the Decision Core server is unreachable:

| Mode | Behavior |
|------|----------|
| `closed` (default) | All tool calls are blocked. Safe default for production. |
| `open` | Tool calls are allowed with a logged warning. Use only for development. |

```python
# fail-closed: bridge error → block
hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes", fail_mode="closed")

# fail-open: bridge error → log warning, allow
hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes", fail_mode="open")
```

## Approval Handling

Hermes's `pre_tool_call` hook can only return pass or block — there is no native pause/resume mechanism. When Decision Core returns `approve_required`, the plugin blocks the tool call with a message explaining that approval is needed:

```
Approval required: needs manager sign-off for production deployment
```

To implement a full approval workflow with Hermes, you would need to:

1. Capture the block message in your Hermes conversation handler
2. Route the approval request to an external system (Slack, email, dashboard)
3. Re-invoke the tool after approval is granted

This is an integration-level concern outside the plugin itself. For native `requireApproval` support, see the [OpenCLAW integration](./openclaw.md).

## Testing

The plugin ships with 54 pytest test cases in `test_hooks.py` covering:

- Allow, deny, and approve_required verdicts
- Fail-closed and fail-open behavior
- Bridge error handling
- Post-tool-call recording
- Bridge HTTP client (mocked `requests.Session`)
- Plugin registration
- Command-aware action refinement for Google Workspace skills
- Integration between refined actions and pre/post hook audit paths
- The current limitation that list-style subprocess args are not refined; only
  shell-style command strings are matched

Run tests:

```bash
cd integrations/hermes
pip install pytest requests
python -m pytest test_hooks.py -v
```

## Configuration Examples

### Production (org mode, fail-closed)

```yaml
plugins:
  enabled:
    - decision-core
  settings:
    decision-core:
      dc_base_url: "http://127.0.0.1:3100"
      dc_api_key: "${DC_API_KEY}"
      dc_agent_id: "${DC_AGENT_ID}"
      dc_surface_id: "hermes"
      dc_fail_mode: "closed"
      dc_timeout_seconds: 5
```

Ensure the systemd unit includes both env files:

```ini
EnvironmentFile=/home/<agent>/.config/decision-core/agent.env
EnvironmentFile=/home/<agent>/.hermes/.env
```

For service-managed deployments, validate the running gateway with
`systemctl status hermes-gateway-<agent>`. Some Hermes versions report
`hermes gateway status --system` as "running manually" even when the real
systemd unit is healthy.

### Development (single agent, fail-open)

```yaml
plugins:
  enabled:
    - decision-core
  settings:
    decision-core:
      dc_base_url: "http://127.0.0.1:3100"
      dc_api_key: "${DECISION_CORE_BEARER_TOKEN}"
      dc_surface_id: "hermes-dev"
      dc_fail_mode: "open"
      dc_timeout_seconds: 10
```

## Organisation Mode

When running multiple Hermes agents with role-based policies, each agent needs its own identity and token.

### Per-Agent Setup

1. Run `decision-core org init` and `decision-core provision` to generate per-agent configs.
2. Each Hermes agent gets its own `agent.env` with a unique `DC_API_KEY` and `DC_AGENT_ID`.
3. Configure each agent's plugin:

```yaml
plugins:
  enabled:
    - decision-core
  settings:
    decision-core:
      dc_base_url: "http://127.0.0.1:3100"
      dc_api_key: "${DC_API_KEY}"         # unique per agent
      dc_agent_id: "${DC_AGENT_ID}"       # matches agents.yaml
      dc_surface_id: "hermes"
      dc_fail_mode: "closed"
```

4. The DC server resolves identity from the bearer token. `dc_agent_id` is sent as a consistency check — the server rejects requests where the body agentId doesn't match the token-bound identity.

### Additional Plugins

Org mode adds two optional Hermes plugins:

- **`plugins/strategic-context/`** — injects company OKRs and strategy from G-brain into conversations
- **`plugins/approval-queue/`** — polls for pending approvals assigned to this agent's role

See [Organisation Deployment Security](../ORG-DEPLOYMENT-SECURITY.md) for the full threat model.

## Evidence Write-Back to G-Brain

When Decision Core is configured with the G-Brain evidence sink, every policy
evaluation triggered by a Hermes tool call is recorded as a G-Brain knowledge
page. This gives you a queryable audit trail of all agent actions and verdicts.

Evidence recording is fire-and-forget — it never delays the verdict response to
Hermes. If G-Brain is temporarily unreachable, the verdict still returns normally
and the error is logged.

To enable evidence write-back, configure the Decision Core server with the G-Brain
HTTP transport environment variables. See the [G-Brain Adapter Guide](./gbrain.md#evidence-sink)
for the full configuration reference.

Once enabled, verify evidence appears after an evaluation:

```bash
# Use the G-Brain search/get-page commands from gbrain.md to confirm that
# Decision Core pages are being written under the decisions/ namespace.
```

## Related Documentation

- [HTTP Integration](./http.md) — HTTP API reference (the transport layer this plugin uses)
- [G-Brain Adapter Guide](./gbrain.md) — Evidence sink, transport configuration, OAuth setup
- [Architecture](../ARCHITECTURE.md) — System design
- [Policy Authoring Guide](../POLICY-AUTHORING-GUIDE.md) — Writing rules for tools
- [MCP Integration](./mcp.md) — Alternative MCP-based integration
- [OpenCLAW Integration](./openclaw.md) — TypeScript SDK integration with native approval support
- [Five-Person Hermes + G-Brain Runbook](../runbooks/decision-core-hermes-gbrain-five-person-setup-guide-2026-05-19.md) — fresh and existing deployment flow
