/**
 * CLI Entry Point
 *
 * Shell-friendly interface to all Decision Core features.
 * Minimal arg parser — no external dependencies.
 */

import { createLogger } from '../../utils/logger.js';
import { loadCliConfig, type CliConfig } from './config-loader.js';
import { evaluateCommand } from './commands/evaluate.js';
import { auditCommand } from './commands/audit.js';
import { ingestCommand } from './commands/ingest.js';
import { compileCommand } from './commands/compile.js';
import { serveCommand } from './commands/serve.js';
import { providersCommand } from './commands/providers.js';
import { explainCommand } from './commands/explain.js';
import { onboardCommand } from './commands/onboard.js';
import { authorCommand } from './commands/author.js';
import { validateCommand } from './commands/validate.js';
import { lintCommand } from './commands/lint.js';
import { analyzeCommand } from './commands/analyze.js';
import { generateTestsCommand } from './commands/generate-tests.js';
import { setupCommand } from './commands/setup.js';
import { initCommand } from './commands/init.js';
import { rulesCommand } from './commands/rules.js';
import { addRuleCommand } from './commands/add-rule.js';
import { rescanCommand } from './commands/rescan.js';
import { historyCommand } from './commands/history.js';
import { observationsCommand } from './commands/observations.js';
import { rollbackCommand } from './commands/rollback.js';
import { doctorCommand } from './commands/doctor.js';
import { testScenariosCommand } from './commands/test-scenarios.js';
import { upgradeCommand } from './commands/upgrade.js';
import { provisionCommand } from './commands/provision.js';
import { orgCommand } from './commands/org.js';
import { conformanceCommand } from './commands/conformance.js';

const logger = createLogger('cli');

// ===========================================================================
// Arg Parsing
// ===========================================================================

export interface ParsedArgs {
  command: string;
  subcommand?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parse process.argv-style args into structured form.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip node + script
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }

  const command = positionals[0] || 'help';
  const subcommand = positionals.length > 1 ? positionals[1] : undefined;

  return { command, subcommand, positionals: positionals.slice(1), flags };
}

// ===========================================================================
// Command Dispatch
// ===========================================================================

const COMMANDS: Record<string, string> = {
  evaluate: 'Evaluate a decision against policies',
  audit: 'Run compliance audit with gap detection',
  ingest: 'Ingest a policy document',
  compile: 'Compile approved clauses into rules',
  serve: 'Start HTTP and/or MCP server',
  providers: 'Manage provider profiles (list|init|doctor|test|explain-routing)',
  explain: 'Explain a previous decision by correlation ID',
  onboard: 'Interactive onboarding interview to generate initial config',
  author: 'Author policy rules from natural language',
  validate: 'Validate a structured policy document',
  analyze: 'Analyze a policy pack for conflicting or ambiguous rules',
  lint: 'Lint a policy for errors, warnings, and suggestions',
  'generate-tests': 'Auto-generate test cases from compiled rules',
  setup: 'Agent-led onboarding with memory evidence and adaptive interview',
  init: 'Create starter decision-core.yaml and policy pack',
  rules: 'Manage policy rules (list|add|disable|enable)',
  'add-rule': 'Add a policy rule (alias for rules add)',
  rescan: 'Detect new tools and compare against existing rules',
  history: 'Show past decisions from the decision log',
  rollback: 'Restore previous policy-pack.yaml from backup',
  doctor: 'Verify install, config, pack, and evaluate health',
  'run-tests': 'Execute generated test scenarios against policy pack',
  upgrade: 'Upgrade profile mode and add mode-specific rules',
  provision: 'Provision per-agent configs from agents.yaml + access-policy.yaml',
  org: 'Organisation mode commands (init|report)',
  conformance: 'Run conformance scenarios and manage regression baselines',
  help: 'Show this help message',
};

function printHelp(): void {
  const lines = [
    'decision-core — CLI for Decision Core',
    '',
    'Usage: decision-core <command> [options]',
    '',
    'Commands:',
  ];

  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    lines.push(`  ${cmd.padEnd(14)} ${desc}`);
  }

  lines.push('', 'Global flags:', '  --config <path>  Path to config YAML (default: decision-core.yaml)');
  lines.push('  --json           Output as JSON');
  lines.push('  --help           Show help');
  lines.push('');

  process.stdout.write(lines.join('\n'));
}

// ===========================================================================
// CLI Runner
// ===========================================================================

export interface CliContext {
  config: CliConfig | undefined;
  flags: Record<string, string | boolean>;
  args: ParsedArgs;
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

/**
 * Main CLI execution function. Can be called programmatically for testing.
 */
export async function runCli(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.flags['help'] || args.command === 'help') {
    printHelp();
    return 0;
  }

  // Load config
  let config: CliConfig | undefined;
  try {
    const configPath = typeof args.flags['config'] === 'string' ? args.flags['config'] : undefined;
    config = loadCliConfig(configPath);
  } catch (err) {
    process.stderr.write(`Error loading config: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const ctx: CliContext = {
    config,
    flags: args.flags,
    args,
    stdout: (msg: string) => process.stdout.write(msg + '\n'),
    stderr: (msg: string) => process.stderr.write(msg + '\n'),
  };

  logger.debug({ command: args.command, subcommand: args.subcommand }, 'Dispatching command');

  try {
    switch (args.command) {
      case 'evaluate':
        return await evaluateCommand(ctx);
      case 'audit':
        return await auditCommand(ctx);
      case 'ingest':
        return await ingestCommand(ctx);
      case 'compile':
        return await compileCommand(ctx);
      case 'serve':
        return await serveCommand(ctx);
      case 'providers':
        return await providersCommand(ctx);
      case 'explain':
        return await explainCommand(ctx);
      case 'onboard':
        return await onboardCommand(ctx);
      case 'author':
        return await authorCommand(ctx);
      case 'validate':
        return await validateCommand(ctx);
      case 'analyze':
        return await analyzeCommand(ctx);
      case 'lint':
        return await lintCommand(ctx);
      case 'generate-tests':
        return await generateTestsCommand(ctx);
      case 'setup':
        return await setupCommand(ctx);
      case 'init':
        return await initCommand(ctx);
      case 'rules':
        return await rulesCommand(ctx);
      case 'add-rule':
        return await addRuleCommand(ctx);
      case 'rescan':
        return await rescanCommand(ctx);
      case 'history':
        return await historyCommand(ctx);
      case 'observations':
        return await observationsCommand(ctx);
      case 'rollback':
        return await rollbackCommand(ctx);
      case 'doctor':
        return await doctorCommand(ctx);
      case 'run-tests':
        return await testScenariosCommand(ctx);
      case 'upgrade':
        return await upgradeCommand(ctx);
      case 'provision':
        return await provisionCommand(ctx);
      case 'org':
        return await orgCommand(ctx);
      case 'conformance':
        return await conformanceCommand(ctx);
      default:
        ctx.stderr(`Unknown command: ${args.command}`);
        ctx.stderr('Run "decision-core help" for available commands.');
        return 1;
    }
  } catch (err) {
    logger.error({ err }, 'Command failed');
    ctx.stderr(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
