/**
 * MCP Tool Definitions for Onboarding Flow
 *
 * Registers dc_onboard_start, dc_onboard_answer, dc_onboard_generate,
 * and dc_onboard_validate tools on the MCP server.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '../../utils/logger.js';
import { OnboardingService } from './onboarding.service.js';

const logger = createLogger('onboarding-tools');

function errorResponse(message: string): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}

function successResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Register onboarding tools on the MCP server.
 */
export function registerOnboardingTools(
  server: McpServer,
  tenantId: string,
  service?: OnboardingService,
): void {
  const onboarding = service ?? new OnboardingService();

  // --- dc_onboard_start ---
  server.tool(
    'dc_onboard_start',
    'Begin the Decision Core onboarding interview. Returns phase 1 questions.',
    {},
    async () => {
      try {
        const result = onboarding.startOnboarding(tenantId);
        logger.info({ sessionId: result.sessionId }, 'dc_onboard_start called');
        return successResponse(result);
      } catch (err) {
        logger.error({ err }, 'dc_onboard_start failed');
        return errorResponse(err instanceof Error ? err.message : 'Start failed');
      }
    },
  );

  // --- dc_onboard_answer ---
  server.tool(
    'dc_onboard_answer',
    'Submit answers for the current onboarding phase. Returns the next phase questions or generated config.',
    {
      sessionId: z.string().describe('The onboarding session ID from dc_onboard_start'),
      phase: z.number().int().min(1).max(4).describe('The phase number being answered (1-4)'),
      answers: z.record(z.unknown()).describe('Answers keyed by question ID'),
    },
    async (params) => {
      try {
        const result = onboarding.processPhaseAnswers(
          params.sessionId,
          params.phase,
          params.answers,
        );
        logger.info({ sessionId: params.sessionId, phase: params.phase }, 'dc_onboard_answer called');
        return successResponse(result);
      } catch (err) {
        logger.error({ err, sessionId: params.sessionId, phase: params.phase }, 'dc_onboard_answer failed');
        return errorResponse(err instanceof Error ? err.message : 'Answer processing failed');
      }
    },
  );

  // --- dc_onboard_generate ---
  server.tool(
    'dc_onboard_generate',
    'Generate Decision Core configuration from complete onboarding answers (all 4 phases).',
    {
      phase1: z.object({
        agentDescription: z.string(),
        agentTools: z.array(z.string()),
        dataAccess: z.array(z.string()),
        environment: z.string(),
      }).describe('Phase 1 answers: agent discovery'),
      phase2: z.object({
        highRiskTools: z.array(z.string()),
        mediumRiskTools: z.array(z.string()),
        externalServices: z.boolean(),
        canSpendMoney: z.boolean(),
        piiHandling: z.boolean(),
      }).describe('Phase 2 answers: risk assessment'),
      phase3: z.object({
        riskProfile: z.string(),
        teamSize: z.string(),
        complianceRequirements: z.array(z.string()),
        approvalWorkflow: z.string(),
      }).describe('Phase 3 answers: governance posture'),
      phase4: z.object({
        providerMode: z.string(),
        apiKeyEnvVar: z.string().optional(),
        localEndpoint: z.string().optional(),
      }).describe('Phase 4 answers: provider selection'),
    },
    async (params) => {
      try {
        const config = onboarding.generateConfig(params as never);
        logger.info('dc_onboard_generate called');
        return successResponse(config);
      } catch (err) {
        logger.error({ err }, 'dc_onboard_generate failed');
        return errorResponse(err instanceof Error ? err.message : 'Generation failed');
      }
    },
  );

  // --- dc_onboard_validate ---
  server.tool(
    'dc_onboard_validate',
    'Validate generated Decision Core configuration for correctness and security.',
    {
      policies: z.string().describe('Generated policies.yaml content'),
      surfaces: z.string().describe('Generated surfaces.yaml content'),
      provider: z.string().describe('Generated provider config YAML content'),
    },
    async (params) => {
      try {
        const result = onboarding.validateConfig(params);
        logger.info({ valid: result.valid }, 'dc_onboard_validate called');
        return successResponse(result);
      } catch (err) {
        logger.error({ err }, 'dc_onboard_validate failed');
        return errorResponse(err instanceof Error ? err.message : 'Validation failed');
      }
    },
  );

  logger.info({ toolCount: 4 }, 'Onboarding MCP tools registered');
}
