import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import {
  SurfaceContractSchema,
  SurfaceContractRegistryFileSchema,
  type SurfaceContract,
  type SurfaceField,
  type SurfaceFieldType,
} from './surface-contract.types.js';
import type { SurfaceRegistry } from '../../trust/trust.contracts.js';

export class SurfaceContractRegistry {
  private readonly surfaces = new Map<string, SurfaceContract>();

  register(contract: SurfaceContract): void {
    const parsed = SurfaceContractSchema.parse(contract);
    this.surfaces.set(parsed.surfaceId, parsed);
  }

  registerAll(contracts: SurfaceContract[]): void {
    for (const contract of contracts) {
      this.register(contract);
    }
  }

  get(surfaceId: string): SurfaceContract | undefined {
    return this.surfaces.get(surfaceId);
  }

  has(surfaceId: string): boolean {
    return this.surfaces.has(surfaceId);
  }

  getAllSurfaceIds(): string[] {
    return [...this.surfaces.keys()];
  }

  size(): number {
    return this.surfaces.size;
  }

  isValidDecision(surfaceId: string, decision: string): boolean {
    const contract = this.surfaces.get(surfaceId);
    if (!contract) return true;
    return contract.validDecisions.includes(decision);
  }

  isValidField(surfaceId: string, fieldName: string): boolean {
    const contract = this.surfaces.get(surfaceId);
    if (!contract) return true;
    if (contract.inputFields.length === 0) return true;
    return contract.inputFields.some((f) => f.name === fieldName);
  }

  getFieldType(surfaceId: string, fieldName: string): SurfaceFieldType | undefined {
    const contract = this.surfaces.get(surfaceId);
    if (!contract) return undefined;
    const field = contract.inputFields.find((f) => f.name === fieldName);
    return field?.type;
  }

  getProtectedFields(surfaceId: string): SurfaceField[] {
    const contract = this.surfaces.get(surfaceId);
    if (!contract) return [];
    return contract.inputFields.filter((f) => f.protectedAttribute);
  }

  isForbiddenOutput(surfaceId: string, output: string): boolean {
    const contract = this.surfaces.get(surfaceId);
    if (!contract) return false;
    return contract.forbiddenOutputs.includes(output);
  }

  loadFromFile(path: string): void {
    const raw = readFileSync(path, 'utf-8');
    const data = path.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
    const parsed = SurfaceContractRegistryFileSchema.parse(data);
    this.registerAll(parsed.surfaces);
  }

  mergeFromTrustRegistry(trustRegistry: SurfaceRegistry): void {
    for (const entry of trustRegistry.surfaces) {
      if (this.surfaces.has(entry.surfaceId)) continue;
      this.register({
        surfaceId: entry.surfaceId,
        displayName: entry.description,
        category: entry.category,
        description: entry.description,
        validDecisions: ['allow', 'deny', 'approve_required'],
        inputFields: [],
        forbiddenOutputs: [],
        safeFallback: 'deny',
        maxAutonomyTier: entry.riskTier === 'critical' ? 1 : entry.riskTier === 'intermediate' ? 3 : 5,
        protectedAttributeHazard: false,
        riskTier: entry.riskTier,
      });
    }
  }
}
