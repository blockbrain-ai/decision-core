import { z } from 'zod';
import { RouteClassEnum } from './route-class.js';

export const RuntimeSurfaceRouteSchema = z.object({
  surfaceId: z.string().min(1),
  routeClass: RouteClassEnum,
  deterministicExtractorId: z.string().nullable(),
  confidenceThreshold: z.number().min(0).max(1),
  fallbackPattern: z.string(),
  frontierShadow: z.boolean(),
  humanReviewOnDisagreement: z.boolean(),
  policyEvidenceRequired: z.boolean(),
  scoreSummary: z.object({
    weightedTotal: z.number().min(0).max(1),
    hardBlockerCount: z.number().int().nonnegative(),
  }),
});

export type RuntimeSurfaceRoute = z.infer<typeof RuntimeSurfaceRouteSchema>;

export const RuntimeRouteConfigSchema = z.object({
  version: z.string().min(1),
  generatedAt: z.string().datetime(),
  enterpriseId: z.string().min(1),
  configHash: z.string().min(1),
  optimizerVersion: z.string().min(1),
  surfaces: z.array(RuntimeSurfaceRouteSchema),
});

export type RuntimeRouteConfig = z.infer<typeof RuntimeRouteConfigSchema>;
