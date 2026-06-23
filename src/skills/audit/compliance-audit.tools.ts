/**
 * MCP Tool Definitions for Compliance Audit Skill
 *
 * Registers dc_audit_run, dc_audit_gaps, and dc_audit_evidence
 * tools on the MCP server.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLogger } from '../../utils/logger.js';
import { ComplianceAuditService, type ComplianceAuditDeps } from './compliance-audit.service.js';

const logger = createLogger('compliance-audit-tools');

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
 * Register compliance audit tools on the MCP server.
 */
export function registerComplianceAuditTools(
  server: McpServer,
  tenantId: string,
  deps: ComplianceAuditDeps,
  service?: ComplianceAuditService,
): void {
  const audit = service ?? new ComplianceAuditService(deps);

  // --- dc_audit_run ---
  server.tool(
    'dc_audit_run',
    'Run a full compliance audit. Returns a structured report with gaps, coverage metrics, and recommendations.',
    {
      from: z.string().optional().describe('Start of time range (ISO 8601)'),
      to: z.string().optional().describe('End of time range (ISO 8601)'),
      surfaces: z.array(z.string()).optional().describe('Limit audit to specific surfaces'),
      includeEvidenceIntegrity: z.boolean().optional().describe('Check evidence chain integrity (default: true)'),
    },
    async (params) => {
      try {
        const report = await audit.runAudit({
          tenantId,
          timeRange: params.from || params.to ? { from: params.from ?? '1970-01-01T00:00:00.000Z', to: params.to ?? new Date().toISOString() } : undefined,
          surfaces: params.surfaces,
          includeEvidenceIntegrity: params.includeEvidenceIntegrity,
        });
        logger.info(
          { tenantId, totalDecisions: report.summary.totalDecisions, gapCount: report.summary.gapCount },
          'dc_audit_run completed',
        );
        return successResponse(report);
      } catch (err) {
        logger.error({ err }, 'dc_audit_run failed');
        return errorResponse(err instanceof Error ? err.message : 'Audit failed');
      }
    },
  );

  // --- dc_audit_gaps ---
  server.tool(
    'dc_audit_gaps',
    'List compliance gaps only (without full report). Useful for quick gap checks.',
    {
      from: z.string().optional().describe('Start of time range (ISO 8601)'),
      to: z.string().optional().describe('End of time range (ISO 8601)'),
      surfaces: z.array(z.string()).optional().describe('Limit audit to specific surfaces'),
      severity: z.enum(['critical', 'warning', 'info']).optional().describe('Filter gaps by severity'),
    },
    async (params) => {
      try {
        const report = await audit.runAudit({
          tenantId,
          timeRange: params.from || params.to ? { from: params.from ?? '1970-01-01T00:00:00.000Z', to: params.to ?? new Date().toISOString() } : undefined,
          surfaces: params.surfaces,
        });

        let gaps = report.gaps;
        if (params.severity) {
          gaps = gaps.filter((g) => g.severity === params.severity);
        }

        logger.info({ tenantId, gapCount: gaps.length }, 'dc_audit_gaps completed');
        return successResponse({ gaps, total: gaps.length });
      } catch (err) {
        logger.error({ err }, 'dc_audit_gaps failed');
        return errorResponse(err instanceof Error ? err.message : 'Gap detection failed');
      }
    },
  );

  // --- dc_audit_evidence ---
  server.tool(
    'dc_audit_evidence',
    'Check evidence chain integrity for specific decisions by correlation ID.',
    {
      correlationIds: z.array(z.string()).describe('Correlation IDs to check'),
    },
    async (params) => {
      try {
        const result = await audit.checkEvidenceIntegrity(tenantId, params.correlationIds);
        logger.info(
          { tenantId, checked: result.checked, intact: result.intact, broken: result.broken },
          'dc_audit_evidence completed',
        );
        return successResponse(result);
      } catch (err) {
        logger.error({ err }, 'dc_audit_evidence failed');
        return errorResponse(err instanceof Error ? err.message : 'Evidence check failed');
      }
    },
  );

  logger.info({ toolCount: 3 }, 'Compliance audit MCP tools registered');
}
