/**
 * onboard command tests
 *
 * Tests the onboarding CLI command with simulated stdin input.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough, Writable } from 'node:stream';

function createMockStdin(answers: string[]): PassThrough {
  const stream = new PassThrough();
  let idx = 0;
  function feedNext(): void {
    if (idx < answers.length) {
      stream.write(answers[idx] + '\n');
      idx++;
      setTimeout(feedNext, 15);
    }
  }
  setTimeout(feedNext, 100);
  return stream;
}

describe('onboardCommand', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true });
    Object.defineProperty(process, 'stdout', { value: originalStdout, writable: true });
  });

  it('exports onboardCommand function', async () => {
    const mod = await import('./onboard.js');
    expect(typeof mod.onboardCommand).toBe('function');
  });

  it('completes interactive interview and outputs JSON', async () => {
    // 16 questions total across 4 phases
    const answers = [
      // Phase 1 (4 questions)
      'A deployment agent',        // agent_description: text
      'deploy,rollback',           // agent_tools: text
      '5',                         // data_access: multi_select -> index 5 = source_code
      '3',                         // environment: select -> index 3 = production
      // Phase 2 (5 questions; tools = ['deploy', 'rollback'])
      '1',                         // high_risk_tools: multi_select -> deploy
      '2',                         // medium_risk_tools: multi_select -> rollback
      'y',                         // external_services: confirm
      'y',                         // can_spend_money: confirm
      'n',                         // pii_handling: confirm
      // Phase 3 (4 questions)
      '3',                         // risk_profile: select -> enterprise
      '3',                         // team_size: select -> large
      '2',                         // compliance_requirements: multi_select -> sox
      '1',                         // approval_workflow: select -> block
      // Phase 4 (3 questions)
      '3',                         // provider_mode: select -> direct
      'API_KEY',                   // api_key_env_var: text
      '',                          // local_endpoint: text (empty -> default)
    ];

    const inputStream = createMockStdin(answers);
    const outputStream = new Writable({
      write(_chunk, _encoding, callback) { callback(); },
    });

    Object.defineProperty(process, 'stdin', { value: inputStream, writable: true });
    Object.defineProperty(process, 'stdout', { value: outputStream, writable: true });

    const { onboardCommand } = await import('./onboard.js');
    const output: string[] = [];

    const ctx = {
      config: { tenantId: 'test-tenant', persistence: 'memory' as const, tenantMode: 'single' as const },
      flags: { json: true } as Record<string, string | boolean>,
      args: { command: 'onboard', positionals: [] as string[], flags: { json: true } as Record<string, string | boolean>, subcommand: undefined },
      stdout: (msg: string) => output.push(msg),
      stderr: (_msg: string) => {},
    };

    const code = await onboardCommand(ctx);
    expect(code).toBe(0);

    // Header lines followed by JSON output
    const jsonLine = output.find((line) => line.startsWith('{'));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed.generatedConfig).toBeDefined();
    expect(parsed.generatedConfig.policies).toContain('deploy');
    expect(parsed.generatedConfig.surfaces).toBeDefined();
    expect(parsed.generatedConfig.provider).toBeDefined();
  }, 20000);
});
