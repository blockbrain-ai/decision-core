import { describe, it, expect } from 'vitest';
import { proposeRuleForTool, findUngovernedTools } from './rule-proposal.js';

describe('proposeRuleForTool — safe-default proposals for new tools', () => {
  it('proposes DENY for a high-risk tool (tier 4)', () => {
    const p = proposeRuleForTool('delete_database');
    expect(p.verdict).toBe('deny');
    expect(p.rule.defaultVerdict).toBe('deny');
    expect(p.rule.priority).toBe(90);
    expect(p.rule.applied).toBeUndefined(); // it's a proposal, not applied
  });

  it('proposes human APPROVAL for a state-changing tool (tier 2)', () => {
    const p = proposeRuleForTool('send_email');
    expect(p.verdict).toBe('approve_required');
    expect(p.rule.requireApproval).toBe(true);
  });

  it('proposes ALLOW for a read-only tool (tier 1)', () => {
    const p = proposeRuleForTool('read_file');
    expect(p.verdict).toBe('allow');
    expect(p.rule.defaultVerdict).toBeUndefined();
  });

  it('denyNew forces a deny proposal regardless of tier', () => {
    expect(proposeRuleForTool('read_file', { denyNew: true }).verdict).toBe('deny');
  });
});

describe('findUngovernedTools — policy drift detection', () => {
  it('flags tools with no matching exact or prefix-glob rule', () => {
    const ungoverned = findUngovernedTools(
      ['file.read', 'deploy.prod', 'file.write'],
      ['file.*', 'admin_*'],
    );
    // file.read/file.write are covered by file.* ; deploy.prod is not.
    expect(ungoverned).toEqual(['deploy.prod']);
  });

  it('returns [] when every tool is governed', () => {
    expect(findUngovernedTools(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});
