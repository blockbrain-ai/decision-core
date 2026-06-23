import { hashCanonicalJson } from '../../utils/audit-hash.js';
import type { RuntimeRouteConfig, RuntimeSurfaceRoute } from '../types/runtime-config.js';
import { RuntimeRouteConfigSchema } from '../types/runtime-config.js';

export interface RouteConfigLoaderOptions {
  configJson: string;
}

export class EnterpriseRouteConfigLoader {
  private config: RuntimeRouteConfig | null = null;
  private surfaceMap: Map<string, RuntimeSurfaceRoute> = new Map();

  loadFromJson(configJson: string): RuntimeRouteConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configJson);
    } catch {
      throw new Error('Enterprise route config is not valid JSON');
    }

    const result = RuntimeRouteConfigSchema.safeParse(parsed);
    if (!result.success) {
      const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Enterprise route config validation failed: ${errors}`);
    }

    assertConfigIntegrity(result.data);

    this.config = result.data;
    this.surfaceMap.clear();
    for (const surface of this.config.surfaces) {
      this.surfaceMap.set(surface.surfaceId, surface);
    }

    return this.config;
  }

  loadFromObject(data: RuntimeRouteConfig): RuntimeRouteConfig {
    const result = RuntimeRouteConfigSchema.safeParse(data);
    if (!result.success) {
      const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Enterprise route config validation failed: ${errors}`);
    }

    assertConfigIntegrity(result.data);

    this.config = result.data;
    this.surfaceMap.clear();
    for (const surface of this.config.surfaces) {
      this.surfaceMap.set(surface.surfaceId, surface);
    }

    return this.config;
  }

  getConfig(): RuntimeRouteConfig | null {
    return this.config;
  }

  resolveSurfaceRoute(surfaceId: string): RuntimeSurfaceRoute | null {
    return this.surfaceMap.get(surfaceId) ?? null;
  }

  isLoaded(): boolean {
    return this.config !== null;
  }
}

function assertConfigIntegrity(config: RuntimeRouteConfig): void {
  const seen = new Set<string>();
  for (const surface of config.surfaces) {
    if (seen.has(surface.surfaceId)) {
      throw new Error(`Enterprise route config validation failed: duplicate surfaceId ${surface.surfaceId}`);
    }
    seen.add(surface.surfaceId);
  }

  const expectedHash = hashCanonicalJson({
    version: config.version,
    enterpriseId: config.enterpriseId,
    optimizerVersion: config.optimizerVersion,
    surfaces: config.surfaces,
  });

  if (config.configHash !== expectedHash) {
    throw new Error(
      `Enterprise route config validation failed: configHash mismatch; expected ${expectedHash}, got ${config.configHash}`,
    );
  }
}
