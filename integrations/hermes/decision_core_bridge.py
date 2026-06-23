"""HTTP client for the Decision Core localhost API bridge."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import requests

logger = logging.getLogger("decision_core_plugin")


@dataclass(frozen=True)
class EvaluationResult:
    """Result from a Decision Core policy evaluation."""

    verdict: str  # "allow" | "deny" | "approve_required"
    matched_policies: list[dict[str, Any]] = field(default_factory=list)


class BridgeError(Exception):
    """Raised when the HTTP bridge is unreachable or returns an error."""


class DecisionCoreBridge:
    """Thin HTTP client that talks to the Decision Core localhost API."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:3100",
        api_key: str = "",
        timeout: float = 5.0,
        agent_id: str | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._agent_id = agent_id
        self._session = requests.Session()
        self._session.headers.update({
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._api_key}",
        })

    def evaluate(
        self,
        surface_id: str,
        action: str,
        context: dict[str, Any] | None = None,
    ) -> EvaluationResult:
        """POST /evaluate — ask Decision Core for a policy verdict.

        Raises BridgeError if the bridge is unreachable or returns a
        non-200 status.
        """
        payload: dict[str, Any] = {
            "surfaceId": surface_id,
            "action": action,
        }
        if self._agent_id is not None:
            payload["agentId"] = self._agent_id
        if context is not None:
            payload["context"] = context

        try:
            resp = self._session.post(
                f"{self._base_url}/evaluate",
                json=payload,
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            raise BridgeError(f"Decision Core bridge unreachable: {exc}") from exc

        if resp.status_code != 200:
            raise BridgeError(
                f"Decision Core returned HTTP {resp.status_code}: {resp.text}"
            )

        body = resp.json()
        data = body.get("data", body)

        return EvaluationResult(
            verdict=data.get("verdict", "deny"),
            matched_policies=data.get("matchedPolicies", []),
        )

    def record(
        self,
        surface_id: str,
        tool_name: str,
        result: dict[str, Any] | None = None,
        timing_ms: float = 0,
        correlation_id: str | None = None,
    ) -> None:
        """POST /record-execution — send tool execution outcome for audit.

        This is fire-and-forget; errors are logged but not raised.
        """
        payload: dict[str, Any] = {
            "surface": surface_id,
            "toolName": tool_name,
            "timing_ms": timing_ms,
        }
        if result is not None:
            payload["result"] = result
        if correlation_id is not None:
            payload["correlationId"] = correlation_id

        try:
            resp = self._session.post(
                f"{self._base_url}/record-execution",
                json=payload,
                timeout=self._timeout,
            )
            if resp.status_code != 200:
                logger.warning(
                    "Decision Core /record-execution returned HTTP %d: %s",
                    resp.status_code,
                    resp.text,
                )
        except requests.RequestException as exc:
            logger.warning("Failed to record to Decision Core: %s", exc)
