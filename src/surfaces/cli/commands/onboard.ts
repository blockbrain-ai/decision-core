/**
 * onboard command — Interactive 5-phase onboarding interview.
 *
 * Usage: decision-core onboard [--json] [--output-dir <dir>]
 *
 * When --json is set, outputs the generated config as JSON.
 * When --output-dir is set, writes config files to that directory.
 * Otherwise, prints the generated YAML configs to stdout.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CliContext } from '../cli.js';
import { createReadline, askQuestion, type ReadlineInterface } from '../readline-helpers.js';
import { OnboardingService } from '../../../skills/onboarding/onboarding.service.js';
import type {
  OnboardingPhase,
} from '../../../contracts/onboarding.contracts.js';

async function runInteractivePhase(
  rl: ReadlineInterface,
  phase: OnboardingPhase,
  ctx: CliContext,
): Promise<Record<string, unknown>> {
  ctx.stdout(`\n--- Phase ${phase.phase}: ${phase.title} ---\n`);
  const answers: Record<string, unknown> = {};
  for (const q of phase.questions) {
    answers[q.id] = await askQuestion(rl, q);
  }
  return answers;
}

function buildPhase1Answers(raw: Record<string, unknown>): Record<string, unknown> {
  const toolsRaw = raw['agent_tools'];
  const tools = typeof toolsRaw === 'string'
    ? toolsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : toolsRaw;
  return {
    agentDescription: raw['agent_description'] as string,
    agentTools: tools,
    dataAccess: raw['data_access'],
    environment: raw['environment'],
  };
}

function buildPhase2Answers(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    highRiskTools: raw['high_risk_tools'],
    mediumRiskTools: raw['medium_risk_tools'],
    externalServices: raw['external_services'],
    canSpendMoney: raw['can_spend_money'],
    piiHandling: raw['pii_handling'],
  };
}

function buildPhase3Answers(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    riskProfile: raw['risk_profile'],
    teamSize: raw['team_size'],
    complianceRequirements: raw['compliance_requirements'],
    approvalWorkflow: raw['approval_workflow'],
  };
}

function buildPhase4Answers(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    providerMode: raw['provider_mode'],
    apiKeyEnvVar: raw['api_key_env_var'] || undefined,
    localEndpoint: raw['local_endpoint'] || undefined,
  };
}

export async function onboardCommand(ctx: CliContext): Promise<number> {
  const service = new OnboardingService();
  const tenantId = ctx.config?.tenantId ?? 'default';

  const { sessionId, phase: phase1 } = service.startOnboarding(tenantId);

  const rl = createReadline();

  try {
    ctx.stdout('Decision Core Onboarding');
    ctx.stdout('========================');
    ctx.stdout('This interview will generate your initial governance configuration.');

    // Phase 1
    const raw1 = await runInteractivePhase(rl, phase1, ctx);
    const p1 = buildPhase1Answers(raw1);
    const r1 = service.processPhaseAnswers(sessionId, 1, p1);

    // Phase 2
    const raw2 = await runInteractivePhase(rl, r1.nextPhase!, ctx);
    const p2 = buildPhase2Answers(raw2);
    const r2 = service.processPhaseAnswers(sessionId, 2, p2);

    // Phase 3
    const raw3 = await runInteractivePhase(rl, r2.nextPhase!, ctx);
    const p3 = buildPhase3Answers(raw3);
    const r3 = service.processPhaseAnswers(sessionId, 3, p3);

    // Phase 4
    const raw4 = await runInteractivePhase(rl, r3.nextPhase!, ctx);
    const p4 = buildPhase4Answers(raw4);
    const r4 = service.processPhaseAnswers(sessionId, 4, p4);

    const result = r4.result!;

    // Validate
    const validation = service.validateConfig(result.generatedConfig);
    if (!validation.valid) {
      ctx.stderr('\nWarnings in generated config:');
      for (const err of validation.errors) {
        ctx.stderr(`  - ${err}`);
      }
    }

    // Output
    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify(result, null, 2));
    } else {
      ctx.stdout('\n--- Generated Configuration ---\n');
      ctx.stdout('# policies.yaml');
      ctx.stdout(result.generatedConfig.policies);
      ctx.stdout('# surfaces.yaml');
      ctx.stdout(result.generatedConfig.surfaces);
      ctx.stdout('# decision-core.yaml (provider config)');
      ctx.stdout(result.generatedConfig.provider);
    }

    // Write to disk if --output-dir is set
    const outputDir = ctx.flags['output-dir'];
    if (typeof outputDir === 'string') {
      const dir = resolve(outputDir);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, 'policies.yaml'), result.generatedConfig.policies, 'utf-8');
      writeFileSync(resolve(dir, 'surfaces.yaml'), result.generatedConfig.surfaces, 'utf-8');
      writeFileSync(resolve(dir, 'decision-core.yaml'), result.generatedConfig.provider, 'utf-8');
      ctx.stdout(`\nConfig files written to ${dir}`);
    }

    return 0;
  } finally {
    rl.close();
  }
}
