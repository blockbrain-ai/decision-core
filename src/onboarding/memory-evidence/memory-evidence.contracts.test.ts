import { describe, it, expect } from 'vitest';
import {
  MemoryEvidenceSourceSchema,
  MemoryEvidenceItemSchema,
  MemoryEvidenceExportSchema,
  MemoryEvidenceConsentSchema,
  containsSecret,
  redactEvidenceItem,
  redactExport,
  validateExport,
} from './memory-evidence.contracts.js';
import type { MemoryEvidenceExport, MemoryEvidenceItem } from './memory-evidence.contracts.js';

// ===========================================================================
// Fixtures
// ===========================================================================

function makeExport(overrides?: Partial<MemoryEvidenceExport>): MemoryEvidenceExport {
  return {
    schemaVersion: 1,
    sourceId: 'test-source',
    sourceKind: 'gbrain',
    collectedBy: 'user-agent',
    collectedAt: '2026-01-01T00:00:00.000Z',
    consent: {
      readGranted: true,
      writeBackGranted: false,
      scope: ['onboarding'],
    },
    items: [
      {
        id: 'item-1',
        summary: 'Agent manages e-commerce operations',
        sourceRef: 'gbrain://pages/agent-setup',
        confidence: 0.85,
        sensitive: false,
      },
    ],
    ...overrides,
  };
}

function makeItem(overrides?: Partial<MemoryEvidenceItem>): MemoryEvidenceItem {
  return {
    id: 'item-1',
    summary: 'Test summary',
    sourceRef: 'test://ref',
    confidence: 0.8,
    sensitive: false,
    ...overrides,
  };
}

