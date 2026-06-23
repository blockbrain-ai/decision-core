import { z } from 'zod';

export const AgentRegistrationSchema = z.object({
  agentId: z.string().min(1),
  displayName: z.string().min(1),
  humanOwner: z.string().optional(),
  roles: z.array(z.string()).min(1),
  surfaces: z.array(z.string()).default([]),
  personalBrain: z.string().optional(),
  authSubject: z.string().optional(),
  credentialRefs: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
});
export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>;

export const AgentRegistryConfigSchema = z.object({
  tenantId: z.string().default('default'),
  agents: z.array(AgentRegistrationSchema),
}).refine(
  (config) => {
    const subjects = config.agents
      .filter((a) => a.enabled && a.authSubject)
      .map((a) => a.authSubject!);
    return new Set(subjects).size === subjects.length;
  },
  { message: 'Duplicate authSubject across enabled agents' },
).refine(
  (config) => {
    const brains = config.agents
      .filter((a) => a.enabled && a.personalBrain)
      .map((a) => a.personalBrain!);
    return new Set(brains).size === brains.length;
  },
  { message: 'Personal brain ID must be unique per enabled agent' },
);
export type AgentRegistryConfig = z.infer<typeof AgentRegistryConfigSchema>;
