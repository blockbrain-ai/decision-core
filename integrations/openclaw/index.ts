/**
 * OpenClaw Decision Core Plugin — Entry Point
 *
 * EXPERIMENTAL (v0.1). The hook contract here is aligned with OpenClaw's real
 * plugin API (src/plugins/hook-types.ts: PluginHookBeforeToolCallEvent/Result,
 * PluginApprovalResolution; src/plugins/types.ts: register(api) +
 * api.registerHook). Unlike the Hermes integration, this path has NOT yet been
 * proven through a full OpenClaw agent loop — see
 * docs/INTEGRATION-GUIDES/openclaw.md. Run behind fail-closed.
 *
 * Two entry shapes are exported:
 *  - `plugin` (default): an OpenClaw plugin definition with register(api) for
 *    the real loader; it calls api.registerHook('before_tool_call'|...).
 *  - `definePluginEntry(config)`: returns a hook bundle for tests and for
 *    embedding hosts that wire hooks themselves.
 */

import { randomUUID } from 'node:crypto';
import { createPolicyGuard } from '../../src/surfaces/sdk/index.js';
import { createLogger } from '../../src/utils/logger.js';
import { makeBeforeToolCallHook } from './before-tool-call.js';
import { ApprovalBridge } from './approval-bridge.js';
import type { AuditSink } from './approval-bridge.js';
import type { BeforeToolCallResult } from './before-tool-call.js';
import type { DecisionEvidenceSink } from '../../src/integrity/evidence-sinks/decision-evidence-sink.js';

const logger = createLogger('openclaw-plugin');

// ===========================================================================
// OpenCLAW Plugin Host Types
// ===========================================================================

export interface PluginConfig {
  policyPackPath?: string;
  agentRegistryPath?: string;
  tenantId?: string;
  surfaceId?: string;
  failMode?: 'closed' | 'open';
  approvalTimeoutMs?: number;
  evidenceSink?: DecisionEvidenceSink;
}

export interface AfterToolCallContext {
  toolName: string;
  toolParams: Record<string, unknown>;
  result?: unknown;
  timingMs?: number;
  correlationId?: string;
  sessionId?: string;
}

/**
 * OpenClaw's real before_tool_call event (src/plugins/hook-types.ts
 * PluginHookBeforeToolCallEvent).
 */
export interface OpenClawBeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
}

/**
 * OpenClaw's real after_tool_call event (src/plugins/hook-types.ts
 * PluginHookAfterToolCallEvent) — note `params` and `durationMs`, not
 * `toolParams`/`timingMs`.
 */
export interface OpenClawAfterToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

/** OpenClaw's PluginHookToolContext (src/plugins/hook-types.ts). */
export interface OpenClawToolContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolName?: string;
  toolCallId?: string;
}

export interface PluginHooks {
  before_tool_call: (
    event: OpenClawBeforeToolCallEvent,
    ctx?: OpenClawToolContext,
  ) => Promise<BeforeToolCallResult>;
  after_tool_call: (
    event: OpenClawAfterToolCallEvent,
    ctx?: OpenClawToolContext,
  ) => Promise<void>;
}

export interface PluginEntry {
  name: string;
  version: string;
  hooks: PluginHooks;
}

// ===========================================================================
// After Tool Call Handler
// ===========================================================================

function makeAfterToolCallHook(auditSink: AuditSink, surfaceId: string) {
  return async (ctx: AfterToolCallContext): Promise<void> => {
    try {
      const payload: Record<string, unknown> = {};
      if (ctx.result !== undefined) {
        payload.result = typeof ctx.result === 'string' ? { value: ctx.result } : ctx.result;
      }
      if (ctx.timingMs !== undefined) {
        payload.timingMs = ctx.timingMs;
      }

      auditSink.record({
        surfaceId,
        toolName: ctx.toolName,
        operationType: 'tool_execution',
        payload,
        correlationId: ctx.correlationId ?? crypto.randomUUID(),
      });

      logger.debug({ toolName: ctx.toolName }, 'Audit recorded');
    } catch (err) {
      logger.error({ err, toolName: ctx.toolName }, 'Audit recording failed');
    }
  };
}

// ===========================================================================
// Plugin Entry Point
// ===========================================================================

