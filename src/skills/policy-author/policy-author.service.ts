/**
 * Policy Author Service
 *
 * Translates natural language descriptions into YAML policy rules.
 * Generated rules are ALWAYS drafts — never auto-activated.
 *
 * Two modes:
 *   1. Text-to-Policy: parse a single natural-language statement
 *   2. Document-to-Policy: extract multiple clauses from a policy document
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../../utils/logger.js';
import type {
  PolicyAuthorRequest,
  PolicyAuthorResult,
  CandidateRule,
  DocumentIngestionRequest,
  ReviewRequest,
  CommitResult,
  CandidateRuleStatus,
  ConfidenceLevel,
  RuleConflict,
} from '../../contracts/policy-author.contracts.js';

const logger = createLogger('policy-author');

// ===========================================================================
// Pattern Definitions
// ===========================================================================

interface RulePattern {
  /** Regex patterns that trigger this rule type */
  triggers: RegExp[];
  /** What type of rule this produces */
  ruleType: string;
  /** Generate the YAML rule from matched input */
  generate: (input: string, match: RegExpMatchArray) => GeneratedRule;
}

interface GeneratedRule {
  name: string;
  actionTypePattern: string;
  riskClass: 'A' | 'B' | 'C';
  enforcementPoint: 'pre_decision' | 'action_dispatch' | 'post_execution';
  policyType: 'safety' | 'compliance' | 'business' | 'resource' | 'quality';
  requireApproval: boolean;
  maxAmountUsd?: number;
  maxCountPerDay?: number;
  explanation: string;
  confidence: ConfidenceLevel;
  affectedTools: string[];
}

// ===========================================================================
// Tool Extraction Helpers
// ===========================================================================

const KNOWN_TOOL_PATTERNS: [string, string][] = [
  // More specific patterns first (order matters)
  ['drop the database', 'db.drop'],
  ['drop database', 'db.drop'],
  ['drop db', 'db.drop'],
  ['financial report', 'report.financial'],
  ['send email', 'email.send'],
  ['deploy to production', 'deploy.production'],
  ['deploy production', 'deploy.production'],
  ['database', 'db.*'],
  ['db', 'db.*'],
  ['drop', 'db.drop'],
  ['delete', '*.delete'],
  ['deploy', 'deploy.*'],
  ['production', 'deploy.production'],
  ['email', 'email.send'],
  ['payment', 'payment.*'],
  ['financial', 'payment.*'],
  ['money', 'payment.*'],
  ['file', 'file.*'],
  ['write', '*.write'],
  ['read', '*.read'],
  ['api', 'api.*'],
  ['report', 'report.*'],
  ['access', '*.read'],
];

function extractToolPattern(text: string): string {
  const lower = text.toLowerCase();
  for (const [keyword, pattern] of KNOWN_TOOL_PATTERNS) {
    if (lower.includes(keyword)) {
      return pattern;
    }
  }
  // Default: wildcard
  return '*';
}

function extractThreshold(text: string): number | undefined {
  const match = text.match(/(?:more than|over|exceeds?|above|greater than)\s+(\d+)/i);
  if (match) return parseInt(match[1], 10);
  const matchAmount = text.match(/\$\s*(\d[\d,]*)/);
  if (matchAmount) return parseInt(matchAmount[1].replace(/,/g, ''), 10);
  return undefined;
}

function extractRole(text: string): string | undefined {
  const match = text.match(/only\s+([\w\s]+?)\s+(?:can|should|may|are allowed)/i);
  if (match) return match[1].trim();
  return undefined;
}

// ===========================================================================
// Rule Patterns
// ===========================================================================

