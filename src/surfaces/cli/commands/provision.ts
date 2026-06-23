import { resolve } from 'path';
import { provisionAgents, verifyProvision } from '../../../identity/provision-agent.js';
import type { CliContext } from '../cli.js';

export async function provisionCommand(ctx: CliContext): Promise<number> {
  const isVerify = ctx.flags['verify'] === true;

  const agentsFile = typeof ctx.flags['agents-file'] === 'string'
    ? ctx.flags['agents-file']
    : resolve('.decision-core', 'agents.yaml');
  const accessPolicyFile = typeof ctx.flags['access-policy'] === 'string'
    ? ctx.flags['access-policy']
    : resolve('.decision-core', 'access-policy.yaml');
  const outputDir = typeof ctx.flags['output'] === 'string'
    ? ctx.flags['output']
    : resolve('.decision-core', 'agents');
  const policyPackPath = typeof ctx.flags['policy-pack'] === 'string'
    ? ctx.flags['policy-pack']
    : ctx.config?.policyPackPath;

  if (isVerify) {
    return runVerify(ctx, agentsFile, accessPolicyFile, outputDir, policyPackPath);
  }

  return runProvision(ctx, agentsFile, accessPolicyFile, outputDir);
}

async function runProvision(
  ctx: CliContext,
  agentsFile: string,
  accessPolicyFile: string,
  outputDir: string,
): Promise<number> {
  try {
    const result = await provisionAgents(agentsFile, accessPolicyFile, outputDir);

    ctx.stdout(`Provisioned ${result.agentCount} agents.`);
    ctx.stdout(`Tokens generated: ${result.tokensGenerated}`);
    ctx.stdout(`Auth bindings: ${result.authBindingsWritten}`);
    for (const env of result.envFilesWritten) {
      ctx.stdout(`  env: ${env}`);
    }
    if (result.warnings.length > 0) {
      ctx.stderr(`\nWarnings:`);
      for (const w of result.warnings) {
        ctx.stderr(`  - ${w}`);
      }
    }

    return 0;
  } catch (err) {
    ctx.stderr(`Provision failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function runVerify(
  ctx: CliContext,
  agentsFile: string,
  accessPolicyFile: string,
  outputDir: string,
  policyPackPath?: string,
): Promise<number> {
  try {
    const result = await verifyProvision(agentsFile, accessPolicyFile, outputDir, policyPackPath);

    if (result.ok) {
      ctx.stdout('All agents compliant with access policy.');
      return 0;
    }

    if (result.violations.length > 0) {
      ctx.stderr('ACCESS POLICY VIOLATIONS:');
      for (const v of result.violations) {
        ctx.stderr(`  VIOLATION: ${v.agentId} has ${v.brain} mounted but ${v.reason}`);
      }
    }

    if (result.unknownTools.length > 0) {
      ctx.stderr('\nUNKNOWN TOOLS (no policy classification):');
      for (const t of result.unknownTools) {
        ctx.stderr(`  - ${t}`);
      }
    }

    if (result.warnings.length > 0) {
      ctx.stderr('\nWarnings:');
      for (const w of result.warnings) {
        ctx.stderr(`  - ${w}`);
      }
    }

    return 1;
  } catch (err) {
    ctx.stderr(`Verify failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
