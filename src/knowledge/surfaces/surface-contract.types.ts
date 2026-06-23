import { z } from 'zod';
import { AutonomyLevelSchema } from '../../contracts/policy.contracts.js';
import { RiskTierSchema } from '../../trust/trust.contracts.js';

export const SURFACE_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'string[]',
  'number[]',
  'record',
  'enum',
] as const;

export const SurfaceFieldTypeSchema = z.enum(SURFACE_FIELD_TYPES);
export type SurfaceFieldType = z.infer<typeof SurfaceFieldTypeSchema>;

export const SurfaceFieldSchema = z.object({
  name: z.string().min(1),
  type: SurfaceFieldTypeSchema,
  required: z.boolean().default(false),
  description: z.string().optional(),
  enumValues: z.array(z.string()).optional(),
  protectedAttribute: z.boolean().default(false),
});
export type SurfaceField = z.infer<typeof SurfaceFieldSchema>;

export const SurfaceContractSchema = z.object({
  surfaceId: z.string().min(1),
  displayName: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  validDecisions: z.array(z.string()).min(1),
  inputFields: z.array(SurfaceFieldSchema).default([]),
  forbiddenOutputs: z.array(z.string()).default([]),
  safeFallback: z.string().default('deny'),
  maxAutonomyTier: AutonomyLevelSchema.default(3),
  protectedAttributeHazard: z.boolean().default(false),
  riskTier: RiskTierSchema.optional(),
});
export type SurfaceContract = z.infer<typeof SurfaceContractSchema>;

export const SurfaceContractRegistryFileSchema = z.object({
  version: z.string(),
  surfaces: z.array(SurfaceContractSchema),
});
export type SurfaceContractRegistryFile = z.infer<typeof SurfaceContractRegistryFileSchema>;

export const SurfaceContractRegistrySchema = SurfaceContractRegistryFileSchema;
export type SurfaceContractRegistryFileDocument = z.infer<typeof SurfaceContractRegistrySchema>;

export const SURFACE_CONTRACT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SurfaceContractRegistry',
  description: 'Decision Core surface contract definitions for policy validation',
  type: 'object' as const,
  required: ['version', 'surfaces'],
  properties: {
    version: { type: 'string' as const },
    surfaces: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        required: ['surfaceId', 'validDecisions'],
        properties: {
          surfaceId: { type: 'string' as const, minLength: 1 },
          displayName: { type: 'string' as const },
          category: { type: 'string' as const },
          description: { type: 'string' as const },
          validDecisions: { type: 'array' as const, items: { type: 'string' as const }, minItems: 1 },
          inputFields: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              required: ['name', 'type'],
              properties: {
                name: { type: 'string' as const, minLength: 1 },
                type: { type: 'string' as const, enum: SURFACE_FIELD_TYPES as unknown as string[] },
                required: { type: 'boolean' as const, default: false },
                description: { type: 'string' as const },
                enumValues: { type: 'array' as const, items: { type: 'string' as const } },
                protectedAttribute: { type: 'boolean' as const, default: false },
              },
            },
          },
          forbiddenOutputs: { type: 'array' as const, items: { type: 'string' as const }, default: [] },
          safeFallback: { type: 'string' as const, default: 'deny' },
          maxAutonomyTier: { type: 'integer' as const, minimum: 0, maximum: 5, default: 3 },
          protectedAttributeHazard: { type: 'boolean' as const, default: false },
          riskTier: { type: 'string' as const, enum: ['critical', 'intermediate', 'low'] },
        },
      },
    },
  },
} as const;
