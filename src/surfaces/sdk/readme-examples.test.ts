/**
 * README Example Regression Tests
 *
 * These tests run the README's documented examples as close to verbatim as
 * possible. If an example in README.md changes, change it here too — the
 * point is that the published happy path provably works on a fresh install.
 *
 * Regression context: ActionApprovalDecision previously hard-coded
 * actionType='workflow.approve_action', so quickStart's per-tool allow rules
 * never matched and every README example returned 'blocked'.
 */

import { describe, it, expect } from 'vitest';
import { quickStart } from './quick-start.js';
import { ActionApprovalDecision } from '../../decisions/examples/action-approval.decision.js';

describe('README examples (verbatim happy path)', () => {
  it('front-page example: declared read is allowed, undeclared delete is blocked', async () => {
    const dc = await quickStart({
      tools: ['read_*', 'write_*', 'search_*'],
    });

    const denied = await dc.evaluate(new ActionApprovalDecision('delete_file')
      .withInputProvider(() => ({
        actionName: 'delete_file',
        actionParams: { path: '/data/report.csv' },
        requestedBy: 'agent-1',
        riskIndicators: ['destructive'],
      })),
    );
    expect(denied.verdict).toBe('blocked');

    const allowed = await dc.evaluate(new ActionApprovalDecision('read_file')
      .withInputProvider(() => ({
        actionName: 'read_file',
        actionParams: { path: '/docs/readme.md' },
        requestedBy: 'agent-1',
        riskIndicators: [],
      })),
    );
    expect(allowed.verdict).toBe('completed');
  });

  it('explain() works on a quickStart instance for a blocked decision', async () => {
    const dc = await quickStart({ tools: ['read_*'] });
    const blocked = await dc.evaluate(new ActionApprovalDecision('drop_table')
      .withInputProvider(() => ({
        actionName: 'drop_table',
        actionParams: {},
        requestedBy: 'agent-1',
        riskIndicators: [],
      })),
    );
    expect(blocked.verdict).toBe('blocked');
    const explanation = await dc.explain(blocked.correlationId);
    expect(explanation.verdict).toBe('deny');
    expect(explanation.summary.length).toBeGreaterThan(0);
  });

  it('default ActionApprovalDecision (no action name) stays backwards-compatible', () => {
    const decision = new ActionApprovalDecision();
    expect(decision.actionType).toBe('workflow.approve_action');
  });

  it('passing a plain object to dc.evaluate throws a helpful TypeError', async () => {
    const dc = await quickStart({ tools: ['read_*'] });
    await expect(
      // @ts-expect-error — deliberately wrong input shape, the common first mistake
      dc.evaluate({ surfaceId: 'agent', actionType: 'tool_call', toolName: 'read_file' }),
    ).rejects.toThrow(/BaseDecision/);
  });
});
