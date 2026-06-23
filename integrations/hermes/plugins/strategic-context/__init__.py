"""Strategic Context plugin for Hermes Agent.

Queries G-brain for strategy/OKR pages and injects them into
the conversation as advisory context on the first turn.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

import requests

logger = logging.getLogger("strategic_context_plugin")


class PluginContext(Protocol):
    """Minimal protocol for the Hermes plugin context."""

    def get_config(self, key: str, default: Any = None) -> Any: ...
    def register_hook(self, hook_name: str, handler: Any) -> None: ...


_cached_context: str | None = None


def register(ctx: PluginContext) -> None:
    """Entry point called by Hermes to register the plugin."""

    gbrain_url: str = ctx.get_config("gbrain_url", "http://127.0.0.1:3200")
    gbrain_brain_id: str = ctx.get_config("gbrain_brain_id", "")
    strategy_source: str = ctx.get_config("strategy_source", "strategy")
    inject_interval: str = ctx.get_config("strategy_inject_interval", "first_turn")

    def pre_llm_call(
        messages: list[dict[str, Any]],
        turn_count: int = 0,
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        global _cached_context

        if inject_interval == "first_turn" and turn_count > 0 and _cached_context is not None:
            return messages

        if _cached_context is None:
            _cached_context = _fetch_strategic_context(
                gbrain_url, gbrain_brain_id, strategy_source
            )

        if not _cached_context:
            return messages

        strategy_message = {
            "role": "system",
            "content": (
                "[Strategic Context — advisory only, does not override policy]\n"
                + _cached_context
            ),
        }

        return [messages[0], strategy_message] + messages[1:] if messages else [strategy_message]

    ctx.register_hook("pre_llm_call", pre_llm_call)

    logger.info(
        "Strategic context plugin registered (brain=%s, source=%s, interval=%s)",
        gbrain_brain_id,
        strategy_source,
        inject_interval,
    )


def _fetch_strategic_context(
    gbrain_url: str,
    brain_id: str,
    source: str,
) -> str:
    """Fetch strategy pages from G-brain search API."""
    try:
        resp = requests.get(
            f"{gbrain_url}/api/search",
            params={
                "q": "OKRs goals strategy objectives direction",
                "source": source,
                "limit": "5",
            },
            headers={"X-Brain-Id": brain_id} if brain_id else {},
            timeout=5,
        )

        if resp.status_code != 200:
            logger.warning(
                "G-brain strategic context fetch returned %d", resp.status_code
            )
            return ""

        data = resp.json()
        pages = data.get("results", data.get("pages", []))

        if not pages:
            return ""

        summaries: list[str] = []
        for page in pages[:5]:
            title = page.get("title", page.get("slug", "untitled"))
            content = page.get("content", page.get("summary", ""))
            if content:
                summaries.append(f"- {title}: {content[:500]}")

        return "\n".join(summaries)

    except requests.RequestException as exc:
        logger.warning("Failed to fetch strategic context: %s", exc)
        return ""
