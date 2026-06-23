import type { CompiledRule, DecisionContext, RuleExpression } from './policy-rule-expression.types.js';
import type { TestCase } from './policy-rule-test-harness.js';

export interface ScenarioGeneratorOptions {
  includePositive?: boolean;
  includeNegative?: boolean;
  includeBoundary?: boolean;
  includeMissing?: boolean;
}

const DEFAULTS: Required<ScenarioGeneratorOptions> = {
  includePositive: true,
  includeNegative: true,
  includeBoundary: true,
  includeMissing: true,
};

export function generateScenarios(rules: CompiledRule[], options?: ScenarioGeneratorOptions): TestCase[] {
  const opts = { ...DEFAULTS, ...options };
  const cases: TestCase[] = [];

  for (const rule of rules) {
    cases.push(...generateForExpression(rule.id, rule.expression, opts));
  }

  return cases;
}

function generateForExpression(ruleId: string, expr: RuleExpression, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  switch (expr.type) {
    case 'threshold': return generateThreshold(ruleId, expr, opts);
    case 'range': return generateRange(ruleId, expr, opts);
    case 'enum_match': return generateEnumMatch(ruleId, expr, opts);
    case 'string_match': return generateStringMatch(ruleId, expr, opts);
    case 'boolean_required': return generateBooleanRequired(ruleId, expr, opts);
    case 'field_presence': return generateFieldPresence(ruleId, expr, opts);
    case 'sanctions_match': return generateSanctionsMatch(ruleId, expr, opts);
    case 'regex_match': return generateRegexMatch(ruleId, expr, opts);
    case 'date_range': return generateDateRange(ruleId, expr, opts);
    case 'amount_limit': return generateAmountLimit(ruleId, expr, opts);
    case 'count_limit': return generateCountLimit(ruleId, expr, opts);
    case 'role_required': return generateRoleRequired(ruleId, expr, opts);
    case 'jurisdiction_match': return generateJurisdictionMatch(ruleId, expr, opts);
    case 'list_membership': return generateListMembership(ruleId, expr, opts);
    case 'composite_and': return generateCompositeAnd(ruleId, expr, opts);
    case 'composite_or': return generateCompositeOr(ruleId, expr, opts);
  }
}

function tc(ruleId: string, name: string, context: DecisionContext, expectedPass: boolean): TestCase {
  return { name, context, expectedResults: [{ ruleId, expectedPass }] };
}

function generateThreshold(ruleId: string, expr: Extract<RuleExpression, { type: 'threshold' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, operator, value } = expr;
  const above = value + 1;
  const below = value - 1;

  if (opts.includePositive) {
    const passValue = operator === 'eq'
      ? value
      : ['gt', 'gte'].includes(operator)
        ? above
        : below;
    cases.push(tc(ruleId, `threshold:${field} ${operator} ${value} — pass`, { [field]: passValue }, true));
  }
  if (opts.includeNegative) {
    const failValue = operator === 'neq'
      ? value
      : ['gt', 'gte'].includes(operator)
        ? below
        : above;
    cases.push(tc(ruleId, `threshold:${field} ${operator} ${value} — fail`, { [field]: failValue }, false));
  }
  if (opts.includeBoundary) {
    const boundaryPass = ['gte', 'lte', 'eq'].includes(operator);
    cases.push(tc(ruleId, `threshold:${field} ${operator} ${value} — boundary`, { [field]: value }, boundaryPass));
  }
  if (opts.includeMissing) {
    cases.push(tc(ruleId, `threshold:${field} — missing`, {}, false));
  }
  return cases;
}

function generateRange(ruleId: string, expr: Extract<RuleExpression, { type: 'range' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, min, max, inclusive } = expr;
  const mid = (min + max) / 2;

  if (opts.includePositive) cases.push(tc(ruleId, `range:${field} in [${min},${max}] — inside`, { [field]: mid }, true));
  if (opts.includeNegative) {
    cases.push(tc(ruleId, `range:${field} — below`, { [field]: min - 1 }, false));
    cases.push(tc(ruleId, `range:${field} — above`, { [field]: max + 1 }, false));
  }
  if (opts.includeBoundary) {
    cases.push(tc(ruleId, `range:${field} — at min`, { [field]: min }, inclusive));
    cases.push(tc(ruleId, `range:${field} — at max`, { [field]: max }, inclusive));
  }
  if (opts.includeMissing) cases.push(tc(ruleId, `range:${field} — missing`, {}, false));
  return cases;
}