const RULE_PATTERNS: RulePattern[] = [
  // Deny pattern: "nobody should", "never", "must not", "no one", "do not"
  {
    triggers: [
      /\b(?:nobody|no\s*one|never|must\s*not|shall\s*not|should\s*not|do\s*not|don'?t|cannot|can'?t|prohibited|forbidden)\b/i,
    ],
    ruleType: 'deny',
    generate: (input: string) => {
      const toolPattern = extractToolPattern(input);
      return {
        name: `Deny: ${input.slice(0, 50)}`,
        actionTypePattern: toolPattern,
        riskClass: 'A',
        enforcementPoint: 'pre_decision',
        policyType: 'safety',
        requireApproval: false,
        explanation: `Blocks all actions matching "${toolPattern}". This is a hard deny — the action will be rejected without option for approval.`,
        confidence: toolPattern === '*' ? 'low' : 'high',
        affectedTools: [toolPattern],
      };
    },
  },

  // Approval required pattern: "needs approval", "requires sign-off", "must be approved"
  {
    triggers: [
      /\b(?:needs?\s+approval|requires?\s+(?:sign-?off|approval|review)|must\s+be\s+approved|approval\s+required|get\s+approval)\b/i,
    ],
    ruleType: 'approve_required',
    generate: (input: string) => {
      const toolPattern = extractToolPattern(input);
      const threshold = extractThreshold(input);
      return {
        name: `Approval required: ${input.slice(0, 50)}`,
        actionTypePattern: toolPattern,
        riskClass: 'B',
        enforcementPoint: 'pre_decision',
        policyType: 'business',
        requireApproval: true,
        maxCountPerDay: threshold,
        explanation: `Requires human approval before actions matching "${toolPattern}" can proceed.${threshold ? ` Triggered when count exceeds ${threshold}.` : ''}`,
        confidence: toolPattern === '*' ? 'low' : 'high',
        affectedTools: [toolPattern],
      };
    },
  },

  // Threshold pattern: "if more than N", "over N", "limit to N", "maximum N"
  {
    triggers: [
      /\b(?:more\s+than|over|exceeds?|above|greater\s+than|limit\s+(?:to|of)|maximum|max|at\s+most)\s+\d+/i,
      /\$\s*\d/,
    ],
    ruleType: 'threshold',
    generate: (input: string) => {
      const toolPattern = extractToolPattern(input);
      const threshold = extractThreshold(input);
      const isFinancial = /\b(?:payment|money|financial|cost|spend|\$|dollar|amount)\b/i.test(input);
      return {
        name: `Threshold: ${input.slice(0, 50)}`,
        actionTypePattern: toolPattern,
        riskClass: 'B',
        enforcementPoint: 'pre_decision',
        policyType: isFinancial ? 'compliance' : 'business',
        requireApproval: true,
        maxAmountUsd: isFinancial ? threshold : undefined,
        maxCountPerDay: !isFinancial ? threshold : undefined,
        explanation: `Requires approval when ${isFinancial ? `amount exceeds $${threshold}` : `count exceeds ${threshold}`} for actions matching "${toolPattern}".`,
        confidence: threshold ? 'high' : 'low',
        affectedTools: [toolPattern],
      };
    },
  },

  // Role-based pattern: "only X can", "restricted to X"
  {
    triggers: [
      /\b(?:only\s+[\w\s]+?\s+(?:can|should|may|are\s+allowed)|restricted\s+to|exclusive\s+to|limited\s+to)\b/i,
    ],
    ruleType: 'role_based',
    generate: (input: string) => {
      const toolPattern = extractToolPattern(input);
      const role = extractRole(input);
      return {
        name: `Role-based: ${input.slice(0, 50)}`,
        actionTypePattern: toolPattern,
        riskClass: 'A',
        enforcementPoint: 'pre_decision',
        policyType: 'compliance',
        requireApproval: false,
        explanation: `Restricts actions matching "${toolPattern}" to ${role ? `the "${role}" role` : 'authorized roles only'}. All other actors are denied.`,
        confidence: role && toolPattern !== '*' ? 'high' : 'medium',
        affectedTools: [toolPattern],
      };
    },
  },

  // Rate limit pattern: "no more than N per day/hour", "rate limit"
  {
    triggers: [
      /\b(?:no\s+more\s+than\s+\d+\s+per|rate\s+limit|per\s+(?:day|hour|minute)|times?\s+per)\b/i,
    ],
    ruleType: 'rate_limit',
    generate: (input: string) => {
      const toolPattern = extractToolPattern(input);
      const countMatch = input.match(/(\d+)\s+(?:per|times)/i);
      const count = countMatch ? parseInt(countMatch[1], 10) : undefined;
      return {
        name: `Rate limit: ${input.slice(0, 50)}`,
        actionTypePattern: toolPattern,
        riskClass: 'B',
        enforcementPoint: 'action_dispatch',
        policyType: 'resource',
        requireApproval: false,
        maxCountPerDay: count,
        explanation: `Limits actions matching "${toolPattern}" to ${count ?? 'a configured threshold'} per day.`,
        confidence: count ? 'high' : 'medium',
        affectedTools: [toolPattern],
      };
    },
  },

  // Time-based pattern: "only during", "business hours", "not after"
  {
    triggers: [
      /\b(?:only\s+during|business\s+hours|not\s+(?:after|before)|between\s+\d+|outside\s+(?:of\s+)?hours)\b/i,
    ],
    ruleType: 'time_window',
    generate: (input: string) => {
      const toolPattern = extractToolPattern(input);
      return {
        name: `Time window: ${input.slice(0, 50)}`,
        actionTypePattern: toolPattern,
        riskClass: 'B',
        enforcementPoint: 'pre_decision',
        policyType: 'business',
        requireApproval: true,
        explanation: `Restricts actions matching "${toolPattern}" to specified time windows. Actions outside the window require approval.`,
        confidence: 'medium',
        affectedTools: [toolPattern],
      };
    },
  },
];

