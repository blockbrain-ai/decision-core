/**
 * Policy Conflict Detector
 *
 * Production-grade static analysis for detecting conflicting or ambiguous
 * rules within a PolicyPack.
 *
 * Focus for v1: Structural and priority-based conflicts on tool patterns
 * and actions.
 */

import type {
  PolicyPack,
  PolicyRuleDefinition,
  PackRuleAction,
} from '../../contracts/policy-pack.contracts.js';
import type {
  ConflictReport,
  PolicyConflict,
  ConflictAnalysisOptions,
} from './types.js';
import { globMatches } from '../glob-matcher.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';

/**
 * Returns true if two surface lists have any intersection.
 * Missing/empty surfaces or presence of '*' means "applies to all" → overlaps everything.
 * Disjoint surfaces (e.g. ["administrative"] vs ["phi"]) means the rules can never apply
 * to the same request → cannot be in conflict.
 */
function surfacesOverlap(sa: string[] | undefined, sb: string[] | undefined): boolean {
  const a = (!sa || sa.length === 0 || sa.includes('*')) ? ['*'] : sa;
  const b = (!sb || sb.length === 0 || sb.includes('*')) ? ['*'] : sb;
  if (a.includes('*') || b.includes('*')) return true;
  return a.some((s) => b.includes(s));
}

const DEFAULT_OPTIONS: Required<ConflictAnalysisOptions> = {
  onConflict: 'warn',
  includeDisabled: false,
};

/**
 * Main entry point: Analyze a policy pack for conflicts.
 */
export function analyzePolicyPack(
  pack: PolicyPack,
  options: ConflictAnalysisOptions = {}
): ConflictReport {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const enabledRules = pack.rules; // All rules considered enabled in current pack schema

  const conflicts: PolicyConflict[] = [];

  // 1. Detect Direct Conflicts and Ambiguous Priority on exact tool pattern matches
  conflicts.push(...detectDirectAndAmbiguousConflicts(enabledRules));

  // 2. Detect Priority Shadowing using glob overlap
  conflicts.push(...detectPriorityShadowing(enabledRules));

  // Deduplicate by rule pair + type
  const uniqueConflicts = deduplicateConflicts(conflicts);

  const highestSeverity = getHighestSeverity(uniqueConflicts);

  return {
    hasConflicts: uniqueConflicts.length > 0,
    conflicts: uniqueConflicts,
    summary: {
      totalRules: enabledRules.length,
      conflictingRuleCount: new Set(
        uniqueConflicts.flatMap((c) => c.ruleIds)
      ).size,
      highestSeverity,
    },
    generatedAt: new Date().toISOString(),
    packName: pack.name,
    packVersion: pack.version,
  };
}

/**
 * Detects cases where multiple rules have the exact same tool pattern
 * and produce conflicting actions, especially at same priority.
 */
