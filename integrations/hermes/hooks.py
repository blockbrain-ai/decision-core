"""Hermes hook handlers for Decision Core policy enforcement."""

from __future__ import annotations

import logging
import re
from typing import Any, Callable

from .decision_core_bridge import BridgeError, DecisionCoreBridge

logger = logging.getLogger("decision_core_plugin")


# -- Verdict constants -------------------------------------------------------

VERDICT_ALLOW = "allow"
VERDICT_DENY = "deny"
VERDICT_APPROVE_REQUIRED = "approve_required"


# -- Hook result helpers -----------------------------------------------------

def _pass_through() -> dict[str, Any]:
    """Allow the tool call to proceed."""
    return {"action": "pass"}


def _block(reason: str) -> dict[str, Any]:
    """Block the tool call with an explanation."""
    return {"action": "block", "message": reason}


# -- Command-aware action refinement ----------------------------------------

_GOOGLE_API_PATTERN = re.compile(
    r"google_api\.py\s+"
    r"(?P<service>gmail|calendar|drive|contacts|sheets|docs)\s+"
    r"(?P<operation>\S+)",
)

_SKILL_ACTION_MAP: dict[tuple[str, str], str] = {
    # Gmail
    ("gmail", "search"):  "google.gmail.search",
    ("gmail", "get"):     "google.gmail.get",
    ("gmail", "send"):    "google.gmail.send",
    ("gmail", "reply"):   "google.gmail.reply",
    ("gmail", "labels"):  "google.gmail.labels",
    ("gmail", "modify"):  "google.gmail.modify",
    # Calendar
    ("calendar", "list"):   "google.calendar.list",
    ("calendar", "create"): "google.calendar.create",
    ("calendar", "delete"): "google.calendar.delete",
    # Drive
    ("drive", "search"):        "google.drive.search",
    ("drive", "get"):           "google.drive.get",
    ("drive", "upload"):        "google.drive.upload",
    ("drive", "download"):      "google.drive.download",
    ("drive", "create-folder"): "google.drive.create_folder",
    ("drive", "share"):         "google.drive.share",
    ("drive", "delete"):        "google.drive.delete",
    # Contacts
    ("contacts", "list"): "google.contacts.list",
    # Sheets
    ("sheets", "get"):    "google.sheets.get",
    ("sheets", "create"): "google.sheets.create",
    ("sheets", "update"): "google.sheets.update",
    ("sheets", "append"): "google.sheets.append",
    # Docs
    ("docs", "get"):    "google.docs.get",
    ("docs", "create"): "google.docs.create",
    ("docs", "append"): "google.docs.append",
}


def _refine_action(tool_name: str, args: dict[str, Any]) -> str:
    """Inspect tool arguments to produce a more specific DC action name.

    For terminal/execute_code calls that invoke a known skill script, returns
    a granular action like ``google.gmail.send`` instead of the generic
    ``terminal``. Falls back to the raw tool_name for everything else.
    """
    if tool_name not in ("terminal", "execute_code"):
        return tool_name

    cmd = args.get("command", "") or args.get("code", "") or ""
    if not cmd:
        return tool_name

    m = _GOOGLE_API_PATTERN.search(cmd)
    if m:
        service = m.group("service")
        operation = m.group("operation")
        refined = _SKILL_ACTION_MAP.get((service, operation))
        if refined:
            return refined
        return f"google.{service}.{operation}"

    return tool_name


# -- Hook factories ----------------------------------------------------------

def make_pre_tool_call_hook(
    bridge: DecisionCoreBridge,
    surface_id: str,
    fail_mode: str = "closed",
) -> Callable[..., dict[str, Any]]:
    """Create the pre_tool_call hook bound to a bridge instance.

    Verdict mapping:
      allow            -> pass (tool executes normally)
      deny             -> block with explanation
      approve_required -> block with "Approval required: ..." message

    Failure modes:
      closed (default) -> block if bridge is unreachable
      open             -> log warning and allow if bridge is unreachable
    """

    def pre_tool_call(
        tool_name: str,
        args: dict[str, Any],
        context: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        action = _refine_action(tool_name, args)

        eval_context: dict[str, Any] = {"args": args}
        if context is not None:
            eval_context.update(context)

        try:
            result = bridge.evaluate(
                surface_id=surface_id,
                action=action,
                context=eval_context,
            )
        except BridgeError as exc:
            logger.error("pre_tool_call bridge error: %s", exc)
            if fail_mode == "open":
                logger.warning(
                    "Fail-open: allowing %s despite bridge error", action
                )
                return _pass_through()
            return _block(
                f"Decision Core unavailable — tool call blocked (fail-closed): {exc}"
            )

        if result.verdict == VERDICT_ALLOW:
            return _pass_through()

        if result.verdict == VERDICT_APPROVE_REQUIRED:
            reasons = [
                p.get("reason", "")
                for p in result.matched_policies
                if p.get("reason")
            ]
            detail = "; ".join(reasons) if reasons else "manual approval needed"
            return _block(f"Approval required: {detail}")

        # deny or any unknown verdict -> block
        reasons = [
            p.get("reason", "")
            for p in result.matched_policies
            if p.get("reason")
        ]
        detail = "; ".join(reasons) if reasons else "policy denied this action"
        return _block(detail)

    return pre_tool_call


def make_post_tool_call_hook(
    bridge: DecisionCoreBridge,
    surface_id: str,
) -> Callable[..., None]:
    """Create the post_tool_call hook bound to a bridge instance.

    Records tool execution outcome to Decision Core audit trail.
    Errors are logged but never block — audit recording is best-effort.
    """

    def post_tool_call(
        tool_name: str,
        result: Any = None,
        duration_ms: float | None = None,
        correlation_id: str | None = None,
        args: dict[str, Any] | None = None,
        timing: float | None = None,
        **kwargs: Any,
    ) -> None:
        # Hermes invokes this hook with duration_ms= (see hermes_cli/
        # model_tools.py, handle_function_call). `timing` is kept as a
        # legacy alias for older callers; duration_ms wins when both given.
        action = _refine_action(tool_name, args or {})
        if duration_ms is not None:
            timing_ms = duration_ms
        elif timing is not None:
            timing_ms = timing
        else:
            timing_ms = 0

        outcome: dict[str, Any] = {}
        if result is not None:
            if isinstance(result, dict):
                outcome = result
            else:
                outcome = {"value": str(result)}

        bridge.record(
            surface_id=surface_id,
            tool_name=action,
            result=outcome,
            timing_ms=timing_ms,
            correlation_id=correlation_id,
        )

    return post_tool_call
