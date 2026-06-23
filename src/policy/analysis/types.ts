/**
 * Policy Conflict Analysis Types
 *
 * Defines the data structures for detecting and reporting conflicts
 * within a PolicyPack.
 */

import type { PolicyPack, PolicyRuleDefinition, PackRuleAction } from '../../contracts/policy-pack.contracts.js';

export type ConflictType =
  | 'DirectConflict'
  | 'PriorityShadow'
  | 'AmbiguousPriority'
  | 'RoleConflict';

export type ConflictSeverity = 'low' | 'medium' | 'high';

export interface PolicyConflict {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  ruleIds: string[]; // Using index as id for now, or name if unique
  ruleNames: string[];
  description: string;
  suggestedFix: string;
  evidence: {
    overlappingPattern?: string;
    conflictingVerdicts?: PackRuleAction[];
    exampleContext?: Record<string, unknown>;
    priorityDifference?: number;
  };
}

export interface ConflictReport {
  hasConflicts: boolean;
  conflicts: PolicyConflict[];
  summary: {
    totalRules: number;
    conflictingRuleCount: number;
    highestSeverity: ConflictSeverity | null;
  };
  generatedAt: string;
  packName?: string;
  packVersion?: string;
}

/**
 * Options for conflict analysis.
 */
export interface ConflictAnalysisOptions {
  // Note: onConflict and includeDisabled are reserved for future use.
  // Currently the detector focuses on enabled rules and reports (does not auto-fail load).
}