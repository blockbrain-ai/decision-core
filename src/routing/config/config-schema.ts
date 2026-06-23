import { RuntimeRouteConfigSchema } from '../types/runtime-config.js';

export { RuntimeRouteConfigSchema };

export function validateRuntimeConfig(data: unknown): { valid: boolean; errors: string[] } {
  const result = RuntimeRouteConfigSchema.safeParse(data);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
  };
}
