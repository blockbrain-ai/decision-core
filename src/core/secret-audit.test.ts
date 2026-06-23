/**
 * Secret Audit Tests
 */

import { describe, it, expect } from 'vitest';
import { auditFile, auditDirectory } from './secret-audit.js';
import { join } from 'node:path';

describe('SECRET_PATTERNS', () => {
  it('detects hardcoded API keys', () => {
    const content = `const key = 'sk-abc123456789abcdef';`;
    const violations = auditFile('test.ts', content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].pattern).toBe('hardcoded-api-key');
  });

  it('detects hardcoded secrets', () => {
    const content = `const secret = "my-super-secret-value-12345";`;
    const violations = auditFile('test.ts', content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].pattern).toBe('hardcoded-secret');
  });

  it('detects AWS access keys', () => {
    const content = `const aws = 'AKIAIOSFODNN7EXAMPLE';`;
    const violations = auditFile('test.ts', content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].pattern).toBe('aws-key');
  });

  it('detects inline Bearer tokens', () => {
    const content = `const auth = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdefgh';`;
    const violations = auditFile('test.ts', content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].pattern).toBe('bearer-inline');
  });

  it('detects private key headers', () => {
    const content = `const key = '-----BEGIN RSA PRIVATE KEY-----';`;
    const violations = auditFile('test.ts', content);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].pattern).toBe('private-key-header');
  });

  it('does not flag env var references', () => {
    const content = `const key = process.env['API_KEY'];`;
    const violations = auditFile('test.ts', content);
    expect(violations).toHaveLength(0);
  });

  it('does not flag schema definitions', () => {
    const content = `const schema = z.object({ apiKey: z.string() });`;
    const violations = auditFile('test.ts', content);
    expect(violations).toHaveLength(0);
  });

  it('skips comment-only lines', () => {
    const content = `// const secret = "hardcoded-secret-value-12345";`;
    const violations = auditFile('test.ts', content);
    expect(violations).toHaveLength(0);
  });

  it('reports correct line numbers', () => {
    const content = `line 1\nline 2\nconst secret = "hardcoded-secret-value-12345";\nline 4`;
    const violations = auditFile('test.ts', content);
    expect(violations[0].line).toBe(3);
  });
});

describe('auditDirectory', () => {
  it('audits the src directory and finds zero plaintext secrets', () => {
    const srcDir = join(__dirname, '..');
    const violations = auditDirectory(srcDir);

    if (violations.length > 0) {
      const details = violations.map(v => `  ${v.file}:${v.line} [${v.pattern}] ${v.snippet}`).join('\n');
      throw new Error(`Found ${violations.length} plaintext secret(s) in source:\n${details}`);
    }

    expect(violations).toHaveLength(0);
  });
});
