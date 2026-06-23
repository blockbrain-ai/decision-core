import { z } from 'zod';
import { RouteClassEnum } from './route-class.js';

export const ConfidenceTierEnum = z.enum([
  'hard_rule',
  'high',
  'medium',
  'low',
  'no_decision',
]);

export type CandidateConfidenceTier = z.infer<typeof ConfidenceTierEnum>;

export const RuleFiredResultEnum = z.enum([
  'allow',
  'block',
  'route',
  'escalate',
  'no_match',
]);

export const RuleFiredSchema = z.object({
  ruleId: z.string().min(1),
  description: z.string(),
  inputFields: z.array(z.string()),
  policyRefs: z.array(z.string()),
  result: RuleFiredResultEnum,
});

export type RuleFired = z.infer<typeof RuleFiredSchema>;

export const DeterministicDecisionCandidateSchema = z.object({
  surfaceId: z.string().min(1),
  routeClass: RouteClassEnum,
  decision: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  confidenceTier: ConfidenceTierEnum,
  ruleSetId: z.string().min(1),
  ruleSetVersion: z.string().min(1),
  ruleSetHash: z.string().min(1),
  rulesFired: z.array(RuleFiredSchema),
  missingEvidence: z.array(z.string()),
  usedInputFields: z.array(z.string()),
  ignoredUntrustedFields: z.array(z.string()),
  rationale: z.string(),
  safeToExecuteWithoutModel: z.boolean(),
});

export type DeterministicDecisionCandidate = z.infer<typeof DeterministicDecisionCandidateSchema>;
