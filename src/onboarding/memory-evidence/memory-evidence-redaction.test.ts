import { describe, it, expect } from 'vitest';
import {
  containsPII,
  redactPII,
  deepRedactItem,
  deepRedactExport,
} from './memory-evidence-redaction.js';
import type { MemoryEvidenceExport, MemoryEvidenceItem } from './memory-evidence.contracts.js';

function makeItem(overrides?: Partial<MemoryEvidenceItem>): MemoryEvidenceItem {
  return {
    id: 'item-1',
    summary: 'Clean summary',
    sourceRef: 'test://ref',
    confidence: 0.8,
    sensitive: false,
    ...overrides,
  };
}

function makeExport(items: MemoryEvidenceItem[]): MemoryEvidenceExport {
  return {
    schemaVersion: 1,
    sourceId: 'test',
    sourceKind: 'gbrain',
    collectedBy: 'user-agent',
    collectedAt: '2026-01-01T00:00:00.000Z',
    consent: { readGranted: true, writeBackGranted: false, scope: ['onboarding'] },
    items,
  };
}

describe('memory-evidence-redaction', () => {
  describe('containsPII', () => {
    it('detects email addresses', () => {
      expect(containsPII('Contact user@example.com for details')).toBe(true);
    });

    it('detects phone numbers', () => {
      expect(containsPII('Call (555) 123-4567')).toBe(true);
      expect(containsPII('Call +1-555-123-4567')).toBe(true);
    });

    it('detects SSNs', () => {
      expect(containsPII('SSN: 123-45-6789')).toBe(true);
    });

    it('detects credit card numbers', () => {
      expect(containsPII('Card: 4111 1111 1111 1111')).toBe(true);
      expect(containsPII('Card: 4111-1111-1111-1111')).toBe(true);
    });

    it('does not flag normal text', () => {
      expect(containsPII('Agent manages operations')).toBe(false);
      expect(containsPII('')).toBe(false);
    });
  });

  describe('redactPII', () => {
    it('redacts emails', () => {
      expect(redactPII('Contact user@example.com')).toBe('Contact [EMAIL_REDACTED]');
    });

    it('redacts SSNs', () => {
      expect(redactPII('SSN: 123-45-6789')).toBe('SSN: [SSN_REDACTED]');
    });

    it('redacts credit cards', () => {
      expect(redactPII('Card: 4111 1111 1111 1111')).toBe('Card: [CC_REDACTED]');
    });

    it('handles multiple PII types in one string', () => {
      const text = 'Email: user@example.com, SSN: 123-45-6789';
      const redacted = redactPII(text);
      expect(redacted).toContain('[EMAIL_REDACTED]');
      expect(redacted).toContain('[SSN_REDACTED]');
    });

    it('passes through clean text unchanged', () => {
      expect(redactPII('Normal text')).toBe('Normal text');
    });
  });

  describe('deepRedactItem', () => {
    it('passes through clean items', () => {
      const item = makeItem();
      const result = deepRedactItem(item);
      expect(result.item).toBe(item);
      expect(result.hadSecret).toBe(false);
      expect(result.hadPII).toBe(false);
    });

    it('redacts secrets', () => {
      const item = makeItem({ summary: 'Key: sk-abcdefghijklmnopqrstuvwxyz' });
      const result = deepRedactItem(item);
      expect(result.hadSecret).toBe(true);
      expect(result.item.summary).toContain('[REDACTED');
      expect(result.item.sensitive).toBe(true);
    });

    it('redacts PII', () => {
      const item = makeItem({ summary: 'User email is john@example.com' });
      const result = deepRedactItem(item);
      expect(result.hadPII).toBe(true);
      expect(result.item.summary).toContain('[EMAIL_REDACTED]');
      expect(result.item.sensitive).toBe(true);
    });

    it('redacts both secrets and PII', () => {
      const item = makeItem({
        summary: 'Key sk-abcdefghijklmnopqrstuvwxyz for john@example.com',
      });
      const result = deepRedactItem(item);
      expect(result.hadSecret).toBe(true);
      expect(result.hadPII).toBe(true);
    });
  });

  describe('deepRedactExport', () => {
    it('produces stats for clean export', () => {
      const exp = makeExport([makeItem()]);
      const result = deepRedactExport(exp);
      expect(result.stats.totalItems).toBe(1);
      expect(result.stats.secretsRedacted).toBe(0);
      expect(result.stats.piiRedacted).toBe(0);
    });

    it('redacts mixed items and produces accurate stats', () => {
      const exp = makeExport([
        makeItem({ id: 'clean', summary: 'Normal' }),
        makeItem({ id: 'secret', summary: 'Has sk-abcdefghijklmnopqrstuvwxyz' }),
        makeItem({ id: 'pii', summary: 'Has john@example.com' }),
        makeItem({ id: 'already', summary: 'Marked', sensitive: true }),
      ]);

      const result = deepRedactExport(exp);
      expect(result.stats.totalItems).toBe(4);
      expect(result.stats.secretsRedacted).toBe(1);
      expect(result.stats.piiRedacted).toBe(1);
      expect(result.stats.alreadySensitive).toBe(1);
    });

    it('preserves export metadata', () => {
      const exp = makeExport([makeItem()]);
      const result = deepRedactExport(exp);
      expect(result.export.sourceId).toBe(exp.sourceId);
      expect(result.export.consent).toEqual(exp.consent);
    });
  });
});
