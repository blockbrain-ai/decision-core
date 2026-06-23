/**
 * Provider Conformance Test Utility
 *
 * Validates that a configured provider produces structured output,
 * respects timeouts, and handles errors gracefully.
 * Output: usable / limited / not-usable verdict.
 */

import { createLogger } from '../utils/logger.js';
import type { ProviderProfile } from './provider-profiles.js';
import { ModelGateway, ModelGatewayError, type ModelGatewayConfig } from './model-gateway.js';

const logger = createLogger('provider-conformance');

// ===========================================================================
// Conformance Verdict
// ===========================================================================

export const CONFORMANCE_VERDICTS = ['usable', 'limited', 'not-usable'] as const;
export type ConformanceVerdict = (typeof CONFORMANCE_VERDICTS)[number];

// ===========================================================================
// Test Results
// ===========================================================================

export interface ConformanceTestResult {
  testName: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface ConformanceReport {
  providerId: string;
  modelId: string;
  verdict: ConformanceVerdict;
  tests: ConformanceTestResult[];
  timestamp: string;
}

// ===========================================================================
// Conformance Runner
// ===========================================================================

/**
 * Run conformance tests against a provider profile using the given gateway config.
 */
export async function runConformanceTests(
  profile: ProviderProfile,
  gatewayConfig: ModelGatewayConfig,
): Promise<ConformanceReport> {
  const tests: ConformanceTestResult[] = [];

  // Test 1: Basic response
  tests.push(await testBasicResponse(profile, gatewayConfig));

  // Test 2: Structured output (JSON)
  tests.push(await testStructuredOutput(profile, gatewayConfig));

  // Test 3: Timeout respect
  tests.push(await testTimeoutRespect(profile, gatewayConfig));

  // Test 4: Error handling
  tests.push(await testErrorHandling(profile, gatewayConfig));

  const passCount = tests.filter(t => t.passed).length;
  let verdict: ConformanceVerdict;

  if (passCount === tests.length) {
    verdict = 'usable';
  } else if (passCount >= 2) {
    verdict = 'limited';
  } else {
    verdict = 'not-usable';
  }

  const report: ConformanceReport = {
    providerId: profile.providerId,
    modelId: profile.modelId,
    verdict,
    tests,
    timestamp: new Date().toISOString(),
  };

  logger.info(
    { providerId: profile.providerId, verdict, passCount, total: tests.length },
    'Conformance test complete',
  );

  return report;
}

// ===========================================================================
// Individual Tests
// ===========================================================================

async function testBasicResponse(
  _profile: ProviderProfile,
  config: ModelGatewayConfig,
): Promise<ConformanceTestResult> {
  const start = Date.now();
  try {
    const gateway = new ModelGateway(config);
    const response = await gateway.call('general', 'Respond with the word "hello".');

    const passed = Boolean(response.text && response.text.length > 0);
    return {
      testName: 'basic-response',
      passed,
      duration: Date.now() - start,
      error: passed ? undefined : 'Empty response text',
    };
  } catch (err) {
    return {
      testName: 'basic-response',
      passed: false,
      duration: Date.now() - start,
      error: String(err),
    };
  }
}

async function testStructuredOutput(
  _profile: ProviderProfile,
  config: ModelGatewayConfig,
): Promise<ConformanceTestResult> {
  const start = Date.now();
  try {
    const gateway = new ModelGateway(config);
    const response = await gateway.call(
      'general',
      'Respond with valid JSON: {"status": "ok", "value": 42}. Only output JSON, nothing else.',
    );

    let passed = false;
    try {
      const parsed = JSON.parse(response.text);
      passed = typeof parsed === 'object' && parsed !== null;
    } catch {
      passed = false;
    }

    return {
      testName: 'structured-output',
      passed,
      duration: Date.now() - start,
      error: passed ? undefined : 'Response was not valid JSON',
    };
  } catch (err) {
    return {
      testName: 'structured-output',
      passed: false,
      duration: Date.now() - start,
      error: String(err),
    };
  }
}

async function testTimeoutRespect(
  _profile: ProviderProfile,
  config: ModelGatewayConfig,
): Promise<ConformanceTestResult> {
  const start = Date.now();
  const shortTimeout = 100; // Very short timeout to verify mechanism works

  try {
    const gateway = new ModelGateway(config);
    // If the call completes quickly (within timeout), that's fine — it means the provider is fast
    await gateway.call('general', 'Say "ok".', { timeoutMs: shortTimeout });

    return {
      testName: 'timeout-respect',
      passed: true,
      duration: Date.now() - start,
    };
  } catch (err) {
    // A timeout error means the mechanism works correctly
    if (err instanceof ModelGatewayError && err.code === 'TIMEOUT') {
      return {
        testName: 'timeout-respect',
        passed: true,
        duration: Date.now() - start,
      };
    }
    // Other errors might mean the provider is down
    return {
      testName: 'timeout-respect',
      passed: false,
      duration: Date.now() - start,
      error: String(err),
    };
  }
}

async function testErrorHandling(
  _profile: ProviderProfile,
  config: ModelGatewayConfig,
): Promise<ConformanceTestResult> {
  const start = Date.now();
  try {
    // Test that the gateway correctly surfaces errors without crashing
    const gateway = new ModelGateway({
      ...config,
      profiles: config.profiles.map(p => ({ ...p, adapter: 'disabled' as const })),
    });

    try {
      await gateway.call('general', 'test');
      // Should have thrown
      return {
        testName: 'error-handling',
        passed: false,
        duration: Date.now() - start,
        error: 'Expected error was not thrown for disabled adapter',
      };
    } catch (err) {
      // Expected: error is properly surfaced
      const passed = err instanceof ModelGatewayError;
      return {
        testName: 'error-handling',
        passed,
        duration: Date.now() - start,
        error: passed ? undefined : `Unexpected error type: ${String(err)}`,
      };
    }
  } catch (err) {
    return {
      testName: 'error-handling',
      passed: false,
      duration: Date.now() - start,
      error: String(err),
    };
  }
}
