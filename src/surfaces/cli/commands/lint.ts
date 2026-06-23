import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliContext } from '../cli.js';
import { detectFrontmatter, parseStructuredDocument } from '../../../knowledge/authoring/frontmatter-parser.js';
import { parseYamlPolicy } from '../../../knowledge/authoring/yaml-policy-parser.js';
import { SurfaceContractRegistry } from '../../../knowledge/surfaces/surface-contract-registry.service.js';
import { createPolicyLinter } from '../../../knowledge/linter/policy-linter.service.js';
import type { LintContext, LintSeverity } from '../../../knowledge/linter/lint-types.js';
import type { ParsedStructuredClause } from '../../../knowledge/authoring/structured-clause.types.js';

function collectPolicyFiles(dirPath: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const full = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPolicyFiles(full));
    } else if (/\.(md|yaml|yml)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

export async function lintCommand(ctx: CliContext): Promise<number> {
  const inputPath = ctx.args.positionals[0];
  if (!inputPath) {
    ctx.stderr('Usage: decision-core lint <path> [--surface-contracts <path>]');
    return 1;
  }

  const resolved = resolve(inputPath);
  let filePaths: string[];
  try {
    const stat = statSync(resolved);
    filePaths = stat.isDirectory() ? collectPolicyFiles(resolved) : [resolved];
  } catch {
    ctx.stderr(`Cannot access path: ${inputPath}`);
    return 1;
  }

  if (filePaths.length === 0) {
    ctx.stderr('No .md, .yaml, or .yml files found in directory.');
    return 1;
  }

  let totalErrors = 0;
  for (const filePath of filePaths) {
    if (filePaths.length > 1) {
      ctx.stdout(`\n--- ${filePath} ---`);
    }
    const code = await lintSingleFile(ctx, filePath);
    if (code !== 0) totalErrors++;
  }

  if (filePaths.length > 1) {
    ctx.stdout(`\nLinted ${filePaths.length} file(s): ${filePaths.length - totalErrors} clean, ${totalErrors} with errors.`);
  }

  return totalErrors > 0 ? 1 : 0;
}

async function lintSingleFile(ctx: CliContext, filePath: string): Promise<number> {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    ctx.stderr(`Cannot read file: ${filePath}`);
    return 1;
  }

  const isJson = ctx.flags['json'] === true;
  const severityFilter = ctx.flags['severity'] as LintSeverity | undefined;

  // Load surface contracts
  const registry = new SurfaceContractRegistry();
  const contractsPath = (typeof ctx.flags['surface-contracts'] === 'string')
    ? ctx.flags['surface-contracts']
    : (ctx.config?.surfaceContractPath ?? undefined);

  if (contractsPath) {
    try {
      registry.loadFromFile(resolve(contractsPath));
    } catch (err) {
      ctx.stderr(`Cannot load surface contracts: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  } else {
    // Load default for CLI convenience
    loadDefaultSurfaceContracts(registry);
  }

  // Parse document
  let lintContext: LintContext;
  try {
    const isYaml = filePath.endsWith('.yaml') || filePath.endsWith('.yml');
    const hasFrontmatter = detectFrontmatter(content);

    if (hasFrontmatter) {
      const { document, parsedClauses } = parseStructuredDocument(content, filePath);
      lintContext = {
        clauses: document.clauses,
        frontmatter: document.frontmatter,
        surfaceRegistry: registry,
        hasStructuredClauses: parsedClauses.length > 0,
        sourceLineRefs: toSourceLineRefMap(parsedClauses),
        documentSource: filePath,
      };
    } else if (isYaml) {
      const { document, parsedClauses } = parseYamlPolicy(content, filePath);
      lintContext = {
        clauses: document.clauses,
        frontmatter: document.frontmatter,
        surfaceRegistry: registry,
        hasStructuredClauses: parsedClauses.length > 0,
        sourceLineRefs: toSourceLineRefMap(parsedClauses),
        documentSource: filePath,
      };
    } else {
      lintContext = {
        clauses: [],
        surfaceRegistry: registry,
        hasStructuredClauses: false,
        documentSource: filePath,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.stderr(`Parse error: ${message}`);
    return 1;
  }

  const linter = createPolicyLinter();
  const report = linter.lint(lintContext);

  // Apply severity filter
  let diagnostics = report.diagnostics;
  if (severityFilter) {
    diagnostics = diagnostics.filter((d) => d.severity === severityFilter);
  }

  if (isJson) {
    ctx.stdout(JSON.stringify({ ...report, diagnostics }, null, 2));
  } else {
    if (diagnostics.length === 0) {
      ctx.stdout('No issues found.');
    } else {
      for (const d of diagnostics) {
        const loc = d.line ? `:${d.line}` : '';
        const clause = d.clauseId ? ` [${d.clauseId}]` : '';
        ctx.stdout(`${d.severity.toUpperCase().padEnd(7)} ${d.ruleId}${clause}${loc}: ${d.message}`);
        if (d.suggestion) ctx.stdout(`         → ${d.suggestion}`);
      }
      ctx.stdout('');
      ctx.stdout(`${report.errorCount} error(s), ${report.warningCount} warning(s), ${report.infoCount} info`);
    }
  }

  return report.errorCount > 0 ? 1 : 0;
}

function toSourceLineRefMap(parsedClauses: ParsedStructuredClause[]): LintContext['sourceLineRefs'] {
  return Object.fromEntries(parsedClauses.map(({ clause, sourceLineRef }) => [clause.clause_id, sourceLineRef]));
}

function loadDefaultSurfaceContracts(registry: SurfaceContractRegistry): void {
  const candidates = [
    resolve(process.cwd(), 'config/surface-contracts/default.yaml'),
    fileURLToPath(new URL('../../../../config/surface-contracts/default.yaml', import.meta.url)),
    fileURLToPath(new URL('../../../../../config/surface-contracts/default.yaml', import.meta.url)),
  ];

  for (const candidate of new Set(candidates)) {
    if (!existsSync(candidate)) continue;
    registry.loadFromFile(candidate);
    return;
  }
}