function generateEnumMatch(ruleId: string, expr: Extract<RuleExpression, { type: 'enum_match' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, allowedValues } = expr;

  if (opts.includePositive && allowedValues.length > 0) {
    cases.push(tc(ruleId, `enum:${field} — valid member`, { [field]: allowedValues[0] }, true));
  }
  if (opts.includeNegative) cases.push(tc(ruleId, `enum:${field} — invalid member`, { [field]: '__invalid__' }, false));
  if (opts.includeBoundary) cases.push(tc(ruleId, `enum:${field} — empty`, { [field]: '' }, false));
  if (opts.includeMissing) cases.push(tc(ruleId, `enum:${field} — missing`, {}, false));
  return cases;
}

function generateStringMatch(ruleId: string, expr: Extract<RuleExpression, { type: 'string_match' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, pattern, caseSensitive } = expr;

  if (opts.includePositive) cases.push(tc(ruleId, `string:${field} — exact`, { [field]: pattern }, true));
  if (opts.includeNegative) cases.push(tc(ruleId, `string:${field} — different`, { [field]: pattern + '_x' }, false));
  if (opts.includeBoundary) {
    const caseVariant = flipCase(pattern);
    if (caseVariant) cases.push(tc(ruleId, `string:${field} — wrong case`, { [field]: caseVariant }, !caseSensitive));
  }
  if (opts.includeMissing) cases.push(tc(ruleId, `string:${field} — missing`, {}, false));
  return cases;
}

function flipCase(value: string): string | null {
  const flipped = value
    .split('')
    .map((char) => {
      const lower = char.toLowerCase();
      const upper = char.toUpperCase();
      if (lower === upper) return char;
      return char === lower ? upper : lower;
    })
    .join('');
  return flipped === value ? null : flipped;
}

function generateBooleanRequired(ruleId: string, expr: Extract<RuleExpression, { type: 'boolean_required' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, requiredValue } = expr;

  if (opts.includePositive) cases.push(tc(ruleId, `bool:${field} — correct`, { [field]: requiredValue }, true));
  if (opts.includeNegative) cases.push(tc(ruleId, `bool:${field} — wrong`, { [field]: !requiredValue }, false));
  if (opts.includeMissing) cases.push(tc(ruleId, `bool:${field} — missing`, {}, false));
  return cases;
}

