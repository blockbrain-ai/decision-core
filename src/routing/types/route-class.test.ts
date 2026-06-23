import { describe, it, expect } from 'vitest';
import { RouteClassEnum, ROUTE_CLASS_PRIORITY } from './route-class.js';

describe('RouteClassEnum', () => {
  it('parses valid route classes', () => {
    expect(RouteClassEnum.parse('deterministic_only')).toBe('deterministic_only');
    expect(RouteClassEnum.parse('frontier_or_human_required')).toBe('frontier_or_human_required');
    expect(RouteClassEnum.parse('not_ready_data_or_policy_gap')).toBe('not_ready_data_or_policy_gap');
  });

  it('rejects invalid route class', () => {
    expect(() => RouteClassEnum.parse('invalid')).toThrow();
  });

  it('has all route classes in priority map', () => {
    for (const value of RouteClassEnum.options) {
      expect(ROUTE_CLASS_PRIORITY[value]).toBeDefined();
    }
  });

  it('priority is ordered from deterministic (0) to not ready (6)', () => {
    expect(ROUTE_CLASS_PRIORITY['deterministic_only']).toBe(0);
    expect(ROUTE_CLASS_PRIORITY['not_ready_data_or_policy_gap']).toBe(6);
    expect(ROUTE_CLASS_PRIORITY['deterministic_only']).toBeLessThan(ROUTE_CLASS_PRIORITY['frontier_or_human_required']);
  });
});
