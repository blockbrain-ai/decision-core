/**
 * Broken Deny Unknown — Allows unknown tools instead of denying by default.
 *
 * Mutation: The wrapper passes through the PDP result unchanged even when
 * no rules match, meaning unknown actions get an implicit "allow" instead
 * of the fail-secure "deny".
 * When swapped in, tool drift tests must fail because unknown actions are allowed.
 */

import type { PolicyDecisionPoint } from '../../src/policy/policy-decision-point.js';

/**
 * No-op wrapper: returns PDP result unchanged without intercepting
 * no-match allows. Unknown actions will be implicitly allowed.
 */
export function brokenWrapPdpDenyUnknown(inner: PolicyDecisionPoint): PolicyDecisionPoint {
  // BROKEN: Simply pass through — don't convert no-match allows to deny.
  return inner;
}
