/**
 * createDecisionCore — Primary SDK Factory
 *
 * Creates a fully configured Decision Core instance with all dependencies wired.
 * Supports zero-config (in-memory, no model, default tenant) and full config
 * with policy packs, trust routing, and provider gateway.
 */

import type { TenantId, CorrelationId } from '../../contracts/common.contracts.js';
import type { DecisionRunnerResult, DecisionContext } from '../../decisions/decision-runner.js';
import type { BaseDecision } from '../../decisions/base-decision.js';
import { DecisionRunner } from '../../decisions/decision-runner.js';
import { PolicyDecisionPoint } from '../../policy/policy-decision-point.js';
import { wrapPdpDenyUnknown } from '../../policy/deny-unknown-wrapper.js';
import { SurfaceResolver } from '../../trust/surface-resolver.js';
import { TrustPolicyLoader } from '../../trust/trust-policy.js';
import { RuntimeRouteResolver } from '../../routing/runtime/runtime-route-resolver.js';
import type { PolicyRuleRepository } from '../../persistence/interfaces/policy-rule.repository.js';
import type { DecisionLogRepository } from '../../persistence/interfaces/decision-log.repository.js';
import { InMemoryPolicyRuleRepository } from '../../persistence/memory/in-memory-policy-rule.repository.js';
import { InMemoryDecisionLogRepository } from '../../persistence/memory/in-memory-decision-log.repository.js';
import { NoOpEventService } from '../../adapters/event-service.js';
import { ModelGateway, type ModelGatewayConfig } from '../../core/model-gateway.js';
import type { ModelGatewayAdapter } from '../../adapters/model-gateway.js';
import { loadAndSeedPolicyPack } from './policy-pack-loader.js';
import {
  DecisionCoreConfigSchema,
  type DecisionCoreConfig,
  type DecisionCore,
  type Explanation,
  type ExplanationRecord,
} from './types.js';
import { SurfaceContractRegistry } from '../../knowledge/surfaces/surface-contract-registry.service.js';
import { createLogger } from '../../utils/logger.js';
import { resolveBundledConfigPath } from '../../utils/bundled-paths.js';

const logger = createLogger('create-decision-core');

/**
 * Create a fully configured Decision Core instance.
 *
 * With zero config, returns an in-memory instance with no model provider
 * and default tenant. Add configuration to enable policy packs, trust routing,
 * provider gateway, and more.
 */
