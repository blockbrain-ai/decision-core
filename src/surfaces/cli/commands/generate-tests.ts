import { readFileSync, writeFileSync } from 'node:fs';
import type { CliContext } from '../cli.js';
import { generateScenarios } from '../../../knowledge/compiler/scenario-generator.js';
import type { CompiledRule } from '../../../knowledge/compiler/policy-rule-expression.types.js';

export async function generateTestsCommand(ctx: CliContext): Promise<number> {
  const ruleSetPath = typeof ctx.flags['rule-set'] === 'string' ? ctx.flags['rule-set'] : ctx.args.positionals[0];

  if (!ruleSetPath) {
    ctx.stderr('Usage: decision-core generate-tests --rule-set <path> [--output <path>]');
    return 1;
  }

  let rules: CompiledRule[];
  try {
    const raw = readFileSync(ruleSetPath, 'utf-8');
    const parsed = JSON.parse(raw);
    rules = Array.isArray(parsed) ? parsed : (parsed.rules ?? parsed.compiledRules ?? []);
  } catch (err) {
    ctx.stderr(`Cannot load rule set: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (rules.length === 0) {
    ctx.stderr('No compiled rules found in the input file.');
    return 1;
  }

  const scenarios = generateScenarios(rules);
  const output = JSON.stringify(scenarios, null, 2);

  const outputPath = typeof ctx.flags['output'] === 'string' ? ctx.flags['output'] : undefined;

  if (outputPath) {
    writeFileSync(outputPath, output, 'utf-8');
    ctx.stdout(`Generated ${scenarios.length} test cases → ${outputPath}`);
  } else {
    ctx.stdout(output);
  }

  return 0;
}
