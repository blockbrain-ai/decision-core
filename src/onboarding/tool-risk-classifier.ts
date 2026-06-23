import type { ProfileTool, ToolRiskTier, DefaultAction } from '../contracts/onboarding-profile.contracts.js';

const HIGH_RISK_PATTERNS = [
  'delete', 'drop', 'rm', 'destroy', 'purge', 'admin', 'sudo',
  'deploy', 'payment', 'transfer', 'billing', 'refund',
];

const MEDIUM_RISK_PATTERNS = [
  'write', 'create', 'update', 'edit', 'send', 'contact',
  'publish', 'post', 'upload', 'execute', 'run', 'invoke',
];

const LOW_RISK_PATTERNS = [
  'read', 'list', 'get', 'fetch', 'search', 'query', 'view',
  'describe', 'count', 'status', 'check', 'ping',
];

export interface ToolCandidate {
  name: string;
  riskTier: ToolRiskTier;
  defaultAction: DefaultAction;
  isDetectionCandidate: true;
  matchedPattern: string;
}

export function classifyDetectedTools(toolNames: string[]): ToolCandidate[] {
  return toolNames.map((name) => classify(name));
}

function classify(name: string): ToolCandidate {
  const lower = name.toLowerCase();

  for (const p of HIGH_RISK_PATTERNS) {
    if (lower.includes(p)) {
      return { name, riskTier: 4, defaultAction: 'block', isDetectionCandidate: true, matchedPattern: p };
    }
  }

  for (const p of MEDIUM_RISK_PATTERNS) {
    if (lower.includes(p)) {
      return { name, riskTier: 2, defaultAction: 'ask', isDetectionCandidate: true, matchedPattern: p };
    }
  }

  for (const p of LOW_RISK_PATTERNS) {
    if (lower.includes(p)) {
      return { name, riskTier: 1, defaultAction: 'allow', isDetectionCandidate: true, matchedPattern: p };
    }
  }

  return { name, riskTier: 3, defaultAction: 'ask', isDetectionCandidate: true, matchedPattern: 'unknown' };
}

export function candidatesToProfileTools(candidates: ToolCandidate[]): ProfileTool[] {
  return candidates.map((c) => ({
    name: c.name,
    riskTier: c.riskTier,
    canSpendMoney: HIGH_RISK_PATTERNS.slice(7).some((p) => c.name.toLowerCase().includes(p)),
    canDeleteData: ['delete', 'drop', 'rm', 'destroy', 'purge'].some((p) => c.name.toLowerCase().includes(p)),
    canContactPeople: ['send', 'contact'].some((p) => c.name.toLowerCase().includes(p)),
    canPublishContent: ['publish', 'post'].some((p) => c.name.toLowerCase().includes(p)),
    canDeployCode: c.name.toLowerCase().includes('deploy'),
    accessesSensitiveData: false,
    defaultAction: c.defaultAction,
  }));
}
