#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workRoot = mkdtempSync(join(tmpdir(), 'decision-core-tarball-smoke-'));
const packDir = join(workRoot, 'pack');
const installDir = join(workRoot, 'install');

mkdirSync(packDir, { recursive: true });
mkdirSync(installDir, { recursive: true });

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    console.error(`Command failed: ${command} ${args.join(' ')}`);
    if (error.stdout) console.error(String(error.stdout));
    if (error.stderr) console.error(String(error.stderr));
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  run('npm', ['pack', '--pack-destination', packDir]);

  const packed = readdirSync(packDir).filter((name) => name.endsWith('.tgz'));
  assert(packed.length === 1, `Expected exactly one packed tarball, found ${packed.length}`);

  const tarballPath = join(packDir, packed[0]);
  const entries = run('tar', ['-tzf', tarballPath])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''));

  const required = [
    'package.json',
    'README.md',
    'LICENSE',
    'dist/src/index.js',
    'dist/src/index.d.ts',
    'dist/src/surfaces/cli/bin.js',
    'integrations/hermes/__init__.py',
    'integrations/hermes/decision_core_bridge.py',
    'integrations/hermes/hooks.py',
    'integrations/hermes/plugin.yaml',
    'integrations/hermes/requirements.txt',
  ];
  const missing = required.filter((entry) => !entries.includes(entry));
  assert(missing.length === 0, `Tarball missing required files: ${missing.join(', ')}`);

  const bannedPatterns = [
    { label: '.env', pattern: /^\.env(?:$|\.)/ },
    { label: 'node_modules', pattern: /^node_modules\// },
    { label: '.pipeline', pattern: /^\.pipeline\// },
    { label: '.artifacts', pattern: /^\.artifacts\// },
    { label: 'coverage', pattern: /^coverage\// },
    { label: 'database dumps', pattern: /\.(?:db|sqlite|sqlite3)$/i },
  ];
  const banned = entries.filter((entry) => bannedPatterns.some(({ pattern }) => pattern.test(entry)));
  assert(banned.length === 0, `Tarball contains banned paths: ${banned.join(', ')}`);

  run('npm', ['install', tarballPath, '--omit=optional', '--ignore-scripts'], { cwd: installDir });

  const sdkSmokePath = join(installDir, 'sdk-smoke.mjs');
  writeFileSync(sdkSmokePath, `
    import { ActionApprovalDecision, evaluate, quickStart } from '@decision-core/core';

    const denied = await evaluate(
      { action: 'delete_file', surface: 'api' },
      { denyUnknownDefault: true },
    );
    if (denied.decision !== 'deny') {
      throw new Error('Expected top-level evaluate() to deny unmatched action with denyUnknownDefault');
    }

    const dc = await quickStart({ tools: ['read_*', 'write_*', 'search_*'] });
    const allowed = await dc.evaluate(new ActionApprovalDecision('read_file')
      .withInputProvider(() => ({
        actionName: 'read_file',
        actionParams: { path: '/docs/readme.md' },
        requestedBy: 'tarball-smoke',
        riskIndicators: [],
      })),
    );
    if (allowed.verdict !== 'completed') {
      throw new Error('Expected quickStart read_file decision to complete');
    }

    const blocked = await dc.evaluate(new ActionApprovalDecision('delete_file')
      .withInputProvider(() => ({
        actionName: 'delete_file',
        actionParams: { path: '/data/report.csv' },
        requestedBy: 'tarball-smoke',
        riskIndicators: ['destructive'],
      })),
    );
    if (blocked.verdict !== 'blocked') {
      throw new Error('Expected quickStart delete_file decision to block');
    }
  `);
  run(process.execPath, [sdkSmokePath], { cwd: installDir });

  const cliHelp = run(process.execPath, [
    'node_modules/@decision-core/core/dist/src/surfaces/cli/bin.js',
    '--help',
  ], { cwd: installDir });
  assert(cliHelp.includes('decision-core') && cliHelp.includes('Commands:'), 'Packaged CLI help did not render');

  console.log(JSON.stringify({
    tarball: packed[0],
    fileCount: entries.length,
    required: required.length,
    sdk: 'ok',
    cli: 'ok',
  }));
} finally {
  if (process.env.KEEP_DECISION_CORE_TARBALL_SMOKE !== '1') {
    rmSync(workRoot, { recursive: true, force: true });
  } else {
    console.error(`Kept tarball smoke workspace: ${workRoot}`);
  }
}
