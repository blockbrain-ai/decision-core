import { describe, expect, it } from 'vitest';
import {
  ActionTypePatternSchema,
  ActionTypeSchema,
  PolicyContextSchema,
  PolicyRuleCreateInputSchema,
} from './policy.contracts.js';

describe('action type contract boundaries', () => {
  it('accepts ordinary action names and patterns', () => {
    expect(ActionTypeSchema.safeParse('deploy.production').success).toBe(true);
    expect(ActionTypePatternSchema.safeParse('deploy.*').success).toBe(true);
  });

  it('rejects empty action names and patterns', () => {
    expect(ActionTypeSchema.safeParse('').success).toBe(false);
    expect(ActionTypePatternSchema.safeParse('').success).toBe(false);
  });

  it('rejects control characters in action names and patterns', () => {
    expect(ActionTypeSchema.safeParse('deploy.production\nsafe.read').success).toBe(false);
    expect(ActionTypePatternSchema.safeParse('deploy.*\n**').success).toBe(false);
  });

  it('applies action validation through policy context and rule schemas', () => {
    expect(PolicyContextSchema.safeParse({
      enforcementPoint: 'pre_decision',
      actionType: 'finance.pay\nroll',
    }).success).toBe(false);

    expect(PolicyRuleCreateInputSchema.safeParse({
      name: 'bad pattern',
      description: '',
      actionTypePattern: 'finance.*\n**',
      riskClass: 'B',
      enforcementPoint: 'pre_decision',
      policyType: 'business',
      priority: 10,
      requiredConstraints: [],
      requireApproval: false,
      enabled: true,
    }).success).toBe(false);
  });
});
