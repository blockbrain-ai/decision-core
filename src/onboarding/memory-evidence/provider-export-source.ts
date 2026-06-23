/**
 * Provider Export Source
 *
 * Registry of known provider export capabilities and helper functions
 * for constructing evidence export templates for each provider tier.
 */

import type { MemorySourceKind } from '../../contracts/onboarding-profile.contracts.js';
import type { MemoryEvidenceExport } from './memory-evidence.contracts.js';

// ===========================================================================
// Provider Tier
// ===========================================================================

export type ProviderTier = 0 | 1 | 2;

export interface ProviderExportCapability {
  kind: MemorySourceKind;
  tier: ProviderTier;
  supportsDirectRead: boolean;
  supportsMcpExport: boolean;
  supportsCliExport: boolean;
  supportsApiExport: boolean;
  requiresCredential: boolean;
  notes: string;
}

// ===========================================================================
// Registry
// ===========================================================================

const PROVIDER_CAPABILITIES: ProviderExportCapability[] = [
  { kind: 'gbrain', tier: 0, supportsDirectRead: true, supportsMcpExport: true, supportsCliExport: false, supportsApiExport: false, requiresCredential: false, notes: 'GBrainClient.search() with unrestricted slugPrefix for reads' },
  { kind: 'mempalace', tier: 0, supportsDirectRead: false, supportsMcpExport: true, supportsCliExport: false, supportsApiExport: false, requiresCredential: false, notes: 'MemPalace MCP tools: mempalace_search, mempalace_kg_query' },
  { kind: 'openclaw-native', tier: 0, supportsDirectRead: true, supportsMcpExport: false, supportsCliExport: true, supportsApiExport: false, requiresCredential: false, notes: 'Filesystem read of MEMORY.md, memory/*.md, openclaw memory search CLI' },
  { kind: 'hermes-built-in', tier: 0, supportsDirectRead: true, supportsMcpExport: false, supportsCliExport: true, supportsApiExport: false, requiresCredential: false, notes: 'Read ~/.hermes/memories/MEMORY.md, USER.md; hermes memory status' },
  { kind: 'hermes-active-provider', tier: 0, supportsDirectRead: false, supportsMcpExport: false, supportsCliExport: true, supportsApiExport: false, requiresCredential: false, notes: 'hermes memory search/export via active provider' },
  { kind: 'markdown-vault', tier: 0, supportsDirectRead: true, supportsMcpExport: true, supportsCliExport: false, supportsApiExport: false, requiresCredential: false, notes: 'Direct .md file scan or Obsidian MCP tools' },
  { kind: 'mem0', tier: 1, supportsDirectRead: false, supportsMcpExport: false, supportsCliExport: false, supportsApiExport: true, requiresCredential: true, notes: 'Memory.search() via Python/Node SDK or Hermes provider' },
  { kind: 'honcho', tier: 1, supportsDirectRead: false, supportsMcpExport: false, supportsCliExport: false, supportsApiExport: true, requiresCredential: true, notes: 'peer.search()/peer.chat() via SDK or Hermes provider' },
  { kind: 'zep-graphiti', tier: 1, supportsDirectRead: false, supportsMcpExport: true, supportsCliExport: false, supportsApiExport: true, requiresCredential: true, notes: 'Zep MCP tools or graph.search() via SDK' },
  { kind: 'supermemory', tier: 2, supportsDirectRead: false, supportsMcpExport: true, supportsCliExport: false, supportsApiExport: false, requiresCredential: true, notes: 'Cloud-hosted, OAuth. Agent uses MCP recall tool if configured.' },
  { kind: 'cognee', tier: 2, supportsDirectRead: false, supportsMcpExport: false, supportsCliExport: false, supportsApiExport: true, requiresCredential: true, notes: 'Requires database setup. Agent uses recall() if configured.' },
  { kind: 'letta', tier: 2, supportsDirectRead: false, supportsMcpExport: false, supportsCliExport: false, supportsApiExport: true, requiresCredential: true, notes: 'Agent framework. Export memory blocks if configured.' },
];

export function getProviderCapability(kind: MemorySourceKind): ProviderExportCapability | null {
  return PROVIDER_CAPABILITIES.find((p) => p.kind === kind) ?? null;
}

export function getProvidersByTier(tier: ProviderTier): ProviderExportCapability[] {
  return PROVIDER_CAPABILITIES.filter((p) => p.tier === tier);
}

export function getAllProviderCapabilities(): ProviderExportCapability[] {
  return [...PROVIDER_CAPABILITIES];
}

// ===========================================================================
// Export Template
// ===========================================================================

export function createExportTemplate(
  sourceId: string,
  sourceKind: MemorySourceKind,
): MemoryEvidenceExport {
  return {
    schemaVersion: 1,
    sourceId,
    sourceKind,
    collectedBy: 'user-agent',
    collectedAt: new Date().toISOString(),
    consent: {
      readGranted: false,
      writeBackGranted: false,
      scope: [],
    },
    items: [],
  };
}

export function isCredentialFreeSource(kind: MemorySourceKind): boolean {
  const cap = getProviderCapability(kind);
  return cap !== null && !cap.requiresCredential;
}
