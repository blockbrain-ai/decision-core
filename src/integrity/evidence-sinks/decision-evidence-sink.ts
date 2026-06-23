export interface EvaluationEvidence {
  tenantId: string;
  surfaceId: string;
  host: string;
  agentId?: string;
  action: string;
  verdict: 'allow' | 'deny' | 'approve_required';
  correlationId: string;
  matchedPolicies?: Array<Record<string, unknown>>;
  context?: Record<string, unknown>;
  timestamp?: string;
}

export interface ExecutionEvidence {
  tenantId: string;
  surfaceId: string;
  host: string;
  agentId?: string;
  action: string;
  correlationId: string;
  result?: Record<string, unknown>;
  timingMs?: number;
  timestamp?: string;
}

export interface DecisionEvidenceSink {
  recordEvaluation(evidence: EvaluationEvidence): Promise<void>;
  recordExecution(evidence: ExecutionEvidence): Promise<void>;
}
