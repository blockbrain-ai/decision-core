/**
 * MCP Tool Definitions for Policy Author Skill
 *
 * Registers dc_author_from_text, dc_author_from_document,
 * dc_author_review, and dc_author_commit tools on the MCP server.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '../../utils/logger.js';
import { PolicyAuthorService } from './policy-author.service.js';

const logger = createLogger('policy-author-tools');

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
 * Register policy author tools on the MCP server.
 */
export function registerPolicyAuthorTools(
  server: McpServer,
  _tenantId: string,
  service?: PolicyAuthorService,
): void {
  const author = service ?? new PolicyAuthorService();

  // --- dc_author_from_text ---
  server.tool(
    'dc_author_from_text',
    'Generate candidate policy rules from a natural language description. Rules are always drafts requiring explicit approval.',
    {
      naturalLanguage: z.string().describe('Natural language description of the desired policy rule(s)'),
      existingSurfaces: z.array(z.string()).optional().describe('List of existing surface names for context'),
      existingTools: z.array(z.string()).optional().describe('List of existing tool names for context'),
      existingRules: z.array(z.string()).optional().describe('List of existing rule names for conflict detection'),
    },
    async (params) => {
      try {
        const result = author.authorFromText({
          naturalLanguage: params.naturalLanguage,
          context: {
            existingSurfaces: params.existingSurfaces,
            existingTools: params.existingTools,
            existingRules: params.existingRules,
          },
        });
        logger.info({ ruleCount: result.candidateRules.length }, 'dc_author_from_text called');
        return successResponse(result);
      } catch (err) {
        logger.error({ err }, 'dc_author_from_text failed');
        return errorResponse(err instanceof Error ? err.message : 'Authoring failed');
      }
    },
  );

  // --- dc_author_from_document ---
  server.tool(
    'dc_author_from_document',
    'Extract policy clauses from a document and generate candidate rules. Rules are always drafts.',
    {
      documentContent: z.string().describe('The full text content of the policy document'),
      documentName: z.string().optional().describe('Name/title of the document for reference'),
      existingSurfaces: z.array(z.string()).optional().describe('List of existing surface names'),
      existingTools: z.array(z.string()).optional().describe('List of existing tool names'),
      existingRules: z.array(z.string()).optional().describe('List of existing rule names for conflict detection'),
    },
    async (params) => {
      try {
        const result = author.authorFromDocument({
          documentContent: params.documentContent,
          documentName: params.documentName,
          context: {
            existingSurfaces: params.existingSurfaces,
            existingTools: params.existingTools,
            existingRules: params.existingRules,
          },
        });
        logger.info({ ruleCount: result.candidateRules.length }, 'dc_author_from_document called');
        return successResponse(result);
      } catch (err) {
        logger.error({ err }, 'dc_author_from_document failed');
        return errorResponse(err instanceof Error ? err.message : 'Document ingestion failed');
      }
    },
  );

  // --- dc_author_review ---
  server.tool(
    'dc_author_review',
    'Review a candidate rule: accept, modify, or reject it. Requires a session ID from a previous authoring call.',
    {
      sessionId: z.string().describe('The authoring session ID'),
      ruleId: z.string().describe('The candidate rule ID to review'),
      action: z.enum(['accept', 'modify', 'reject']).describe('Review action to take'),
      modifiedYaml: z.string().optional().describe('Modified YAML content (required if action is "modify")'),
    },
    async (params) => {
      try {
        const result = author.reviewRule(params.sessionId, {
          ruleId: params.ruleId,
          action: params.action,
          modifiedYaml: params.modifiedYaml,
        });
        logger.info({ sessionId: params.sessionId, ruleId: params.ruleId, action: params.action }, 'dc_author_review called');
        return successResponse(result);
      } catch (err) {
        logger.error({ err }, 'dc_author_review failed');
        return errorResponse(err instanceof Error ? err.message : 'Review failed');
      }
    },
  );

  // --- dc_author_commit ---
  server.tool(
    'dc_author_commit',
    'Commit all accepted rules as draft policies (enabled: false). Returns the generated YAML.',
    {
      sessionId: z.string().describe('The authoring session ID'),
    },
    async (params) => {
      try {
        const result = author.commitRules(params.sessionId);
        logger.info({ sessionId: params.sessionId, committedCount: result.committedRuleIds.length }, 'dc_author_commit called');
        return successResponse(result);
      } catch (err) {
        logger.error({ err }, 'dc_author_commit failed');
        return errorResponse(err instanceof Error ? err.message : 'Commit failed');
      }
    },
  );

  logger.info({ toolCount: 4 }, 'Policy author MCP tools registered');
}
