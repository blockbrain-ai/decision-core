/**
 * author command — Interactive policy authoring from natural language.
 *
 * Usage: decision-core author [--text "rule description"] [--document <file>] [--json] [--output-dir <dir>]
 *
 * Modes:
 *   --text "..."        Generate rules from a natural language statement
 *   --document <path>   Extract rules from a policy document file
 *   (no flags)          Interactive mode via stdin
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { CliContext } from '../cli.js';
import { PolicyAuthorService } from '../../../skills/policy-author/policy-author.service.js';
import type { PolicyAuthorResult, CandidateRule } from '../../../contracts/policy-author.contracts.js';

function formatRule(rule: CandidateRule, index: number): string {
  const lines: string[] = [];
  lines.push(`  [${index + 1}] ${rule.ruleType} (confidence: ${rule.confidence}, status: ${rule.status})`);
  lines.push(`      Source: "${rule.sourceText}"`);
  lines.push(`      Explanation: ${rule.explanation}`);
  if (rule.affectedTools.length > 0) {
    lines.push(`      Tools: ${rule.affectedTools.join(', ')}`);
  }
  return lines.join('\n');
}

function formatResult(result: PolicyAuthorResult): string {
  const lines: string[] = [];

  if (result.candidateRules.length === 0) {
    lines.push('No candidate rules generated.');
  } else {
    lines.push(`Generated ${result.candidateRules.length} candidate rule(s):\n`);
    for (let i = 0; i < result.candidateRules.length; i++) {
      lines.push(formatRule(result.candidateRules[i], i));
      lines.push('');
    }
  }

  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const w of result.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  if (result.ambiguities.length > 0) {
    lines.push('Ambiguities:');
    for (const a of result.ambiguities) {
      lines.push(`  ? ${a}`);
    }
  }

  return lines.join('\n');
}

async function promptLine(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((res) => {
    rl.question(question, (answer: string) => res(answer.trim()));
  });
}

export async function authorCommand(ctx: CliContext): Promise<number> {
  const service = new PolicyAuthorService();

  const textInput = ctx.flags['text'];
  const documentPath = ctx.flags['document'];

  // --- Non-interactive: text mode ---
  if (typeof textInput === 'string') {
    const result = service.authorFromText({ naturalLanguage: textInput });

    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify(result, null, 2));
    } else {
      ctx.stdout(formatResult(result));
    }

    return writeOutput(ctx, result, service);
  }

  // --- Non-interactive: document mode ---
  if (typeof documentPath === 'string') {
    const fullPath = resolve(documentPath);
    if (!existsSync(fullPath)) {
      ctx.stderr(`File not found: ${fullPath}`);
      return 1;
    }

    const content = readFileSync(fullPath, 'utf-8');
    const result = service.authorFromDocument({ documentContent: content, documentName: documentPath });

    if (ctx.flags['json']) {
      ctx.stdout(JSON.stringify(result, null, 2));
    } else {
      ctx.stdout(formatResult(result));
    }

    return writeOutput(ctx, result, service);
  }

  // --- Interactive mode ---
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    ctx.stdout('Decision Core — Policy Author');
    ctx.stdout('=============================');
    ctx.stdout('Describe your policy rules in plain English. Type "done" when finished.\n');

    const statements: string[] = [];
    let line = await promptLine(rl, '> ');
    while (line.toLowerCase() !== 'done' && line.toLowerCase() !== 'exit') {
      if (line) statements.push(line);
      line = await promptLine(rl, '> ');
    }

    if (statements.length === 0) {
      ctx.stdout('No input provided.');
      return 0;
    }

    const combined = statements.join('\n');
    const result = service.authorFromText({ naturalLanguage: combined });

    ctx.stdout('\n' + formatResult(result));

    // Review loop
    if (result.candidateRules.length > 0) {
      ctx.stdout('\nReview each rule: (a)ccept / (r)eject / (s)kip');

      const sessionId = result.sessionId;

      if (sessionId) {
        for (const rule of result.candidateRules) {
          if (rule.status === 'needs_human_policy_authoring') {
            ctx.stdout(`  [${rule.id.slice(0, 8)}] Skipped — needs human authoring`);
            continue;
          }

          const answer = await promptLine(rl, `  [${rule.id.slice(0, 8)}] ${rule.ruleType}: ${rule.explanation.slice(0, 60)}... (a/r/s) `);
          if (answer.startsWith('a')) {
            service.reviewRule(sessionId, { ruleId: rule.id, action: 'accept' });
          } else if (answer.startsWith('r')) {
            service.reviewRule(sessionId, { ruleId: rule.id, action: 'reject' });
          }
          // 's' or anything else = skip (stays as draft)
        }

        const commitResult = service.commitRules(sessionId);
        if (commitResult.committedRuleIds.length > 0) {
          ctx.stdout(`\nCommitted ${commitResult.committedRuleIds.length} rule(s) as drafts.`);

          const outputDir = ctx.flags['output-dir'];
          if (typeof outputDir === 'string') {
            const dir = resolve(outputDir);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, 'authored-policies.yaml'), commitResult.policiesYaml, 'utf-8');
            ctx.stdout(`Written to ${resolve(dir, 'authored-policies.yaml')}`);
          } else {
            ctx.stdout('\n--- Generated Policy YAML (draft) ---\n');
            ctx.stdout(commitResult.policiesYaml);
          }
        } else {
          ctx.stdout('\nNo rules accepted.');
        }
      }
    }

    return 0;
  } finally {
    rl.close();
  }
}

/**
 * Write output to disk if --output-dir is specified.
 */
function writeOutput(ctx: CliContext, result: PolicyAuthorResult, service: PolicyAuthorService): number {
  const outputDir = ctx.flags['output-dir'];

  if (typeof outputDir === 'string' && result.candidateRules.length > 0) {
    // Auto-accept all rules in non-interactive mode
    const sessionId = result.sessionId;
    if (sessionId) {
      for (const rule of result.candidateRules) {
        if (rule.status === 'draft') {
          service.reviewRule(sessionId, { ruleId: rule.id, action: 'accept' });
        }
      }
      const commitResult = service.commitRules(sessionId);

      if (commitResult.policiesYaml) {
        const dir = resolve(outputDir);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'authored-policies.yaml'), commitResult.policiesYaml, 'utf-8');
        ctx.stdout(`\nDraft policies written to ${resolve(dir, 'authored-policies.yaml')}`);
      }
    }
  }

  return 0;
}