export async function definePluginEntry(config: PluginConfig = {}): Promise<PluginEntry> {
  const {
    policyPackPath,
    agentRegistryPath,
    tenantId = 'default',
    surfaceId = 'openclaw',
    failMode = 'closed',
    approvalTimeoutMs = 300_000,
    evidenceSink,
  } = config;

  const guard = await createPolicyGuard({ policyPackPath, agentRegistryPath, tenantId });

  const auditSink: AuditSink = {
    record(entry) {
      logger.info({ ...entry }, 'Audit entry');
    },
  };

  const approvalBridge = new ApprovalBridge(surfaceId, auditSink);

  const beforeToolCall = makeBeforeToolCallHook({
    guard,
    tenantId,
    surfaceId,
    failMode,
    approvalBridge,
    approvalTimeoutMs,
  });

  const afterToolCall = makeAfterToolCallHook(auditSink, surfaceId);

  logger.info({ surfaceId, tenantId, failMode }, 'OpenClaw plugin initialized');

  const wrappedBeforeToolCall = async (
    event: OpenClawBeforeToolCallEvent,
    ctx?: OpenClawToolContext,
  ) => {
    const result = await beforeToolCall({
      toolName: event.toolName,
      toolParams: event.params ?? {},
      agentId: ctx?.agentId,
      sessionId: ctx?.sessionId ?? ctx?.sessionKey,
    });

    if (evidenceSink) {
      const correlationId = randomUUID();
      const verdict = 'pass' in result ? 'allow'
        : 'block' in result ? 'deny'
        : 'approve_required' as const;
      try {
        await evidenceSink.recordEvaluation({
          tenantId,
          surfaceId,
          host: 'openclaw',
          agentId: ctx?.agentId,
          action: event.toolName,
          verdict,
          correlationId,
          context: event.params,
        });
      } catch (err) {
        logger.error({ err }, 'evidence sink evaluation recording failed');
      }
    }

    return result;
  };

  const wrappedAfterToolCall = async (
    event: OpenClawAfterToolCallEvent,
    ctx?: OpenClawToolContext,
  ) => {
    // OpenClaw passes durationMs (not timingMs) and toolCallId as the natural
    // correlation key when none is threaded through.
    const correlationId = event.toolCallId ?? randomUUID();
    await afterToolCall({
      toolName: event.toolName,
      toolParams: event.params ?? {},
      result: event.result,
      timingMs: event.durationMs,
      correlationId,
      sessionId: ctx?.sessionId ?? ctx?.sessionKey,
    });

    if (evidenceSink) {
      const resultObj = event.result != null
        ? (typeof event.result === 'object' ? event.result as Record<string, unknown> : { value: event.result })
        : undefined;
      try {
        await evidenceSink.recordExecution({
          tenantId,
          surfaceId,
          host: 'openclaw',
          action: event.toolName,
          correlationId,
          result: resultObj,
          timingMs: event.durationMs,
        });
      } catch (err) {
        logger.error({ err }, 'evidence sink execution recording failed');
      }
    }
  };

  return {
    name: 'decision-core',
    version: '0.1.0',
    hooks: {
      before_tool_call: wrappedBeforeToolCall,
      after_tool_call: wrappedAfterToolCall,
    },
  };
}

// ===========================================================================
// Real OpenClaw plugin definition (register(api) shape)
// ===========================================================================

/**
 * Minimal shape of the OpenClaw plugin API surface this plugin uses
 * (src/plugins/types.ts OpenClawPluginApi.registerHook). Declared locally so
 * the integration has no compile-time dependency on the OpenClaw package.
 */
export interface OpenClawPluginApi {
  registerHook: (
    events: string | string[],
    handler: (event: unknown, ctx?: unknown) => unknown,
    opts?: Record<string, unknown>,
  ) => void;
  getPluginConfig?: () => PluginConfig | undefined;
}

export interface OpenClawPluginDefinition {
  id: string;
  name: string;
  version: string;
  register: (api: OpenClawPluginApi) => void | Promise<void>;
}

/**
 * The OpenClaw plugin definition consumed by the real loader. On register it
 * builds the guard from plugin config and wires the two hooks via
 * api.registerHook — matching OpenClaw's actual registration mechanism.
 */
export const plugin: OpenClawPluginDefinition = {
  id: 'decision-core',
  name: 'Decision Core',
  version: '0.1.0',
  async register(api: OpenClawPluginApi): Promise<void> {
    const config = api.getPluginConfig?.() ?? {};
    const entry = await definePluginEntry(config);
    api.registerHook('before_tool_call', entry.hooks.before_tool_call as (e: unknown, c?: unknown) => unknown);
    api.registerHook('after_tool_call', entry.hooks.after_tool_call as (e: unknown, c?: unknown) => unknown);
  },
};

export default plugin;
