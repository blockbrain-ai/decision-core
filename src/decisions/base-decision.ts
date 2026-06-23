/**
 * BaseDecision — Core interface for decision templates
 *
 * All decision templates must implement this interface to ensure
 * consistent quality gate enforcement and input/output handling.
 */

import type { EvaluationSpec } from './evaluation-spec.types.js';
import type { TenantId } from '../contracts/common.contracts.js';
import type { QualityGateStatus } from '../contracts/decision.contracts.js';

/**
 * Quality gate check result for decision pre-conditions.
 */
export interface DecisionQualityGateResult {
  status: QualityGateStatus;
  failedEntities: string[];
  message: string;
}

/**
 * BaseDecision interface for all decision templates.
 *
 * Generic type parameters:
 * - TInput: The input context type for the decision
 * - TOutput: The output result type for the decision
 */
export interface BaseDecision<TInput, TOutput> {
  /** Unique identifier for this decision type */
  readonly templateId: string;

  /** Version of this decision template */
  readonly version: string;

  /** Required entity types for this decision */
  readonly requiredEntities: string[];

  /** Decision type (often same as templateId) */
  readonly decisionType: string;

  /** Entity type this decision applies to */
  readonly entityType: string;

  /** Surface ID for trust routing */
  readonly surfaceId: string;

  /** Action type pattern for policy matching */
  readonly actionType: string;

  /** Optional evaluation specification for measuring outcomes */
  readonly evaluationSpec?: EvaluationSpec;

  /**
   * Check if required entities meet quality gates
   */
  checkQualityGate(context: { tenantId: TenantId }): Promise<DecisionQualityGateResult>;

  /**
   * Gather inputs for the decision
   */
  gatherInputs(context: { tenantId: TenantId; date: Date }): Promise<TInput>;

  /**
   * Evaluate the decision and produce output.
   * Only called when the route requires model evaluation.
   */
  evaluate(input: TInput): Promise<TOutput>;

  /**
   * Build the prompt for model evaluation. Used when trust routing
   * dispatches to a model-assisted pattern.
   */
  buildPrompt(input: TInput): string;

  /**
   * Parse model output into the expected output type.
   */
  parseOutput(raw: unknown): TOutput;
}
