/**
 * Compiled Rule Evaluator
 *
 * Evaluates compiled rules against a decision context.
 * Each rule expression type has a deterministic evaluation function
 * that returns pass/fail with evidence.
 */

import { createLogger } from '../../utils/logger.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';
import type {
  CompiledRule,
  DecisionContext,
  RuleEvalResult,
  RuleExpression,
} from './policy-rule-expression.types.js';
import type { EvalDiagnostic } from './compiler-diagnostics.js';

const logger = createLogger('compiled-rule-evaluator');

function getFieldValue(context: DecisionContext, field: string): unknown {
  const parts = field.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

interface EvalOutcome {
  passed: boolean;
  diagnostic: EvalDiagnostic;
}

function evaluateWithDiagnostic(ruleId: string, expression: RuleExpression, context: DecisionContext): EvalOutcome {
  switch (expression.type) {
    case 'threshold': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'number') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'threshold', fieldChecked: expression.field, valueFound: value, valueExpected: expression.value, operator: expression.operator, reason: `field '${expression.field}' is not a number (got ${typeof value})` } };
      }
      let passed: boolean;
      switch (expression.operator) {
        case 'gt': passed = value > expression.value; break;
        case 'gte': passed = value >= expression.value; break;
        case 'lt': passed = value < expression.value; break;
        case 'lte': passed = value <= expression.value; break;
        case 'eq': passed = value === expression.value; break;
        case 'neq': passed = value !== expression.value; break;
      }
      return { passed, diagnostic: { ruleId, expressionType: 'threshold', fieldChecked: expression.field, valueFound: value, valueExpected: expression.value, operator: expression.operator, reason: `${expression.field}=${value} ${expression.operator} ${expression.value} → ${passed ? 'pass' : 'fail'}` } };
    }

    case 'range': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'number') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'range', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a number` } };
      }
      const passed = expression.inclusive
        ? value >= expression.min && value <= expression.max
        : value > expression.min && value < expression.max;
      return { passed, diagnostic: { ruleId, expressionType: 'range', fieldChecked: expression.field, valueFound: value, valueExpected: `[${expression.min}, ${expression.max}]`, reason: `${expression.field}=${value} in ${expression.inclusive ? '[' : '('}${expression.min},${expression.max}${expression.inclusive ? ']' : ')'} → ${passed ? 'pass' : 'fail'}` } };
    }

    case 'enum_match': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'string') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'enum_match', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a string` } };
      }
      const passed = expression.allowedValues.includes(value);
      return { passed, diagnostic: { ruleId, expressionType: 'enum_match', fieldChecked: expression.field, valueFound: value, valueExpected: expression.allowedValues, reason: `'${value}' ${passed ? 'in' : 'not in'} [${expression.allowedValues.join(', ')}]` } };
    }

    case 'string_match': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'string') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'string_match', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a string` } };
      }
      const passed = expression.caseSensitive
        ? value === expression.pattern
        : value.toLowerCase() === expression.pattern.toLowerCase();
      return { passed, diagnostic: { ruleId, expressionType: 'string_match', fieldChecked: expression.field, valueFound: value, valueExpected: expression.pattern, reason: `'${value}' ${passed ? '==' : '!='} '${expression.pattern}' (caseSensitive=${expression.caseSensitive})` } };
    }

    case 'boolean_required': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'boolean') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'boolean_required', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a boolean` } };
      }
      const passed = value === expression.requiredValue;
      return { passed, diagnostic: { ruleId, expressionType: 'boolean_required', fieldChecked: expression.field, valueFound: value, valueExpected: expression.requiredValue, reason: `${expression.field}=${value}, required=${expression.requiredValue} → ${passed ? 'pass' : 'fail'}` } };
    }

    case 'field_presence': {
      const results = expression.fields.map((field) => {
        const value = getFieldValue(context, field);
        return value !== undefined && value !== null;
      });
      const passed = expression.allRequired ? results.every(Boolean) : results.some(Boolean);
      const missing = expression.fields.filter((_, i) => !results[i]);
      return { passed, diagnostic: { ruleId, expressionType: 'field_presence', reason: passed ? `All ${expression.allRequired ? 'required' : 'some'} fields present` : `Missing fields: ${missing.join(', ')}` } };
    }

    case 'sanctions_match': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'string') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'sanctions_match', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a string` } };
      }
      const sanctionsList = getFieldValue(context, '_sanctionsData') as Record<string, string[]> | undefined;
      if (!sanctionsList) {
        return { passed: true, diagnostic: { ruleId, expressionType: 'sanctions_match', fieldChecked: expression.field, valueFound: value, reason: 'No sanctions data available — pass by default' } };
      }
      for (const listName of expression.sanctionsLists) {
        const list = sanctionsList[listName];
        if (list && list.includes(value)) {
          return { passed: false, diagnostic: { ruleId, expressionType: 'sanctions_match', fieldChecked: expression.field, valueFound: value, reason: `'${value}' found on ${listName} sanctions list` } };
        }
      }
      return { passed: true, diagnostic: { ruleId, expressionType: 'sanctions_match', fieldChecked: expression.field, valueFound: value, reason: `'${value}' not on any sanctions list` } };
    }

    case 'regex_match': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'string') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'regex_match', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a string` } };
      }
      const regex = new RegExp(expression.pattern, expression.flags ?? '');
      const passed = regex.test(value);
      return { passed, diagnostic: { ruleId, expressionType: 'regex_match', fieldChecked: expression.field, valueFound: value, valueExpected: expression.pattern, reason: `'${value}' ${passed ? 'matches' : 'does not match'} /${expression.pattern}/${expression.flags ?? ''}` } };
    }

    case 'date_range': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'string') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'date_range', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a string` } };
      }
      const date = new Date(value).getTime();
      if (isNaN(date)) {
        return { passed: false, diagnostic: { ruleId, expressionType: 'date_range', fieldChecked: expression.field, valueFound: value, reason: `'${value}' is not a valid date` } };
      }
      if (expression.after) {
        const afterDate = new Date(expression.after).getTime();
        if (date <= afterDate) {
          return { passed: false, diagnostic: { ruleId, expressionType: 'date_range', fieldChecked: expression.field, valueFound: value, reason: `date ${value} is not after ${expression.after}` } };
        }
      }
      if (expression.before) {
        const beforeDate = new Date(expression.before).getTime();
        if (date >= beforeDate) {
          return { passed: false, diagnostic: { ruleId, expressionType: 'date_range', fieldChecked: expression.field, valueFound: value, reason: `date ${value} is not before ${expression.before}` } };
        }
      }
      return { passed: true, diagnostic: { ruleId, expressionType: 'date_range', fieldChecked: expression.field, valueFound: value, reason: `date ${value} within range` } };
    }

    case 'amount_limit': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'number') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'amount_limit', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a number` } };
      }
      if (expression.currency) {
        const currency = getFieldValue(context, `${expression.field}_currency`);
        if (currency !== expression.currency) {
          return { passed: false, diagnostic: { ruleId, expressionType: 'amount_limit', fieldChecked: expression.field, valueFound: value, reason: `currency mismatch: got '${currency}', expected '${expression.currency}'` } };
        }
      }
      const passed = value <= expression.maxAmount;
      return { passed, diagnostic: { ruleId, expressionType: 'amount_limit', fieldChecked: expression.field, valueFound: value, valueExpected: expression.maxAmount, operator: 'lte', reason: `${expression.field}=${value} <= ${expression.maxAmount} → ${passed ? 'pass' : 'fail'}` } };
    }

    case 'count_limit': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'number') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'count_limit', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a number` } };
      }
      const passed = value <= expression.maxCount;
      return { passed, diagnostic: { ruleId, expressionType: 'count_limit', fieldChecked: expression.field, valueFound: value, valueExpected: expression.maxCount, operator: 'lte', reason: `${expression.field}=${value} <= ${expression.maxCount} → ${passed ? 'pass' : 'fail'}` } };
    }

    case 'role_required': {
      const value = getFieldValue(context, expression.field);
      if (!Array.isArray(value)) {
        return { passed: false, diagnostic: { ruleId, expressionType: 'role_required', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not an array` } };
      }
      const passed = expression.anyOf
        ? expression.requiredRoles.some((role) => value.includes(role))
        : expression.requiredRoles.every((role) => value.includes(role));
      return { passed, diagnostic: { ruleId, expressionType: 'role_required', fieldChecked: expression.field, valueFound: value, valueExpected: expression.requiredRoles, reason: `roles ${JSON.stringify(value)} ${expression.anyOf ? 'anyOf' : 'allOf'} ${JSON.stringify(expression.requiredRoles)} → ${passed ? 'pass' : 'fail'}` } };
    }

    case 'jurisdiction_match': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'string') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'jurisdiction_match', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a string` } };
      }
      const passed = expression.allowedJurisdictions.includes(value);
      return { passed, diagnostic: { ruleId, expressionType: 'jurisdiction_match', fieldChecked: expression.field, valueFound: value, valueExpected: expression.allowedJurisdictions, reason: `'${value}' ${passed ? 'in' : 'not in'} allowed jurisdictions` } };
    }

    case 'list_membership': {
      const value = getFieldValue(context, expression.field);
      if (typeof value !== 'string') {
        return { passed: false, diagnostic: { ruleId, expressionType: 'list_membership', fieldChecked: expression.field, valueFound: value, reason: `field '${expression.field}' is not a string` } };
      }
      const lists = getFieldValue(context, '_listData') as Record<string, string[]> | undefined;
      if (!lists) {
        const passed = !expression.mustBePresent;
        return { passed, diagnostic: { ruleId, expressionType: 'list_membership', fieldChecked: expression.field, valueFound: value, reason: `No list data available, mustBePresent=${expression.mustBePresent} → ${passed ? 'pass' : 'fail'}` } };
      }
      const list = lists[expression.listId];
      if (!list) {
        const passed = !expression.mustBePresent;
        return { passed, diagnostic: { ruleId, expressionType: 'list_membership', fieldChecked: expression.field, valueFound: value, reason: `List '${expression.listId}' not found, mustBePresent=${expression.mustBePresent} → ${passed ? 'pass' : 'fail'}` } };
      }
      const isMember = list.includes(value);
      const passed = expression.mustBePresent ? isMember : !isMember;
      return { passed, diagnostic: { ruleId, expressionType: 'list_membership', fieldChecked: expression.field, valueFound: value, reason: `'${value}' ${isMember ? 'is' : 'is not'} in list '${expression.listId}', mustBePresent=${expression.mustBePresent} → ${passed ? 'pass' : 'fail'}` } };
    }

    case 'composite_and': {
      const subDiagnostics: EvalDiagnostic[] = [];
      let allPassed = true;
      for (const rule of expression.rules) {
        const outcome = evaluateWithDiagnostic(ruleId, rule, context);
        subDiagnostics.push(outcome.diagnostic);
        if (!outcome.passed) allPassed = false;
      }
      return { passed: allPassed, diagnostic: { ruleId, expressionType: 'composite_and', reason: `AND(${expression.rules.length} rules) → ${allPassed ? 'pass' : 'fail'}`, subDiagnostics } };
    }

    case 'composite_or': {
      const subDiagnostics: EvalDiagnostic[] = [];
      let anyPassed = false;
      for (const rule of expression.rules) {
        const outcome = evaluateWithDiagnostic(ruleId, rule, context);
        subDiagnostics.push(outcome.diagnostic);
        if (outcome.passed) anyPassed = true;
      }
      return { passed: anyPassed, diagnostic: { ruleId, expressionType: 'composite_or', reason: `OR(${expression.rules.length} rules) → ${anyPassed ? 'pass' : 'fail'}`, subDiagnostics } };
    }
  }
}

function collectInputFields(expression: RuleExpression, context: DecisionContext): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  switch (expression.type) {
    case 'composite_and':
    case 'composite_or':
      for (const rule of expression.rules) {
        Object.assign(fields, collectInputFields(rule, context));
      }
      break;
    case 'field_presence':
      for (const field of expression.fields) {
        fields[field] = getFieldValue(context, field) ?? null;
      }
      break;
    default: {
      const expr = expression as { field?: string };
      if (expr.field) {
        fields[expr.field] = getFieldValue(context, expr.field) ?? null;
      }
      break;
    }
  }

  return fields;
}

export interface CompiledRuleEvaluator {
  evaluate(rule: CompiledRule, context: DecisionContext): RuleEvalResult;
  evaluateAll(rules: CompiledRule[], context: DecisionContext): RuleEvalResult[];
}

export function createCompiledRuleEvaluator(): CompiledRuleEvaluator {
  return {
    evaluate(rule: CompiledRule, context: DecisionContext): RuleEvalResult {
      const inputFields = collectInputFields(rule.expression, context);
      const conditionHash = hashCanonicalJson(rule.expression);

      try {
        const outcome = evaluateWithDiagnostic(rule.id, rule.expression, context);
        return {
          passed: outcome.passed,
          ruleId: rule.id,
          clauseId: rule.clauseId,
          controlId: rule.controlId,
          inputFields,
          result: outcome.passed ? 'pass' : 'fail',
          diagnostic: outcome.diagnostic,
          conditionHash,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ ruleId: rule.id, error: message }, 'Rule evaluation error');
        return {
          passed: false,
          ruleId: rule.id,
          clauseId: rule.clauseId,
          controlId: rule.controlId,
          inputFields,
          result: 'error',
          errorMessage: message,
          conditionHash,
        };
      }
    },

    evaluateAll(rules: CompiledRule[], context: DecisionContext): RuleEvalResult[] {
      return rules.map((rule) => this.evaluate(rule, context));
    },
  };
}