function generateFieldPresence(ruleId: string, expr: Extract<RuleExpression, { type: 'field_presence' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { fields, allRequired } = expr;

  if (opts.includePositive) {
    const ctx: DecisionContext = {};
    for (const f of fields) ctx[f] = 'present';
    cases.push(tc(ruleId, `presence — all present`, ctx, true));
  }
  if (opts.includeNegative) {
    if (allRequired && fields.length > 1) {
      const ctx: DecisionContext = { [fields[0]]: 'present' };
      cases.push(tc(ruleId, `presence — one missing`, ctx, false));
    } else if (!allRequired && fields.length > 0) {
      cases.push(tc(ruleId, `presence — all missing`, {}, false));
    }
  }
  if (opts.includeMissing) cases.push(tc(ruleId, `presence — all missing`, {}, allRequired ? false : false));
  return cases;
}

function generateSanctionsMatch(ruleId: string, expr: Extract<RuleExpression, { type: 'sanctions_match' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, sanctionsLists } = expr;

  if (opts.includePositive) {
    cases.push(tc(ruleId, `sanctions:${field} — not on list`, { [field]: 'safe_entity', _sanctionsData: Object.fromEntries(sanctionsLists.map((l) => [l, ['bad_entity']])) }, true));
  }
  if (opts.includeNegative) {
    cases.push(tc(ruleId, `sanctions:${field} — on list`, { [field]: 'bad_entity', _sanctionsData: Object.fromEntries(sanctionsLists.map((l) => [l, ['bad_entity']])) }, false));
  }
  if (opts.includeMissing) cases.push(tc(ruleId, `sanctions:${field} — missing`, {}, false));
  return cases;
}

function generateRegexMatch(ruleId: string, expr: Extract<RuleExpression, { type: 'regex_match' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, pattern } = expr;

  if (opts.includePositive) {
    const match = new RegExp(pattern).exec('test_match_123') ? 'test_match_123' : 'a';
    cases.push(tc(ruleId, `regex:${field} — matching`, { [field]: match }, new RegExp(pattern).test(match)));
  }
  if (opts.includeNegative) {
    cases.push(tc(ruleId, `regex:${field} — non-matching`, { [field]: '\x00' }, new RegExp(pattern).test('\x00')));
  }
  if (opts.includeMissing) cases.push(tc(ruleId, `regex:${field} — missing`, {}, false));
  return cases;
}

function generateDateRange(ruleId: string, expr: Extract<RuleExpression, { type: 'date_range' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, after, before } = expr;

  if (opts.includePositive) {
    const mid = after && before
      ? new Date((new Date(after).getTime() + new Date(before).getTime()) / 2).toISOString()
      : after ? new Date(new Date(after).getTime() + 86400000).toISOString()
      : before ? new Date(new Date(before).getTime() - 86400000).toISOString()
      : '2025-06-15T00:00:00Z';
    cases.push(tc(ruleId, `date:${field} — within`, { [field]: mid }, true));
  }
  if (opts.includeNegative && after) {
    cases.push(tc(ruleId, `date:${field} — before start`, { [field]: new Date(new Date(after).getTime() - 86400000).toISOString() }, false));
  }
  if (opts.includeNegative && before) {
    cases.push(tc(ruleId, `date:${field} — after end`, { [field]: new Date(new Date(before).getTime() + 86400000).toISOString() }, false));
  }
  if (opts.includeMissing) cases.push(tc(ruleId, `date:${field} — missing`, {}, false));
  return cases;
}

function generateAmountLimit(ruleId: string, expr: Extract<RuleExpression, { type: 'amount_limit' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, maxAmount, currency } = expr;
  const ctx = (val: number) => currency ? { [field]: val, [`${field}_currency`]: currency } : { [field]: val };

  if (opts.includePositive) cases.push(tc(ruleId, `amount:${field} — under`, ctx(maxAmount - 1), true));
  if (opts.includeBoundary) cases.push(tc(ruleId, `amount:${field} — at limit`, ctx(maxAmount), true));
  if (opts.includeNegative) cases.push(tc(ruleId, `amount:${field} — over`, ctx(maxAmount + 1), false));
  if (opts.includeBoundary && currency) cases.push(tc(ruleId, `amount:${field} — wrong currency`, { [field]: maxAmount - 1, [`${field}_currency`]: '__wrong__' }, false));
  if (opts.includeMissing) cases.push(tc(ruleId, `amount:${field} — missing`, {}, false));
  return cases;
}

function generateCountLimit(ruleId: string, expr: Extract<RuleExpression, { type: 'count_limit' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, maxCount } = expr;

  if (opts.includePositive) cases.push(tc(ruleId, `count:${field} — under`, { [field]: maxCount - 1 }, true));
  if (opts.includeBoundary) cases.push(tc(ruleId, `count:${field} — at limit`, { [field]: maxCount }, true));
  if (opts.includeNegative) cases.push(tc(ruleId, `count:${field} — over`, { [field]: maxCount + 1 }, false));
  if (opts.includeMissing) cases.push(tc(ruleId, `count:${field} — missing`, {}, false));
  return cases;
}

function generateRoleRequired(ruleId: string, expr: Extract<RuleExpression, { type: 'role_required' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, requiredRoles, anyOf } = expr;

  if (opts.includePositive) cases.push(tc(ruleId, `role:${field} — all roles`, { [field]: [...requiredRoles] }, true));
  if (opts.includeNegative) {
    if (anyOf) {
      cases.push(tc(ruleId, `role:${field} — none`, { [field]: ['__invalid__'] }, false));
    } else if (requiredRoles.length > 1) {
      cases.push(tc(ruleId, `role:${field} — some missing`, { [field]: [requiredRoles[0]] }, false));
    } else {
      cases.push(tc(ruleId, `role:${field} — none`, { [field]: ['__invalid__'] }, false));
    }
  }
  if (opts.includeBoundary) cases.push(tc(ruleId, `role:${field} — non-array`, { [field]: '__invalid__' }, false));
  if (opts.includeMissing) cases.push(tc(ruleId, `role:${field} — missing`, {}, false));
  return cases;
}

function generateJurisdictionMatch(ruleId: string, expr: Extract<RuleExpression, { type: 'jurisdiction_match' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, allowedJurisdictions } = expr;

  if (opts.includePositive && allowedJurisdictions.length > 0) {
    cases.push(tc(ruleId, `jurisdiction:${field} — allowed`, { [field]: allowedJurisdictions[0] }, true));
  }
  if (opts.includeNegative) cases.push(tc(ruleId, `jurisdiction:${field} — forbidden`, { [field]: '__forbidden__' }, false));
  if (opts.includeMissing) cases.push(tc(ruleId, `jurisdiction:${field} — missing`, {}, false));
  return cases;
}

function generateListMembership(ruleId: string, expr: Extract<RuleExpression, { type: 'list_membership' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];
  const { field, listId, mustBePresent } = expr;

  if (opts.includePositive) {
    if (mustBePresent) {
      cases.push(tc(ruleId, `list:${field} — present`, { [field]: 'item', _listData: { [listId]: ['item'] } }, true));
    } else {
      cases.push(tc(ruleId, `list:${field} — not present`, { [field]: 'other', _listData: { [listId]: ['item'] } }, true));
    }
  }
  if (opts.includeNegative) {
    if (mustBePresent) {
      cases.push(tc(ruleId, `list:${field} — absent`, { [field]: 'other', _listData: { [listId]: ['item'] } }, false));
    } else {
      cases.push(tc(ruleId, `list:${field} — present but forbidden`, { [field]: 'item', _listData: { [listId]: ['item'] } }, false));
    }
  }
  if (opts.includeMissing) cases.push(tc(ruleId, `list:${field} — missing`, {}, false));
  return cases;
}

function generateCompositeAnd(ruleId: string, expr: Extract<RuleExpression, { type: 'composite_and' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];

  if (opts.includePositive) {
    const ctx: DecisionContext = {};
    for (const sub of expr.rules) {
      const subCases = generateForExpression(ruleId, sub, { ...opts, includeNegative: false, includeBoundary: false, includeMissing: false });
      if (subCases.length > 0) Object.assign(ctx, subCases[0].context);
    }
    cases.push(tc(ruleId, `AND — all true`, ctx, true));
  }
  if (opts.includeNegative && expr.rules.length > 0) {
    const failCases = generateForExpression(ruleId, expr.rules[0], { ...opts, includePositive: false, includeBoundary: false, includeMissing: false });
    if (failCases.length > 0) {
      cases.push(tc(ruleId, `AND — one false`, failCases[0].context, false));
    }
  }
  return cases;
}

function generateCompositeOr(ruleId: string, expr: Extract<RuleExpression, { type: 'composite_or' }>, opts: Required<ScenarioGeneratorOptions>): TestCase[] {
  const cases: TestCase[] = [];

  if (opts.includePositive && expr.rules.length > 0) {
    const subCases = generateForExpression(ruleId, expr.rules[0], { ...opts, includeNegative: false, includeBoundary: false, includeMissing: false });
    if (subCases.length > 0) {
      cases.push(tc(ruleId, `OR — one true`, subCases[0].context, true));
    }
  }
  if (opts.includeNegative) {
    cases.push(tc(ruleId, `OR — all false`, {}, false));
  }
  return cases;
}
