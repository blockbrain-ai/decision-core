import { describe, it, expect } from 'vitest';
import {
  getSourceInstructions,
  getAllSourceInstructions,
  getInstructionsForDetectedSources,
} from './memory-source-instructions.js';
import type { MemorySourceKind } from '../../contracts/onboarding-profile.contracts.js';

describe('memory-source-instructions', () => {
  describe('getSourceInstructions', () => {
    const supportedKinds: MemorySourceKind[] = [
      'gbrain',
      'mempalace',
      'openclaw-native',
      'hermes-built-in',
      'hermes-active-provider',
      'markdown-vault',
      'mem0',
      'honcho',
      'zep-graphiti',
      'generic-mcp',
    ];

    for (const kind of supportedKinds) {
      it(`returns instructions for ${kind}`, () => {
        const inst = getSourceInstructions(kind);
        expect(inst).not.toBeNull();
        expect(inst!.sourceKind).toBe(kind);
        expect(inst!.title).toBeTruthy();
        expect(inst!.querySteps.length).toBeGreaterThan(0);
        expect(inst!.searchTopics.length).toBeGreaterThan(0);
        expect(inst!.safetyNotes.length).toBeGreaterThan(0);
        expect(inst!.exportFormat).toBe('memory-evidence-export');
      });
    }

    it('returns null for "none" kind', () => {
      expect(getSourceInstructions('none')).toBeNull();
    });

    it('returns null for unsupported kind', () => {
      expect(getSourceInstructions('supermemory')).toBeNull();
      expect(getSourceInstructions('cognee')).toBeNull();
      expect(getSourceInstructions('letta')).toBeNull();
    });

    it('includes safety note about secrets', () => {
      const inst = getSourceInstructions('gbrain')!;
      const hasSecretNote = inst.safetyNotes.some((n) =>
        n.toLowerCase().includes('api key') || n.toLowerCase().includes('secret'),
      );
      expect(hasSecretNote).toBe(true);
    });
  });

  describe('getAllSourceInstructions', () => {
    it('returns all supported instructions', () => {
      const all = getAllSourceInstructions();
      expect(all.length).toBeGreaterThanOrEqual(10);
      for (const inst of all) {
        expect(inst.sourceKind).toBeTruthy();
        expect(inst.querySteps.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getInstructionsForDetectedSources', () => {
    it('returns instructions only for detected sources', () => {
      const detected: MemorySourceKind[] = ['gbrain', 'openclaw-native'];
      const instructions = getInstructionsForDetectedSources(detected);
      expect(instructions).toHaveLength(2);
      expect(instructions[0].sourceKind).toBe('gbrain');
      expect(instructions[1].sourceKind).toBe('openclaw-native');
    });

    it('filters out unsupported sources', () => {
      const detected: MemorySourceKind[] = ['gbrain', 'none', 'supermemory'];
      const instructions = getInstructionsForDetectedSources(detected);
      expect(instructions).toHaveLength(1);
      expect(instructions[0].sourceKind).toBe('gbrain');
    });

    it('returns empty for no detected sources', () => {
      expect(getInstructionsForDetectedSources([])).toEqual([]);
    });
  });
});
