import { describe, it, expect } from 'vitest';
import { resolvePanel } from './panel-resolver.js';
import type { SurfaceBinding, TribunalConfig, TribunalPanel } from '../trust.contracts.js';

function makePanel(panelId: string): TribunalPanel {
  return {
    panelId,
    assessors: [
      { role: 'assessor', modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.1 },
      { role: 'assessor', modelPolicy: 'balanced', maxTokens: 700, temperature: 0.1 },
    ],
    arbiter: { role: 'arbiter', modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.0 },
    confidenceThreshold: 0.85,
  };
}

function makeConfig(panels: Record<string, TribunalPanel>): TribunalConfig {
  return {
    version: '1.0.0',
    defaults: { assessorCount: 2, confidenceThreshold: 0.85 },
    panels,
  };
}

function makeBinding(overrides?: Partial<SurfaceBinding>): SurfaceBinding {
  return {
    surfaceId: 'test.surface',
    pattern: 'tribunal',
    roles: {
      assessor_a: { modelPolicy: 'high-quality' },
      assessor_b: { modelPolicy: 'balanced' },
      arbiter: { modelPolicy: 'high-quality' },
    },
    fallbackStrategy: 'safe_block',
    ...overrides,
  };
}

describe('resolvePanel', () => {
  it('resolves by explicit panelId from binding', () => {
    const panel = makePanel('high_assurance');
    const config = makeConfig({ high_assurance: panel });
    const binding = makeBinding({
      tribunalConfig: { panelId: 'high_assurance' },
    });

    const result = resolvePanel(binding, config);

    expect(result).not.toBeNull();
    expect(result!.panelId).toBe('high_assurance');
  });

  it('resolves by surface key convention', () => {
    const panel = makePanel('finance_processing');
    const config = makeConfig({ finance_processing: panel });
    const binding = makeBinding({ surfaceId: 'finance.processing' });

    const result = resolvePanel(binding, config);

    expect(result).not.toBeNull();
    expect(result!.panelId).toBe('finance_processing');
  });

  it('falls back to default panel', () => {
    const panel = makePanel('default');
    const config = makeConfig({ default: panel });
    const binding = makeBinding({ surfaceId: 'unknown.surface' });

    const result = resolvePanel(binding, config);

    expect(result).not.toBeNull();
    expect(result!.panelId).toBe('default');
  });

  it('returns null when no panel can be resolved', () => {
    const config = makeConfig({});
    const binding = makeBinding({ surfaceId: 'unknown.surface' });

    const result = resolvePanel(binding, config);

    expect(result).toBeNull();
  });

  it('prioritizes explicit panelId over surface key', () => {
    const explicitPanel = makePanel('explicit');
    const surfacePanel = makePanel('test_surface');
    const config = makeConfig({ explicit: explicitPanel, test_surface: surfacePanel });
    const binding = makeBinding({
      surfaceId: 'test.surface',
      tribunalConfig: { panelId: 'explicit' },
    });

    const result = resolvePanel(binding, config);

    expect(result!.panelId).toBe('explicit');
  });
});
