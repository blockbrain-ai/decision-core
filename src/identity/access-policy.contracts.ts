import { z } from 'zod';

export const RollupPolicySchema = z.object({
  mode: z.enum(['redacted-aggregate-only', 'full', 'disabled']).default('redacted-aggregate-only'),
  forbiddenFields: z.array(z.string()).default([]),
});
export type RollupPolicy = z.infer<typeof RollupPolicySchema>;

export const AccessClassificationSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  brain: z.string().min(1),
  accessibleBy: z.array(z.string()),
  writeAccess: z.array(z.string()).default([]),
  neverAccessibleBy: z.array(z.string()).default([]),
  examples: z.array(z.string()).default([]),
  rollupPolicy: RollupPolicySchema.optional(),
});
export type AccessClassification = z.infer<typeof AccessClassificationSchema>;

export const AccessPolicyConfigSchema = z.object({
  version: z.string().default('1.0'),
  lastReviewedBy: z.string().optional(),
  lastReviewedAt: z.string().optional(),
  classifications: z.array(AccessClassificationSchema),
});
export type AccessPolicyConfig = z.infer<typeof AccessPolicyConfigSchema>;
