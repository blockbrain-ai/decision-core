/**
 * Policy Events
 *
 * Domain event type constants emitted during policy evaluation
 * and enforcement. Consumed through the EventService adapter.
 */

export const POLICY_EVENTS = {
  POLICY_EVALUATED: 'policy.evaluated',
  POLICY_DENIED: 'policy.denied',
  POLICY_APPROVAL_REQUIRED: 'policy.approval_required',
  POLICY_ALLOWED: 'policy.allowed',
  POLICY_ENFORCED: 'policy.enforced',
  POLICY_BLOCKED: 'policy.blocked',
  POLICY_ENFORCEMENT_SKIPPED: 'policy.enforcement_skipped',
} as const;

export type PolicyEventType = (typeof POLICY_EVENTS)[keyof typeof POLICY_EVENTS];
