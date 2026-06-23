/**
 * CLI Command: decision-core validate <path>
 *
 * Validates a single structured policy document (markdown with frontmatter
 * or YAML policy file). This is the restored original functionality.
 *
 * Conflict analysis for policy *packs* should use:
 *   decision-core policy analyze <pack.yaml>
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import type { CliContext } from '../cli.js';
import { detectFrontmatter, parseStructuredDocument } from '../../../knowledge/authoring/frontmatter-parser.js';
import { parseYamlPolicy } from '../../../knowledge/authoring/yaml-policy-parser.js';
import type { ParsedStructuredClause } from '../../../knowledge/authoring/structured-clause.types.js';

export async function validateCommand(ctx: CliContext): Promise<number> {
  const inputPath = ctx.args.positionals?.[0] || (ctx.args as any)._?.[0];

  if (!inputPath) {
    ctx.stderr('Usage: decision-core validate <path-to-document.md|yaml> [--json]\n(Use "analyze <pack.yaml>" to check a compiled policy pack for rule conflicts)');
    return 1;
  }

  const resolved = resolve(inputPath);

  if (!existsSync(resolved)) {
    ctx.stderr(`Cannot access: ${inputPath}`);
    return 1;
  }

  const stat = statSync(resolved);
  if (stat.isDirectory()) {
    ctx.stderr('validate expects a single file. Use "lint" for directories.');
    return 1;
  }

  const ext = extname(resolved).toLowerCase();
  const isMarkdown = ext === '.md';
  const isYaml = ext === '.yaml' || ext === '.yml';

  if (!isMarkdown && !isYaml) {
    ctx.stderr('Unsupported file type. Supported: .md, .yaml, .yml');
    return 1;
  }

  try {
    const content = readFileSync(resolved, 'utf-8');

    if (isMarkdown) {
      const hasFrontmatter = detectFrontmatter(content);
      if (!hasFrontmatter) {
        ctx.stderr('No valid frontmatter found.');
        return 1;
      }

      const parsedResult = parseStructuredDocument(content);
      const parsedClauses = parsedResult.parsedClauses || [];

      const output = {
        valid: true,
        file: resolved,
        type: 'structured-clause',
        frontmatter: parsedResult.document.frontmatter,
        clauseCount: parsedClauses.length,
        hasBody: !!parsedResult.document.clauses?.length,
      };

      if ((ctx.args as any).json || (ctx.args as any).flags?.json) {
        ctx.stdout(JSON.stringify(output, null, 2));
      } else {
        ctx.stdout(`✅ Valid structured clause document`);
        ctx.stdout(`   Clauses: ${output.clauseCount}`);
      }
      return 0;
    }

    // YAML path
    const policyResult = parseYamlPolicy(content);
    const ruleCount = policyResult.parsedClauses?.length || 0;

    const output = {
      valid: true,
      file: resolved,
      type: 'yaml-policy',
      ruleCount,
    };

    if ((ctx.args as any).json || (ctx.args as any).flags?.json) {
      ctx.stdout(JSON.stringify(output, null, 2));
    } else {
      ctx.stdout(`✅ Valid YAML policy document`);
      ctx.stdout(`   Rules: ${output.ruleCount}`);
    }
    return 0;

  } catch (err: any) {
    ctx.stderr(`Validation failed: ${err.message}`);
    return 1;
  }
}
