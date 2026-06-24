/**
 * Shared observe→enforce promotion: backs up decision-core.yaml, flips the single
 * `enforcementMode` line to `enforce`, validates, and writes. Used by both the CLI
 * `enforce` command and the mutating MCP `dc_enforce` tool so they behave
 * identically (backup + diff + validate + rollback path). Never touches the policy
 * rules; refuses on an empty policy or an already-enforcing config.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { CliConfigSchema } from './config-loader.js';
import { createBackup } from './backup-utils.js';

export type PromoteResult =
  | { ok: true; alreadyEnforcing: true }
  | { ok: true; alreadyEnforcing: false; from: 'observe'; to: 'enforce' }
  | { ok: false; code: 'no_config' | 'invalid_config' | 'no_pack' | 'write_validation'; error: string };

/** Read-only check: can we promote, and is there anything to promote? */
export function inspectPromote(cwd: string): {
  exists: boolean;
  valid: boolean;
  alreadyEnforcing: boolean;
  hasPack: boolean;
} {
  const configPath = resolve(cwd, 'decision-core.yaml');
  if (!existsSync(configPath)) return { exists: false, valid: false, alreadyEnforcing: false, hasPack: false };
  const parsed = CliConfigSchema.safeParse(parseYaml(readFileSync(configPath, 'utf-8')));
  if (!parsed.success) return { exists: true, valid: false, alreadyEnforcing: false, hasPack: false };
  const hasPack = !!parsed.data.policyPackPath || existsSync(resolve(cwd, '.decision-core', 'policy-pack.yaml'));
  return { exists: true, valid: true, alreadyEnforcing: parsed.data.enforcementMode === 'enforce', hasPack };
}

/** Flip observe→enforce with backup + validation. Mutates decision-core.yaml. */
export function flipToEnforce(cwd: string): PromoteResult {
  const configPath = resolve(cwd, 'decision-core.yaml');
  if (!existsSync(configPath)) {
    return { ok: false, code: 'no_config', error: 'No decision-core.yaml found. Run `decision-core setup` first.' };
  }
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = CliConfigSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    return { ok: false, code: 'invalid_config', error: `decision-core.yaml is invalid: ${parsed.error.message}` };
  }
  if (parsed.data.enforcementMode === 'enforce') {
    return { ok: true, alreadyEnforcing: true };
  }
  const hasPack = !!parsed.data.policyPackPath || existsSync(resolve(cwd, '.decision-core', 'policy-pack.yaml'));
  if (!hasPack) {
    return { ok: false, code: 'no_pack', error: 'No policy pack configured — refusing to enforce an empty policy.' };
  }

  createBackup([configPath], 'enforce', resolve(cwd, '.decision-core'));
  const updated = /enforcementMode:\s*['"]?observe['"]?/.test(raw)
    ? raw.replace(/enforcementMode:\s*['"]?observe['"]?/, 'enforcementMode: enforce')
    : `${raw}${raw.endsWith('\n') ? '' : '\n'}enforcementMode: enforce\n`;

  const revalidate = CliConfigSchema.safeParse(parseYaml(updated));
  if (!revalidate.success || revalidate.data.enforcementMode !== 'enforce') {
    return {
      ok: false,
      code: 'write_validation',
      error: `Updated config did not validate as enforce (${revalidate.success ? 'mode mismatch' : revalidate.error.message}); decision-core.yaml left unchanged (backup made).`,
    };
  }
  writeFileSync(configPath, updated, 'utf-8');
  return { ok: true, alreadyEnforcing: false, from: 'observe', to: 'enforce' };
}
