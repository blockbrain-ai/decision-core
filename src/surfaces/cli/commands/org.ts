import { resolve } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateOrgReport, formatReportMarkdown, formatReportJson } from '../../../identity/org-report.js';
import type { CliContext } from '../cli.js';
import { resolveBundledConfigPath } from '../../../utils/bundled-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function orgCommand(ctx: CliContext): Promise<number> {
  const subcommand = ctx.args.subcommand;

  switch (subcommand) {
    case 'init':
      return orgInit(ctx);
    case 'report':
      return orgReport(ctx);
    default:
      ctx.stdout('Usage: decision-core org <init|report>');
      ctx.stdout('  init    — Create starter org config files');
      ctx.stdout('  report  — Generate organisation status report');
      return subcommand ? 1 : 0;
  }
}

async function orgInit(ctx: CliContext): Promise<number> {
  const dcDir = resolve('.decision-core');
  mkdirSync(dcDir, { recursive: true });

  const profile = typeof ctx.flags['profile'] === 'string'
    ? ctx.flags['profile']
    : 'small-business';

  const filesToCopy: Array<{ src: string; dest: string; label: string }> = [
    {
      src: resolveBundledConfigPath(__dirname, 'agents', `${profile}-agents.yaml`),
      dest: join(dcDir, 'agents.yaml'),
      label: 'agents.yaml',
    },
    {
      src: resolveBundledConfigPath(__dirname, 'access-policy', `${profile}-access-policy.yaml`),
      dest: join(dcDir, 'access-policy.yaml'),
      label: 'access-policy.yaml',
    },
    {
      src: resolveBundledConfigPath(__dirname, 'packs', `${profile}.yaml`),
      dest: join(dcDir, 'policy-pack.yaml'),
      label: 'policy-pack.yaml',
    },
    {
      src: resolveBundledConfigPath(__dirname, 'tools', `${profile}-tool-inventory.yaml`),
      dest: join(dcDir, 'tool-inventory.yaml'),
      label: 'tool-inventory.yaml',
    },
  ];

  for (const f of filesToCopy) {
    if (!existsSync(f.src)) {
      ctx.stderr(`Template not found: ${f.src}`);
      ctx.stderr(`Available profiles: small-business`);
      return 1;
    }

    if (existsSync(f.dest)) {
      ctx.stdout(`  skip: ${f.label} (already exists)`);
    } else {
      copyFileSync(f.src, f.dest);
      ctx.stdout(`  created: ${f.label}`);
    }
  }

  ctx.stdout('');
  ctx.stdout('Org config initialised. Next steps:');
  ctx.stdout('  1. Review and edit .decision-core/agents.yaml');
  ctx.stdout('  2. Review and edit .decision-core/access-policy.yaml');
  ctx.stdout('  3. Review and edit .decision-core/tool-inventory.yaml whenever tools change');
  ctx.stdout('  4. Run: decision-core provision');
  ctx.stdout('  5. Run: decision-core provision --verify');

  return 0;
}

async function orgReport(ctx: CliContext): Promise<number> {
  const agentsFile = typeof ctx.flags['agents-file'] === 'string'
    ? ctx.flags['agents-file']
    : resolve('.decision-core', 'agents.yaml');
  const accessPolicyFile = typeof ctx.flags['access-policy'] === 'string'
    ? ctx.flags['access-policy']
    : resolve('.decision-core', 'access-policy.yaml');

  const format = typeof ctx.flags['format'] === 'string'
    ? ctx.flags['format']
    : 'markdown';

  try {
    const report = generateOrgReport(agentsFile, accessPolicyFile);

    if (format === 'json' || ctx.flags['json'] === true) {
      ctx.stdout(formatReportJson(report));
    } else {
      ctx.stdout(formatReportMarkdown(report));
    }

    const outPath = typeof ctx.flags['out'] === 'string' ? ctx.flags['out'] : undefined;
    if (outPath) {
      const { writeFileSync } = await import('fs');
      const content = format === 'json' ? formatReportJson(report) : formatReportMarkdown(report);
      writeFileSync(outPath, content, 'utf-8');
      ctx.stdout(`Report written to ${outPath}`);
    }

    return 0;
  } catch (err) {
    ctx.stderr(`Report failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
