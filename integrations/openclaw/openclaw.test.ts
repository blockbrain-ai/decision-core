/**
 * Tests for Decision Core OpenCLAW Plugin
 *
 * Covers:
 * - allow → pass
 * - deny → block with blockReason
 * - approve_required → requireApproval with title, description, severity
 * - Approval resolution recorded back to Decision Core
 * - after_tool_call records audit evidence
 * - Fail modes (closed/open)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PolicyVerdict } from '../../src/contracts/policy.contracts.js';
import type { PolicyGuard } from '../../src/surfaces/sdk/types.js';
import {
  makeBeforeToolCallHook,
  mapVerdictToHookResult,
  type ToolCallContext,
} from './before-tool-call.js';
import { ApprovalBridge, type AuditSink } from './approval-bridge.js';
import { definePluginEntry } from './index.js';

// ===========================================================================
// Test Helpers
// ===========================================================================

function makeVerdict(verdict: 'allow' | 'deny' | 'approve_required', policies: PolicyVerdict['matchedPolicies'] = []): PolicyVerdict {
  return { verdict, matchedPolicies: policies };
}

function makeFakeGuard(verdict: PolicyVerdict): PolicyGuard {
  return {
    evaluate: vi.fn().mockResolvedValue(verdict),
  };
}

function makeFailingGuard(): PolicyGuard {
  return {
    evaluate: vi.fn().mockRejectedValue(new Error('evaluation failed')),
  };
}

function makeFakeAuditSink(): AuditSink & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    record(entry) {
      calls.push(entry);
    },
  };
}

const defaultCtx: ToolCallContext = {
  toolName: 'file_write',
  toolParams: { path: '/tmp/test.txt' },
};

// ===========================================================================
// mapVerdictToHookResult — Unit Tests
// ===========================================================================

describe('mapVerdictToHookResult', () => {
  const sink = makeFakeAuditSink();
  const bridge = new ApprovalBridge('openclaw', sink);

  it('maps allow → pass', () => {
    const verdict = makeVerdict('allow');
    const result = mapVerdictToHookResult(verdict, 'file_write', bridge, 60_000);
    expect(result).toEqual({ pass: true });
  });

  it('maps deny → block with reason from matched policy', () => {
    const verdict = makeVerdict('deny', [
      { ruleId: 'r1', ruleName: 'no-delete', verdict: 'deny', reason: 'deletion prohibited' },
    ]);
    const result = mapVerdictToHookResult(verdict, 'file_delete', bridge, 60_000);
    expect(result).toEqual({
      block: true,
      blockReason: 'deletion prohibited',
    });
  });

  it('maps deny → block with default reason when no policies', () => {
    const verdict = makeVerdict('deny');
    const result = mapVerdictToHookResult(verdict, 'file_delete', bridge, 60_000);
    expect(result).toEqual({
      block: true,
      blockReason: 'policy denied this action',
    });
  });

  it('maps approve_required → requireApproval with title, description, severity', () => {
    const verdict = makeVerdict('approve_required', [
      { ruleId: 'r2', ruleName: 'compliance-gate', verdict: 'approve_required', reason: 'needs sign-off' },
    ]);
    const result = mapVerdictToHookResult(verdict, 'deploy', bridge, 120_000) as { requireApproval: Record<string, unknown> };
    expect(result.requireApproval).toBeDefined();
    expect(result.requireApproval.title).toBe('Approval required: deploy');
    expect(result.requireApproval.description).toBe('needs sign-off');
    // OpenClaw severity enum: info | warning | critical. Compliance rules map to critical.
    expect(result.requireApproval.severity).toBe('critical');
    expect(result.requireApproval.timeoutMs).toBe(120_000);
    expect(result.requireApproval.timeoutBehavior).toBe('deny');
    expect(typeof result.requireApproval.onResolution).toBe('function');
  });

  it('maps approve_required with safety rule → critical severity', () => {
    const verdict = makeVerdict('approve_required', [
      { ruleId: 'r3', ruleName: 'safety-check', verdict: 'approve_required', reason: 'safety review' },
    ]);
    const result = mapVerdictToHookResult(verdict, 'exec', bridge, 60_000) as { requireApproval: Record<string, unknown> };
    expect(result.requireApproval.severity).toBe('critical');
  });

  it('maps approve_required with no policies → warning severity', () => {
    const verdict = makeVerdict('approve_required');
    const result = mapVerdictToHookResult(verdict, 'exec', bridge, 60_000) as { requireApproval: Record<string, unknown> };
    expect(result.requireApproval.severity).toBe('warning');
  });
});

// ===========================================================================
// makeBeforeToolCallHook — Integration Tests
// ===========================================================================

describe('makeBeforeToolCallHook', () => {
  let sink: ReturnType<typeof makeFakeAuditSink>;
  let bridge: ApprovalBridge;

  beforeEach(() => {
    sink = makeFakeAuditSink();
    bridge = new ApprovalBridge('openclaw', sink);
  });

  it('allow verdict passes through', async () => {
    const guard = makeFakeGuard(makeVerdict('allow'));
    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: 'test',
      surfaceId: 'openclaw',
      failMode: 'closed',
      approvalBridge: bridge,
    });

    const result = await hook(defaultCtx);
    expect(result).toEqual({ pass: true });
  });

  it('deny verdict blocks', async () => {
    const guard = makeFakeGuard(makeVerdict('deny', [
      { ruleId: 'r1', ruleName: 'block-rule', verdict: 'deny', reason: 'not allowed' },
    ]));
    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: 'test',
      surfaceId: 'openclaw',
      failMode: 'closed',
      approvalBridge: bridge,
    });

    const result = await hook(defaultCtx);
    expect(result).toEqual({ block: true, blockReason: 'not allowed' });
  });

  it('approve_required returns requireApproval', async () => {
    const guard = makeFakeGuard(makeVerdict('approve_required', [
      { ruleId: 'r2', ruleName: 'approval-gate', verdict: 'approve_required', reason: 'manual check' },
    ]));
    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: 'test',
      surfaceId: 'openclaw',
      failMode: 'closed',
      approvalBridge: bridge,
    });

    const result = await hook(defaultCtx) as { requireApproval: Record<string, unknown> };
    expect(result.requireApproval).toBeDefined();
    expect(result.requireApproval.title).toBe('Approval required: file_write');
    expect(result.requireApproval.description).toBe('manual check');
  });

  it('fail-closed blocks on evaluation error', async () => {
    const guard = makeFailingGuard();
    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: 'test',
      surfaceId: 'openclaw',
      failMode: 'closed',
      approvalBridge: bridge,
    });

    const result = await hook(defaultCtx);
    expect(result).toEqual({
      block: true,
      blockReason: 'Policy evaluation unavailable (fail-closed)',
    });
  });

  it('fail-open passes on evaluation error', async () => {
    const guard = makeFailingGuard();
    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: 'test',
      surfaceId: 'openclaw',
      failMode: 'open',
      approvalBridge: bridge,
    });

    const result = await hook(defaultCtx);
    expect(result).toEqual({ pass: true });
  });

  it('passes tool context to guard.evaluate', async () => {
    const guard = makeFakeGuard(makeVerdict('allow'));
    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: 'tenant-1',
      surfaceId: 'openclaw',
      failMode: 'closed',
      approvalBridge: bridge,
    });

    await hook({ toolName: 'shell_exec', toolParams: { cmd: 'ls' }, sessionId: 'sess-1' });
    expect(guard.evaluate).toHaveBeenCalledWith(
      'tenant-1',
      'openclaw',
      'shell_exec',
      { args: { cmd: 'ls' }, sessionId: 'sess-1', agentId: undefined },
    );
  });
});

// ===========================================================================
// ApprovalBridge — Tests
// ===========================================================================

describe('ApprovalBridge', () => {
  it('records approval resolution to audit sink', () => {
    const sink = makeFakeAuditSink();
    const bridge = new ApprovalBridge('openclaw', sink);
    const verdict = makeVerdict('approve_required', [
      { ruleId: 'r2', ruleName: 'gate', verdict: 'approve_required', reason: 'needs approval' },
    ]);

    bridge.recordResolution('deploy', verdict, true);

    expect(sink.calls.length).toBe(1);
    const call = sink.calls[0];
    expect(call.surfaceId).toBe('openclaw');
    expect(call.toolName).toBe('deploy');
    expect(call.operationType).toBe('approval_resolution');
    expect((call.payload as Record<string, unknown>).approved).toBe(true);
    expect((call.payload as Record<string, unknown>).verdict).toBe('approve_required');
  });

  it('records rejection resolution', () => {
    const sink = makeFakeAuditSink();
    const bridge = new ApprovalBridge('openclaw', sink);
    const verdict = makeVerdict('approve_required', [
      { ruleId: 'r3', ruleName: 'gate2', verdict: 'approve_required', reason: 'check' },
    ]);

    bridge.recordResolution('exec', verdict, false);

    expect(sink.calls.length).toBe(1);
    expect((sink.calls[0].payload as Record<string, unknown>).approved).toBe(false);
  });

  it('tracks resolutions in getResolutions()', () => {
    const sink = makeFakeAuditSink();
    const bridge = new ApprovalBridge('openclaw', sink);
    const verdict = makeVerdict('approve_required');

    bridge.recordResolution('tool1', verdict, true);
    bridge.recordResolution('tool2', verdict, false);

    const resolutions = bridge.getResolutions();
    expect(resolutions.length).toBe(2);
    expect(resolutions[0].toolName).toBe('tool1');
    expect(resolutions[0].approved).toBe(true);
    expect(resolutions[1].toolName).toBe('tool2');
    expect(resolutions[1].approved).toBe(false);
  });

  it('onResolution callback records to bridge', () => {
    const sink = makeFakeAuditSink();
    const bridge = new ApprovalBridge('openclaw', sink);
    const verdict = makeVerdict('approve_required', [
      { ruleId: 'r4', ruleName: 'gate3', verdict: 'approve_required', reason: 'review' },
    ]);

    const result = mapVerdictToHookResult(verdict, 'deploy', bridge, 60_000) as {
      requireApproval: { onResolution: (decision: string) => void };
    };
    // OpenClaw resolves with an enum, not a boolean.
    result.requireApproval.onResolution('allow-once');

    expect(bridge.getResolutions().length).toBe(1);
    expect(bridge.getResolutions()[0].approved).toBe(true);
    expect(bridge.getResolutions()[0].resolution).toBe('allow-once');
    expect(sink.calls.length).toBe(1);
  });

  it('maps a timeout resolution to not-approved with the raw resolution preserved', () => {
    const sink = makeFakeAuditSink();
    const bridge = new ApprovalBridge('openclaw', sink);
    const verdict = makeVerdict('approve_required', [
      { ruleId: 'r5', ruleName: 'gate4', verdict: 'approve_required', reason: 'review' },
    ]);
    const result = mapVerdictToHookResult(verdict, 'deploy', bridge, 60_000) as {
      requireApproval: { onResolution: (decision: string) => void };
    };
    result.requireApproval.onResolution('timeout');
    expect(bridge.getResolutions()[0].approved).toBe(false);
    expect(bridge.getResolutions()[0].resolution).toBe('timeout');
  });
});

// ===========================================================================
// definePluginEntry — Integration Tests
// ===========================================================================

describe('definePluginEntry', () => {
  it('returns plugin with correct name and version', async () => {
    const plugin = await definePluginEntry({ tenantId: 'test' });
    expect(plugin.name).toBe('decision-core');
    expect(plugin.version).toBe('0.1.0');
  });

  it('registers both hooks', async () => {
    const plugin = await definePluginEntry({ tenantId: 'test' });
    expect(typeof plugin.hooks.before_tool_call).toBe('function');
    expect(typeof plugin.hooks.after_tool_call).toBe('function');
  });

  it('after_tool_call does not throw on valid input', async () => {
    const plugin = await definePluginEntry({ tenantId: 'test' });
    await expect(
      // OpenClaw after-call event shape: params + durationMs (not toolParams/timingMs).
      plugin.hooks.after_tool_call({
        toolName: 'file_read',
        params: { path: '/x' },
        result: 'content',
        durationMs: 15,
        toolCallId: 'corr-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('after_tool_call does not throw on missing optional fields', async () => {
    const plugin = await definePluginEntry({ tenantId: 'test' });
    await expect(
      plugin.hooks.after_tool_call({
        toolName: 'file_read',
        params: {},
      }),
    ).resolves.toBeUndefined();
  });
});

// ===========================================================================
// Real OpenClaw plugin definition (register(api) shape)
// ===========================================================================

describe('plugin (register(api) definition)', () => {
  it('registers before_tool_call and after_tool_call via api.registerHook', async () => {
    const { plugin } = await import('./index.js');
    const registered: string[] = [];
    const api = {
      registerHook: (events: string | string[]) => {
        if (Array.isArray(events)) registered.push(...events);
        else registered.push(events);
      },
      getPluginConfig: () => ({ tenantId: 'test', failMode: 'closed' as const }),
    };
    await plugin.register(api);
    expect(registered).toContain('before_tool_call');
    expect(registered).toContain('after_tool_call');
    expect(plugin.id).toBe('decision-core');
  });
});