// ===========================================================================
// Service
// ===========================================================================

interface AuthoringSession {
  id: string;
  candidateRules: Map<string, CandidateRule>;
  createdAt: string;
}

export class PolicyAuthorService {
  private sessions = new Map<string, AuthoringSession>();

  /**
   * Generate candidate rules from a natural language description.
   * Rules are ALWAYS drafts — never auto-activated.
   */
  authorFromText(request: PolicyAuthorRequest): PolicyAuthorResult {
    const { naturalLanguage, context } = request;
    logger.info({ inputLength: naturalLanguage.length }, 'Authoring from text');

    const statements = this.splitStatements(naturalLanguage);
    const candidateRules: CandidateRule[] = [];
    const warnings: string[] = [];
    const ambiguities: string[] = [];

    for (const statement of statements) {
      const result = this.processStatement(statement, context);
      if (result.rule) {
        candidateRules.push(result.rule);
      }
      if (result.warning) {
        warnings.push(result.warning);
      }
      if (result.ambiguity) {
        ambiguities.push(result.ambiguity);
      }
    }

    // Check for conflicts with existing rules
    if (context?.existingRules) {
      const conflicts = this.detectConflicts(candidateRules, context.existingRules);
      for (const conflict of conflicts) {
        warnings.push(
          `Rule "${conflict.candidateRuleId}" may conflict with existing rule "${conflict.conflictingRuleName}": ${conflict.reason}`,
        );
      }
    }

    // Store in session for later review/commit
    const sessionId = randomUUID();
    const session: AuthoringSession = {
      id: sessionId,
      candidateRules: new Map(candidateRules.map((r) => [r.id, r])),
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, session);

    logger.info(
      { sessionId, ruleCount: candidateRules.length, warningCount: warnings.length },
      'Authoring complete',
    );

    return { sessionId, candidateRules, warnings, ambiguities };
  }

