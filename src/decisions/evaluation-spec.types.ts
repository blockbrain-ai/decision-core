/**
 * EvaluationSpec TypeScript type definitions
 *
 * Declares how decision outcomes should be measured for tracking
 * business results over time.
 */

/**
 * Comparison type for evaluating success criteria
 */
export type ComparisonType = 'previous_period' | 'baseline';

/**
 * Outcome window string format (e.g., '30d', '7d', '1d')
 */
export type OutcomeWindow = string;

/**
 * EvaluationSpec defines how a decision's outcomes should be measured.
 */
export interface EvaluationSpec {
  outcomeMetric: string;
  outcomeWindow: OutcomeWindow;
  successCriteria: string;
  comparison: ComparisonType;
  successThreshold: number;
  minimumSampleSize: number;
}

export function isEvaluationSpec(obj: unknown): obj is EvaluationSpec {
  if (typeof obj !== 'object' || obj === null) return false;
  const spec = obj as Record<string, unknown>;
  return (
    typeof spec['outcomeMetric'] === 'string' &&
    typeof spec['outcomeWindow'] === 'string' &&
    typeof spec['successCriteria'] === 'string' &&
    isComparisonType(spec['comparison']) &&
    typeof spec['successThreshold'] === 'number' &&
    typeof spec['minimumSampleSize'] === 'number'
  );
}

export function isComparisonType(value: unknown): value is ComparisonType {
  return value === 'previous_period' || value === 'baseline';
}

export function parseOutcomeWindowDays(window: OutcomeWindow): number | null {
  const match = window.match(/^(\d+)d$/);
  if (!match) return null;
  return parseInt(match[1], 10);
}
