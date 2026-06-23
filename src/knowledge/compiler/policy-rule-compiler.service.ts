/**
 * Policy Rule Compiler Service
 *
 * Compiles approved clauses into deterministic enforcement guards.
 * Ambiguous clauses produce needs_human_policy_authoring, never guessed rules.
 * Only approved or active clauses can be compiled — drafts are rejected.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClause, PolicyControl } from '../../contracts/clause.contracts.js';
import type { ClauseRepository } from '../../persistence/interfaces/clause.repository.js';
import { createLogger } from '../../utils/logger.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import type {
  AmbiguousClause,
  CompiledRule,
  CompilationError,
  CompilationResult,
  RuleExpression,
  RuleType,
} from './policy-rule-expression.types.js';
import type { CompilerDiagnostic } from './compiler-diagnostics.js';
import type { StructuredCompilerInput } from '../authoring/structured-to-clause.js';

const logger = createLogger('policy-rule-compiler');

export interface ControlProvider {
  findByClauseId(tenantId: TenantId, clauseId: string): Promise<PolicyControl[]>;
}

export interface PolicyRuleCompiler {
  compile(tenantId: TenantId, clauseIds: string[]): Promise<CompilationResult>;
}

export interface StructuredCompilerInputProvider {
  findByClauseId(
    tenantId: TenantId,
    clauseId: string,
    clause: PolicyClause,
  ): Promise<StructuredCompilerInput | null | undefined>;
}

export interface PolicyRuleCompilerOptions {
  structuredInputProvider?: StructuredCompilerInputProvider;
}

interface ClausePattern {
  ruleType: RuleType;
  expression: RuleExpression;
  description: string;
}

function analyzeClauseForPattern(clause: PolicyClause, controls: PolicyControl[]): ClausePattern | null {
  // Attempt to derive a rule from the clause type and controls
  for (const control of controls) {
    const pattern = mapControlToExpression(clause, control);
    if (pattern) return pattern;
  }

  // Fall back to clause-type-based pattern matching
  return mapClauseTypeToExpression(clause);
}

function mapControlToExpression(_clause: PolicyClause, control: PolicyControl): ClausePattern | null {
  const params = control.parameters as Record<string, unknown>;

  switch (control.controlType) {
    case 'amount_threshold': {
      const field = (params['field'] as string) ?? 'amount';
      const maxAmount = params['maxAmount'] as number | undefined;
      const operator = params['operator'] as string | undefined;
      const value = params['value'] as number | undefined;

      if (maxAmount !== undefined) {
        return {
          ruleType: 'amount_limit',
          expression: {
            type: 'amount_limit',
            field,
            maxAmount,
            currency: params['currency'] as string | undefined,
          },
          description: `Amount limit: ${field} <= ${maxAmount}`,
        };
      }

      if (operator && value !== undefined) {
        return {
          ruleType: 'threshold',
          expression: {
            type: 'threshold',
            field,
            operator: operator as 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq',
            value,
          },
          description: `Threshold: ${field} ${operator} ${value}`,
        };
      }
      return null;
    }

    case 'sanctions_hold': {
      const field = (params['field'] as string) ?? 'entity_name';
      const lists = (params['sanctionsLists'] as string[]) ?? ['OFAC', 'EU', 'UN'];
      return {
        ruleType: 'sanctions_match',
        expression: {
          type: 'sanctions_match',
          field,
          sanctionsLists: lists,
        },
        description: `Sanctions check: ${field} against ${lists.join(', ')}`,
      };
    }

    case 'dual_authorization_required': {
      const field = (params['field'] as string) ?? 'approvers';
      const requiredRoles = (params['requiredRoles'] as string[]) ?? ['approver'];
      return {
        ruleType: 'role_required',
        expression: {
          type: 'role_required',
          field,
          requiredRoles,
          anyOf: false,
        },
        description: `Dual auth: requires roles ${requiredRoles.join(', ')}`,
      };
    }

    case 'evidence_field_required': {
      const fields = (params['fields'] as string[]) ?? [];
      if (fields.length === 0) return null;
      return {
        ruleType: 'field_presence',
        expression: {
          type: 'field_presence',
          fields,
          allRequired: true,
        },
        description: `Required fields: ${fields.join(', ')}`,
      };
    }

    case 'decision_label_forbidden': {
      const field = (params['field'] as string) ?? 'decision_label';
      const forbidden = (params['forbiddenValues'] as string[]) ?? [];
      if (forbidden.length === 0) return null;
      return {
        ruleType: 'list_membership',
        expression: {
          type: 'list_membership',
          field,
          listId: '_forbidden_decision_labels',
          mustBePresent: false,
        },
        description: `Forbidden labels: ${forbidden.join(', ')} — value must NOT be in this set`,
      };
    }
  }
}

function mapClauseTypeToExpression(clause: PolicyClause): ClausePattern | null {
  switch (clause.clauseType) {
    case 'threshold': {
      const match = clause.text.match(/(?:exceed|greater than|more than|above|over)\s+(\d+(?:\.\d+)?)/i);
      if (match) {
        return {
          ruleType: 'threshold',
          expression: {
            type: 'threshold',
            field: 'amount',
            operator: 'lte',
            value: parseFloat(match[1]!),
          },
          description: `Threshold from clause: must not exceed ${match[1]}`,
        };
      }
      const matchBelow = clause.text.match(/(?:below|less than|under|at most)\s+(\d+(?:\.\d+)?)/i);
      if (matchBelow) {
        return {
          ruleType: 'threshold',
          expression: {
            type: 'threshold',
            field: 'amount',
            operator: 'lt',
            value: parseFloat(matchBelow[1]!),
          },
          description: `Threshold from clause: must be below ${matchBelow[1]}`,
        };
      }
      return null;
    }

    case 'evidence_requirement': {
      const fieldMatch = clause.text.match(/require[sd]?\s+(?:the\s+)?(?:following\s+)?(?:evidence|fields?|documents?)[:\s]+([^.]+)/i);
      if (fieldMatch) {
        const fields = fieldMatch[1]!.split(/[,;]\s*/).map((f) => f.trim().replace(/\s+/g, '_').toLowerCase());
        return {
          ruleType: 'field_presence',
          expression: {
            type: 'field_presence',
            fields,
            allRequired: true,
          },
          description: `Evidence requirement: ${fields.join(', ')}`,
        };
      }
      return null;
    }

    case 'prohibition': {
      const jurisdictionMatch = clause.text.match(/(?:prohibited|forbidden|not allowed)\s+(?:in|for)\s+(.+)/i);
      if (jurisdictionMatch) {
        const jurisdictions = jurisdictionMatch[1]!.split(/[,;]\s*and\s*|[,;]\s*/).map((j) => j.trim());
        return {
          ruleType: 'jurisdiction_match',
          expression: {
            type: 'jurisdiction_match',
            field: 'jurisdiction',
            allowedJurisdictions: jurisdictions,
          },
          description: `Jurisdiction prohibition: ${jurisdictions.join(', ')}`,
        };
      }
      return null;
    }

    case 'approval_requirement': {
      const roleMatch = clause.text.match(/(?:approval|authorization)\s+(?:from|by)\s+(.+)/i);
      if (roleMatch) {
        const roles = roleMatch[1]!.split(/[,;]\s*and\s*|[,;]\s*/).map((r) => r.trim().replace(/\s+/g, '_').toLowerCase());
        return {
          ruleType: 'role_required',
          expression: {
            type: 'role_required',
            field: 'approvers',
            requiredRoles: roles,
            anyOf: false,
          },
          description: `Approval requirement: ${roles.join(', ')}`,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

export function createPolicyRuleCompiler(
  clauseRepository: ClauseRepository,
  controlProvider: ControlProvider,
  options: PolicyRuleCompilerOptions = {},
): PolicyRuleCompiler {
  return {
    async compile(tenantId: TenantId, clauseIds: string[]): Promise<CompilationResult> {
      const compiledRules: CompiledRule[] = [];
      const ambiguousClauses: AmbiguousClause[] = [];
      const errors: CompilationError[] = [];
      const diagnostics: CompilerDiagnostic[] = [];

      logger.info({ tenantId, clauseCount: clauseIds.length }, 'Starting compilation');

      for (const clauseId of clauseIds) {
        try {
          const clause = await clauseRepository.findById(tenantId, clauseId);

          if (!clause) {
            errors.push({ clauseId, error: 'Clause not found' });
            diagnostics.push({ clauseId, stage: 'clause_lookup', outcome: 'failed', message: 'Clause not found' });
            continue;
          }

          diagnostics.push({ clauseId, stage: 'clause_lookup', outcome: 'success', message: `Found clause: ${clause.clauseType}` });

          if (clause.status === 'draft') {
            errors.push({ clauseId, error: 'Cannot compile draft clause — must be approved or active' });
            diagnostics.push({ clauseId, stage: 'status_check', outcome: 'failed', message: 'Clause is draft — must be approved or active' });
            continue;
          }

          if (clause.status === 'superseded') {
            errors.push({ clauseId, error: 'Cannot compile superseded clause' });
            diagnostics.push({ clauseId, stage: 'status_check', outcome: 'failed', message: 'Clause is superseded' });
            continue;
          }

          diagnostics.push({ clauseId, stage: 'status_check', outcome: 'success', message: `Status: ${clause.status}` });

          const structuredInput = await options.structuredInputProvider?.findByClauseId(tenantId, clauseId, clause);
          if (structuredInput) {
            const rule: CompiledRule = {
              id: generateUuidV7(),
              clauseId,
              controlId: null,
              ruleType: structuredInput.expression.type,
              expression: structuredInput.expression,
              description: `Structured ${structuredInput.clauseType} clause${structuredInput.decision ? ` → ${structuredInput.decision}` : ''}`,
              compiledAt: new Date().toISOString(),
              sourceLineRef: structuredInput.sourceLineRef,
              surfaceId: structuredInput.surfaceId,
              authoringSchemaVersion: structuredInput.authoringSchemaVersion,
              decision: structuredInput.decision,
            };

            compiledRules.push(rule);
            diagnostics.push({
              clauseId,
              stage: 'structured_condition',
              outcome: 'success',
              message: `Compiled exact structured ${structuredInput.expression.type} expression without prose pattern matching`,
              matchedField: 'field' in structuredInput.expression
                ? (structuredInput.expression as { field: string }).field
                : undefined,
            });
            continue;
          }

          const controls = await controlProvider.findByClauseId(tenantId, clauseId);
          const pattern = analyzeClauseForPattern(clause, controls);

          if (!pattern) {
            ambiguousClauses.push({
              clauseId,
              reason: `Clause text does not match any known rule pattern and has no compilable controls`,
              status: 'needs_human_policy_authoring',
            });
            diagnostics.push({
              clauseId,
              stage: controls.length > 0 ? 'control_mapping' : 'pattern_match',
              outcome: 'ambiguous',
              message: 'No compilable pattern found',
              controlsFound: controls.length,
              patternAttempted: clause.clauseType,
            });
            continue;
          }

          diagnostics.push({
            clauseId,
            stage: controls.length > 0 ? 'control_mapping' : 'pattern_match',
            outcome: 'success',
            message: pattern.description,
            controlsFound: controls.length,
            patternAttempted: clause.clauseType,
            matchedField: 'field' in pattern.expression ? (pattern.expression as { field: string }).field : undefined,
          });

          const rule: CompiledRule = {
            id: generateUuidV7(),
            clauseId,
            controlId: controls.length > 0 ? controls[0]!.id : null,
            ruleType: pattern.ruleType,
            expression: pattern.expression,
            description: pattern.description,
            compiledAt: new Date().toISOString(),
          };

          compiledRules.push(rule);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ clauseId, error: message }, 'Compilation error');
          errors.push({ clauseId, error: message });
          diagnostics.push({ clauseId, stage: 'expression_build', outcome: 'failed', message });
        }
      }

      logger.info(
        { tenantId, compiled: compiledRules.length, ambiguous: ambiguousClauses.length, errors: errors.length },
        'Compilation complete',
      );

      return { compiledRules, ambiguousClauses, errors, diagnostics };
    },
  };
}
