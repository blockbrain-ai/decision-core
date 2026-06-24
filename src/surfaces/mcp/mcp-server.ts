/**
 * MCP Server — Decision Core Tool Provider
 *
 * Thin MCP wrapper over SDK functions. Each tool maps to one SDK method.
 * Runs over the stdio transport (the standard MCP local transport). A remote
 * HTTP/streamable MCP transport is roadmapped (v0.2); for remote access today
 * use the dedicated HTTP server surface (createHttpServer).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLogger } from '../../utils/logger.js';
import { extractToken, timingSafeCompare } from '../http/auth.js';
import { registerTools } from './mcp-tools.js';
import { registerOnboardingTools } from '../../skills/onboarding/onboarding.tools.js';
import { registerSetupTools } from '../../skills/onboarding/setup.tools.js';
import { registerPolicyAuthorTools } from '../../skills/policy-author/policy-author.tools.js';
import { registerComplianceAuditTools } from '../../skills/audit/compliance-audit.tools.js';
import type { ComplianceAuditDeps } from '../../skills/audit/compliance-audit.service.js';
import type { McpServerDeps } from './types.js';

const logger = createLogger('mcp-server');

export interface McpServerConfig {
  name?: string;
  version?: string;
  bearerToken?: string;
  /** Only the stdio transport is implemented in v0.1. */
  transport?: 'stdio';
  /**
   * Expose the policy-MUTATING tools (`ingest_policy`, `compile_rules`). OFF by
   * default: these rewrite the policy engine, and the stdio surface has no
   * per-call identity, so they require an explicit operator opt-in. Read-only
   * tools are always available.
   */
  allowPolicyMutations?: boolean;
}

/**
 * Create and configure the MCP server with all Decision Core tools registered.
 */
export function createMcpServer(deps: McpServerDeps, config: McpServerConfig = {}): McpServer {
  const { name = 'decision-core', version = '0.1.0' } = config;

  const server = new McpServer({ name, version });

  registerTools(server, deps, { allowPolicyMutations: config.allowPolicyMutations ?? false });
  registerOnboardingTools(server, deps.tenantId);
  registerSetupTools(server);
  registerPolicyAuthorTools(server, deps.tenantId);
  registerComplianceAuditTools(server, deps.tenantId, {
    decisionLogRepo: deps.decisionLogRepo,
    policyRuleRepo: deps.policyRuleRepo,
  } as unknown as ComplianceAuditDeps);

  logger.info({ name, version, transport: config.transport ?? 'stdio' }, 'MCP server created');

  return server;
}

/**
 * Start the MCP server with stdio transport.
 */
export async function startStdioServer(deps: McpServerDeps, config: McpServerConfig = {}): Promise<void> {
  const server = createMcpServer(deps, { ...config, transport: 'stdio' });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started on stdio');
}

/**
 * Validate a bearer token from request headers.
 * Returns true if auth is valid or no token is configured.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateBearerToken(
  authHeader: string | undefined,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return true;
  const token = extractToken(authHeader);
  if (!token) return false;
  return timingSafeCompare(token, expectedToken);
}
