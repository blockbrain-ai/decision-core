/**
 * Decision Runner
 *
 * Orchestrates the full decision pipeline:
 *   1. Quality gate check
 *   2. Policy evaluation (PDP)
 *   3. Trust routing resolution
 *   4. Route execution (deterministic or model-assisted)
 *   5. Evidence recording
 *   6. Decision logging
 *
 * Wires together: PolicyDecisionPoint, SurfaceResolver,
 * RuntimeRouteResolver, DecisionLogRepository, EventService.
 */

import type { TenantId, CorrelationId } from '../contracts/common.contracts.js';
import type { DecisionRecord, DecisionLogStatus } from '../contracts/decision.contracts.js';
import type { PolicyVerdict } from '../contracts/policy.contracts.js';
import type { DecisionLogRepository } from '../persistence/interfaces/decision-log.repository.js';
import type { EventService } from '../adapters/event-service.js';
import type { ModelGatewayAdapter } from '../adapters/model-gateway.js';
import type { PolicyDecisionPoint } from '../policy/policy-decision-point.js';
import type { SurfaceResolver } from '../trust/surface-resolver.js';
import type { RuntimeRouteResolver, RouteResolution } from '../routing/runtime/runtime-route-resolver.js';
import type { EnforcementFlow, EnforcementFlowResult } from '../knowledge/enforcement/enforcement-flow.js';
import type { ClauseEvidence } from '../knowledge/enforcement/deterministic-enforcer.js';
import type { BaseDecision } from './base-decision.js';
import { EvidenceRecorder } from './evidence/evidence-recorder.js';
import { checkAbortConditions, hasSoftAbort } from './evidence/abort-conditions.js';
import type { AbortCondition } from './evidence/abort-conditions.js';
import { generateUuidV7 } from '../utils/uuid-v7.js';
import { hashCanonicalJson } from '../utils/audit-hash.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('decision-runner');

// ===========================================================================
// Decision Runner Types
// ===========================================================================

export type DecisionVerdict = 'completed' | 'blocked' | 'approval_required' | 'safe_block' | 'failed';

export interface DecisionRunnerResult<TOutput = unknown> {
  verdict: DecisionVerdict;
  output: TOutput | null;
  explanation: string;
  correlationId: string;
  tenantId: string;
  auditHash: string;
  timing: DecisionTiming;
  evidenceChain: EvidenceChainSummary;
  policyVerdict: PolicyVerdict | null;
  routeResolution: RouteResolution | null;
  abortConditions: AbortCondition[];
  clauseEvidence: ClauseEvidence[];
  ruleSetVersion: number | null;
}

export interface DecisionTiming {
  startedAt: string;
  completedAt: string;
  totalMs: number;
  policyMs: number;
  routingMs: number;
  executionMs: number;
}

export interface EvidenceChainSummary {
  recordCount: number;
  headHash: string | null;
}

export interface DecisionContext {
  date?: Date;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface DecisionRunnerDeps {
  pdp: PolicyDecisionPoint;
  surfaceResolver: SurfaceResolver;
  routeResolver: RuntimeRouteResolver;
  decisionLog: DecisionLogRepository;
  eventService: EventService;
  modelGateway?: ModelGatewayAdapter;
  enforcementFlow?: EnforcementFlow;
}

// ===========================================================================
// Decision Runner
// ===========================================================================

export class DecisionRunner {
  private readonly pdp: PolicyDecisionPoint;
  private readonly surfaceResolver: SurfaceResolver;
  private readonly routeResolver: RuntimeRouteResolver;
  private readonly decisionLog: DecisionLogRepository;
  private readonly eventService: EventService;
  private readonly modelGateway?: ModelGatewayAdapter;
  private readonly enforcementFlow?: EnforcementFlow;

  constructor(deps: DecisionRunnerDeps) {
    this.pdp = deps.pdp;
    this.surfaceResolver = deps.surfaceResolver;
    this.routeResolver = deps.routeResolver;
    this.decisionLog = deps.decisionLog;
    this.eventService = deps.eventService;
    this.modelGateway = deps.modelGateway;
    this.enforcementFlow = deps.enforcementFlow;
  }

