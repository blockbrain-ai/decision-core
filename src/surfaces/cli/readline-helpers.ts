/**
 * Shared readline prompt utilities for CLI commands.
 */

import { createInterface } from 'node:readline';
import type { OnboardingQuestion } from '../../contracts/onboarding.contracts.js';

export type ReadlineInterface = ReturnType<typeof createInterface>;

export function createReadline(): ReadlineInterface {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export async function prompt(rl: ReadlineInterface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => resolve(answer.trim()));
  });
}

export async function askQuestion(
  rl: ReadlineInterface,
  q: OnboardingQuestion,
): Promise<unknown> {
  switch (q.type) {
    case 'text': {
      const defaultHint = q.default ? ` [${q.default}]` : '';
      const answer = await prompt(rl, `  ${q.prompt}${defaultHint}\n  > `);
      return answer || q.default || '';
    }
    case 'select': {
      const opts = q.options ?? [];
      const defaultHint = q.default ? ` [${q.default}]` : '';
      const optList = opts.map((o, i) => `    ${i + 1}. ${o}`).join('\n');
      const answer = await prompt(rl, `  ${q.prompt}${defaultHint}\n${optList}\n  > `);
      if (!answer && q.default) return q.default;
      const idx = parseInt(answer, 10);
      if (idx >= 1 && idx <= opts.length) return opts[idx - 1];
      if (opts.includes(answer)) return answer;
      return q.default ?? opts[0] ?? answer;
    }
    case 'multi_select': {
      const opts = q.options ?? [];
      const defaultHint = q.default ? ` [${q.default}]` : '';
      const optList = opts.map((o, i) => `    ${i + 1}. ${o}`).join('\n');
      const answer = await prompt(rl, `  ${q.prompt} (comma-separated)${defaultHint}\n${optList}\n  > `);
      if (!answer && q.default) return [q.default];
      const parts = answer.split(',').map((s) => s.trim()).filter(Boolean);
      return parts.map((p) => {
        const idx = parseInt(p, 10);
        if (idx >= 1 && idx <= opts.length) return opts[idx - 1]!;
        return p;
      });
    }
    case 'confirm': {
      const defaultHint = q.default === 'true' ? ' [Y/n]' : ' [y/N]';
      const answer = await prompt(rl, `  ${q.prompt}${defaultHint}\n  > `);
      if (!answer) return q.default === 'true';
      return answer.toLowerCase().startsWith('y');
    }
    default:
      return '';
  }
}
