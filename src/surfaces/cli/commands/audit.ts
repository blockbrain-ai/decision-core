/**
 * audit command — Run compliance audit and generate report.
 *
 * Usage: decision-core audit [--from <iso>] [--to <iso>] [--surface <id>] [--json] [--evidence]
 *
 * Bootstraps repositories from CLI config:
 * - Policy rules loaded from policyPackPath if configured
 * - Trust policies loaded from trust.policyPath if configured
 * - Surface bindings loaded from trust.bindingsPath if configured
 * - Decision logs from configured persistence layer
 *
 * Accepts optional injected dependencies for testability.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { TenantId } from '../../../contracts/common.contracts.js';
import type { CliContext } from '../cli.js';
import { ComplianceAuditService, formatReportAsMarkdown, type ComplianceAuditDeps } from '../../../skills/audit/compliance-audit.service.js';
import { InMemoryDecisionLogRepository } from '../../../persistence/memory/in-memory-decision-log.repository.js';
import { InMemoryPolicyRuleRepository } from '../../../persistence/memory/in-memory-policy-rule.repository.js';
import { EvidenceChainService } from '../../../integrity/evidence-chain.service.js';
import { TrustPolicyLoader } from '../../../trust/trust-policy.js';
import { loadAndSeedPolicyPack } from '../../sdk/policy-pack-loader.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('cli-audit');

/**
 * Bootstrap audit dependencies from CLI config.
 * Loads policy pack, trust policies, and surface bindings from configured paths.
 */
async function bootstrapDeps(ctx: CliContext): Promise<{
  deps: ComplianceAuditDeps;
  tenantId: TenantId;
}> {
  const tenantId = (ctx.config?.tenantId ?? 'default') as unknown as TenantId;

  const decisionLogRepo = new InMemoryDecisionLogRepository();
  const policyRuleRepo = new InMemoryPolicyRuleRepository();
  const evidenceChainService = new EvidenceChainService();
  const trustPolicyLoader = new TrustPolicyLoader();

  // Load policy rules from policy pack if configured
  if (ctx.config?.policyPackPath) {
    const packPath = ctx.config.policyPackPath;
    if (existsSync(packPath)) {
      await loadAndSeedPolicyPack(packPath, tenantId, policyRuleRepo);
      logger.info({ packPath }, 'Policy pack loaded for audit');
    } else {
      logger.warn({ packPath }, 'Policy pack path configured but file not found');
    }
  }

  // Load trust policies if configured
  if (ctx.config?.trust?.policyPath) {
    const policyPath = ctx.config.trust.policyPath;
    if (existsSync(policyPath)) {
      const data = JSON.parse(readFileSync(policyPath, 'utf-8'));
      trustPolicyLoader.loadPolicy(data);
      logger.info({ policyPath }, 'Trust policies loaded for audit');
    }
  }

  // Load surface bindings if configured
  if (ctx.config?.trust?.bindingsPath) {
    const bindingsPath = ctx.config.trust.bindingsPath;
    if (existsSync(bindingsPath)) {
      const data = JSON.parse(readFileSync(bindingsPath, 'utf-8'));
      trustPolicyLoader.loadBindings(data);
      logger.info({ bindingsPath }, 'Surface bindings loaded for audit');
    }
  }

  // Load surface registry if configured
  if (ctx.config?.trust?.registryPath) {
    const registryPath = ctx.config.trust.registryPath;
    if (existsSync(registryPath)) {
      const data = JSON.parse(readFileSync(registryPath, 'utf-8'));
      trustPolicyLoader.loadRegistry(data);
      logger.info({ registryPath }, 'Surface registry loaded for audit');
    }
  }

  const deps: ComplianceAuditDeps = {
    decisionLogRepo,
    policyRuleRepo,
    evidenceChainService,
    getTrustPolicy: (id) => trustPolicyLoader.getPolicyEntry(id),
    getSurfaceBinding: (id) => trustPolicyLoader.getBinding(id),
  };

  return { deps, tenantId };
}

export async function auditCommand(ctx: CliContext, injectedDeps?: ComplianceAuditDeps): Promise<number> {
  const { deps, tenantId } = injectedDeps
    ? { deps: injectedDeps, tenantId: (ctx.config?.tenantId ?? 'default') as unknown as TenantId }
    : await bootstrapDeps(ctx);

  const service = new ComplianceAuditService(deps);

  const from = typeof ctx.flags['from'] === 'string' ? ctx.flags['from'] : undefined;
  const to = typeof ctx.flags['to'] === 'string' ? ctx.flags['to'] : undefined;
  const surfaceFlag = typeof ctx.flags['surface'] === 'string' ? ctx.flags['surface'] : undefined;
  const includeEvidence = ctx.flags['evidence'] === true;

  const report = await service.runAudit({
    tenantId,
    timeRange: from || to ? { from: from ?? '1970-01-01T00:00:00.000Z', to: to ?? new Date().toISOString() } : undefined,
    surfaces: surfaceFlag ? [surfaceFlag] : undefined,
    includeEvidenceIntegrity: includeEvidence,
  });

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify(report, null, 2));
  } else {
    ctx.stdout(formatReportAsMarkdown(report));
  }

  return 0;
}