  /**
   * Execute a decision through the full pipeline.
   */
  async execute<TInput, TOutput>(
    tenantId: TenantId,
    decision: BaseDecision<TInput, TOutput>,
    context: DecisionContext = {},
  ): Promise<DecisionRunnerResult<TOutput>> {
    if (!decision || typeof (decision as BaseDecision<TInput, TOutput>).checkQualityGate !== 'function') {
      throw new TypeError(
        'evaluate() expects a BaseDecision instance (e.g. new ActionApprovalDecision("read_file").withInputProvider(...)). ' +
        'For plain { action, surface } inputs, use the top-level evaluate() convenience function instead.',
      );
    }
    const startedAt = new Date();
    const correlationId = (context.correlationId ?? generateUuidV7()) as CorrelationId;

    const evidenceRecorder = new EvidenceRecorder(tenantId, correlationId, this.eventService);

    logger.info(
      { tenantId, templateId: decision.templateId, correlationId },
      'Decision execution started',
    );

    // Record decision initiation
    evidenceRecorder.append({
      operationType: 'decision_initiated',
      payload: {
        templateId: decision.templateId,
        version: decision.version,
        surfaceId: decision.surfaceId,
        actionType: decision.actionType,
      },
    });

    let policyMs = 0;
    let routingMs = 0;
    let executionMs = 0;

    // -----------------------------------------------------------------------
    // Step 1: Quality Gate
    // -----------------------------------------------------------------------
    const qualityGate = await decision.checkQualityGate({ tenantId });

    evidenceRecorder.append({
      operationType: 'quality_gate_checked',
      payload: { status: qualityGate.status, failedEntities: qualityGate.failedEntities, message: qualityGate.message },
    });

    // -----------------------------------------------------------------------
    // Step 2: Policy Evaluation
    // -----------------------------------------------------------------------
    const policyStart = Date.now();
    const policyVerdict = await this.pdp.evaluate(
      tenantId,
      {
        enforcementPoint: 'pre_decision',
        actionType: decision.actionType,
      },
      correlationId,
    );
    policyMs = Date.now() - policyStart;

    evidenceRecorder.append({
      operationType: 'policy_evaluated',
      payload: {
        verdict: policyVerdict.verdict,
        matchedPolicies: policyVerdict.matchedPolicies,
      },
    });

    // -----------------------------------------------------------------------
    // Step 3: Route Resolution
    // -----------------------------------------------------------------------
    const routingStart = Date.now();
    let routeResolution: RouteResolution | null = null;

    if (this.routeResolver.isLoaded()) {
      routeResolution = this.routeResolver.resolve(
        decision.surfaceId,
        {},
        { tenantId, correlationId },
      );
    }
    routingMs = Date.now() - routingStart;

    if (routeResolution) {
      evidenceRecorder.append({
        operationType: 'route_resolved',
        payload: {
          routeClass: routeResolution.routeClass,
          skipModelCall: routeResolution.skipModelCall,
          reason: routeResolution.reason,
        },
      });
    }

    // -----------------------------------------------------------------------
    // Check Abort Conditions
    // -----------------------------------------------------------------------
    // Model is only required when a loaded route config explicitly says so
    const routeConfigLoaded = this.routeResolver.isLoaded();
    const modelRequired = routeResolution ? !routeResolution.skipModelCall : false;
    const abortConditions = checkAbortConditions({
      policyVerdict: policyVerdict.verdict,
      routeResolved: routeResolution !== null || !routeConfigLoaded,
      modelRequired,
      modelAvailable: !!this.modelGateway,
      qualityGateStatus: qualityGate.status,
    });

    // Policy deny → blocked
    if (policyVerdict.verdict === 'deny') {
      return this.finalize(tenantId, decision, {
        verdict: 'blocked',
        output: null,
        explanation: `Policy denied: ${policyVerdict.matchedPolicies.map((p) => p.reason).join('; ')}`,
        correlationId,
        policyVerdict,
        routeResolution,
        abortConditions,
        evidenceRecorder,
        enforcementFlowResult: null,
        startedAt,
        policyMs,
        routingMs,
        executionMs: 0,
      });
    }

    // Policy approve_required → approval_required
    if (policyVerdict.verdict === 'approve_required') {
      return this.finalize(tenantId, decision, {
        verdict: 'approval_required',
        output: null,
        explanation: `Approval required: ${policyVerdict.matchedPolicies.map((p) => p.reason).join('; ')}`,
        correlationId,
        policyVerdict,
        routeResolution,
        abortConditions,
        evidenceRecorder,
        enforcementFlowResult: null,
        startedAt,
        policyMs,
        routingMs,
        executionMs: 0,
      });
    }

    // Quality gate fail → blocked
    if (qualityGate.status === 'fail') {
      return this.finalize(tenantId, decision, {
        verdict: 'blocked',
        output: null,
        explanation: `Quality gate failed: ${qualityGate.message}`,
        correlationId,
        policyVerdict,
        routeResolution,
        abortConditions,
        evidenceRecorder,
        enforcementFlowResult: null,
        startedAt,
        policyMs,
        routingMs,
        executionMs: 0,
      });
    }

    // -----------------------------------------------------------------------
    // Step 2b: Clause-Based Enforcement (compiled rules)
    // -----------------------------------------------------------------------
    let enforcementFlowResult: EnforcementFlowResult | null = null;

    if (this.enforcementFlow) {
      const enforcementContext = {
        actionType: decision.actionType,
        surfaceId: decision.surfaceId,
        tenantId,
        ...context.metadata,
      };

      enforcementFlowResult = await this.enforcementFlow.execute(
        tenantId,
        enforcementContext,
        evidenceRecorder,
      );

      if (enforcementFlowResult.outcome === 'blocked') {
        return this.finalize(tenantId, decision, {
          verdict: 'blocked',
          output: null,
          explanation: enforcementFlowResult.explanation,
          correlationId,
          policyVerdict,
          routeResolution,
          abortConditions,
          evidenceRecorder,
          enforcementFlowResult,
          startedAt,
          policyMs,
          routingMs,
          executionMs: 0,
        });
      }
    }

    // Soft abort (model unavailable, no route) → safe_block
    if (hasSoftAbort(abortConditions)) {
      const reasons = abortConditions.map((a) => a.reason).join('; ');
      return this.finalize(tenantId, decision, {
        verdict: 'safe_block',
        output: null,
        explanation: `Safe block: ${reasons}`,
        correlationId,
        policyVerdict,
        routeResolution,
        abortConditions,
        evidenceRecorder,
        enforcementFlowResult,
        startedAt,
        policyMs,
        routingMs,
        executionMs: 0,
      });
    }

    // -----------------------------------------------------------------------
    // Step 4: Execute Decision
    // -----------------------------------------------------------------------
    const execStart = Date.now();
    let output: TOutput | null = null;

    try {
      // Gather inputs
      const input = await decision.gatherInputs({
        tenantId,
        date: context.date ?? new Date(),
      });

      evidenceRecorder.append({
        operationType: 'inputs_gathered',
        payload: { inputHash: hashCanonicalJson(input) },
      });

      // Deterministic path: use candidate decision directly
      if (routeResolution?.skipModelCall && routeResolution.candidate && routeResolution.candidate.decision !== null) {
        const candidate = routeResolution.candidate;
        output = decision.parseOutput(candidate.decision);

        evidenceRecorder.append({
          operationType: 'deterministic_resolution',
          payload: {
            decision: candidate.decision,
            confidence: candidate.confidence,
            routeClass: routeResolution.routeClass,
          },
        });
      } else if (this.modelGateway) {
        // Model-assisted path via trust surface resolver
        const prompt = decision.buildPrompt(input);
        const patternResult = await this.surfaceResolver.resolve(
          decision.surfaceId,
          { prompt, tenantId, correlationId },
          { gateway: this.modelGateway },
        );

        evidenceRecorder.append({
          operationType: 'pattern_executed',
          payload: {
            patternUsed: patternResult.patternUsed,
            modelUsed: patternResult.modelUsed,
            confidence: patternResult.confidence,
            verificationStatus: patternResult.verificationStatus,
            finalDecisionSource: patternResult.finalDecisionSource,
            autonomyStatus: patternResult.autonomyStatus,
          },
        });

        if (patternResult.autonomyStatus === 'safe_block') {
          return this.finalize(tenantId, decision, {
            verdict: 'safe_block',
            output: null,
            explanation: `Pattern execution safe-blocked: ${patternResult.reason}`,
            correlationId,
            policyVerdict,
            routeResolution,
            abortConditions,
            evidenceRecorder,
            enforcementFlowResult,
            startedAt,
            policyMs,
            routingMs,
            executionMs: Date.now() - execStart,
          });
        }

        output = decision.parseOutput(patternResult.output);
      } else {
        // No model gateway, but model not required (shouldn't reach here given abort checks)
        output = await decision.evaluate(input);
      }
    } catch (err) {
      executionMs = Date.now() - execStart;

      evidenceRecorder.append({
        operationType: 'execution_failed',
        payload: { error: err instanceof Error ? err.message : String(err) },
      });

      return this.finalize(tenantId, decision, {
        verdict: 'failed',
        output: null,
        explanation: `Execution error: ${err instanceof Error ? err.message : String(err)}`,
        correlationId,
        policyVerdict,
        routeResolution,
        abortConditions,
        evidenceRecorder,
        enforcementFlowResult,
        startedAt,
        policyMs,
        routingMs,
        executionMs,
      });
    }

    executionMs = Date.now() - execStart;

    return this.finalize(tenantId, decision, {
      verdict: 'completed',
      output,
      explanation: 'Decision completed successfully',
      correlationId,
      policyVerdict,
      routeResolution,
      abortConditions,
      evidenceRecorder,
      enforcementFlowResult,
      startedAt,
      policyMs,
      routingMs,
      executionMs,
    });
  }

