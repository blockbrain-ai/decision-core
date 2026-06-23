import { describe, it, expect, vi } from 'vitest';
import { executePattern } from './pattern-executor.js';
import type { ModelGatewayAdapter, ModelResponse } from '../../adapters/model-gateway.js';
import type { PatternContext, SurfaceBinding } from '../trust.contracts.js';

function makeGateway(response?: Partial<ModelResponse>): ModelGatewayAdapter {
  return {
    evaluate: vi.fn().mockResolvedValue({
      text: 'test output',
      model: 'test-model',
      confidence: 0.9,
      latency: 100,
      ...response,
    }),
  };
}

function makeContext(overrides?: Partial<PatternContext>): PatternContext {
  return {
    surfaceId: 'test.surface',
    prompt: 'Test prompt',
    tenantId: 'tenant-1',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function makeBinding(overrides?: Partial<SurfaceBinding>): SurfaceBinding {
  return {
    surfaceId: 'test.surface',
    pattern: 'single_model',
    roles: {
      primary: { modelPolicy: 'balanced', maxTokens: 500, temperature: 0.1 },
    },
    fallbackStrategy: 'safe_block',
    ...overrides,
  };
}

describe('PatternExecutor', () => {
  describe('fail-closed behavior', () => {
    it('returns safe_block when no gateway provided for single_model', async () => {
      const binding = makeBinding({ pattern: 'single_model' });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway: undefined });

      expect(result.autonomyStatus).toBe('safe_block');
      expect(result.reason).toBe('model_gateway_unavailable');
      expect(result.verificationStatus).toBe('fallback');
      expect(result.output).toBeNull();
    });

    it('returns safe_block when no gateway provided for primary_reviewer', async () => {
      const binding = makeBinding({ pattern: 'primary_reviewer' });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway: undefined });

      expect(result.autonomyStatus).toBe('safe_block');
      expect(result.reason).toBe('model_gateway_unavailable');
    });

    it('returns safe_block when no gateway provided for tribunal', async () => {
      const binding = makeBinding({ pattern: 'tribunal' });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway: undefined });

      expect(result.autonomyStatus).toBe('safe_block');
      expect(result.reason).toBe('model_gateway_unavailable');
    });

    it('returns safe_block when no gateway provided for a5_hybrid', async () => {
      const binding = makeBinding({ pattern: 'a5_hybrid' });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway: undefined });

      expect(result.autonomyStatus).toBe('safe_block');
      expect(result.reason).toBe('model_gateway_unavailable');
    });
  });

  describe('single_model pattern', () => {
    it('executes successfully with gateway', async () => {
      const gateway = makeGateway({ confidence: 0.95 });
      const binding = makeBinding({ pattern: 'single_model' });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.patternUsed).toBe('single_model');
      expect(result.output).toBe('test output');
      expect(result.confidence).toBe(0.95);
      expect(result.verificationStatus).toBe('verified');
      expect(result.autonomyStatus).toBe('verified_autonomous');
    });

    it('flags review_required when below confidence threshold', async () => {
      const gateway = makeGateway({ confidence: 0.5 });
      const binding = makeBinding({
        pattern: 'single_model',
        confidenceThreshold: 0.8,
      });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.verificationStatus).toBe('review_required');
      expect(result.autonomyStatus).toBe('safe_block');
      expect(result.reason).toBe('confidence_below_threshold');
    });
  });

  describe('primary_reviewer pattern', () => {
    it('executes successfully when reviewer agrees', async () => {
      const gateway = makeGateway({ confidence: 0.9 });
      const binding = makeBinding({
        pattern: 'primary_reviewer',
        roles: {
          primary: { modelPolicy: 'balanced', maxTokens: 500, temperature: 0.1 },
          reviewer: { modelPolicy: 'high-quality', maxTokens: 300, temperature: 0.0 },
        },
      });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.patternUsed).toBe('primary_reviewer');
      expect(result.verificationStatus).toBe('verified');
      expect(result.finalDecisionSource).toBe('reviewer');
    });

    it('flags review_required when reviewer has low confidence', async () => {
      let callCount = 0;
      const gateway: ModelGatewayAdapter = {
        evaluate: vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            text: 'output',
            model: 'test-model',
            confidence: callCount === 1 ? 0.8 : 0.3, // reviewer low confidence
            latency: 50,
          });
        }),
      };
      const binding = makeBinding({
        pattern: 'primary_reviewer',
        roles: {
          primary: { modelPolicy: 'balanced', maxTokens: 500, temperature: 0.1 },
          reviewer: { modelPolicy: 'high-quality', maxTokens: 300, temperature: 0.0 },
        },
      });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.patternUsed).toBe('primary_reviewer');
      expect(result.verificationStatus).toBe('review_required');
      expect(result.reason).toBe('reviewer_disagreed');
    });
  });

  describe('tribunal pattern', () => {
    it('executes with arbiter synthesis', async () => {
      const gateway = makeGateway({ confidence: 0.9 });
      const binding = makeBinding({
        pattern: 'tribunal',
        roles: {
          assessor_a: { modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.1 },
          assessor_b: { modelPolicy: 'balanced', maxTokens: 700, temperature: 0.1 },
          arbiter: { modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.0 },
        },
        tribunalConfig: {
          arbiterOnDisagreementOnly: false,
          confidenceThreshold: 0.85,
        },
      });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.patternUsed).toBe('tribunal');
      expect(result.finalDecisionSource).toBe('tribunal_arbiter');
      expect(result.verificationStatus).toBe('verified');
    });

    it('skips arbiter in lazy mode when assessors agree', async () => {
      const gateway: ModelGatewayAdapter = {
        evaluate: vi.fn().mockResolvedValue({
          text: 'agreed output',
          model: 'test-model',
          confidence: 0.95,
          latency: 50,
        }),
      };
      const binding = makeBinding({
        pattern: 'tribunal',
        roles: {
          assessor_a: { modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.1 },
          assessor_b: { modelPolicy: 'balanced', maxTokens: 700, temperature: 0.1 },
          arbiter: { modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.0 },
        },
        tribunalConfig: {
          arbiterOnDisagreementOnly: true,
          confidenceThreshold: 0.85,
        },
      });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.patternUsed).toBe('tribunal');
      expect(result.output).toBe('agreed output');
      // Only 2 calls (assessors), not 3 (arbiter skipped)
      expect(gateway.evaluate).toHaveBeenCalledTimes(2);
    });

    it('invokes arbiter when assessors disagree in lazy mode', async () => {
      let callCount = 0;
      const gateway: ModelGatewayAdapter = {
        evaluate: vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            text: callCount <= 2 ? `assessor_${callCount}_output` : 'arbiter_output',
            model: 'test-model',
            confidence: 0.9,
            latency: 50,
          });
        }),
      };
      const binding = makeBinding({
        pattern: 'tribunal',
        roles: {
          assessor_a: { modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.1 },
          assessor_b: { modelPolicy: 'balanced', maxTokens: 700, temperature: 0.1 },
          arbiter: { modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.0 },
        },
        tribunalConfig: {
          arbiterOnDisagreementOnly: true,
          confidenceThreshold: 0.85,
        },
      });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.output).toBe('arbiter_output');
      expect(gateway.evaluate).toHaveBeenCalledTimes(3);
    });
  });

  describe('a5_hybrid pattern', () => {
    it('returns primary result when confidence meets threshold', async () => {
      const gateway = makeGateway({ confidence: 0.9 });
      const binding = makeBinding({
        pattern: 'a5_hybrid',
        roles: {
          primary: { modelPolicy: 'balanced', maxTokens: 500, temperature: 0.1 },
          challenger: { modelPolicy: 'balanced', maxTokens: 500, temperature: 0.2 },
          judge: { modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.0 },
        },
        confidenceThreshold: 0.75,
      });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.patternUsed).toBe('a5_hybrid');
      expect(result.finalDecisionSource).toBe('primary');
      expect(result.verificationStatus).toBe('verified');
      // Only primary called (met threshold)
      expect(gateway.evaluate).toHaveBeenCalledTimes(1);
    });

    it('escalates to challengers when primary is below threshold', async () => {
      let callCount = 0;
      const gateway: ModelGatewayAdapter = {
        evaluate: vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            text: `output_${callCount}`,
            model: 'test-model',
            confidence: callCount === 1 ? 0.5 : 0.9, // primary low, challenger high
            latency: 50,
          });
        }),
      };
      const binding = makeBinding({
        pattern: 'a5_hybrid',
        roles: {
          primary: { modelPolicy: 'balanced', maxTokens: 500, temperature: 0.1 },
          challenger: { modelPolicy: 'balanced', maxTokens: 500, temperature: 0.2 },
          judge: { modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.0 },
        },
        confidenceThreshold: 0.75,
      });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.patternUsed).toBe('a5_hybrid');
      expect(result.finalDecisionSource).toBe('reviewer');
      expect(result.verificationStatus).toBe('verified');
    });

    it('escalates to judge when all challengers fail threshold', async () => {
      let callCount = 0;
      const gateway: ModelGatewayAdapter = {
        evaluate: vi.fn().mockImplementation(() => {
          callCount++;
          // primary + 2 challengers low, judge high
          const confidence = callCount <= 3 ? 0.5 : 0.9;
          return Promise.resolve({
            text: `output_${callCount}`,
            model: 'test-model',
            confidence,
            latency: 50,
          });
        }),
      };
      const binding = makeBinding({
        pattern: 'a5_hybrid',
        roles: {
          primary: { modelPolicy: 'balanced', maxTokens: 500, temperature: 0.1 },
          challenger: { modelPolicy: 'balanced', maxTokens: 500, temperature: 0.2 },
          judge: { modelPolicy: 'high-quality', maxTokens: 700, temperature: 0.0 },
        },
        confidenceThreshold: 0.75,
      });
      const context = makeContext();

      const result = await executePattern(binding, context, { gateway });

      expect(result.patternUsed).toBe('a5_hybrid');
      expect(result.finalDecisionSource).toBe('tribunal_arbiter');
      expect(result.verificationStatus).toBe('verified');
    });
  });
});
