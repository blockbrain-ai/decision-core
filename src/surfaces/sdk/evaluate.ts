/**
 * Lightweight evaluate() convenience function.
 *
 * Auto-discovers .decision-core/policy-pack.yaml if no policyPackPath given.
 * For hot paths, use createPolicyGuard() directly.
 */

import { resolve } from 'path';
import { existsSync } from 'fs';
import { createPolicyGuard } from './create-policy-guard.js';
import { loadCliConfig } from '../cli/config-loader.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { DecisionRecord } from '../../contracts/decision.contracts.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';

export interface EvaluateInput {
  action: string;
  surface?: string;
  context?: Record<string, unknown>;
}

export interface EvaluateResult {
  decision: 'allow' | 'deny' | 'approve_required';
  matchedPolicies: Array<{ ruleId: string; ruleName: string; verdict: string; reason: string }>;
  rationale: string;
  correlationId: string;
  /** Active enforcement mode for this evaluation. */
  enforcementMode?: 'enforce' | 'observe';
  /** In observe mode, the verdict that WOULD have been enforced (decision is forced to allow). */
  observedDecision?: 'allow' | 'deny' | 'approve_required';
}

export interface EvaluateOptions {
  policyPackPath?: string;
  tenantId?: string;
  denyUnknownDefault?: boolean;
  persistence?: 'memory' | 'sqlite';
  sqlitePath?: string;
  /** Path to the agent registry — wires identity-derived (trusted) role resolution. */
  agentRegistryPath?: string;
  /** 'observe' never blocks (returns allow, reports observedDecision); 'enforce' (default) blocks. */
  enforcementMode?: 'enforce' | 'observe';
}

export async function evaluate(
  input: EvaluateInput,
  options?: EvaluateOptions,
): Promise<EvaluateResult> {
  const startedAt = Date.now();
  const config = loadRuntimeConfig();
  const tenantId = options?.tenantId ?? config?.tenantId ?? 'default';
  const surface = input.surface ?? 'default';

  let policyPackPath = options?.policyPackPath ?? config?.policyPackPath;
  if (!policyPackPath) {
    const autoPath = resolve(process.cwd(), '.decision-core', 'policy-pack.yaml');
    if (existsSync(autoPath)) policyPackPath = autoPath;
  }

  const guard = await createPolicyGuard({
    policyPackPath,
    tenantId,
    denyUnknownDefault: options?.denyUnknownDefault ?? config?.denyUnknownDefault,
    agentRegistryPath: options?.agentRegistryPath ?? config?.agentRegistryPath,
    enforcementMode: options?.enforcementMode ?? config?.enforcementMode,
  });

  const verdict = await guard.evaluate(tenantId, surface, input.action, input.context);

  const observing = verdict.enforcementMode === 'observe';
  const result: EvaluateResult = {
    decision: verdict.verdict,
    matchedPolicies: verdict.matchedPolicies.map((mp) => ({
      ruleId: mp.ruleId,
      ruleName: mp.ruleName,
      verdict: mp.verdict,
      reason: mp.reason,
    })),
    rationale: observing && verdict.observedVerdict && verdict.observedVerdict !== 'allow'
      ? `Observe mode — allowed (would be ${verdict.observedVerdict} under enforce)`
      : verdict.matchedPolicies.length > 0
      ? verdict.matchedPolicies.map((mp) => `[${mp.verdict}] ${mp.ruleName}: ${mp.reason}`).join('; ')
      : verdict.verdict === 'deny'
      ? 'No matching rules — denied by denyUnknownDefault'
      : 'No matching rules — allowed by default',
    correlationId: generateUuidV7(),
    enforcementMode: verdict.enforcementMode,
    observedDecision: verdict.observedVerdict,
  };

  const persistence = options?.persistence ?? config?.persistence;
  const sqlitePath = options?.sqlitePath ?? config?.sqlitePath;
  if (persistence === 'sqlite') {
    if (!sqlitePath) {
      throw new Error('SQLite persistence requires sqlitePath in decision-core.yaml or evaluate options.');
    }
    await appendDecisionRecord({
      tenantId,
      surface,
      input,
      result,
      latency: Date.now() - startedAt,
      sqlitePath,
    });
  }

  return result;
}

function loadRuntimeConfig() {
  // Fail CLOSED on config errors. loadCliConfig() returns undefined ONLY when no
  // config file is present (defaults apply); a present-but-invalid/corrupt
  // decision-core.yaml (or an auto-discovered pack) THROWS. We deliberately do
  // NOT swallow that — silently degrading a tampered config to "no pack +
  // deny-unknown off" would be a fail-open hole.
  return loadCliConfig();
}

async function appendDecisionRecord(args: {
  tenantId: string;
  surface: string;
  input: EvaluateInput;
  result: EvaluateResult;
  latency: number;
  sqlitePath: string;
}): Promise<void> {
  const { createSqliteConnection } = await import('../../persistence/sqlite/sqlite-connection.js');
  const { SqliteDecisionLogRepository } = await import('../../persistence/sqlite/sqlite-decision-log.repository.js');

  const db = createSqliteConnection({ path: args.sqlitePath });
  try {
    const repo = new SqliteDecisionLogRepository(db);
    const now = new Date().toISOString();
    const recordBase: Omit<DecisionRecord, 'auditHash'> = {
      id: generateUuidV7(),
      surface: args.surface,
      toolName: args.input.action,
      status: args.result.decision === 'deny'
        ? 'blocked'
        : args.result.decision === 'approve_required'
          ? 'pending'
          : 'generated',
      confidence: 1,
      latency: args.latency,
      input: {
        action: args.input.action,
        surface: args.input.surface,
        context: args.input.context ?? {},
      },
      output: {
        decision: args.result.decision,
        matchedPolicies: args.result.matchedPolicies,
        rationale: args.result.rationale,
      },
      correlationId: args.result.correlationId,
      tenantId: args.tenantId,
      createdAt: now,
      updatedAt: now,
    };
    const record: DecisionRecord = {
      ...recordBase,
      auditHash: hashCanonicalJson(recordBase),
    };
    await repo.append(args.tenantId as TenantId, record);
  } finally {
    db.close();
  }
}