function detectDirectAndAmbiguousConflicts(
  rules: PolicyRuleDefinition[]
): PolicyConflict[] {
  const conflicts: PolicyConflict[] = [];

  // Group by (tool pattern + surface) — rules on completely disjoint surfaces cannot conflict
  const groups = new Map<string, PolicyRuleDefinition[]>();

  for (const rule of rules) {
    const tools = rule.tools && rule.tools.length > 0 ? rule.tools : ['**'];
    const surfaces = rule.surfaces && rule.surfaces.length > 0 ? rule.surfaces : ['*'];

    for (const tool of tools) {
      for (const surface of surfaces) {
        const key = `${tool}|${surface}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(rule);
      }
    }
  }

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    const byAction = new Map<string, PolicyRuleDefinition[]>();
    for (const r of group) {
      if (!byAction.has(r.action)) byAction.set(r.action, []);
      byAction.get(r.action)!.push(r);
    }

    if (byAction.size > 1) {
      const all = group;
      const actions = Array.from(byAction.keys());

      // Skip if any conditions are present (amount tiers, time windows, dual-auth, cross-tenant,
      // audit requirements, etc.). Conditions make superficially-similar rules apply to disjoint
      // cases → not a structural conflict. Surface separation is already enforced by the
      // tool|surface grouping above (disjoint surfaces never share a group).
      const hasDifferentiatingConditions = all.some(
        (r) => r.conditions && Object.keys(r.conditions).length > 0
      );

      if (hasDifferentiatingConditions) {
        continue;
      }

      const priorities = new Set(all.map(r => r.priority ?? 0));
      const type = priorities.size === 1 ? 'AmbiguousPriority' : 'DirectConflict';

      const [toolPattern, surface] = key.split('|');

      conflicts.push({
        id: generateUuidV7(),
        type,
        severity: type === 'AmbiguousPriority' ? 'medium' : 'high',
        ruleIds: all.map((r, i) => r.name || `r${i}`),
        ruleNames: all.map(r => r.name),
        description: `Conflicting actions for tool "${toolPattern}" on surface "${surface}": ${actions.join(' vs ')}`,
        suggestedFix: 'Review priorities, conditions, or use more specific tool/surface patterns.',
        evidence: {
          overlappingPattern: key,
          conflictingVerdicts: actions as PackRuleAction[],
        },
      });
    }
  }

  return conflicts;
}

/**
 * Detects Priority Shadow conflicts: a lower priority rule is completely
 * overshadowed by a higher priority one with different action.
 */
function detectPriorityShadowing(
  rules: PolicyRuleDefinition[]
): PolicyConflict[] {
  const conflicts: PolicyConflict[] = [];

  for (let i = 0; i < rules.length; i++) {
    const ruleA = rules[i];
    const priA = ruleA.priority ?? 0;
    const toolsA = ruleA.tools ?? ['**'];
    const actionA = ruleA.action;

    for (let j = i + 1; j < rules.length; j++) {
      const ruleB = rules[j];
      const priB = ruleB.priority ?? 0;
      const toolsB = ruleB.tools ?? ['**'];
      const actionB = ruleB.action;

      if (actionA === actionB) continue;

      // Surface-aware: disjoint surfaces means the rules can never apply to the same request.
      // E.g. healthcare allow-admin-read on ["administrative"] vs approve-phi-access on ["phi"]
      // or team read/write rules on ["shared"] vs ["personal"]. These are not conflicts.
      if (!surfacesOverlap(ruleA.surfaces, ruleB.surfaces)) {
        continue;
      }

      // Check for glob overlap between any pair of tools (robust for common patterns)
      const hasOverlap = toolsA.some((tA) =>
        toolsB.some((tB) => globsCanOverlap(tA, tB) || tB.startsWith(tA.replace('*', '')))
      );

      if (hasOverlap) {
        const [higher, lower] =
          priA > priB
            ? [ruleA, ruleB]
            : priB > priA
              ? [ruleB, ruleA]
              : [null, null];

        if (higher && lower) {
          // Skip intentional priority layering (the normal way governance policies are written):
          // - Any higher-pri restricting action (deny or approve_required) over a lower rule is the
          //   intended "deny/approval wins" or carve-out pattern. Includes classic broad-allow + high-deny
          //   (personal), high-deny on admin surface shadowing lower approve-publish (team), and
          //   high-approve carve-out over broad lower deny on same surface (team admin-read).
          // - Conditions always differentiate (amount tiers, time windows, etc.).
          // - Surface-disjoint cases already skipped earlier.
          const higherIsRestricting = higher.action === 'deny' || higher.action === 'approve_required';
          const hasDifferentiatingConditions =
            (lower.conditions && Object.keys(lower.conditions).length > 0) ||
            (higher.conditions && Object.keys(higher.conditions).length > 0);

          if (higherIsRestricting || hasDifferentiatingConditions) {
            continue;
          }

          conflicts.push({
            id: generateUuidV7(),
            type: 'PriorityShadow',
            severity: 'medium',
            ruleIds: [higher.name || '', lower.name || ''],
            ruleNames: [higher.name, lower.name],
            description: `Rule "${lower.name}" (priority ${lower.priority ?? 0}) is shadowed by higher priority rule "${higher.name}" (priority ${higher.priority ?? 0}) with overlapping tool pattern. Different actions: ${higher.action} vs ${lower.action}.`,
            suggestedFix:
              'Review whether this shadowing is intentional. Consider adjusting priorities or patterns.',
            evidence: {
              overlappingPattern: `${toolsA.join(',')} overlaps with ${toolsB.join(',')}`,
              conflictingVerdicts: [higher.action, lower.action] as PackRuleAction[],
              priorityDifference: Math.abs(priA - priB),
            },
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Improved glob overlap detection for common policy patterns.
 * Handles *, **, and prefix/suffix cases used in Decision Core packs.
 */
function globsCanOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === '**' || b === '**') return true;

  const aParts = a.split('.');
  const bParts = b.split('.');

  // Check for ** wildcard which matches anything
  if (aParts.includes('**') || bParts.includes('**')) return true;

  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i++) {
    const aPart = aParts[i] ?? '';
    const bPart = bParts[i] ?? '';

    if (aPart === '*' || bPart === '*') continue;
    if (aPart === '' || bPart === '') continue; // different lengths but compatible so far

    if (aPart !== bPart) {
      return false;
    }
  }

  return true;
}

function deduplicateConflicts(conflicts: PolicyConflict[]): PolicyConflict[] {
  const seen = new Set<string>();
  return conflicts.filter((c) => {
    const key = [...c.ruleIds].sort().join('|') + '|' + c.type;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getHighestSeverity(
  conflicts: PolicyConflict[]
): 'low' | 'medium' | 'high' | null {
  if (conflicts.length === 0) return null;
  const severities = conflicts.map((c) => c.severity);
  if (severities.includes('high')) return 'high';
  if (severities.includes('medium')) return 'medium';
  return 'low';
}

/**
 * Convenience function to check if a pack has conflicts.
 */
export function hasConflicts(pack: PolicyPack, options?: ConflictAnalysisOptions): boolean {
  return analyzePolicyPack(pack, options).hasConflicts;
}
