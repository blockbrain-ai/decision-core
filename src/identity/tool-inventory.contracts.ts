import { z } from 'zod';

export const ToolEntrySchema = z.object({
  name: z.string().min(1),
  surface: z.string().default('*'),
  riskTier: z.number().int().min(1).max(5).default(3),
  allowedRoles: z.array(z.string()).default([]),
  approvalRole: z.string().optional(),
  description: z.string().default(''),
});
export type ToolEntry = z.infer<typeof ToolEntrySchema>;

export const ToolInventorySchema = z.object({
  version: z.string().default('1.0'),
  tools: z.array(ToolEntrySchema),
});
export type ToolInventory = z.infer<typeof ToolInventorySchema>;
