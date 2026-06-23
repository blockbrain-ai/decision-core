/**
 * Edge Types Tests
 *
 * Validates edge type constraints for all 16 edge types.
 */

import { describe, it, expect } from 'vitest';
import {
  EDGE_TYPE_CONSTRAINTS,
  validateEdgeConstraints,
  ENTITY_TYPES,
  type EntityType,
} from './edge-types.js';
import { GRAPH_EDGE_TYPES } from '../../contracts/clause.contracts.js';

describe('edge-types', () => {
  describe('EDGE_TYPE_CONSTRAINTS', () => {
    it('defines constraints for all 16 edge types', () => {
      expect(Object.keys(EDGE_TYPE_CONSTRAINTS)).toHaveLength(16);
      for (const edgeType of GRAPH_EDGE_TYPES) {
        expect(EDGE_TYPE_CONSTRAINTS[edgeType]).toBeDefined();
        expect(EDGE_TYPE_CONSTRAINTS[edgeType].edgeType).toBe(edgeType);
      }
    });

    it('each constraint has valid source and target entity types', () => {
      for (const constraint of Object.values(EDGE_TYPE_CONSTRAINTS)) {
        expect(constraint.validSources.length).toBeGreaterThan(0);
        expect(constraint.validTargets.length).toBeGreaterThan(0);
        for (const s of constraint.validSources) {
          expect(ENTITY_TYPES).toContain(s);
        }
        for (const t of constraint.validTargets) {
          expect(ENTITY_TYPES).toContain(t);
        }
      }
    });
  });

  describe('validateEdgeConstraints', () => {
    it('allows valid clause-to-clause conflicts_with edge', () => {
      const result = validateEdgeConstraints('conflicts_with', 'clause', 'clause');
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('allows valid clause-to-surface constrains edge', () => {
      const result = validateEdgeConstraints('constrains', 'clause', 'surface');
      expect(result.valid).toBe(true);
    });

    it('allows valid clause-to-field requires_evidence edge', () => {
      const result = validateEdgeConstraints('requires_evidence', 'clause', 'field');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid source entity type', () => {
      const result = validateEdgeConstraints('conflicts_with', 'surface', 'clause');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not allow source entity type');
      expect(result.reason).toContain('surface');
    });

    it('rejects invalid target entity type', () => {
      const result = validateEdgeConstraints('requires_evidence', 'clause', 'surface');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not allow target entity type');
      expect(result.reason).toContain('surface');
    });

    it('validates all edge types allow at least one valid combination', () => {
      for (const [edgeType, constraint] of Object.entries(EDGE_TYPE_CONSTRAINTS)) {
        const result = validateEdgeConstraints(
          edgeType as any,
          constraint.validSources[0] as EntityType,
          constraint.validTargets[0] as EntityType,
        );
        expect(result.valid).toBe(true);
      }
    });
  });
});
