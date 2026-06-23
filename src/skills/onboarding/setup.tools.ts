/**
 * MCP Tool Definitions for Agent-Led Setup Flow
 *
 * Registers dc_setup_detect, dc_setup_infer, dc_setup_generate,
 * dc_setup_validate, and dc_setup_activate tools on the MCP server.
 * Runtime activation comes from writing policy-pack.yaml plus decision-core.yaml;
 * dc_setup_activate is a confirmation/verification marker for agent-led flows.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '../../utils/logger.js';
import { detectAgentEnvironment } from '../../onboarding/detect-agent-env.js';
import {
  createEmptyProfile,
  redactProfileForReport,
} from '../../contracts/onboarding-profile.contracts.js';
import type { OnboardingProfile } from '../../contracts/onboarding-profile.contracts.js';
import { importMemoryEvidence } from '../../onboarding/memory-evidence/memory-evidence-importer.js';
import {
  inferProfileFromEvidence,
  applyInferenceToProfile,
} from '../../onboarding/memory-evidence/memory-evidence-profile-inference.js';
import {
  planInterview,
  applyModeDefaults,
} from '../../onboarding/interview-engine.js';
import { generateArtifacts } from '../../onboarding/generate-artifacts.js';
import { validateGeneratedArtifacts } from '../../onboarding/validate-generated-artifacts.js';

const logger = createLogger('setup-tools');

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

let activeProfile: OnboardingProfile | null = null;

export function registerSetupTools(server: McpServer): void {
  // --- dc_setup_detect ---
  server.tool(
    'dc_setup_detect',
    'Detect agent environment: harness, tools, provider env vars, and memory sources.',
    { scanRoot: z.string().optional().describe('Directory to scan (default: cwd)') },
    async (params) => {
      try {
        const root = params.scanRoot ?? process.cwd();
        const env = detectAgentEnvironment(root);

        activeProfile = createEmptyProfile(`setup-${Date.now()}`);
        activeProfile.agent = {
          harness: env.harness.harness,
          harnessVersion: env.harness.version,
          detectedTools: env.tools.map((t) => t.name),
          detectedCapabilities: [],
          configPaths: env.harness.configPaths,
        };
        activeProfile.memory.sources = env.memorySources;

        logger.info({ harness: env.harness.harness }, 'dc_setup_detect');
        return successResponse({
          harness: env.harness,
          provider: { suggestedMode: env.provider.suggestedMode, envVarNames: env.provider.envVarNames },
          tools: env.tools,
          memorySources: env.memorySources.filter((s) => s.detected),
          profileId: activeProfile.profileId,
        });
      } catch (err) {
        logger.error({ err }, 'dc_setup_detect failed');
        return errorResponse(err instanceof Error ? err.message : 'Detection failed');
      }
    },
  );

  // --- dc_setup_infer ---
  server.tool(
    'dc_setup_infer',
    'Import memory evidence exports and infer profile fields. Returns inferred suggestions and interview plan.',
    {
      exports: z.array(z.any()).describe('Array of MemoryEvidenceExport JSON objects'),
      mode: z.string().optional().describe('Profile mode override: personal|team|business|enterprise'),
    },
    async (params) => {
      try {
        if (!activeProfile) {
          return errorResponse('Call dc_setup_detect first');
        }

        const importResults = params.exports.map((exp: unknown) => importMemoryEvidence(exp));
        const validExports = importResults
          .filter((r) => r.success && r.export)
          .map((r) => r.export!);

        const inference = inferProfileFromEvidence(validExports);
        activeProfile = applyInferenceToProfile(activeProfile, inference);
        activeProfile.memory.evidenceImported = validExports.length > 0;

        if (params.mode) {
          activeProfile.mode = params.mode as OnboardingProfile['mode'];
        }

        activeProfile = applyModeDefaults(activeProfile);

        const plan = planInterview(activeProfile);

        logger.info({ itemsUsed: inference.itemsUsed }, 'dc_setup_infer');
        return successResponse({
          inference,
          interviewPlan: {
            questionsNeeded: plan.questions.length,
            skipped: plan.skippedCount,
            reason: plan.reason,
            questions: plan.questions.map((q) => ({
              id: q.id,
              prompt: q.prompt,
              type: q.type,
              options: q.options,
              defaultValue: q.defaultValue,
              required: q.required,
            })),
          },
          profile: redactProfileForReport(activeProfile),
          importResults: importResults.map((r) => ({
            sourceId: r.sourceId,
            success: r.success,
            itemCount: r.itemCount,
            redactedCount: r.redactedCount,
            errors: r.errors,
          })),
        });
      } catch (err) {
        logger.error({ err }, 'dc_setup_infer failed');
        return errorResponse(err instanceof Error ? err.message : 'Inference failed');
      }
    },
  );

  // --- dc_setup_generate ---
  server.tool(
    'dc_setup_generate',
    'Generate Decision Core artifacts from the current profile. Returns artifact list and validation info.',
    {
      profileOverrides: z.record(z.any()).optional().describe('Profile field overrides from interview answers'),
    },
    async (params) => {
      try {
        if (!activeProfile) {
          return errorResponse('Call dc_setup_detect first');
        }

        if (params.profileOverrides) {
          activeProfile = {
            ...activeProfile,
            ...params.profileOverrides,
            schemaVersion: 1,
            profileId: activeProfile.profileId,
            createdAt: activeProfile.createdAt,
            updatedAt: new Date().toISOString(),
          } as OnboardingProfile;
        }

        const result = generateArtifacts(activeProfile);

        logger.info({ artifactCount: result.artifacts.length }, 'dc_setup_generate');
        return successResponse({
          artifactCount: result.artifacts.length,
          artifacts: result.artifacts.map((a) => ({
            path: a.path,
            category: a.category,
            contentLength: a.content.length,
            content: a.content,
          })),
          profileHash: result.profileHash,
          warnings: result.warnings,
        });
      } catch (err) {
        logger.error({ err }, 'dc_setup_generate failed');
        return errorResponse(err instanceof Error ? err.message : 'Generation failed');
      }
    },
  );

  // --- dc_setup_validate ---
  server.tool(
    'dc_setup_validate',
    'Validate generated artifacts: check policies parse, lint cleanly, and scenarios are runnable.',
    {},
    async () => {
      try {
        if (!activeProfile) {
          return errorResponse('Call dc_setup_detect and dc_setup_generate first');
        }

        const result = generateArtifacts(activeProfile);
        const validation = validateGeneratedArtifacts(result.artifacts);

        logger.info({ valid: validation.valid, policyCount: validation.policyCount }, 'dc_setup_validate');
        return successResponse({
          valid: validation.valid,
          policyCount: validation.policyCount,
          scenarioCount: validation.scenarioCount,
          registryLoaded: validation.registryLoaded,
          issues: validation.issues,
          warnings: result.warnings,
        });
      } catch (err) {
        logger.error({ err }, 'dc_setup_validate failed');
        return errorResponse(err instanceof Error ? err.message : 'Validation failed');
      }
    },
  );

  // --- dc_setup_activate ---
  server.tool(
    'dc_setup_activate',
    'Confirm generated runtime setup after artifacts have been written. Requires explicit confirmation.',
    {
      confirmed: z.boolean().describe('Must be true to activate'),
      projectRoot: z.string().optional().describe('Optional project root to verify decision-core.yaml and .decision-core/policy-pack.yaml exist'),
    },
    async (params) => {
      try {
        if (!activeProfile) {
          return errorResponse('Call dc_setup_detect and dc_setup_generate first');
        }

        if (!params.confirmed) {
          return errorResponse('Activation requires confirmed: true');
        }

        let runtimeVerified = false;
        if (params.projectRoot) {
          const { existsSync } = await import('node:fs');
          const { resolve } = await import('node:path');
          const configPath = resolve(params.projectRoot, 'decision-core.yaml');
          const packPath = resolve(params.projectRoot, '.decision-core', 'policy-pack.yaml');
          if (!existsSync(configPath) || !existsSync(packPath)) {
            return errorResponse('Runtime files are missing. Expected decision-core.yaml and .decision-core/policy-pack.yaml.');
          }
          runtimeVerified = true;
        }

        activeProfile.activatedAt = new Date().toISOString();

        logger.info({ profileId: activeProfile.profileId }, 'dc_setup_activate');
        return successResponse({
          activated: true,
          runtimeVerified,
          note: 'Runtime enforcement is active when decision-core.yaml points at .decision-core/policy-pack.yaml.',
          profileId: activeProfile.profileId,
          activatedAt: activeProfile.activatedAt,
        });
      } catch (err) {
        logger.error({ err }, 'dc_setup_activate failed');
        return errorResponse(err instanceof Error ? err.message : 'Activation failed');
      }
    },
  );
}

export function getActiveProfile(): OnboardingProfile | null {
  return activeProfile;
}

export function resetActiveProfile(): void {
  activeProfile = null;
}
