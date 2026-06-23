import { z } from 'zod';

export const AgentAuthBindingSchema = z.object({
  subject: z.string().min(1),
  salt: z.string().min(1).optional(),
  agentId: z.string().min(1),
  tenantId: z.string().default('default'),
  enabled: z.boolean().default(true),
});
export type AgentAuthBinding = z.infer<typeof AgentAuthBindingSchema>;

export const AgentAuthStoreSchema = z.object({
  bindings: z.array(AgentAuthBindingSchema),
});
export type AgentAuthStore = z.infer<typeof AgentAuthStoreSchema>;
