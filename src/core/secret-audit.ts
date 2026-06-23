/**
 * Source-wide Secret Audit
 *
 * Scans source files for plaintext secrets. Returns violations.
 * Patterns: hardcoded API keys, passwords, tokens, secrets in string literals.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export interface SecretViolation {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

/**
 * Patterns that indicate plaintext secrets in source code.
 * Each pattern is a regex with a descriptive label.
 */
export const SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'hardcoded-api-key', regex: /['"](?:sk-|pk_live_|pk_test_|rk_live_|rk_test_|api[_-]?key[_-]?)[a-zA-Z0-9_-]{10,}['"]/i },
  { label: 'hardcoded-secret', regex: /(?:secret|password|passwd|apikey|api_key|token|credential)\s*[:=]\s*['"][^'"]{8,}['"]/i },
  { label: 'aws-key', regex: /['"]AKIA[0-9A-Z]{16}['"]/i },
  { label: 'bearer-inline', regex: /['"]Bearer\s+[a-zA-Z0-9._-]{20,}['"]/i },
  { label: 'private-key-header', regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
];

/**
 * Files and patterns to exclude from auditing (test files, .d.ts, etc.)
 */
const EXCLUDED_PATTERNS = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.d\.ts$/,
  /node_modules/,
  /\.git\//,
  /dist\//,
  /coverage\//,
];

function shouldAuditFile(filePath: string): boolean {
  return extname(filePath) === '.ts' &&
    !EXCLUDED_PATTERNS.some(p => p.test(filePath));
}

/**
 * Recursively collect TypeScript source files from a directory.
 */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        files.push(...collectSourceFiles(full));
      } else if (shouldAuditFile(full)) {
        files.push(full);
      }
    } catch {
      // Skip inaccessible files
    }
  }

  return files;
}

/**
 * Audit a single file for plaintext secrets.
 */
export function auditFile(filePath: string, content: string): SecretViolation[] {
  const violations: SecretViolation[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only lines
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;

    for (const { label, regex } of SECRET_PATTERNS) {
      if (regex.test(line)) {
        violations.push({
          file: filePath,
          line: i + 1,
          pattern: label,
          snippet: line.trim().substring(0, 100),
        });
      }
    }
  }

  return violations;
}

/**
 * Run secret audit across all source files in a directory.
 */
export function auditDirectory(srcDir: string): SecretViolation[] {
  const files = collectSourceFiles(srcDir);
  const violations: SecretViolation[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      violations.push(...auditFile(file, content));
    } catch {
      // Skip unreadable files
    }
  }

  return violations;
}
