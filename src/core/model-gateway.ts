/**
 * Enhanced Model Gateway
 *
 * Purpose-based routing, profile selection, provider policy enforcement.
 * Every model call is audited. 5 modes: host, disabled, direct, local, router.
 */

import { createLogger } from '../utils/logger.js';
import { createHash } from 'crypto';
import type { ProviderProfile, ProviderPurpose } from './provider-profiles.js';
import { selectProfileForPurpose, selectFallbackProfile } from './provider-profiles.js';
import { enforceProviderPolicy, type ProviderPolicy } from './provider-policy.js';

const logger = createLogger('model-gateway');

// ===========================================================================
// Types
// ===========================================================================

export interface ModelCallOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  context?: Record<string, unknown>;
  surfaceId?: string;
  timeoutMs?: number;
}

export interface ModelResponse {
  text: string;
  model: string;
  providerId: string;
  confidence: number;
  latency: number;
  tokenUsage?: { input: number; output: number };
}

export interface ModelCallAuditRecord {
  timestamp: string;
  providerId: string;
  modelId: string;
  purpose: ProviderPurpose;
  promptHash: string;
  outputHash: string;
  policyVersion: string;
  latencyMs: number;
  success: boolean;
  error?: string;
}

/**
 * Host callback function type. The host agent provides this to handle
 * model calls through its own credentials.
 */
export type HostModelCallback = (
  prompt: string,
  options: ModelCallOptions,
) => Promise<ModelResponse>;

/**
 * Direct/local HTTP adapter function type.
 */
export type HttpAdapterFn = (
  endpoint: string,
  apiKey: string,
  prompt: string,
  options: ModelCallOptions,
  profile: ProviderProfile,
) => Promise<ModelResponse>;

// ===========================================================================
// Gateway Configuration
// ===========================================================================

export interface ModelGatewayConfig {
  profiles: ProviderProfile[];
  policy: ProviderPolicy;
  hostCallback?: HostModelCallback;
  httpAdapter?: HttpAdapterFn;
  currentLab?: string;
  onAudit?: (record: ModelCallAuditRecord) => void;
}

// ===========================================================================
// Model Gateway
// ===========================================================================

export class ModelGateway {
  private readonly profiles: ProviderProfile[];
  private readonly policy: ProviderPolicy;
  private readonly hostCallback?: HostModelCallback;
  private readonly httpAdapter?: HttpAdapterFn;
  private readonly currentLab?: string;
  private readonly onAudit?: (record: ModelCallAuditRecord) => void;
  private readonly auditLog: ModelCallAuditRecord[] = [];

  constructor(config: ModelGatewayConfig) {
    this.profiles = config.profiles;
    this.policy = config.policy;
    this.hostCallback = config.hostCallback;
    this.httpAdapter = config.httpAdapter;
    this.currentLab = config.currentLab;
    this.onAudit = config.onAudit;
  }

  /**
   * Call a model for a specific purpose. The gateway selects the best
   * profile and routes through the appropriate adapter.
   */
  async call(
    purpose: ProviderPurpose,
    prompt: string,
    options: ModelCallOptions = {},
  ): Promise<ModelResponse> {
    const profile = selectProfileForPurpose(this.profiles, purpose);

    if (!profile) {
      throw new ModelGatewayError('NO_PROFILE', `No profile available for purpose '${purpose}'`);
    }

    return this.callWithProfile(profile, purpose, prompt, options);
  }

  /**
   * Call using a specific profile, with policy enforcement and audit.
   */
  private async callWithProfile(
    profile: ProviderProfile,
    purpose: ProviderPurpose,
    prompt: string,
    options: ModelCallOptions,
  ): Promise<ModelResponse> {
    // Enforce provider policy
    const enforcement = enforceProviderPolicy(
      this.policy,
      profile,
      options.surfaceId,
      this.currentLab,
    );

    if (!enforcement.allowed) {
      // Try fallback from same group
      const fallback = selectFallbackProfile(this.profiles, profile, purpose);
      if (fallback) {
        logger.info(
          { from: profile.providerId, to: fallback.providerId },
          'Falling back to alternate profile',
        );
        return this.callWithProfile(fallback, purpose, prompt, options);
      }
      throw new ModelGatewayError('POLICY_BLOCKED', enforcement.reason ?? 'Blocked by policy');
    }

    const startTime = Date.now();
    let response: ModelResponse;

    try {
      response = await this.dispatch(profile, purpose, prompt, options);
    } catch (err) {
      const latency = Date.now() - startTime;
      this.recordAudit(profile, purpose, prompt, '', latency, false, String(err));

      // Try fallback on error
      const fallback = selectFallbackProfile(this.profiles, profile, purpose);
      if (fallback) {
        logger.info(
          { from: profile.providerId, to: fallback.providerId, error: String(err) },
          'Error fallback to alternate profile',
        );
        return this.callWithProfile(fallback, purpose, prompt, options);
      }
      throw err;
    }

    const latency = Date.now() - startTime;
    this.recordAudit(profile, purpose, prompt, response.text, latency, true);

    return response;
  }

  /**
   * Dispatch to the appropriate adapter based on profile type.
   */
  private async dispatch(
    profile: ProviderProfile,
    purpose: ProviderPurpose,
    prompt: string,
    options: ModelCallOptions,
  ): Promise<ModelResponse> {
    const timeout = options.timeoutMs ?? profile.timeoutMs;

    switch (profile.adapter) {
      case 'disabled':
        throw new ModelGatewayError(
          'DISABLED',
          `Provider '${profile.providerId}' is disabled`,
        );

      case 'host':
        return this.dispatchHost(profile, prompt, options, timeout);

      case 'direct':
        return this.dispatchDirect(profile, prompt, options, timeout);

      case 'local':
        return this.dispatchLocal(profile, prompt, options, timeout);

      case 'router':
        // Router mode delegates to the best available profile in the fallback group
        return this.dispatchRouter(profile, purpose, prompt, options);

      default:
        throw new ModelGatewayError('UNKNOWN_ADAPTER', `Unknown adapter: ${profile.adapter}`);
    }
  }