describe('memory-evidence.contracts', () => {
  // =========================================================================
  // MemoryEvidenceSourceSchema
  // =========================================================================

  describe('MemoryEvidenceSourceSchema', () => {
    it('validates a well-formed source descriptor', () => {
      const source = {
        id: 'gbrain',
        label: 'G-Brain',
        kind: 'gbrain',
        detectionHints: ['~/.gbrain/ directory'],
        supportedExportFormats: ['gbrain-search-results', 'memory-evidence-export'],
      };
      expect(MemoryEvidenceSourceSchema.parse(source)).toEqual(source);
    });

    it('rejects missing kind', () => {
      const result = MemoryEvidenceSourceSchema.safeParse({
        id: 'test',
        label: 'Test',
        detectionHints: [],
        supportedExportFormats: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid kind', () => {
      const result = MemoryEvidenceSourceSchema.safeParse({
        id: 'test',
        label: 'Test',
        kind: 'dropbox',
        detectionHints: [],
        supportedExportFormats: [],
      });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // MemoryEvidenceItemSchema
  // =========================================================================

  describe('MemoryEvidenceItemSchema', () => {
    it('validates a complete item', () => {
      const item = makeItem({ suggestedProfilePatch: { mode: 'business' } });
      expect(MemoryEvidenceItemSchema.parse(item)).toEqual(item);
    });

    it('validates an item without suggestedProfilePatch', () => {
      const item = makeItem();
      expect(MemoryEvidenceItemSchema.parse(item)).toEqual(item);
    });

    it('rejects confidence > 1', () => {
      const result = MemoryEvidenceItemSchema.safeParse(makeItem({ confidence: 1.5 }));
      expect(result.success).toBe(false);
    });

    it('rejects confidence < 0', () => {
      const result = MemoryEvidenceItemSchema.safeParse(makeItem({ confidence: -0.1 }));
      expect(result.success).toBe(false);
    });

    it('accepts boundary confidence values', () => {
      expect(MemoryEvidenceItemSchema.parse(makeItem({ confidence: 0 }))).toBeTruthy();
      expect(MemoryEvidenceItemSchema.parse(makeItem({ confidence: 1 }))).toBeTruthy();
    });
  });

  // =========================================================================
  // MemoryEvidenceConsentSchema
  // =========================================================================

  describe('MemoryEvidenceConsentSchema', () => {
    it('validates read-only consent', () => {
      const consent = {
        readGranted: true,
        writeBackGranted: false,
        scope: ['onboarding', 'profile-inference'],
      };
      expect(MemoryEvidenceConsentSchema.parse(consent)).toEqual(consent);
    });

    it('validates full consent', () => {
      const consent = {
        readGranted: true,
        writeBackGranted: true,
        scope: ['onboarding'],
      };
      expect(MemoryEvidenceConsentSchema.parse(consent)).toEqual(consent);
    });

    it('validates no-consent scenario', () => {
      const consent = {
        readGranted: false,
        writeBackGranted: false,
        scope: [],
      };
      expect(MemoryEvidenceConsentSchema.parse(consent)).toEqual(consent);
    });
  });

  // =========================================================================
  // MemoryEvidenceExportSchema
  // =========================================================================

  describe('MemoryEvidenceExportSchema', () => {
    it('validates a complete export', () => {
      const exp = makeExport();
      expect(MemoryEvidenceExportSchema.parse(exp)).toEqual(exp);
    });

    it('validates export with multiple items', () => {
      const exp = makeExport({
        items: [
          makeItem({ id: 'a', summary: 'First' }),
          makeItem({ id: 'b', summary: 'Second', sensitive: true }),
          makeItem({ id: 'c', summary: 'Third', suggestedProfilePatch: { mode: 'team' } }),
        ],
      });
      const result = MemoryEvidenceExportSchema.safeParse(exp);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(3);
      }
    });

    it('validates export with empty items', () => {
      const exp = makeExport({ items: [] });
      expect(MemoryEvidenceExportSchema.parse(exp)).toBeTruthy();
    });

    it('validates all collectedBy options', () => {
      for (const by of ['user-agent', 'decision-core', 'manual'] as const) {
        const exp = makeExport({ collectedBy: by });
        expect(MemoryEvidenceExportSchema.parse(exp).collectedBy).toBe(by);
      }
    });

    it('validates all memory source kinds', () => {
      const kinds = [
        'gbrain', 'mempalace', 'openclaw-native', 'hermes-built-in',
        'hermes-active-provider', 'markdown-vault', 'obsidian-mcp',
        'mem0', 'honcho', 'zep-graphiti', 'supermemory', 'cognee',
        'letta', 'langmem', 'generic-mcp', 'none',
      ] as const;

      for (const kind of kinds) {
        const exp = makeExport({ sourceKind: kind });
        expect(MemoryEvidenceExportSchema.parse(exp).sourceKind).toBe(kind);
      }
    });

    it('rejects wrong schemaVersion', () => {
      const result = MemoryEvidenceExportSchema.safeParse(
        makeExport({ schemaVersion: 2 as never }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects missing consent', () => {
      const { consent: _, ...noConsent } = makeExport();
      const result = MemoryEvidenceExportSchema.safeParse(noConsent);
      expect(result.success).toBe(false);
    });

    it('rejects invalid sourceKind', () => {
      const result = MemoryEvidenceExportSchema.safeParse(
        makeExport({ sourceKind: 'dropbox' as never }),
      );
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // Secret Detection
  // =========================================================================

  describe('containsSecret', () => {
    it('detects OpenAI-style API keys', () => {
      expect(containsSecret('My key is sk-abcdefghijklmnopqrstuvwxyz')).toBe(true);
    });

    it('detects AWS access key IDs', () => {
      expect(containsSecret('AKIAIOSFODNN7EXAMPLE1')).toBe(true);
    });

    it('detects private key headers', () => {
      expect(containsSecret('-----BEGIN PRIVATE KEY-----')).toBe(true);
      expect(containsSecret('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    });

    it('detects Bearer tokens', () => {
      expect(containsSecret('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test')).toBe(true);
    });

    it('detects GitHub personal access tokens', () => {
      expect(containsSecret('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')).toBe(true);
    });

    it('detects Slack tokens', () => {
      expect(containsSecret('xoxb-1234567890-abcdefghij')).toBe(true);
    });

    it('does not flag normal text', () => {
      expect(containsSecret('Agent manages e-commerce operations')).toBe(false);
      expect(containsSecret('The user prefers balanced autonomy')).toBe(false);
      expect(containsSecret('')).toBe(false);
    });
  });

  // =========================================================================
  // Redaction
  // =========================================================================

  describe('redactEvidenceItem', () => {
    it('redacts item with secret in summary', () => {
      const item = makeItem({ summary: 'API key is sk-abcdefghijklmnopqrstuvwxyz' });
      const redacted = redactEvidenceItem(item);
      expect(redacted.summary).toBe('[REDACTED — contained secret material]');
      expect(redacted.sensitive).toBe(true);
    });

    it('redacts item with secret in sourceRef', () => {
      const item = makeItem({ sourceRef: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc' });
      const redacted = redactEvidenceItem(item);
      expect(redacted.sourceRef).toBe('[REDACTED]');
      expect(redacted.sensitive).toBe(true);
    });

    it('passes through clean items unchanged', () => {
      const item = makeItem();
      const redacted = redactEvidenceItem(item);
      expect(redacted).toBe(item);
    });
  });

  describe('redactExport', () => {
    it('redacts all items in export', () => {
      const exp = makeExport({
        items: [
          makeItem({ id: 'clean', summary: 'Normal text' }),
          makeItem({ id: 'secret', summary: 'Key: sk-abcdefghijklmnopqrstuvwxyz' }),
        ],
      });

      const redacted = redactExport(exp);
      expect(redacted.items[0].summary).toBe('Normal text');
      expect(redacted.items[1].summary).toBe('[REDACTED — contained secret material]');
    });

    it('preserves export metadata', () => {
      const exp = makeExport();
      const redacted = redactExport(exp);
      expect(redacted.sourceId).toBe(exp.sourceId);
      expect(redacted.sourceKind).toBe(exp.sourceKind);
      expect(redacted.consent).toEqual(exp.consent);
    });
  });

  // =========================================================================
  // validateExport
  // =========================================================================

  describe('validateExport', () => {
    it('returns valid for correct export', () => {
      const result = validateExport(makeExport());
      expect(result.valid).toBe(true);
      expect(result.export).toBeDefined();
      expect(result.errors).toBeUndefined();
    });

    it('returns errors for invalid export', () => {
      const result = validateExport({ schemaVersion: 2 });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('returns errors for null input', () => {
      const result = validateExport(null);
      expect(result.valid).toBe(false);
    });

    it('returns errors for empty object', () => {
      const result = validateExport({});
      expect(result.valid).toBe(false);
    });
  });
});
