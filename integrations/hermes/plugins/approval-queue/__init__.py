"""Approval Queue plugin for Hermes Agent.

Polls Decision Core for pending approvals assigned to this agent's
role and surfaces them to the human operator for resolution.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

import requests

logger = logging.getLogger("approval_queue_plugin")


class PluginContext(Protocol):
    """Minimal protocol for the Hermes plugin context."""

    def get_config(self, key: str, default: Any = None) -> Any: ...
    def register_hook(self, hook_name: str, handler: Any) -> None: ...
    def register_tool(self, name: str, handler: Any, description: str = "") -> None: ...


def register(ctx: PluginContext) -> None:
    """Entry point called by Hermes to register the plugin."""

    dc_base_url: str = ctx.get_config("dc_base_url", "http://127.0.0.1:3100")
    dc_api_key: str = ctx.get_config("dc_api_key", "")
    agent_id: str = ctx.get_config("dc_agent_id", "")

    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {dc_api_key}",
    })

    def pre_llm_call(
        messages: list[dict[str, Any]],
        turn_count: int = 0,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        """Check for pending approvals and inject notification."""
        if turn_count > 0:
            return messages

        try:
            resp = session.get(
                f"{dc_base_url}/approvals/pending",
                params={"agentId": agent_id},
                timeout=5,
            )
            if resp.status_code != 200:
                return messages

            data = resp.json()
            pending = data.get("data", data) if isinstance(data, dict) else data
            if not pending or not isinstance(pending, list) or len(pending) == 0:
                return messages

            summary_lines = [f"You have {len(pending)} pending approval request(s):"]
            for item in pending[:5]:
                action = item.get("actionType", "unknown")
                requester = item.get("requestedBy", "unknown")
                approval_id = item.get("id", "?")
                summary_lines.append(
                    f"  - [{approval_id}] {action} (requested by {requester})"
                )

            notification = {
                "role": "system",
                "content": "\n".join(summary_lines),
            }

            return [messages[0], notification] + messages[1:] if messages else [notification]

        except requests.RequestException as exc:
            logger.warning("Failed to check pending approvals: %s", exc)
            return messages

    def resolve_approval(
        approval_id: str,
        decision: str = "approved",
        notes: str = "",
    ) -> dict[str, Any]:
        """Resolve a pending approval request."""
        try:
            resp = session.post(
                f"{dc_base_url}/approvals/{approval_id}/resolve",
                json={
                    "decision": decision,
                    "resolvedBy": agent_id,
                    "resolutionNotes": notes,
                },
                timeout=5,
            )

            if resp.status_code == 403:
                return {"error": resp.json().get("error", "Forbidden")}
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}"}

            return resp.json()

        except requests.RequestException as exc:
            return {"error": str(exc)}

    ctx.register_hook("pre_llm_call", pre_llm_call)
    ctx.register_tool(
        "resolve_approval",
        resolve_approval,
        "Approve or reject a pending approval request by ID",
    )

    logger.info(
        "Approval queue plugin registered (agent_id=%s, url=%s)",
        agent_id,
        dc_base_url,
    )
