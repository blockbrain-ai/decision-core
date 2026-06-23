/**
 * Trust Policy Loader
 *
 * Loads and validates trust policy configuration from JSON.
 * Policies are loaded once at startup and cached in memory.
 */

import { createLogger } from '../utils/logger.js';
import {
  TrustPolicySchema,
  SurfaceBindingsConfigSchema,
  SurfaceRegistrySchema,
  type TrustPolicy,
  type TrustPolicyEntry,
  type SurfaceBindingsConfig,
  type SurfaceBinding,
  type SurfaceRegistry,
  type SurfaceRegistryEntry,
} from './trust.contracts.js';

const logger = createLogger('trust-policy');

export class TrustPolicyLoader {
  private policy: TrustPolicy | null = null;
  private bindingsConfig: SurfaceBindingsConfig | null = null;
  private registry: SurfaceRegistry | null = null;
  private policyIndex: Map<string, TrustPolicyEntry> = new Map();
  private bindingsIndex: Map<string, SurfaceBinding> = new Map();
  private registryIndex: Map<string, SurfaceRegistryEntry> = new Map();

  loadPolicy(data: unknown): TrustPolicy {
    const parsed = TrustPolicySchema.parse(data);
    this.policy = parsed;
    this.policyIndex.clear();
    for (const entry of parsed.policies) {
      this.policyIndex.set(entry.surfaceId, entry);
    }
    logger.info({ version: parsed.version, count: parsed.policies.length }, 'Trust policy loaded');
    return parsed;
  }

  loadBindings(data: unknown): SurfaceBindingsConfig {
    const parsed = SurfaceBindingsConfigSchema.parse(data);
    this.bindingsConfig = parsed;
    this.bindingsIndex.clear();
    for (const binding of parsed.bindings) {
      this.bindingsIndex.set(binding.surfaceId, binding);
    }
    logger.info({ version: parsed.version, count: parsed.bindings.length }, 'Surface bindings loaded');
    return parsed;
  }

  loadRegistry(data: unknown): SurfaceRegistry {
    const parsed = SurfaceRegistrySchema.parse(data);
    this.registry = parsed;
    this.registryIndex.clear();
    for (const entry of parsed.surfaces) {
      this.registryIndex.set(entry.surfaceId, entry);
    }
    logger.info({ version: parsed.version, count: parsed.surfaces.length }, 'Surface registry loaded');
    return parsed;
  }

  getPolicyEntry(surfaceId: string): TrustPolicyEntry | null {
    return this.policyIndex.get(surfaceId) ?? null;
  }

  getBinding(surfaceId: string): SurfaceBinding | null {
    return this.bindingsIndex.get(surfaceId) ?? null;
  }

  getRegistryEntry(surfaceId: string): SurfaceRegistryEntry | null {
    return this.registryIndex.get(surfaceId) ?? null;
  }

  getPolicy(): TrustPolicy | null {
    return this.policy;
  }

  getBindingsConfig(): SurfaceBindingsConfig | null {
    return this.bindingsConfig;
  }

  getSurfaceRegistry(): SurfaceRegistry | null {
    return this.registry;
  }

  isLoaded(): boolean {
    return this.policy !== null && this.bindingsConfig !== null;
  }
}
