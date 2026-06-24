/**
 * MCP Tool Definitions
 *
 * Each tool maps to one SDK/core function. Thin serialization layer only.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import { ActionTypePatternSchema, ActionTypeSchema } from '../../contracts/policy.contracts.js';
import { createLogger } from '../../utils/logger.js';
import type { McpServerDeps } from './types.js';

const logger = createLogger('mcp-tools');

/**
 * Create a structured error response for MCP tools.
 */
function errorResponse(message: string): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}

/**
 * Create a success response for MCP tools.
 */
function successResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Register all Decision Core tools on the MCP server.
 */
export function registerTools(
  server: McpServer,
  deps: McpServerDeps,
  config?: { allowPolicyMutations?: boolean },
): void {
  const tenantId = deps.tenantId as TenantId;
  const allowMutations = config?.allowPolicyMutations ?? false;

  // --- evaluate ---
  server.tool(
    'evaluate',
    'Evaluate policy rules against an action. Returns allow/deny/approve_required verdict.',
    {
      surfaceId: z.string().describe('The surface requesting the action (e.g., "mcp", "cli", "api")'),
      action: ActionTypeSchema.describe('The action type to evaluate (e.g., "file.write", "deploy.production")'),
      context: z.record(z.unknown()).optional().describe('Additional context for policy evaluation'),
    },
    async (params) => {
      try {
        const result = await deps.policyEvaluator.evaluate(
          tenantId,
          params.surfaceId,
          params.action,
          params.context,
        );
        logger.info({ action: params.action, verdict: result.verdict }, 'evaluate tool called');
        return successResponse(result);
      } catch (err) {
        logger.error({ err, action: params.action }, 'evaluate tool failed');
        return errorResponse(err instanceof Error ? err.message : 'Evaluation failed');
      }
    },
  );

  // --- query_policy ---
  server.tool(
    'query_policy',
    'Query policy rules with optional filters. Returns matching rules.',
    {
      policyType: z.string().optional().describe('Filter by policy type (safety, compliance, business, resource, quality)'),
      riskClass: z.string().optional().describe('Filter by risk class (A, B, C)'),
      enforcementPoint: z.string().optional().describe('Filter by enforcement point (pre_decision, action_dispatch, post_execution)'),
      enabled: z.boolean().optional().describe('Filter by enabled status'),
      limit: z.number().optional().describe('Maximum number of rules to return'),
      offset: z.number().optional().describe('Number of rules to skip'),
    },
    async (params) => {
      try {
        const rules = await deps.policyRuleRepo.findAll(tenantId, {
          policyType: params.policyType,
          riskClass: params.riskClass,
          enforcementPoint: params.enforcementPoint,
          enabled: params.enabled,
          limit: params.limit,
          offset: params.offset,
        });
        logger.info({ count: rules.length }, 'query_policy tool called');
        return successResponse({ rules, count: rules.length });
      } catch (err) {
        logger.error({ err }, 'query_policy tool failed');
        return errorResponse(err instanceof Error ? err.message : 'Query failed');
      }
    },
  );

  // --- list_policy_rules ---
  server.tool(
    'list_policy_rules',
    'List all compiled policy rules for the current tenant. Alias for query_policy with no filters. (Clauses — the pre-compilation policy graph — are a separate concept; this tool returns the compiled rules the engine enforces.)',
    {
      limit: z.number().optional().describe('Maximum number of rules to return'),
      offset: z.number().optional().describe('Number of rules to skip'),
    },
    async (params) => {
      try {
        const rules = await deps.policyRuleRepo.findAll(tenantId, {
          limit: params.limit,
          offset: params.offset,
        });
        logger.info({ count: rules.length }, 'list_policy_rules tool called');
        return successResponse({ rules, count: rules.length });
      } catch (err) {
        logger.error({ err }, 'list_policy_rules tool failed');
        return errorResponse(err instanceof Error ? err.message : 'List failed');
      }
    },
  );

  // --- explain_decision ---
  server.tool(
    'explain_decision',
    'Explain a previous decision by its correlation ID. Returns all decision records for that correlation.',
    {
      correlationId: z.string().describe('The correlation ID of the decision to explain'),
    },
    async (params) => {
      try {
        const records = await deps.decisionLogRepo.findByCorrelationId(
          tenantId,
          params.correlationId,
        );
        logger.info({ correlationId: params.correlationId, count: records.length }, 'explain_decision tool called');
        return successResponse({
          correlationId: params.correlationId,
          tenantId: deps.tenantId,
          records,
        });
      } catch (err) {
        logger.error({ err, correlationId: params.correlationId }, 'explain_decision tool failed');
        return errorResponse(err instanceof Error ? err.message : 'Explain failed');
      }
    },
  );

  // --- audit_trail ---
  server.tool(
    'audit_trail',
    'Query the decision audit trail with optional filters. Returns decision records.',
    {
      surface: z.string().optional().describe('Filter by surface'),
      toolName: z.string().optional().describe('Filter by tool name'),
      status: z.array(z.string()).optional().describe('Filter by status (generated, blocked, failed, pending)'),
      from: z.string().optional().describe('Start timestamp (ISO 8601)'),
      to: z.string().optional().describe('End timestamp (ISO 8601)'),
      limit: z.number().optional().describe('Maximum number of records to return'),
      offset: z.number().optional().describe('Number of records to skip'),
    },
    async (params) => {
      try {
        const records = await deps.decisionLogRepo.findAll(tenantId, {
          surface: params.surface,
          toolName: params.toolName,
          status: params.status as Array<'generated' | 'blocked' | 'failed' | 'pending'> | undefined,
          from: params.from,
          to: params.to,
          limit: params.limit,
          offset: params.offset,
        });
        logger.info({ count: records.length }, 'audit_trail tool called');
        return successResponse({ records, count: records.length });
      } catch (err) {
        logger.error({ err }, 'audit_trail tool failed');
        return errorResponse(err instanceof Error ? err.message : 'Audit query failed');
      }
    },
  );

  // Policy-MUTATING tools (ingest_policy, compile_rules) — OFF by default. They
  // rewrite the policy engine and the stdio surface carries no per-call identity,
  // so they are exposed only with an explicit operator opt-in (allowPolicyMutations).
  if (allowMutations) {
  logger.warn('Policy-mutating MCP tools ENABLED (ingest_policy, compile_rules) — stdio is a local trust boundary');

  // --- ingest_policy ---
  server.tool(
    'ingest_policy',
    'Ingest a new policy rule into the system. Returns the created rule.',
    {
      name: z.string().describe('Rule name'),
      description: z.string().optional().describe('Rule description'),
      actionTypePattern: ActionTypePatternSchema.describe('Glob pattern for matching action types (e.g., "file.*", "deploy.production")'),
      riskClass: z.enum(['A', 'B', 'C']).optional().describe('Risk classification (A=highest, C=lowest)'),
      enforcementPoint: z.enum(['pre_decision', 'action_dispatch', 'post_execution']).optional().describe('When to enforce'),
      policyType: z.enum(['safety', 'compliance', 'business', 'resource', 'quality']).optional().describe('Policy category'),
      priority: z.number().optional().describe('Priority (higher = evaluated first)'),
      maxAmountUsd: z.number().optional().describe('Max financial amount in USD'),
      maxCountPerDay: z.number().optional().describe('Max number of actions per day'),
      cooldownMinutes: z.number().optional().describe('Cooldown between actions in minutes'),
      requireApproval: z.boolean().optional().describe('Whether human approval is required'),
      enabled: z.boolean().optional().describe('Whether the rule is active'),
    },
    async (params) => {
      try {
        const rule = await deps.policyRuleRepo.create(tenantId, {
          name: params.name,
          description: params.description ?? '',
          actionTypePattern: params.actionTypePattern,
          riskClass: params.riskClass ?? 'B',
          enforcementPoint: params.enforcementPoint ?? 'pre_decision',
          policyType: params.policyType ?? 'business',
          priority: params.priority ?? 50,
          maxAmountUsd: params.maxAmountUsd,
          maxCountPerDay: params.maxCountPerDay,
          cooldownMinutes: params.cooldownMinutes,
          requireApproval: params.requireApproval ?? false,
          enabled: params.enabled ?? true,
        });
        logger.info({ ruleId: rule.id, name: rule.name }, 'ingest_policy tool called');
        return successResponse(rule);
      } catch (err) {
        logger.error({ err, name: params.name }, 'ingest_policy tool failed');
        return errorResponse(err instanceof Error ? err.message : 'Ingest failed');
      }
    },
  );

  // --- compile_rules ---
  server.tool(
    'compile_rules',
    'Compile approved policy clauses into enforcement rules. Requires clause IDs.',
    {
      clauseIds: z.array(z.string()).describe('IDs of approved clauses to compile into rules'),
    },
    async (params) => {
      try {
        if (!deps.ruleCompiler) {
          return errorResponse('Rule compiler not configured');
        }
        const result = await deps.ruleCompiler.compile(tenantId, params.clauseIds);
        logger.info({ clauseCount: params.clauseIds.length }, 'compile_rules tool called');
        return successResponse(result);
      } catch (err) {
        logger.error({ err }, 'compile_rules tool failed');
        return errorResponse(err instanceof Error ? err.message : 'Compilation failed');
      }
    },
  );

  } else {
    logger.info('Policy-mutating MCP tools (ingest_policy, compile_rules) disabled (allowPolicyMutations=false)');
  }

  logger.info({ toolCount: allowMutations ? 7 : 5 }, 'MCP tools registered');
}
