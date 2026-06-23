/**
 * run-tests command — Execute generated test scenarios against the policy pack.
 *
 * Usage: decision-core run-tests [--scenarios <path>] [--json]
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { evaluate } from '../../sdk/evaluate.js';
import type { CliContext } from '../cli.js';

interface Scenario {
  name: string;
  input: { action: string; surface?: string; action_type?: string; tool_name?: string };
  expected: string;
}

export async function testScenariosCommand(ctx: CliContext): Promise<number> {
  const scenariosPath = typeof ctx.flags['scenarios'] === 'string'
    ? resolve(ctx.flags['scenarios'])
    : resolve(process.cwd(), '.decision-core', 'tests', 'generated-scenarios.json');

  if (!existsSync(scenariosPath)) {
    ctx.stderr(`Scenarios file not found: ${scenariosPath}`);
    ctx.stderr('Run "decision-core setup" to generate test scenarios.');
    return 1;
  }

  let scenarios: Scenario[];
  try {
    scenarios = JSON.parse(readFileSync(scenariosPath, 'utf-8'));
  } catch (err) {
    ctx.stderr(`Cannot parse scenarios: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const packPath = ctx.config?.policyPackPath
    ? resolve(ctx.config.policyPackPath)
    : resolve(process.cwd(), '.decision-core', 'policy-pack.yaml');

  if (!existsSync(packPath)) {
    ctx.stderr('No policy pack found. Run "decision-core init" or "decision-core setup" first.');
    return 1;
  }

  const legacyVocab = ['block', 'ask'];
  const legacyInput = scenarios.some((s) => s.input.action_type || s.input.tool_name);
  const legacyExpected = scenarios.some((s) => legacyVocab.includes(s.expected));

  if (legacyInput || legacyExpected) {
    ctx.stderr('Scenario file uses legacy format (action_type/tool_name or block/ask vocabulary).');
    ctx.stderr('Re-run "decision-core setup" to generate updated scenarios.');
    return 1;
  }

  let passed = 0;
  let failed = 0;
  const results: Array<{ name: string; expected: string; actual: string; pass: boolean }> = [];

  for (const scenario of scenarios) {
    const result = await evaluate(
      { action: scenario.input.action, surface: scenario.input.surface },
      { policyPackPath: packPath },
    );

    const pass = result.decision === scenario.expected;
    if (pass) passed++;
    else failed++;

    results.push({ name: scenario.name, expected: scenario.expected, actual: result.decision, pass });

    if (!ctx.flags['json']) {
      const icon = pass ? 'PASS' : 'FAIL';
      ctx.stdout(`  [${icon}] ${scenario.name}: expected=${scenario.expected} actual=${result.decision}`);
    }
  }

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({ passed, failed, total: scenarios.length, results }, null, 2));
  } else {
    ctx.stdout('');
    ctx.stdout(`${passed} passed, ${failed} failed out of ${scenarios.length} scenario(s).`);
  }

  return failed > 0 ? 1 : 0;
}