  // =========================================================================
  // Finalization
  // =========================================================================

  private async finalize<TInput, TOutput>(
    tenantId: TenantId,
    decision: BaseDecision<TInput, TOutput>,
    params: {
      verdict: DecisionVerdict;
      output: TOutput | null;
      explanation: string;
      correlationId: CorrelationId;
      policyVerdict: PolicyVerdict | null;
      routeResolution: RouteResolution | null;
      abortConditions: AbortCondition[];
      evidenceRecorder: EvidenceRecorder;
      enforcementFlowResult: EnforcementFlowResult | null;
      startedAt: Date;
      policyMs: number;
      routingMs: number;
      executionMs: number;
    },
  ): Promise<DecisionRunnerResult<TOutput>> {
    const completedAt = new Date();
    const totalMs = completedAt.getTime() - params.startedAt.getTime();

    // Record final evidence step
    params.evidenceRecorder.append({
      operationType: 'decision_finalized',
      payload: {
        verdict: params.verdict,
        explanation: params.explanation,
      },
    });

    const evidenceResult = params.evidenceRecorder.getResult();

    // Build audit hash over the full result
    const auditHash = hashCanonicalJson({
      tenantId,
      correlationId: params.correlationId,
      templateId: decision.templateId,
      verdict: params.verdict,
      evidenceHeadHash: evidenceResult.headHash,
    });

    // Log to DecisionLogRepository
    const status = verdictToStatus(params.verdict);
    const record: DecisionRecord = {
      id: generateUuidV7(),
      surface: decision.surfaceId,
      toolName: decision.actionType,
      status,
      confidence: 0,
      latency: totalMs,
      input: { templateId: decision.templateId, version: decision.version },
      output: params.output !== null ? (params.output as Record<string, unknown>) : {},
      correlationId: params.correlationId,
      tenantId,
      auditHash,
      createdAt: params.startedAt.toISOString(),
      updatedAt: completedAt.toISOString(),
    };

    await this.decisionLog.append(tenantId, record);

    // Emit decision event
    this.eventService.emit({
      id: generateUuidV7(),
      type: `DECISION_${params.verdict.toUpperCase()}`,
      source: 'decision-runner',
      payload: {
        templateId: decision.templateId,
        verdict: params.verdict,
        correlationId: params.correlationId,
      },
      timestamp: completedAt.toISOString(),
      correlationId: params.correlationId,
      tenantId,
    });

    logger.info(
      { tenantId, templateId: decision.templateId, correlationId: params.correlationId, verdict: params.verdict, totalMs },
      'Decision execution finalized',
    );

    const enforcementResult = params.enforcementFlowResult?.enforcementResult ?? null;

    return {
      verdict: params.verdict,
      output: params.output,
      explanation: params.explanation,
      correlationId: params.correlationId,
      tenantId,
      auditHash,
      timing: {
        startedAt: params.startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        totalMs,
        policyMs: params.policyMs,
        routingMs: params.routingMs,
        executionMs: params.executionMs,
      },
      evidenceChain: {
        recordCount: evidenceResult.records.length,
        headHash: evidenceResult.headHash,
      },
      policyVerdict: params.policyVerdict,
      routeResolution: params.routeResolution,
      abortConditions: params.abortConditions,
      clauseEvidence: enforcementResult?.evidence ?? [],
      ruleSetVersion: enforcementResult?.ruleSetVersion ?? null,
    };
  }
}

function verdictToStatus(verdict: DecisionVerdict): DecisionLogStatus {
  switch (verdict) {
    case 'completed':
      return 'generated';
    case 'blocked':
    case 'safe_block':
      return 'blocked';
    case 'approval_required':
      return 'pending';
    case 'failed':
      return 'failed';
  }
}