  private async dispatchHost(
    profile: ProviderProfile,
    prompt: string,
    options: ModelCallOptions,
    timeout: number,
  ): Promise<ModelResponse> {
    if (!this.hostCallback) {
      throw new ModelGatewayError(
        'NO_HOST_CALLBACK',
        'Host mode requires a hostCallback in gateway config',
      );
    }

    const result = await withTimeout(this.hostCallback(prompt, options), timeout);
    return { ...result, providerId: profile.providerId, model: profile.modelId };
  }

  private async dispatchDirect(
    profile: ProviderProfile,
    prompt: string,
    options: ModelCallOptions,
    timeout: number,
  ): Promise<ModelResponse> {
    if (!this.httpAdapter) {
      throw new ModelGatewayError(
        'NO_HTTP_ADAPTER',
        'Direct mode requires an httpAdapter in gateway config',
      );
    }

    if (!profile.envVarName) {
      throw new ModelGatewayError(
        'NO_ENV_VAR',
        'Direct profile requires envVarName',
      );
    }

    const apiKey = process.env[profile.envVarName];
    if (!apiKey) {
      throw new ModelGatewayError(
        'MISSING_CREDENTIAL',
        `Environment variable '${profile.envVarName}' not set`,
      );
    }

    const endpoint = profile.endpoint ?? '';
    const result = await withTimeout(
      this.httpAdapter(endpoint, apiKey, prompt, options, profile),
      timeout,
    );
    return { ...result, providerId: profile.providerId };
  }

  private async dispatchLocal(
    profile: ProviderProfile,
    prompt: string,
    options: ModelCallOptions,
    timeout: number,
  ): Promise<ModelResponse> {
    if (!this.httpAdapter) {
      throw new ModelGatewayError(
        'NO_HTTP_ADAPTER',
        'Local mode requires an httpAdapter in gateway config',
      );
    }

    if (!profile.endpoint) {
      throw new ModelGatewayError(
        'NO_ENDPOINT',
        'Local profile requires endpoint URL',
      );
    }

    // Local mode uses empty string for API key (OpenAI-compatible local server)
    const result = await withTimeout(
      this.httpAdapter(profile.endpoint, '', prompt, options, profile),
      timeout,
    );
    return { ...result, providerId: profile.providerId };
  }

  private async dispatchRouter(
    profile: ProviderProfile,
    purpose: ProviderPurpose,
    prompt: string,
    options: ModelCallOptions,
  ): Promise<ModelResponse> {
    // Router selects from its fallback group
    if (!profile.fallbackGroup) {
      throw new ModelGatewayError(
        'NO_FALLBACK_GROUP',
        'Router profile requires a fallbackGroup',
      );
    }

    const candidates = this.profiles.filter(
      p =>
        p.providerId !== profile.providerId &&
        p.adapter !== 'disabled' &&
        p.adapter !== 'router' &&
        p.fallbackGroup === profile.fallbackGroup,
    );

    if (candidates.length === 0) {
      throw new ModelGatewayError(
        'NO_ROUTE',
        `No candidates in fallback group '${profile.fallbackGroup}'`,
      );
    }

    // Route to first candidate (could be extended with load balancing). Go back
    // through callWithProfile so provider allowlists, surface overrides, and
    // cross-lab policy apply to the concrete provider, not just the router.
    return this.callWithProfile(candidates[0], purpose, prompt, options);
  }

  /**
   * Record an audit entry for a model call.
   */
  private recordAudit(
    profile: ProviderProfile,
    purpose: ProviderPurpose,
    prompt: string,
    output: string,
    latencyMs: number,
    success: boolean,
    error?: string,
  ): void {
    const record: ModelCallAuditRecord = {
      timestamp: new Date().toISOString(),
      providerId: profile.providerId,
      modelId: profile.modelId,
      purpose,
      promptHash: hashContent(prompt),
      outputHash: hashContent(output),
      policyVersion: this.policy.policyVersion,
      latencyMs,
      success,
      error,
    };

    this.auditLog.push(record);
    this.onAudit?.(record);

    logger.info(
      {
        providerId: record.providerId,
        modelId: record.modelId,
        purpose: record.purpose,
        latencyMs: record.latencyMs,
        success: record.success,
      },
      'Model call audited',
    );
  }

  /**
   * Get the full audit log.
   */
  getAuditLog(): readonly ModelCallAuditRecord[] {
    return this.auditLog;
  }

  /**
   * Get the current set of profiles.
   */
  getProfiles(): readonly ProviderProfile[] {
    return this.profiles;
  }
}

// ===========================================================================
// Error Type
// ===========================================================================

export type ModelGatewayErrorCode =
  | 'NO_PROFILE'
  | 'POLICY_BLOCKED'
  | 'DISABLED'
  | 'NO_HOST_CALLBACK'
  | 'NO_HTTP_ADAPTER'
  | 'NO_ENV_VAR'
  | 'MISSING_CREDENTIAL'
  | 'NO_ENDPOINT'
  | 'NO_FALLBACK_GROUP'
  | 'NO_ROUTE'
  | 'TIMEOUT'
  | 'UNKNOWN_ADAPTER';

export class ModelGatewayError extends Error {
  constructor(
    public readonly code: ModelGatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ModelGatewayError';
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ModelGatewayError('TIMEOUT', `Timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
