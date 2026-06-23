/**
 * serve command — Start HTTP and/or MCP server.
 *
 * Usage: decision-core serve [--host <host>] [--port <port>] [--mcp] [--bearer-token <token>]
 */

import { resolve } from 'path';
import { createHttpServer } from '../../http/index.js';
import { startStdioServer } from '../../mcp/index.js';
import { InMemoryPolicyRuleRepository } from '../../../persistence/memory/in-memory-policy-rule.repository.js';
import { InMemoryDecisionLogRepository } from '../../../persistence/memory/in-memory-decision-log.repository.js';
import { PolicyDecisionPoint } from '../../../policy/policy-decision-point.js';
import { wrapPdpDenyUnknown } from '../../../policy/deny-unknown-wrapper.js';
import { NoOpEventService } from '../../../adapters/event-service.js';
import { loadAndSeedPolicyPack } from '../../sdk/policy-pack-loader.js';
import { tryLoadAgentRegistry, resolveAgentRoles, findAgentById } from '../../../identity/agent-registry.js';
import { tryLoadAgentAuthStore, resolveIdentity, isIdentityError } from '../../../identity/agent-auth.js';
import type { OrgIdentityResolver } from '../../http/types.js';
import { createLogger } from '../../../utils/logger.js';
import type { TenantId } from '../../../contracts/common.contracts.js';
import type { CliContext } from '../cli.js';
import type { DecisionEvidenceSink } from '../../../integrity/evidence-sinks/decision-evidence-sink.js';

const logger = createLogger('cli-serve');

function isLocalHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export async function serveCommand(ctx: CliContext): Promise<number> {
  const tenantId = ctx.config?.tenantId ?? 'default';
  const host = (typeof ctx.flags['host'] === 'string' ? ctx.flags['host'] : ctx.config?.serve?.host) ?? '127.0.0.1';
  const port = typeof ctx.flags['port'] === 'string'
    ? parseInt(ctx.flags['port'], 10)
    : (ctx.config?.serve?.port ?? 0);
  const bearerToken = typeof ctx.flags['bearer-token'] === 'string'
    ? ctx.flags['bearer-token']
    : (ctx.config?.serve?.bearerToken
      ?? process.env['DECISION_CORE_BEARER_TOKEN']
      ?? process.env['DECISION_CORE_API_TOKEN']);
  const mcpMode = ctx.flags['mcp'] === true || ctx.config?.serve?.mcp === true;
  const allowUnauthenticatedLocal =
    ctx.flags['allow-unauthenticated-local'] === true
    || ctx.config?.serve?.allowUnauthenticatedLocal === true;

  // Wire dependencies
  const policyRuleRepo = new InMemoryPolicyRuleRepository();
  const decisionLogRepo = new InMemoryDecisionLogRepository();
  const eventService = new NoOpEventService();

  let denyUnknown = ctx.config?.denyUnknownDefault ?? false;

  // Seed policy pack if configured
  if (ctx.config?.policyPackPath) {
    const seed = await loadAndSeedPolicyPack(ctx.config.policyPackPath, tenantId, policyRuleRepo);
    denyUnknown = denyUnknown || seed.denyUnknownDefault;
  }

  let pdp = createPdp(policyRuleRepo, eventService, denyUnknown);

  const policyEvaluator = {
    evaluate: (tid: string, _surfaceId: string, action: string, context?: Record<string, unknown>) =>
      pdp.evaluate(tid as TenantId, {
        enforcementPoint: 'pre_decision',
        actionType: action,
        financialImpact: context?.financialImpact as number | undefined,
        dataQualityScore: context?.dataQualityScore as number | undefined,
        confidence: context?.confidence as number | undefined,
        autonomyLevel: context?.autonomyLevel as number | undefined,
        agentId: context?.agentId as string | undefined,
        callerRoles: Array.isArray(context?.callerRoles) ? context.callerRoles as string[] : undefined,
      }),
  };

  if (mcpMode) {
    ctx.stdout('Starting MCP server (stdio)...');
    await startStdioServer({
      tenantId,
      policyEvaluator,
      policyRuleRepo: {
        findAll: (tid: TenantId, filters?) => policyRuleRepo.findAll(tid, filters),
        create: (tid: TenantId, input) => policyRuleRepo.create(tid, input),
      },
      decisionLogRepo: {
        findAll: (tid: TenantId, filters?) => decisionLogRepo.findAll(tid, filters),
        findByCorrelationId: (tid: TenantId, cid: string) => decisionLogRepo.findByCorrelationId(tid, cid),
      },
    });
    return 0;
  }

  // Org-mode identity resolution. If org config exists, per-agent tokens replace the single global HTTP token.
  const agentRegistryPath = typeof ctx.flags['agent-registry'] === 'string'
    ? ctx.flags['agent-registry']
    : (ctx.config?.agentRegistryPath ?? resolve('.decision-core', 'agents.yaml'));
  const agentAuthPath = typeof ctx.flags['agent-auth'] === 'string'
    ? ctx.flags['agent-auth']
    : (ctx.config?.agentAuthPath ?? resolve('.decision-core', 'agent-auth.yaml'));
  const accessPolicyPath = typeof ctx.flags['access-policy'] === 'string'
    ? ctx.flags['access-policy']
    : (ctx.config?.accessPolicyPath ?? resolve('.decision-core', 'access-policy.yaml'));

  const agentRegistry = tryLoadAgentRegistry(agentRegistryPath);
  const agentAuthStore = tryLoadAgentAuthStore(agentAuthPath);
  if (agentRegistry && !agentAuthStore) {
    ctx.stderr(
      `Org mode registry found at ${agentRegistryPath}, but no auth store was found at ${agentAuthPath}. ` +
      'Run `decision-core provision` or pass --agent-auth explicitly.',
    );
    return 1;
  }

  if (!agentRegistry && agentAuthStore) {
    ctx.stderr(
      `Agent auth store found at ${agentAuthPath}, but no registry was found at ${agentRegistryPath}. ` +
      'Run `decision-core org init` or pass --agent-registry explicitly.',
    );
    return 1;
  }

  const isOrgMode = !!(agentRegistry && agentAuthStore);

  if (!bearerToken && !isOrgMode) {
    if (!allowUnauthenticatedLocal) {
      ctx.stderr(
        'HTTP serve requires authentication. Set DECISION_CORE_BEARER_TOKEN or pass --bearer-token. ' +
        'For localhost-only development, pass --allow-unauthenticated-local.',
      );
      return 1;
    }

    if (!isLocalHost(host)) {
      ctx.stderr('--allow-unauthenticated-local is only allowed for localhost bindings.');
      return 1;
    }

    ctx.stdout('HTTP auth disabled for localhost development.');
  }

  let identityResolver: OrgIdentityResolver | undefined;
  if (isOrgMode) {
    ctx.stdout('Org mode enabled: agent identity resolution active.');
    identityResolver = {
      resolve(token: string, bodyAgentId?: string) {
        const result = resolveIdentity(
          token,
          bodyAgentId,
          agentAuthStore!,
          (agentId) => resolveAgentRoles(agentRegistry!, agentId),
          (agentId) => {
            const agent = findAgentById(agentRegistry!, agentId);
            return agent?.enabled ?? false;
          },
        );

        if (isIdentityError(result)) {
          return { error: result.message, code: result.code };
        }
        return result;
      },
    };
  }

  // Evidence sink wiring
  let evidenceSink: DecisionEvidenceSink | undefined;
  const evidenceSinkType = process.env['DECISION_CORE_EVIDENCE_SINK'];
  if (evidenceSinkType === 'gbrain') {
    const { GBrainClient } = await import('../../../adapters/gbrain/gbrain-client.js');
    const { GBrainStoreAdapter } = await import('../../../adapters/gbrain/gbrain-store.js');
    const { GBrainDecisionEvidenceSink } = await import('../../../integrity/evidence-sinks/gbrain-decision-evidence-sink.js');

    const gbrainUrl = process.env['DECISION_CORE_GBRAIN_URL'];
    const gbrainClientId = process.env['DECISION_CORE_GBRAIN_CLIENT_ID'];
    const gbrainClientSecret = process.env['DECISION_CORE_GBRAIN_CLIENT_SECRET'];
    const gbrainBin = process.env['DECISION_CORE_GBRAIN_BIN'];
    const gbrainCwd = process.env['DECISION_CORE_GBRAIN_CWD'];

    let transport;
    if (gbrainUrl && gbrainClientId && gbrainClientSecret) {
      const { GBrainHttpTransport } = await import('../../../adapters/gbrain/gbrain-http-transport.js');
      transport = new GBrainHttpTransport({
        baseUrl: gbrainUrl,
        clientId: gbrainClientId,
        clientSecret: gbrainClientSecret,
      });
      ctx.stdout(`Evidence sink: gbrain (HTTP transport via ${gbrainUrl})`);
    } else if (gbrainBin) {
      const { GBrainCliTransport } = await import('../../../adapters/gbrain/gbrain-cli-transport.js');
      transport = new GBrainCliTransport({ binPath: gbrainBin, cwd: gbrainCwd });
      ctx.stdout(`Evidence sink: gbrain (CLI transport via ${gbrainBin})`);
    } else {
      ctx.stderr(
        'DECISION_CORE_EVIDENCE_SINK=gbrain requires either:\n' +
        '  HTTP transport: DECISION_CORE_GBRAIN_URL + DECISION_CORE_GBRAIN_CLIENT_ID + DECISION_CORE_GBRAIN_CLIENT_SECRET\n' +
        '  CLI transport:  DECISION_CORE_GBRAIN_BIN (warning: PGLite lock contention when G-Brain HTTP is running)',
      );
      return 1;
    }

    const client = new GBrainClient({ transport });
    const store = new GBrainStoreAdapter({ client });
    evidenceSink = new GBrainDecisionEvidenceSink(store);
  } else {
    // Default: persist execution/evaluation evidence into the same
    // in-memory decision log that `/audit` reads, so agent adapters
    // (Hermes, OpenClaw) get a working audit trail out of the box without
    // requiring an external sink. Set DECISION_CORE_EVIDENCE_SINK=gbrain
    // for durable, tamper-evident off-box storage.
    const { DecisionLogEvidenceSink } = await import('../../../integrity/evidence-sinks/decision-log-evidence-sink.js');
    evidenceSink = new DecisionLogEvidenceSink(decisionLogRepo);
    ctx.stdout('Evidence sink: in-memory decision log (audit visible via GET /audit)');
  }

  // HTTP server
  const server = await createHttpServer(
    {
      tenantId,
      policyEvaluator,
      policyRuleRepo: {
        findAll: (tid: TenantId, filters?) => policyRuleRepo.findAll(tid, filters),
      },
      decisionLogRepo: {
        findAll: (tid: TenantId, filters?) => decisionLogRepo.findAll(tid, filters),
        findByCorrelationId: (tid: TenantId, cid: string) => decisionLogRepo.findByCorrelationId(tid, cid),
      },
      evidenceSink,
    },
    { host, port, bearerToken, orgMode: isOrgMode, identityResolver, orgConfig: isOrgMode ? { agentRegistryPath, accessPolicyPath } : undefined },
  );

  const addr = server.address();
  if (addr) {
    ctx.stdout(`Decision Core HTTP server listening on http://${addr.host}:${addr.port}`);
    if (bearerToken) {
      ctx.stdout('HTTP auth enabled; token value is not displayed.');
    }
  }

  // Watch mode: reload policy pack on changes
  if (ctx.flags['watch'] && ctx.config?.policyPackPath) {
    const { watch } = await import('node:fs');
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const packPath = ctx.config.policyPackPath;
    ctx.stdout(`Watching ${packPath} for changes...`);
    watch(packPath, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          const existing = await policyRuleRepo.findAll(tenantId as TenantId);
          for (const rule of existing) {
            await policyRuleRepo.delete(tenantId as TenantId, rule.id);
          }
          const seed = await loadAndSeedPolicyPack(packPath, tenantId, policyRuleRepo);
          pdp = createPdp(policyRuleRepo, eventService, ctx.config?.denyUnknownDefault || seed.denyUnknownDefault);
          ctx.stdout(`[watch] Policy pack reloaded at ${new Date().toISOString()}`);
        } catch (err) {
          ctx.stderr(`[watch] Reload failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, 500);
    });
  }

  // Keep process alive until signal
  await new Promise<void>((resolve) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      logger.info('Shutting down server');
      server.close().then(resolve);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

  return 0;
}

function createPdp(
  policyRuleRepo: InMemoryPolicyRuleRepository,
  eventService: NoOpEventService,
  denyUnknown: boolean,
): PolicyDecisionPoint {
  const inner = new PolicyDecisionPoint(policyRuleRepo, eventService);
  return denyUnknown ? wrapPdpDenyUnknown(inner) : inner;
}
