"""Decision Core plugin for Hermes Agent.

Registers pre_tool_call and post_tool_call hooks that enforce
Decision Core policies via the localhost HTTP bridge.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

from .decision_core_bridge import DecisionCoreBridge
from .hooks import make_pre_tool_call_hook, make_post_tool_call_hook

logger = logging.getLogger("decision_core_plugin")


class PluginContext(Protocol):
    """Minimal protocol for the Hermes plugin context."""

    def register_hook(self, hook_name: str, handler: Any) -> None: ...


def _load_plugin_settings() -> dict:
    """Read decision-core settings from Hermes config.yaml."""
    try:
        from hermes_cli.config import load_config
        cfg = load_config()
        plugins = cfg.get("plugins", {})
        settings = plugins.get("settings", {})
        return settings.get("decision-core", {})
    except Exception:
        return {}


def register(ctx: PluginContext) -> None:
    """Entry point called by Hermes to register the plugin."""

    settings = _load_plugin_settings()
    base_url: str = settings.get("dc_base_url", "http://127.0.0.1:3100")
    api_key: str = settings.get("dc_api_key", "")
    surface_id: str = settings.get("dc_surface_id", "hermes")
    fail_mode: str = settings.get("dc_fail_mode", "closed")
    timeout: float = float(settings.get("dc_timeout_seconds", 5))
    agent_id: str | None = settings.get("dc_agent_id", None)

    if not api_key:
        logger.error("dc_api_key is required but not configured; plugin will fail-closed")

    bridge = DecisionCoreBridge(
        base_url=base_url,
        api_key=api_key,
        timeout=timeout,
        agent_id=agent_id,
    )

    pre_hook = make_pre_tool_call_hook(
        bridge=bridge,
        surface_id=surface_id,
        fail_mode=fail_mode,
    )
    post_hook = make_post_tool_call_hook(
        bridge=bridge,
        surface_id=surface_id,
    )

    ctx.register_hook("pre_tool_call", pre_hook)
    ctx.register_hook("post_tool_call", post_hook)

    logger.info(
        "Decision Core plugin registered (surface=%s, fail_mode=%s, url=%s)",
        surface_id,
        fail_mode,
        base_url,
    )
