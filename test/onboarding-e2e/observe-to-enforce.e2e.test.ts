/**
 * End-to-end proof of the onboarding "watch → plan → enforce" loop, exercised
 * through the real public surfaces (generate-artifacts → evaluate → observations
 * → recommend → flipToEnforce → evaluate). This is the standing regression for the
 * whole onboarding programme: if any link breaks, this fails.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateArtifacts, generateRootConfigYaml } from '../../src/onboarding/generate-artifacts.js';
import { createEmptyProfile } from '../../src/contracts/onboarding-profile.contracts.js';
import type { OnboardingProfile } from '../../src/contracts/onboarding-profile.contracts.js';
import { evaluate } from '../../src/surfaces/sdk/evaluate.js';
import { aggregateObservations, recommendFromObservations } from '../../src/decisions/observations.js';
import { flipToEnforce, inspectPromote } from '../../src/surfaces/cli/promote-enforce.js';
import { isBetterSqlite3Available } from '../../src/persistence/sqlite/sqlite-availability.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';

function businessProfile(): OnboardingProfile {
  const p = createEmptyProfile('e2e-1');
  p.mode = 'business'; // observe-first + delete_data BLOCK by default
  p.agent.harness = 'openclaw';
  p.agent.detectedTools = ['delete_database', 'read_file'];
  p.tools = [
    { name: 'delete_database', riskTier: 4, canSpendMoney: false, canDeleteData: true, canContactPeople: false, canPublishContent: false, canDeployCode: false, accessesSensitiveData: false, defaultAction: 'block' },
    { name: 'read_file', riskTier: 1, canSpendMoney: false, canDeleteData: false, canContactPeople: false, canPublishContent: false, canDeployCode: false, accessesSensitiveData: false, defaultAction: 'allow' },
  ];
  return p;
}

describe.skipIf(!isBetterSqlite3Available())('onboarding E2E: watch → plan → enforce', () => {
  let dir: string;
  let packPath: string;
  let sqlitePath: string;
  let configPath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'dc-e2e-'));
    mkdirSync(join(dir, '.decision-core'), { recursive: true });
    const profile = businessProfile();
    const arts = generateArtifacts(profile);
    packPath = join(dir, '.decision-core', 'policy-pack.yaml');
    writeFileSync(packPath, arts.artifacts.find((a) => a.path === 'policy-pack.yaml')!.content, 'utf-8');
    sqlitePath = join(dir, '.decision-core', 'decisions.db');
    configPath = join(dir, 'decision-core.yaml');
    // The generated runtime config (observe mode, persisted) — what setup writes.
    writeFileSync(configPath, generateRootConfigYaml(profile, packPath, { observationStorePath: sqlitePath }), 'utf-8');
  });

  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('1) OBSERVE: a would-be-denied action is allowed (non-blocking) but recorded', async () => {
    const del = await evaluate({ action: 'delete_database', surface: 'api' }, { policyPackPath: packPath, enforcementMode: 'observe', persistence: 'sqlite', sqlitePath });
    expect(del.decision).toBe('allow');           // non-blocking
    expect(del.observedDecision).toBe('deny');     // would-be verdict recorded

    const unknown = await evaluate({ action: 'totally_unknown_tool', surface: 'api' }, { policyPackPath: packPath, enforcementMode: 'observe', persistence: 'sqlite', sqlitePath });
    expect(unknown.decision).toBe('allow');
    expect(unknown.observedDecision).toBe('deny'); // deny-unknown shadowed
  });

  it('2) REVIEW: observations surface the would-be denials (via the real repo)', async () => {
    const { createSqliteConnection } = await import('../../src/persistence/sqlite/sqlite-connection.js');
    const { SqliteDecisionLogRepository } = await import('../../src/persistence/sqlite/sqlite-decision-log.repository.js');
    const db = createSqliteConnection({ path: sqlitePath });
    const repo = new SqliteDecisionLogRepository(db);
    const records = await repo.findAll('default' as TenantId, { limit: 100 });
    db.close();

    const summary = aggregateObservations(records);
    expect(summary.totalObservations).toBeGreaterThanOrEqual(2);
    expect(summary.groups.some((g) => g.toolName === 'delete_database' && g.observedVerdict === 'deny')).toBe(true);
    // Recommendations keep blocking the risky one.
    const recs = recommendFromObservations(summary);
    expect(recs.find((r) => r.toolName === 'delete_database')!.recommendation).toBe('keep_blocking');
  });

  it('3) PROMOTE: enforce flips the config (backup + validate)', () => {
    expect(inspectPromote(dir)).toMatchObject({ exists: true, valid: true, alreadyEnforcing: false, hasPack: true });
    const result = flipToEnforce(dir);
    expect(result.ok).toBe(true);
    expect(inspectPromote(dir).alreadyEnforcing).toBe(true);
  });

  it('4) ENFORCE: the same action is now actually blocked', async () => {
    const del = await evaluate({ action: 'delete_database', surface: 'api' }, { policyPackPath: packPath, enforcementMode: 'enforce' });
    expect(del.decision).toBe('deny'); // real enforcement now
  });
});