export async function createDecisionCore(config: Partial<DecisionCoreConfig> = {}): Promise<DecisionCore> {
  const parsed = DecisionCoreConfigSchema.parse(config);

  // --- Persistence ---
  let policyRuleRepo: PolicyRuleRepository;
  let decisionLogRepo: DecisionLogRepository;

  if (parsed.persistence === 'sqlite') {
    if (!parsed.sqlitePath) {
      throw new Error('SQLite persistence requires sqlitePath. Use { persistence: "sqlite", sqlitePath: "./decisions.db" }.');
    }
    const { createSqliteConnection } = await import('../../persistence/sqlite/sqlite-connection.js');
    const { SqlitePolicyRuleRepository } = await import('../../persistence/sqlite/sqlite-policy-rule.repository.js');
    const { SqliteDecisionLogRepository } = await import('../../persistence/sqlite/sqlite-decision-log.repository.js');
    const db = createSqliteConnection({ path: parsed.sqlitePath });
    policyRuleRepo = new SqlitePolicyRuleRepository(db);
    decisionLogRepo = new SqliteDecisionLogRepository(db);
  } else {
    policyRuleRepo = new InMemoryPolicyRuleRepository();
    decisionLogRepo = new InMemoryDecisionLogRepository();
  }

  // --- Event Service ---
  const eventService = new NoOpEventService();

  // --- Policy Decision Point ---
  const innerPdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

  // --- Policy Pack Loading ---
  let denyUnknown = parsed.denyUnknownDefault ?? false;
  if (parsed.policyPackPath) {
    const seedResult = await loadAndSeedPolicyPack(parsed.policyPackPath, parsed.tenantId, policyRuleRepo);
    if (seedResult.denyUnknownDefault) {
      denyUnknown = true;
    }
  }

  const pdp = denyUnknown
    ? wrapPdpDenyUnknown(innerPdp)
    : innerPdp;

  // --- Surface Contract Registry ---
  const surfaceContractRegistry = new SurfaceContractRegistry();

  if (parsed.surfaceContracts) {
    surfaceContractRegistry.registerAll(parsed.surfaceContracts);
  }

  if (parsed.surfaceContractPath) {
    surfaceContractRegistry.loadFromFile(parsed.surfaceContractPath);
  }

  if (parsed.useDefaultSurfaceContracts) {
    const { dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const defaultPath = resolveBundledConfigPath(
      dirname(fileURLToPath(import.meta.url)),
      'surface-contracts',
      'default.yaml',
    );
    surfaceContractRegistry.loadFromFile(defaultPath);
  }

  // --- Trust Framework ---
  const trustPolicyLoader = new TrustPolicyLoader();
  const surfaceResolver = new SurfaceResolver(trustPolicyLoader);

  // --- Route Resolver ---
  const routeResolver = new RuntimeRouteResolver();

  if (parsed.routeConfigPath) {
    const { readFileSync } = await import('node:fs');
    const configJson = readFileSync(parsed.routeConfigPath, 'utf-8');
    routeResolver.loadConfigFromJson(configJson);
  }

  // --- Model Gateway ---
  let modelGatewayAdapter: ModelGatewayAdapter | undefined;

  if (parsed.provider && parsed.provider.mode !== 'disabled') {
    const gatewayConfig: ModelGatewayConfig = {
      profiles: [],
      policy: {
        policyVersion: '1.0.0',
        allowedProviders: [],
        allowCrossLabFallback: true,
        sensitiveSurfaces: [],
      },
      hostCallback: parsed.provider.hostCallback,
      httpAdapter: parsed.provider.httpAdapter,
      currentLab: parsed.provider.currentLab,
    };

    const gateway = new ModelGateway(gatewayConfig);

    // Wrap ModelGateway as ModelGatewayAdapter
    modelGatewayAdapter = {
      async evaluate(prompt, options) {
        const response = await gateway.call('general', prompt, {
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
          systemPrompt: options?.systemPrompt,
          context: options?.context,
        });
        return {
          text: response.text,
          model: response.model,
          confidence: response.confidence,
          latency: response.latency,
          tokenUsage: response.tokenUsage,
        };
      },
    };
  }

  // --- Decision Runner ---
  const runner = new DecisionRunner({
    pdp,
    surfaceResolver,
    routeResolver,
    decisionLog: decisionLogRepo,
    eventService,
    modelGateway: modelGatewayAdapter,
  });

  logger.info(
    {
      tenantId: parsed.tenantId,
      persistence: parsed.persistence,
      providerMode: parsed.provider?.mode ?? 'disabled',
      hasPolicyPack: !!parsed.policyPackPath,
    },
    'Decision Core instance created',
  );

  // --- Build Public API ---
  const tenantId = parsed.tenantId as TenantId;

  return {
    tenantId: parsed.tenantId,
    surfaceContractRegistry,

    async evaluate<TInput, TOutput>(
      decision: BaseDecision<TInput, TOutput>,
      context?: DecisionContext,
    ): Promise<DecisionRunnerResult<TOutput>> {
      return runner.execute(tenantId, decision, context);
    },

    async explain(correlationId: string): Promise<Explanation> {
      const records = await decisionLogRepo.findByCorrelationId(
        tenantId,
        correlationId as CorrelationId,
      );

      const explanationRecords: ExplanationRecord[] = records.map((r) => ({
        id: r.id,
        surface: r.surface,
        status: r.status,
        confidence: r.confidence,
        latency: r.latency,
        auditHash: r.auditHash,
        createdAt: r.createdAt,
      }));

      return {
        correlationId,
        tenantId: parsed.tenantId,
        records: explanationRecords,
      };
    },
  };
}
