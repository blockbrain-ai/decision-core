/**
 * audit command tests
 *
 * Tests the compliance audit CLI command with injected dependencies.
 */

import { describe, it, expect } from 'vitest';
import { auditCommand } from './audit.js';
import type { CliContext } from '../cli.js';
import type { TenantId } from '../../../contracts/common.contracts.js';
import { InMemoryDecisionLogRepository } from '../../../persistence/memory/in-memory-decision-log.repository.js';
import { InMemoryPolicyRuleRepository } from '../../../persistence/memory/in-memory-policy-rule.repository.js';
import { EvidenceChainService } from '../../../integrity/evidence-chain.service.js';
import { generateUuidV7 } from '../../../utils/uuid-v7.js';
import type { DecisionRecord } from '../../../contracts/decision.contracts.js';

const TENANT = 'test-cli-tenant' as TenantId;

function makeCtx(flags: Record<string, string | boolean> = {}): CliContext & { output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    config: { tenantId: TENANT, persistence: 'memory', tenantMode: 'single' },
    flags,
    args: { command: 'audit', positionals: [], flags, subcommand: undefined },
    stdout: (msg: string) => output.push(msg),
    stderr: (msg: string) => errors.push(msg),
    output,
    errors,
  };
}

function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const now = new Date().toISOString();
  return {
    id: generateUuidV7(),
    surface: 'test-surface',
    toolName: 'test.tool',
    status: 'generated',
    confidence: 0.9,
    latency: 50,
    input: {},
    output: {},
    correlationId: generateUuidV7(),
    tenantId: TENANT,
    auditHash: 'hash-' + generateUuidV7(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('auditCommand', () => {
  it('returns clean report for fresh repository', async () => {
    const ctx = makeCtx({});
    const deps = {
      decisionLogRepo: new InMemoryDecisionLogRepository(),
      policyRuleRepo: new InMemoryPolicyRuleRepository(),
      evidenceChainService: new EvidenceChainService(),
    };

    const code = await auditCommand(ctx, deps);
    expect(code).toBe(0);
    expect(ctx.output.join('\n')).toContain('Compliance Audit Report');
    expect(ctx.output.join('\n')).toContain('No compliance gaps detected');
  });

  it('outputs JSON when --json flag set', async () => {
    const ctx = makeCtx({ json: true });
    const deps = {
      decisionLogRepo: new InMemoryDecisionLogRepository(),
      policyRuleRepo: new InMemoryPolicyRuleRepository(),
      evidenceChainService: new EvidenceChainService(),
    };

    const code = await auditCommand(ctx, deps);
    expect(code).toBe(0);
    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed.tenantId).toBe(TENANT);
    expect(parsed.summary).toBeDefined();
    expect(parsed.gaps).toBeDefined();
  });

  it('detects gaps in seeded decision history', async () => {
    const ctx = makeCtx({ json: true });
    const decisionLogRepo = new InMemoryDecisionLogRepository();
    const policyRuleRepo = new InMemoryPolicyRuleRepository();

    // Seed a decision with an uncovered tool
    await decisionLogRepo.append(TENANT, makeDecision({ toolName: 'uncovered.tool' }));

    const deps = {
      decisionLogRepo,
      policyRuleRepo,
      evidenceChainService: new EvidenceChainService(),
    };

    const code = await auditCommand(ctx, deps);
    expect(code).toBe(0);

    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed.summary.totalDecisions).toBe(1);
    expect(parsed.gaps.length).toBeGreaterThan(0);
    expect(parsed.gaps.some((g: { category: string }) => g.category === 'missing_policy' || g.category === 'unaudited_tool')).toBe(true);
  });

  it('works retroactively on existing decision history', async () => {
    const ctx = makeCtx({ json: true });
    const decisionLogRepo = new InMemoryDecisionLogRepository();
    const policyRuleRepo = new InMemoryPolicyRuleRepository();

    // Seed multiple decisions simulating real history
    await decisionLogRepo.append(TENANT, makeDecision({ toolName: 'db.query', surface: 'data-api' }));
    await decisionLogRepo.append(TENANT, makeDecision({ toolName: 'email.send', surface: 'notifications' }));
    await decisionLogRepo.append(TENANT, makeDecision({ toolName: 'db.drop', surface: 'data-api', confidence: 0.3 }));

    // Add a policy that covers db.* but not email.*
    await policyRuleRepo.create(TENANT, {
      name: 'DB policy', description: 'Covers DB operations',
      actionTypePattern: 'db.*', riskClass: 'B', enforcementPoint: 'pre_decision',
      policyType: 'business', priority: 100, requireApproval: false, enabled: true,
    });

    const deps = {
      decisionLogRepo,
      policyRuleRepo,
      evidenceChainService: new EvidenceChainService(),
    };

    const code = await auditCommand(ctx, deps);
    expect(code).toBe(0);

    const parsed = JSON.parse(ctx.output[0]);
    expect(parsed.summary.totalDecisions).toBe(3);
    // Should detect: email.send has no policy, low confidence on db.drop
    expect(parsed.gaps.length).toBeGreaterThan(0);
    expect(parsed.summary.policyCoverage).toBeLessThan(100);
  });
});
