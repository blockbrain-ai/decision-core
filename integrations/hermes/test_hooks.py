"""Tests for Decision Core Hermes plugin hooks and bridge."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from hermes.decision_core_bridge import BridgeError, DecisionCoreBridge, EvaluationResult
from hermes.hooks import (
    VERDICT_ALLOW,
    VERDICT_APPROVE_REQUIRED,
    VERDICT_DENY,
    _refine_action,
    make_post_tool_call_hook,
    make_pre_tool_call_hook,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class FakeBridge:
    """Test double for DecisionCoreBridge."""

    def __init__(self, verdict: str = "allow", policies: list | None = None):
        self.verdict = verdict
        self.policies = policies or []
        self.evaluate_calls: list[dict[str, Any]] = []
        self.record_calls: list[dict[str, Any]] = []

    def evaluate(
        self, surface_id: str, action: str, context: dict | None = None
    ) -> EvaluationResult:
        self.evaluate_calls.append(
            {"surface_id": surface_id, "action": action, "context": context}
        )
        return EvaluationResult(
            verdict=self.verdict, matched_policies=self.policies
        )

    def record(self, **kwargs: Any) -> None:
        self.record_calls.append(kwargs)


class FailingBridge(FakeBridge):
    """Bridge that always raises BridgeError on evaluate."""

    def evaluate(
        self, surface_id: str, action: str, context: dict | None = None
    ) -> EvaluationResult:
        raise BridgeError("Connection refused")


# ---------------------------------------------------------------------------
# _refine_action tests
# ---------------------------------------------------------------------------


class TestRefineActionGoogleGmail:
    def test_gmail_search(self):
        assert _refine_action("terminal", {"command": "python google_api.py gmail search 'is:unread'"}) == "google.gmail.search"

    def test_gmail_get(self):
        assert _refine_action("terminal", {"command": "python google_api.py gmail get MSG_123"}) == "google.gmail.get"

    def test_gmail_send(self):
        assert _refine_action("terminal", {"command": 'python google_api.py gmail send --to user@example.com --subject "Hi" --body "Hello"'}) == "google.gmail.send"

    def test_gmail_reply(self):
        assert _refine_action("terminal", {"command": "python google_api.py gmail reply MSG_123 --body 'Thanks'"}) == "google.gmail.reply"

    def test_gmail_labels(self):
        assert _refine_action("terminal", {"command": "python google_api.py gmail labels"}) == "google.gmail.labels"

    def test_gmail_modify(self):
        assert _refine_action("terminal", {"command": "python google_api.py gmail modify MSG_123 --add-labels LABEL"}) == "google.gmail.modify"


class TestRefineActionGoogleCalendar:
    def test_calendar_list(self):
        assert _refine_action("terminal", {"command": "python google_api.py calendar list"}) == "google.calendar.list"

    def test_calendar_create(self):
        assert _refine_action("terminal", {"command": 'python google_api.py calendar create --summary "Meeting" --start 2026-03-01T10:00:00Z --end 2026-03-01T11:00:00Z'}) == "google.calendar.create"

    def test_calendar_delete(self):
        assert _refine_action("terminal", {"command": "python google_api.py calendar delete EVT_123"}) == "google.calendar.delete"


class TestRefineActionGoogleDrive:
    def test_drive_search(self):
        assert _refine_action("terminal", {"command": 'python google_api.py drive search "budget report"'}) == "google.drive.search"

    def test_drive_upload(self):
        assert _refine_action("terminal", {"command": "python google_api.py drive upload /tmp/report.pdf"}) == "google.drive.upload"

    def test_drive_share(self):
        assert _refine_action("terminal", {"command": "python google_api.py drive share FILE_ID --email user@example.com --role reader"}) == "google.drive.share"

    def test_drive_delete(self):
        assert _refine_action("terminal", {"command": "python google_api.py drive delete FILE_ID"}) == "google.drive.delete"

    def test_drive_create_folder(self):
        assert _refine_action("terminal", {"command": 'python google_api.py drive create-folder "Reports"'}) == "google.drive.create_folder"


class TestRefineActionGoogleSheets:
    def test_sheets_get(self):
        assert _refine_action("terminal", {"command": 'python google_api.py sheets get SHEET_ID "Sheet1!A1:D10"'}) == "google.sheets.get"

    def test_sheets_update(self):
        assert _refine_action("terminal", {"command": "python google_api.py sheets update SHEET_ID 'Sheet1!A1:B2' --values '[[\"a\",\"b\"]]'"}) == "google.sheets.update"

    def test_sheets_create(self):
        assert _refine_action("terminal", {"command": 'python google_api.py sheets create --title "Budget"'}) == "google.sheets.create"


class TestRefineActionGoogleDocs:
    def test_docs_get(self):
        assert _refine_action("terminal", {"command": "python google_api.py docs get DOC_ID"}) == "google.docs.get"

    def test_docs_create(self):
        assert _refine_action("terminal", {"command": 'python google_api.py docs create --title "Notes"'}) == "google.docs.create"

    def test_docs_append(self):
        assert _refine_action("terminal", {"command": 'python google_api.py docs append DOC_ID --text "New paragraph"'}) == "google.docs.append"


class TestRefineActionFallback:
    def test_non_terminal_unchanged(self):
        assert _refine_action("web_search", {"query": "test"}) == "web_search"

    def test_terminal_without_google_api(self):
        assert _refine_action("terminal", {"command": "ls -la /tmp"}) == "terminal"

    def test_terminal_empty_command(self):
        assert _refine_action("terminal", {"command": ""}) == "terminal"

    def test_terminal_no_command_key(self):
        assert _refine_action("terminal", {}) == "terminal"

    def test_execute_code_with_google_api(self):
        assert _refine_action("execute_code", {"code": "python google_api.py gmail send --to x@y.com"}) == "google.gmail.send"

    def test_execute_code_list_args_not_matched(self):
        result = _refine_action("execute_code", {"code": "import subprocess; subprocess.run(['python', 'google_api.py', 'gmail', 'send'])"})
        assert result == "execute_code"

    def test_unknown_google_operation_uses_generic(self):
        assert _refine_action("terminal", {"command": "python google_api.py gmail archive MSG_123"}) == "google.gmail.archive"

    def test_gapi_variable_path(self):
        cmd = "python ${HERMES_HOME:-$HOME/.hermes}/skills/productivity/google-workspace/scripts/google_api.py gmail search 'is:unread'"
        assert _refine_action("terminal", {"command": cmd}) == "google.gmail.search"

    def test_contacts_list(self):
        assert _refine_action("terminal", {"command": "python google_api.py contacts list --max 20"}) == "google.contacts.list"


class TestRefineActionIntegrationWithHooks:
    def test_pre_hook_sends_refined_action(self):
        bridge = FakeBridge(verdict="allow")
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("terminal", {"command": "python google_api.py gmail send --to x@y.com"})
        assert bridge.evaluate_calls[0]["action"] == "google.gmail.send"

    def test_pre_hook_plain_terminal_unchanged(self):
        bridge = FakeBridge(verdict="allow")
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("terminal", {"command": "ls -la"})
        assert bridge.evaluate_calls[0]["action"] == "terminal"

    def test_post_hook_sends_refined_action(self):
        bridge = FakeBridge()
        hook = make_post_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("terminal", result={"stdout": "sent"}, args={"command": "python google_api.py gmail send --to x@y.com"})
        assert bridge.record_calls[0]["tool_name"] == "google.gmail.send"

    def test_post_hook_no_args_uses_raw_name(self):
        bridge = FakeBridge()
        hook = make_post_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("terminal", result={"stdout": "ok"})
        assert bridge.record_calls[0]["tool_name"] == "terminal"

    def test_deny_on_refined_action(self):
        bridge = FakeBridge(verdict="deny", policies=[{"reason": "email send blocked"}])
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        result = hook("terminal", {"command": "python google_api.py gmail send --to x@y.com"})
        assert result["action"] == "block"
        assert "email send blocked" in result["message"]
        assert bridge.evaluate_calls[0]["action"] == "google.gmail.send"

    def test_approve_required_on_refined_action(self):
        bridge = FakeBridge(verdict="approve_required", policies=[{"reason": "needs sign-off"}])
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        result = hook("terminal", {"command": "python google_api.py calendar create --summary 'Meeting'"})
        assert result["action"] == "block"
        assert "Approval required:" in result["message"]
        assert bridge.evaluate_calls[0]["action"] == "google.calendar.create"


# ---------------------------------------------------------------------------
# pre_tool_call tests
# ---------------------------------------------------------------------------


class TestPreToolCallAllow:
    def test_allow_verdict_passes_through(self):
        bridge = FakeBridge(verdict="allow")
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        result = hook("shell_exec", {"cmd": "ls"})
        assert result == {"action": "pass"}

    def test_allow_sends_correct_payload(self):
        bridge = FakeBridge(verdict="allow")
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("file_write", {"path": "/tmp/x"}, context={"user": "alice"})
        call = bridge.evaluate_calls[0]
        assert call["surface_id"] == "hermes"
        assert call["action"] == "file_write"
        assert call["context"]["args"] == {"path": "/tmp/x"}
        assert call["context"]["user"] == "alice"


class TestPreToolCallDeny:
    def test_deny_verdict_blocks(self):
        bridge = FakeBridge(
            verdict="deny",
            policies=[{"reason": "prohibited by safety policy"}],
        )
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        result = hook("rm_rf", {"path": "/"})
        assert result["action"] == "block"
        assert "prohibited by safety policy" in result["message"]

    def test_deny_no_reason_gives_default(self):
        bridge = FakeBridge(verdict="deny", policies=[{}])
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        result = hook("rm_rf", {"path": "/"})
        assert result["action"] == "block"
        assert "policy denied" in result["message"]


class TestPreToolCallApproveRequired:
    def test_approve_required_blocks_with_message(self):
        bridge = FakeBridge(
            verdict="approve_required",
            policies=[{"reason": "needs manager sign-off"}],
        )
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        result = hook("deploy", {"env": "prod"})
        assert result["action"] == "block"
        assert result["message"].startswith("Approval required:")
        assert "needs manager sign-off" in result["message"]

    def test_approve_required_no_reason_gives_default(self):
        bridge = FakeBridge(verdict="approve_required", policies=[])
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        result = hook("deploy", {"env": "prod"})
        assert result["action"] == "block"
        assert "Approval required:" in result["message"]
        assert "manual approval needed" in result["message"]


class TestPreToolCallFailClosed:
    def test_bridge_unreachable_blocks(self):
        bridge = FailingBridge()
        hook = make_pre_tool_call_hook(
            bridge=bridge, surface_id="hermes", fail_mode="closed"
        )
        result = hook("shell_exec", {"cmd": "ls"})
        assert result["action"] == "block"
        assert "fail-closed" in result["message"]

    def test_default_fail_mode_is_closed(self):
        bridge = FailingBridge()
        hook = make_pre_tool_call_hook(bridge=bridge, surface_id="hermes")
        result = hook("shell_exec", {"cmd": "ls"})
        assert result["action"] == "block"


class TestPreToolCallFailOpen:
    def test_bridge_unreachable_allows(self):
        bridge = FailingBridge()
        hook = make_pre_tool_call_hook(
            bridge=bridge, surface_id="hermes", fail_mode="open"
        )
        result = hook("shell_exec", {"cmd": "ls"})
        assert result == {"action": "pass"}


# ---------------------------------------------------------------------------
# post_tool_call tests
# ---------------------------------------------------------------------------


class TestPostToolCall:
    def test_records_outcome_with_hermes_calling_convention(self):
        # Mirrors the real invocation in hermes_cli/model_tools.py:
        # invoke_hook("post_tool_call", tool_name=..., args=..., result=...,
        #             task_id=..., session_id=..., tool_call_id=..., duration_ms=...)
        bridge = FakeBridge()
        hook = make_post_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook(
            tool_name="shell_exec",
            args={"command": "ls"},
            result={"stdout": "ok"},
            task_id="task-1",
            session_id="sess-1",
            tool_call_id="call-1",
            duration_ms=42.5,
        )
        assert len(bridge.record_calls) == 1
        call = bridge.record_calls[0]
        assert call["surface_id"] == "hermes"
        assert call["tool_name"] == "shell_exec"
        assert call["result"] == {"stdout": "ok"}
        assert call["timing_ms"] == 42.5

    def test_legacy_timing_alias_still_accepted(self):
        bridge = FakeBridge()
        hook = make_post_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("shell_exec", result={"stdout": "ok"}, timing=13.0)
        assert bridge.record_calls[0]["timing_ms"] == 13.0

    def test_duration_ms_wins_over_legacy_timing(self):
        bridge = FakeBridge()
        hook = make_post_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("shell_exec", duration_ms=42.5, timing=13.0)
        assert bridge.record_calls[0]["timing_ms"] == 42.5

    def test_records_with_correlation_id(self):
        bridge = FakeBridge()
        hook = make_post_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("file_read", correlation_id="corr-123")
        assert bridge.record_calls[0]["correlation_id"] == "corr-123"

    def test_string_result_wrapped(self):
        bridge = FakeBridge()
        hook = make_post_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("shell_exec", result="hello world")
        assert bridge.record_calls[0]["result"] == {"value": "hello world"}

    def test_none_result(self):
        bridge = FakeBridge()
        hook = make_post_tool_call_hook(bridge=bridge, surface_id="hermes")
        hook("shell_exec")
        assert bridge.record_calls[0]["result"] == {}


# ---------------------------------------------------------------------------
# Bridge unit tests
# ---------------------------------------------------------------------------


class TestDecisionCoreBridge:
    @patch("hermes.decision_core_bridge.requests.Session")
    def test_evaluate_success(self, mock_session_cls):
        mock_session = MagicMock()
        mock_session_cls.return_value = mock_session
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "status": "ok",
            "data": {
                "verdict": "allow",
                "matchedPolicies": [],
            },
        }
        mock_session.post.return_value = mock_resp

        bridge = DecisionCoreBridge(
            base_url="http://127.0.0.1:3100",
            api_key="test-key",
        )
        result = bridge.evaluate("hermes", "shell_exec")
        assert result.verdict == "allow"
        assert result.matched_policies == []

    @patch("hermes.decision_core_bridge.requests.Session")
    def test_evaluate_connection_error(self, mock_session_cls):
        import requests as req

        mock_session = MagicMock()
        mock_session_cls.return_value = mock_session
        mock_session.post.side_effect = req.ConnectionError("refused")

        bridge = DecisionCoreBridge(
            base_url="http://127.0.0.1:3100",
            api_key="test-key",
        )
        with pytest.raises(BridgeError, match="unreachable"):
            bridge.evaluate("hermes", "shell_exec")

    @patch("hermes.decision_core_bridge.requests.Session")
    def test_evaluate_non_200(self, mock_session_cls):
        mock_session = MagicMock()
        mock_session_cls.return_value = mock_session
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.text = "Unauthorized"
        mock_session.post.return_value = mock_resp

        bridge = DecisionCoreBridge(
            base_url="http://127.0.0.1:3100",
            api_key="bad-key",
        )
        with pytest.raises(BridgeError, match="401"):
            bridge.evaluate("hermes", "shell_exec")

    @patch("hermes.decision_core_bridge.requests.Session")
    def test_record_fire_and_forget(self, mock_session_cls):
        mock_session = MagicMock()
        mock_session_cls.return_value = mock_session
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_session.post.return_value = mock_resp

        bridge = DecisionCoreBridge(
            base_url="http://127.0.0.1:3100",
            api_key="test-key",
        )
        # Should not raise
        bridge.record(
            surface_id="hermes",
            tool_name="shell_exec",
            result={"stdout": "ok"},
            timing_ms=50,
        )
        mock_session.post.assert_called_once()
        call_url = mock_session.post.call_args[0][0]
        call_payload = mock_session.post.call_args.kwargs["json"]
        assert call_url == "http://127.0.0.1:3100/record-execution"
        assert call_payload["surface"] == "hermes"
        assert call_payload["toolName"] == "shell_exec"
        assert call_payload["result"] == {"stdout": "ok"}
        assert call_payload["timing_ms"] == 50

    @patch("hermes.decision_core_bridge.requests.Session")
    def test_record_swallows_errors(self, mock_session_cls):
        import requests as req

        mock_session = MagicMock()
        mock_session_cls.return_value = mock_session
        mock_session.post.side_effect = req.ConnectionError("refused")

        bridge = DecisionCoreBridge(
            base_url="http://127.0.0.1:3100",
            api_key="test-key",
        )
        # Should not raise — errors are logged, not propagated
        bridge.record(
            surface_id="hermes",
            tool_name="shell_exec",
        )


# ---------------------------------------------------------------------------
# register() tests
# ---------------------------------------------------------------------------


class TestRegister:
    def test_register_hooks(self):
        from hermes import register

        ctx = MagicMock()
        ctx.get_config.side_effect = lambda key, default=None: {
            "dc_base_url": "http://127.0.0.1:3100",
            "dc_api_key": "test-key",
            "dc_surface_id": "hermes",
            "dc_fail_mode": "closed",
            "dc_timeout_seconds": 5,
        }.get(key, default)

        register(ctx)

        hook_names = [call[0][0] for call in ctx.register_hook.call_args_list]
        assert "pre_tool_call" in hook_names
        assert "post_tool_call" in hook_names
