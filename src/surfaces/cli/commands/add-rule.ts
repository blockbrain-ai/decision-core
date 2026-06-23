/**
 * add-rule command — Backward-compatible alias for `rules add`.
 */

import type { CliContext } from '../cli.js';
import { rulesCommand } from './rules.js';

export async function addRuleCommand(ctx: CliContext): Promise<number> {
  ctx.args.subcommand = 'add';
  return rulesCommand(ctx);
}