  /**
   * Generate candidate rules from a policy document.
   * Splits document into clauses and processes each.
   */
  authorFromDocument(request: DocumentIngestionRequest): PolicyAuthorResult {
    const { documentContent, documentName, context } = request;
    logger.info({ documentName, contentLength: documentContent.length }, 'Authoring from document');

    // Extract clause-like statements from the document
    const clauses = this.extractDocumentClauses(documentContent);
    const candidateRules: CandidateRule[] = [];
    const warnings: string[] = [];
    const ambiguities: string[] = [];

    if (clauses.length === 0) {
      warnings.push('No actionable policy clauses found in document.');
      const emptySessionId = randomUUID();
      this.sessions.set(emptySessionId, {
        id: emptySessionId,
        candidateRules: new Map(),
        createdAt: new Date().toISOString(),
      });
      return { sessionId: emptySessionId, candidateRules, warnings, ambiguities };
    }

    for (const clause of clauses) {
      const result = this.processStatement(clause, context);
      if (result.rule) {
        candidateRules.push(result.rule);
      }
      if (result.warning) {
        warnings.push(result.warning);
      }
      if (result.ambiguity) {
        ambiguities.push(result.ambiguity);
      }
    }

    // Check for conflicts
    if (context?.existingRules) {
      const conflicts = this.detectConflicts(candidateRules, context.existingRules);
      for (const conflict of conflicts) {
        warnings.push(
          `Rule "${conflict.candidateRuleId}" may conflict with existing rule "${conflict.conflictingRuleName}": ${conflict.reason}`,
        );
      }
    }

    // Store session
    const sessionId = randomUUID();
    const session: AuthoringSession = {
      id: sessionId,
      candidateRules: new Map(candidateRules.map((r) => [r.id, r])),
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(sessionId, session);

    logger.info(
      { sessionId, clauseCount: clauses.length, ruleCount: candidateRules.length },
      'Document authoring complete',
    );

    return { sessionId, candidateRules, warnings, ambiguities };
  }

  /**
   * Review a candidate rule: accept, modify, or reject.
   */
  reviewRule(sessionId: string, review: ReviewRequest): CandidateRule {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const rule = session.candidateRules.get(review.ruleId);
    if (!rule) {
      throw new Error(`Rule not found: ${review.ruleId}`);
    }

    switch (review.action) {
      case 'accept':
        rule.status = 'accepted';
        break;
      case 'reject':
        rule.status = 'rejected';
        break;
      case 'modify':
        if (!review.modifiedYaml) {
          throw new Error('modifiedYaml is required for modify action');
        }
        rule.yamlContent = review.modifiedYaml;
        rule.status = 'accepted';
        break;
    }

    session.candidateRules.set(rule.id, rule);
    logger.info({ sessionId, ruleId: review.ruleId, action: review.action }, 'Rule reviewed');

    return rule;
  }

  /**
   * Commit accepted rules as draft policy rules in YAML format.
   * Rules are ALWAYS written with enabled: false (draft status).
   */
  commitRules(sessionId: string): CommitResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const accepted = Array.from(session.candidateRules.values()).filter(
      (r) => r.status === 'accepted',
    );

    if (accepted.length === 0) {
      return {
        committedRuleIds: [],
        policiesYaml: '',
        warnings: ['No accepted rules to commit.'],
      };
    }

    const warnings: string[] = [];
    const yamlLines: string[] = ['# Generated by Policy Author Skill (draft rules — not yet active)', 'rules:'];

    for (const rule of accepted) {
      yamlLines.push(rule.yamlContent);
    }

    const policiesYaml = yamlLines.join('\n');

    logger.info({ sessionId, committedCount: accepted.length }, 'Rules committed as drafts');

    return {
      committedRuleIds: accepted.map((r) => r.id),
      policiesYaml,
      warnings,
    };
  }

