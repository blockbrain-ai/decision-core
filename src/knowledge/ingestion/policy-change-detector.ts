/**
 * Policy Change Detector
 *
 * Compares a new ingestion result against existing clauses (by clauseKey)
 * and produces a change report identifying added, modified, removed, and
 * unchanged clauses.
 */

import type { PolicyClause } from '../../contracts/clause.contracts.js';
import type { NormalizedClause } from './policy-clause-normalizer.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-change-detector');

export interface ChangeReport {
  added: NormalizedClause[];
  modified: ModifiedClause[];
  removed: PolicyClause[];
  unchanged: NormalizedClause[];
}

export interface ModifiedClause {
  previous: PolicyClause;
  current: NormalizedClause;
}

export function detectChanges(
  newClauses: NormalizedClause[],
  existingClauses: PolicyClause[],
): ChangeReport {
  const existingByKey = new Map<string, PolicyClause>();
  for (const clause of existingClauses) {
    existingByKey.set(clause.clauseKey, clause);
  }

  const newByKey = new Map<string, NormalizedClause>();
  for (const clause of newClauses) {
    newByKey.set(clause.clauseKey, clause);
  }

  const added: NormalizedClause[] = [];
  const modified: ModifiedClause[] = [];
  const unchanged: NormalizedClause[] = [];
  const removed: PolicyClause[] = [];

  // Check new clauses against existing
  for (const [key, newClause] of newByKey) {
    const existing = existingByKey.get(key);
    if (!existing) {
      added.push(newClause);
    } else if (existing.normalizedHash !== newClause.normalizedHash) {
      modified.push({ previous: existing, current: newClause });
    } else {
      unchanged.push(newClause);
    }
  }

  // Check for removed clauses
  for (const [key, existing] of existingByKey) {
    if (!newByKey.has(key)) {
      removed.push(existing);
    }
  }

  logger.info(
    {
      added: added.length,
      modified: modified.length,
      removed: removed.length,
      unchanged: unchanged.length,
    },
    'change detection complete',
  );

  return { added, modified, removed, unchanged };
}
