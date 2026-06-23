/**
 * providers command — Manage provider profiles.
 *
 * Subcommands:
 *   list             List configured provider profiles
 *   init             Initialize a provider profiles file
 *   doctor           Check config validity and reachability
 *   test             Run conformance tests on a provider
 *   explain-routing  Explain how a purpose would route to a provider
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  ProviderProfileSchema,
  ValidatedProviderProfileSchema,
  selectProfileForPurpose,
  PROVIDER_PURPOSES,
  type ProviderProfile,
  type ProviderPurpose,
} from '../../../core/provider-profiles.js';
import { runConformanceTests } from '../../../core/provider-conformance.js';
import type { ProviderPolicy } from '../../../core/provider-policy.js';
import { z } from 'zod';
import type { CliContext } from '../cli.js';

const DEFAULT_PROFILES_PATH = 'provider-profiles.yaml';

export async function providersCommand(ctx: CliContext): Promise<number> {
  const subcommand = ctx.args.subcommand ?? ctx.args.positionals[0];

  switch (subcommand) {
    case 'list':
      return listProfiles(ctx);
    case 'init':
      return initProfiles(ctx);
    case 'doctor':
      return doctorProfiles(ctx);
    case 'test':
      return await testProfile(ctx);
    case 'explain-routing':
      return explainRouting(ctx);
    default:
      ctx.stderr('Usage: decision-core providers <list|init|doctor|test|explain-routing>');
      return 1;
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function getProfilesPath(ctx: CliContext): string {
  const fromFlag = typeof ctx.flags['profiles'] === 'string' ? ctx.flags['profiles'] : undefined;
  const fromConfig = ctx.config?.provider?.profilesPath;
  return resolve(fromFlag ?? fromConfig ?? DEFAULT_PROFILES_PATH);
}

function loadProfiles(path: string): ProviderProfile[] {
  if (!existsSync(path)) {
    throw new Error(`Profiles file not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf-8');
  const parsed = parseYaml(raw);
  const ProfilesArraySchema = z.array(ProviderProfileSchema);
  return ProfilesArraySchema.parse(parsed);
}

// ===========================================================================
// Subcommands
// ===========================================================================

function listProfiles(ctx: CliContext): number {
  const path = getProfilesPath(ctx);

  let profiles: ProviderProfile[];
  try {
    profiles = loadProfiles(path);
  } catch (err) {
    ctx.stderr(`Cannot load profiles: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify(profiles, null, 2));
  } else {
    ctx.stdout(`Provider profiles (${profiles.length}):\n`);
    for (const p of profiles) {
      ctx.stdout(`  ${p.providerId}`);
      ctx.stdout(`    Model: ${p.modelId}`);
      ctx.stdout(`    Adapter: ${p.adapter}`);
      ctx.stdout(`    Purposes: ${p.purposes.join(', ')}`);
      ctx.stdout(`    Capabilities: ${p.capabilities.join(', ')}`);
      ctx.stdout(`    Data boundary: ${p.dataBoundary}`);
      ctx.stdout('');
    }
  }

  return 0;
}

function initProfiles(ctx: CliContext): number {
  const path = getProfilesPath(ctx);

  if (existsSync(path) && !ctx.flags['force']) {
    ctx.stderr(`Profiles file already exists: ${path}`);
    ctx.stderr('Use --force to overwrite.');
    return 1;
  }

  const template: ProviderProfile[] = [
    {
      providerId: 'example/model-v1',
      modelId: 'model-v1',
      adapter: 'disabled',
      purposes: ['general'],
      capabilities: ['structured-output'],
      dataBoundary: 'local',
      credentialSource: 'none',
      timeoutMs: 30000,
      maxRetries: 1,
    },
  ];

  writeFileSync(path, stringifyYaml(template), 'utf-8');
  ctx.stdout(`Created provider profiles template: ${path}`);
  return 0;
}

function doctorProfiles(ctx: CliContext): number {
  const path = getProfilesPath(ctx);

  let profiles: ProviderProfile[];
  try {
    profiles = loadProfiles(path);
  } catch (err) {
    ctx.stderr(`Cannot load profiles: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  let allValid = true;
  const issues: string[] = [];

  for (const profile of profiles) {
    const result = ValidatedProviderProfileSchema.safeParse(profile);
    if (!result.success) {
      allValid = false;
      for (const issue of result.error.issues) {
        issues.push(`${profile.providerId}: ${issue.path.join('.')} — ${issue.message}`);
      }
    }

    // Check env var availability for direct adapters
    if (profile.adapter === 'direct' && profile.envVarName) {
      if (!process.env[profile.envVarName]) {
        issues.push(`${profile.providerId}: env var ${profile.envVarName} is not set`);
        allValid = false;
      }
    }

    // Check endpoint presence for local adapters
    if (profile.adapter === 'local' && !profile.endpoint) {
      issues.push(`${profile.providerId}: local adapter missing endpoint`);
      allValid = false;
    }
  }

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({ valid: allValid, profiles: profiles.length, issues }, null, 2));
  } else {
    if (allValid) {
      ctx.stdout(`All ${profiles.length} provider profile(s) pass validation.`);
    } else {
      ctx.stdout(`Provider profile issues found:\n`);
      for (const issue of issues) {
        ctx.stdout(`  - ${issue}`);
      }
    }
  }

  return allValid ? 0 : 1;
}

async function testProfile(ctx: CliContext): Promise<number> {
  const path = getProfilesPath(ctx);
  const providerId = typeof ctx.flags['provider'] === 'string' ? ctx.flags['provider'] : ctx.args.positionals[1];

  if (!providerId) {
    ctx.stderr('Usage: decision-core providers test --provider <id>');
    return 1;
  }

  let profiles: ProviderProfile[];
  try {
    profiles = loadProfiles(path);
  } catch (err) {
    ctx.stderr(`Cannot load profiles: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const profile = profiles.find(p => p.providerId === providerId);
  if (!profile) {
    ctx.stderr(`Provider not found: ${providerId}`);
    return 1;
  }

  ctx.stdout(`Running conformance tests for ${providerId}...`);

  const defaultPolicy: ProviderPolicy = {
    allowedProviders: profiles.map(p => p.providerId),
    allowCrossLabFallback: false,
    sensitiveSurfaces: [],
    policyVersion: '1.0.0',
  };

  const report = await runConformanceTests(profile, {
    profiles,
    policy: defaultPolicy,
  });

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify(report, null, 2));
  } else {
    ctx.stdout(`\nVerdict: ${report.verdict}`);
    ctx.stdout('');
    for (const test of report.tests) {
      const icon = test.passed ? '+' : '-';
      ctx.stdout(`  [${icon}] ${test.testName} (${test.duration}ms)${test.error ? ` — ${test.error}` : ''}`);
    }
  }

  return report.verdict === 'usable' ? 0 : 1;
}

function explainRouting(ctx: CliContext): number {
  const path = getProfilesPath(ctx);
  const purpose = (typeof ctx.flags['purpose'] === 'string' ? ctx.flags['purpose'] : ctx.args.positionals[1]) as ProviderPurpose | undefined;

  if (!purpose || !(PROVIDER_PURPOSES as readonly string[]).includes(purpose)) {
    ctx.stderr(`Usage: decision-core providers explain-routing --purpose <${PROVIDER_PURPOSES.join('|')}>`);
    return 1;
  }

  let profiles: ProviderProfile[];
  try {
    profiles = loadProfiles(path);
  } catch (err) {
    ctx.stderr(`Cannot load profiles: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const selected = selectProfileForPurpose(profiles, purpose);

  if (ctx.flags['json']) {
    ctx.stdout(JSON.stringify({ purpose, selectedProvider: selected ?? null }, null, 2));
  } else {
    if (selected) {
      ctx.stdout(`Purpose: ${purpose}`);
      ctx.stdout(`Selected provider: ${selected.providerId}`);
      ctx.stdout(`  Model: ${selected.modelId}`);
      ctx.stdout(`  Adapter: ${selected.adapter}`);
      ctx.stdout(`  Match type: ${selected.purposes.includes(purpose) ? 'exact' : 'general-purpose fallback'}`);
    } else {
      ctx.stdout(`No provider available for purpose: ${purpose}`);
    }
  }

  return selected ? 0 : 1;
}
