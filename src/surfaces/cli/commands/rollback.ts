/**
 * rollback command — Restore previous policy-pack.yaml and decision-core.yaml.
 *
 * Usage:
 *   decision-core rollback --last
 *   decision-core rollback --list
 */

import { resolve } from 'path';
import { listBackups, restoreLatestBackup } from '../backup-utils.js';
import type { CliContext } from '../cli.js';

export async function rollbackCommand(ctx: CliContext): Promise<number> {
  const dcDir = resolve(process.cwd(), '.decision-core');

  if (ctx.flags['list']) {
    const backups = listBackups(dcDir);
    if (backups.length === 0) {
      ctx.stdout('No backups found.');
      return 0;
    }

    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify(backups, null, 2));
    } else {
      ctx.stdout(`Available backups (${backups.length}):`);
      ctx.stdout('');
      for (const b of backups) {
        ctx.stdout(`  ${b.timestamp}  [${b.command}]  files: ${b.files.join(', ')}`);
      }
    }
    return 0;
  }

  if (ctx.flags['last']) {
    const restored = restoreLatestBackup(dcDir);
    if (!restored) {
      ctx.stderr('No backups available to restore.');
      return 1;
    }

    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify({ restored }));
    } else {
      ctx.stdout(`Restored backup from ${restored.timestamp}:`);
      for (const f of restored.files) {
        ctx.stdout(`  ${f}`);
      }
    }
    return 0;
  }

  ctx.stderr('Usage: decision-core rollback --last | --list');
  return 1;
}