  /**
   * Get a session's current state.
   */
  getSession(sessionId: string): AuthoringSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List candidate rules in a session.
   */
  listRules(sessionId: string): CandidateRule[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return Array.from(session.candidateRules.values());
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private splitStatements(text: string): string[] {
    // Split on sentence boundaries and newlines
    const raw = text
      .split(/(?:\.\s+|\n+|;\s*)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);

    return raw.length > 0 ? raw : [text.trim()];
  }

  private processStatement(
    statement: string,
    _context?: { existingSurfaces?: string[]; existingTools?: string[]; existingRules?: string[] },
  ): { rule?: CandidateRule; warning?: string; ambiguity?: string } {
    // Try each pattern
    for (const pattern of RULE_PATTERNS) {
      for (const trigger of pattern.triggers) {
        const match = statement.match(trigger);
        if (match) {
          const generated = pattern.generate(statement, match);

          // If confidence is low, mark as needing human authoring
          if (generated.confidence === 'low' && generated.actionTypePattern === '*') {
            return {
              rule: this.buildCandidateRule(generated, statement, 'needs_human_policy_authoring', pattern.ruleType),
              ambiguity: `Ambiguous input: "${statement}". Could not determine specific tool or surface. Please clarify which tools or actions this rule applies to.`,
            };
          }

          return {
            rule: this.buildCandidateRule(generated, statement, 'draft', pattern.ruleType),
          };
        }
      }
    }

    // No pattern matched — ambiguous
    return {
      rule: this.buildAmbiguousRule(statement),
      ambiguity: `Could not interpret: "${statement}". No recognized policy pattern found. Please rephrase using patterns like "nobody should...", "needs approval", "only X can...", or "limit to N per day".`,
    };
  }

  private buildCandidateRule(
    generated: GeneratedRule,
    sourceText: string,
    status: CandidateRuleStatus,
    patternRuleType: string,
  ): CandidateRule {
    const id = randomUUID();
    const yamlContent = this.generateYaml(generated, id);

    return {
      id,
      yamlContent,
      explanation: generated.explanation,
      confidence: generated.confidence,
      status,
      sourceText,
      ruleType: patternRuleType,
      affectedSurfaces: [],
      affectedTools: generated.affectedTools,
    };
  }

  private buildAmbiguousRule(statement: string): CandidateRule {
    const id = randomUUID();
    return {
      id,
      yamlContent: `  # Unable to generate rule — needs human authoring\n  # Source: "${statement}"\n  # enabled: false  # DRAFT`,
      explanation: 'This statement could not be automatically interpreted into a policy rule. Please provide more specific language.',
      confidence: 'low',
      status: 'needs_human_policy_authoring',
      sourceText: statement,
      ruleType: 'unknown',
      affectedSurfaces: [],
      affectedTools: [],
    };
  }

  private generateYaml(rule: GeneratedRule, id: string): string {
    const lines: string[] = [];
    lines.push(`  - name: "${rule.name}"`);
    lines.push(`    id: "${id}"`);
    lines.push(`    actionTypePattern: "${rule.actionTypePattern}"`);
    lines.push(`    riskClass: ${rule.riskClass}`);
    lines.push(`    enforcementPoint: ${rule.enforcementPoint}`);
    lines.push(`    policyType: ${rule.policyType}`);
    lines.push(`    requireApproval: ${rule.requireApproval}`);
    if (rule.maxAmountUsd !== undefined) {
      lines.push(`    maxAmountUsd: ${rule.maxAmountUsd}`);
    }
    if (rule.maxCountPerDay !== undefined) {
      lines.push(`    maxCountPerDay: ${rule.maxCountPerDay}`);
    }
    lines.push(`    enabled: false  # DRAFT — must be explicitly activated`);

    return lines.join('\n');
  }

  private extractDocumentClauses(content: string): string[] {
    const clauses: string[] = [];

    // Split by common document structures
    const lines = content.split('\n');
    let currentClause = '';

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and headers
      if (!trimmed || /^#{1,6}\s/.test(trimmed)) {
        if (currentClause.length > 10) {
          clauses.push(currentClause.trim());
          currentClause = '';
        }
        continue;
      }

      // Bullet points and numbered items are individual clauses
      if (/^[-*•]\s|^\d+[.)]\s/.test(trimmed)) {
        if (currentClause.length > 10) {
          clauses.push(currentClause.trim());
        }
        currentClause = trimmed.replace(/^[-*•]\s|^\d+[.)]\s/, '');
        continue;
      }

      // Accumulate paragraph text
      currentClause += ' ' + trimmed;
    }

    // Don't forget the last clause
    if (currentClause.length > 10) {
      clauses.push(currentClause.trim());
    }

    // Filter to only actionable clauses (those matching at least one pattern or containing policy keywords)
    const policyKeywords = /\b(?:must|shall|should|may\s+not|prohibited|required|only|never|always|limit|restrict|approve|review|deny|block|allow)\b/i;
    return clauses.filter((c) => policyKeywords.test(c));
  }

  private detectConflicts(
    candidates: CandidateRule[],
    existingRuleNames: string[],
  ): RuleConflict[] {
    const conflicts: RuleConflict[] = [];

    // Reverse mapping: tool base → natural language keywords
    const toolKeywords: Record<string, string[]> = {
      db: ['database', 'db', 'sql'],
      deploy: ['deploy', 'deployment', 'release'],
      email: ['email', 'mail', 'message'],
      payment: ['payment', 'financial', 'money', 'transaction'],
      report: ['report', 'reporting'],
      file: ['file', 'document'],
      api: ['api', 'endpoint'],
    };

    for (const candidate of candidates) {
      for (const existingName of existingRuleNames) {
        const toolsInCandidate = candidate.affectedTools;
        const existingLower = existingName.toLowerCase();

        for (const tool of toolsInCandidate) {
          const toolBase = tool.split('.')[0];
          if (!toolBase || toolBase === '*') continue;

          // Direct match on tool base
          const keywords = toolKeywords[toolBase] ?? [toolBase];
          const hasOverlap = keywords.some((kw) => existingLower.includes(kw));

          if (hasOverlap) {
            conflicts.push({
              candidateRuleId: candidate.id,
              conflictingRuleId: existingName,
              conflictingRuleName: existingName,
              reason: `Both rules target "${toolBase}" actions — review for potential overlap or contradiction.`,
            });
          }
        }
      }
    }

    return conflicts;
  }
}
