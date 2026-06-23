/**
 * Memory Source Instructions
 *
 * Returns agent-readable instructions for querying each memory source.
 * Instructions tell the user's agent how to gather evidence and return
 * a MemoryEvidenceExport JSON to Decision Core.
 */

import type { MemorySourceKind } from '../../contracts/onboarding-profile.contracts.js';

export interface SourceInstruction {
  sourceKind: MemorySourceKind;
  title: string;
  querySteps: string[];
  exportFormat: string;
  searchTopics: string[];
  safetyNotes: string[];
}

const SHARED_SEARCH_TOPICS = [
  'agent tools and workflows',
  'business domain and operations',
  'compliance requirements (PII, finance, credentials, regulated data)',
  'blocked or denied action patterns',
  'existing policy or governance preferences',
  'data handling rules',
  'approval workflows',
];

const SHARED_SAFETY_NOTES = [
  'Do not include raw API keys, bearer tokens, or private keys in evidence items.',
  'Mark items as sensitive: true if they contain personal or confidential information.',
  'Limit summaries to 2000 characters. Reference source documents instead of copying them.',
  'Only query within the consented scope.',
];

export function getSourceInstructions(kind: MemorySourceKind): SourceInstruction | null {
  const instructions = SOURCE_INSTRUCTIONS[kind];
  return instructions ?? null;
}

export function getAllSourceInstructions(): SourceInstruction[] {
  return Object.values(SOURCE_INSTRUCTIONS);
}

export function getInstructionsForDetectedSources(
  detectedKinds: MemorySourceKind[],
): SourceInstruction[] {
  return detectedKinds
    .map((k) => getSourceInstructions(k))
    .filter((i): i is SourceInstruction => i !== null);
}

const SOURCE_INSTRUCTIONS: Partial<Record<MemorySourceKind, SourceInstruction>> = {
  gbrain: {
    sourceKind: 'gbrain',
    title: 'G-Brain / MemPalace Evidence Collection',
    querySteps: [
      'Use GBrainClient.search() with an empty or broad slugPrefix to find relevant pages.',
      'Search for each topic in the searchTopics list below.',
      'For each relevant result, extract a short summary (not the full page content).',
      'If MemPalace MCP is available, use mempalace_search and mempalace_kg_query tools.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: SHARED_SAFETY_NOTES,
  },

  mempalace: {
    sourceKind: 'mempalace',
    title: 'MemPalace Evidence Collection',
    querySteps: [
      'Use mempalace_search MCP tool to search for each topic.',
      'Use mempalace_kg_query for structured knowledge graph queries.',
      'Use mempalace_list_rooms and mempalace_list_drawers to understand memory organization.',
      'Extract short summaries from relevant drawers.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: SHARED_SAFETY_NOTES,
  },

  'openclaw-native': {
    sourceKind: 'openclaw-native',
    title: 'OpenClaw Native Memory Evidence Collection',
    querySteps: [
      'Read MEMORY.md in the workspace root for high-level context.',
      'Read recent memory/*.md daily note files (last 7-14 days).',
      'If openclaw memory search CLI is available, search for each topic.',
      'Check .openclaw/memory.json for structured memory config.',
      'Look for DREAMS.md for aspirational/planning context.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: SHARED_SAFETY_NOTES,
  },

  'hermes-built-in': {
    sourceKind: 'hermes-built-in',
    title: 'Hermes Built-in Memory Evidence Collection',
    querySteps: [
      'Read ~/.hermes/memories/MEMORY.md for agent memory.',
      'Read ~/.hermes/memories/USER.md for user profile.',
      'Check hermes memory status for provider state.',
      'Extract relevant context from memory files.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: SHARED_SAFETY_NOTES,
  },

  'hermes-active-provider': {
    sourceKind: 'hermes-active-provider',
    title: 'Hermes Active Provider Evidence Collection',
    querySteps: [
      'Read memory.provider from ~/.hermes/config.yaml.',
      'If provider supports search, use hermes memory search CLI.',
      'If provider supports export, use hermes memory export.',
      'Extract relevant results as evidence items.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: SHARED_SAFETY_NOTES,
  },

  'markdown-vault': {
    sourceKind: 'markdown-vault',
    title: 'Markdown / Obsidian Vault Evidence Collection',
    querySteps: [
      'Scan .md files in the user-specified vault path.',
      'Parse YAML frontmatter for structured metadata.',
      'Extract wikilinks and tags for topic discovery.',
      'Search file content for each topic in searchTopics.',
      'If Obsidian MCP is available, use its search tools.',
      'Limit scanning to recent files (last 30 days) unless directed otherwise.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: [
      ...SHARED_SAFETY_NOTES,
      'Respect vault access boundaries — only read from the consented vault path.',
      'Do not read files outside the specified vault directory.',
    ],
  },

  mem0: {
    sourceKind: 'mem0',
    title: 'Mem0 Evidence Collection',
    querySteps: [
      'Use Memory.search() or mem0 search CLI for each topic.',
      'If using the Mem0 API, pass search queries for each topic.',
      'Extract summaries from relevant memory entries.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: SHARED_SAFETY_NOTES,
  },

  honcho: {
    sourceKind: 'honcho',
    title: 'Honcho Evidence Collection',
    querySteps: [
      'Use peer.search() or peer.chat() for relevant user/entity context.',
      'Query session history for governance-related interactions.',
      'Extract profile or entity metadata if available.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: SHARED_SAFETY_NOTES,
  },

  'zep-graphiti': {
    sourceKind: 'zep-graphiti',
    title: 'Zep / Graphiti Evidence Collection',
    querySteps: [
      'Use Zep MCP tools or zep.memory.search() for relevant context.',
      'If Graphiti is configured, use graph.search() for entity/temporal evidence.',
      'Query for entity relationships relevant to governance.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: SHARED_SAFETY_NOTES,
  },

  'generic-mcp': {
    sourceKind: 'generic-mcp',
    title: 'Generic MCP Memory Evidence Collection',
    querySteps: [
      'Use the configured MCP memory tool (e.g., recall, search, query).',
      'Search for each topic in the searchTopics list.',
      'Extract summaries from relevant results.',
      'Construct a MemoryEvidenceExport JSON with the results.',
    ],
    exportFormat: 'memory-evidence-export',
    searchTopics: SHARED_SEARCH_TOPICS,
    safetyNotes: SHARED_SAFETY_NOTES,
  },
};
