export { ClauseApprovalService } from './clause-approval.service.js';
export type { ApprovalRecord, ApprovedClause, RejectedClause, SupersededClause } from './clause-approval.service.js';

export { ClauseVersionService } from './clause-version.service.js';
export type { ClauseVersion, VerificationResult } from './clause-version.service.js';

export { computeClauseHash, isValidTransition, transitionStatus, isEnforceable } from './clause.entity.js';

export { filterEnforceable, getEnforceableClauses } from './enforcement-guard.js';
