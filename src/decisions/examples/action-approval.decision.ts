/**
 * Action Approval Decision Template
 *
 * A simple "should this tool action be approved?" decision that
 * demonstrates the BaseDecision framework without BOS domain logic.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { BaseDecision, DecisionQualityGateResult } from '../base-decision.js';
import type { EvaluationSpec } from '../evaluation-spec.types.js';

// ===========================================================================
// Input / Output Types
// ===========================================================================

export interface ActionApprovalInput {
  actionName: string;
  actionParams: Record<string, unknown>;
  requestedBy: string;
  riskIndicators: string[];
}

export interface ActionApprovalOutput {
  approved: boolean;
  reason: string;
  conditions: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

// ===========================================================================
// Decision Template Implementation
// ===========================================================================

export class ActionApprovalDecision implements BaseDecision<ActionApprovalInput, ActionApprovalOutput> {
  readonly templateId = 'action-approval';
  readonly version = '1.0.0';
  readonly requiredEntities = ['action_request'];
  readonly decisionType = 'action-approval';
  readonly entityType = 'action';
  readonly surfaceId = 'workflow.action_approval';

  /**
   * The action type evaluated against policy rules (e.g. quickStart tool
   * patterns like `read_*`). Pass the concrete action name in the
   * constructor so per-tool allow/deny rules can match it; without an
   * action name the generic `workflow.approve_action` type matches no
   * tool rule and deny-unknown blocks the decision.
   */
  readonly actionType: string;

  constructor(actionName?: string) {
    this.actionType = actionName ?? 'workflow.approve_action';
  }

  readonly evaluationSpec: EvaluationSpec = {
    outcomeMetric: 'action_success_rate',
    outcomeWindow: '7d',
    successCriteria: 'Approved actions complete without incident',
    comparison: 'previous_period',
    successThreshold: 0.95,
    minimumSampleSize: 20,
  };

  private inputProvider?: () => ActionApprovalInput;

  /**
   * Optionally provide a custom input supplier for testing or integration.
   */
  withInputProvider(provider: () => ActionApprovalInput): this {
    this.inputProvider = provider;
    return this;
  }

  async checkQualityGate(_context: { tenantId: TenantId }): Promise<DecisionQualityGateResult> {
    return {
      status: 'pass',
      failedEntities: [],
      message: 'Action request available',
    };
  }

  async gatherInputs(_context: { tenantId: TenantId; date: Date }): Promise<ActionApprovalInput> {
    if (this.inputProvider) {
      return this.inputProvider();
    }
    return {
      actionName: 'unknown',
      actionParams: {},
      requestedBy: 'system',
      riskIndicators: [],
    };
  }

  async evaluate(input: ActionApprovalInput): Promise<ActionApprovalOutput> {
    // Simple deterministic logic for demonstration
    const riskLevel = this.assessRisk(input.riskIndicators);
    const approved = riskLevel !== 'high';

    return {
      approved,
      reason: approved
        ? `Action ${input.actionName} approved with ${riskLevel} risk`
        : `Action ${input.actionName} rejected due to high risk indicators`,
      conditions: riskLevel === 'medium' ? ['requires_monitoring'] : [],
      riskLevel,
    };
  }

  buildPrompt(input: ActionApprovalInput): string {
    return [
      'Evaluate whether the following action should be approved.',
      '',
      `Action: ${input.actionName}`,
      `Requested by: ${input.requestedBy}`,
      `Parameters: ${JSON.stringify(input.actionParams)}`,
      `Risk indicators: ${input.riskIndicators.join(', ') || 'none'}`,
      '',
      'Respond with JSON: { "approved": boolean, "reason": string, "conditions": string[], "riskLevel": "low"|"medium"|"high" }',
    ].join('\n');
  }

  parseOutput(raw: unknown): ActionApprovalOutput {
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw) as ActionApprovalOutput;
      return parsed;
    }
    return raw as ActionApprovalOutput;
  }

  private assessRisk(indicators: string[]): 'low' | 'medium' | 'high' {
    if (indicators.length === 0) return 'low';
    if (indicators.length <= 2) return 'medium';
    return 'high';
  }
}
