/**
 * HTTP API Server — Decision Core Localhost Bridge
 *
 * Minimal HTTP server wrapping the SDK for cross-language communication.
 * Binds 127.0.0.1 by default. When a bearer token is configured, auth is
 * required on all endpoints except /health.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createLogger } from '../../utils/logger.js';
import { validateBearerToken, extractToken } from './auth.js';
import { handleEvaluate } from './routes/evaluate.js';
import { handleRecord } from './routes/record.js';
import { handlePolicy } from './routes/policy.js';
import { handleClauses } from './routes/clauses.js';
import { handleAudit } from './routes/audit.js';
import { handleRecordExecution } from './routes/record-execution.js';
import { handleHealth } from './routes/health.js';
import type { HttpServerDeps, HttpServerConfig } from './types.js';
import { loadAgentRegistry } from '../../identity/agent-registry.js';
import { loadAccessPolicy } from '../../identity/access-policy-loader.js';
import { generateOrgReport } from '../../identity/org-report.js';

const logger = createLogger('http-server');
type ResolvedOrgIdentity = { agentId: string; tenantId: string; roles: string[] };

/**
 * Parse JSON body from incoming request.
 */
function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Parse query string parameters from URL.
 */
function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = new URLSearchParams(url.slice(idx + 1));
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

/**
 * Send JSON response.
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Extract pathname from URL (without query string).
 */
function getPathname(url: string | undefined): string {
  if (!url) return '/';
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

function canReadOrgConfig(identity: ResolvedOrgIdentity | undefined): boolean {
  if (!identity) return false;
  return identity.roles.some((role) => ['ceo', 'owner', 'operator', 'admin'].includes(role));
}

function canReadOrgAudit(identity: ResolvedOrgIdentity | undefined): boolean {
  if (!identity) return false;
  return identity.roles.some((role) =>
    ['ceo', 'owner', 'operator', 'admin', 'auditor', 'compliance_officer'].includes(role),
  );
}

export interface HttpServerInstance {
  server: Server;
  close(): Promise<void>;
  address(): { host: string; port: number } | null;
}

/**
 * Create and start the HTTP API server.
 */
export async function createHttpServer(
  deps: HttpServerDeps,
  config: HttpServerConfig = {},
): Promise<HttpServerInstance> {
  const host = config.host ?? '127.0.0.1';
  const port = config.port ?? 0;
  const bearerToken = config.bearerToken;

  const orgMode = config.orgMode ?? false;
  const identityResolver = config.identityResolver;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const pathname = getPathname(req.url);
    const method = req.method?.toUpperCase() ?? 'GET';

    // Health endpoint — no auth required
    if (pathname === '/health' && method === 'GET') {
      const result = handleHealth();
      sendJson(res, result.status, result.data);
      return;
    }

    let orgIdentity: ResolvedOrgIdentity | undefined;
    const orgToken = orgMode && identityResolver
      ? extractToken(req.headers['authorization'])
      : undefined;

    // Org-mode auth: every protected endpoint must resolve to a token-bound agent identity.
    if (orgMode && identityResolver) {
      if (!orgToken) {
        sendJson(res, 401, { error: 'Bearer token required in org mode', code: 'AUTH_REQUIRED' });
        return;
      }

      const identity = identityResolver.resolve(orgToken);
      if ('error' in identity) {
        sendJson(res, 403, { error: identity.error, code: identity.code });
        return;
      }
      orgIdentity = identity;
    } else if (!validateBearerToken(req, bearerToken)) {
      sendJson(res, 401, { error: 'Unauthorized', code: 'AUTH_REQUIRED' });
      return;
    }

    // Tenant isolation: in org mode, every tenant-scoped operation runs against the
    // AUTHENTICATED identity's tenant (resolved server-side from the token), never
    // the static server-default deps.tenantId. Without this, an identity bound to
    // tenant A would read/write whatever tenant deps.tenantId names — a cross-tenant
    // hole. Non-org keeps the single configured tenant.
    const requestDeps = orgMode && orgIdentity
      ? { ...deps, tenantId: orgIdentity.tenantId }
      : deps;

    try {
      if (pathname === '/evaluate' && method === 'POST') {
        const body = await parseBody(req) as Record<string, unknown>;

        let evaluateContext = body.context as Record<string, unknown> | undefined;

        if (orgMode && identityResolver) {
          const bodyAgentId = (body.agentId as string) ?? (evaluateContext?.agentId as string);
          const identity = identityResolver.resolve(orgToken!, bodyAgentId);

          if ('error' in identity) {
            sendJson(res, 403, { error: identity.error, code: identity.code });
            return;
          }

          evaluateContext = {
            ...evaluateContext,
            agentId: identity.agentId,
            callerRoles: identity.roles,
          };
        } else if (evaluateContext && 'callerRoles' in evaluateContext) {
          // Non-org / no identity: request-supplied roles are NOT trusted — a
          // remote caller must not grant itself roles. Drop them so role-scoped
          // rules don't apply (deny-unknown backstops). agentId stays (it's just
          // an identifier; roles are the privilege).
          evaluateContext = { ...evaluateContext, callerRoles: undefined };
        }

        const result = await handleEvaluate(
          { surfaceId: body.surfaceId as string, action: body.action as string, context: evaluateContext },
          requestDeps,
        );
        sendJson(res, result.status, result.data);
        return;
      }

      if (pathname === '/org/report' && method === 'GET') {
        if (!orgMode || !config.orgConfig) {
          sendJson(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
          return;
        }
        if (!canReadOrgConfig(orgIdentity)) {
          sendJson(res, 403, { error: 'Organisation report requires an operator role', code: 'FORBIDDEN' });
          return;
        }
        const report = generateOrgReport(config.orgConfig.agentRegistryPath, config.orgConfig.accessPolicyPath);
        sendJson(res, 200, { status: 'ok', data: report });
        return;
      }

      if (pathname === '/agents' && method === 'GET') {
        if (!orgMode || !config.orgConfig) {
          sendJson(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
          return;
        }
        if (!canReadOrgConfig(orgIdentity)) {
          sendJson(res, 403, { error: 'Agent registry requires an operator role', code: 'FORBIDDEN' });
          return;
        }
        const registry = loadAgentRegistry(config.orgConfig.agentRegistryPath);
        sendJson(res, 200, {
          status: 'ok',
          data: {
            tenantId: registry.tenantId,
            agents: registry.agents.map((agent) => ({
              agentId: agent.agentId,
              displayName: agent.displayName,
              humanOwner: agent.humanOwner,
              roles: agent.roles,
              enabled: agent.enabled,
              personalBrain: agent.personalBrain,
            })),
          },
        });
        return;
      }

      if (pathname === '/access-policy' && method === 'GET') {
        if (!orgMode || !config.orgConfig) {
          sendJson(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
          return;
        }
        if (!canReadOrgConfig(orgIdentity)) {
          sendJson(res, 403, { error: 'Access policy requires an operator role', code: 'FORBIDDEN' });
          return;
        }
        const policy = loadAccessPolicy(config.orgConfig.accessPolicyPath);
        sendJson(res, 200, { status: 'ok', data: policy });
        return;
      }

      if (pathname === '/record' && method === 'POST') {
        if (orgMode && !canReadOrgAudit(orgIdentity)) {
          sendJson(res, 403, { error: 'Decision records require an audit role', code: 'FORBIDDEN' });
          return;
        }
        const body = await parseBody(req) as Record<string, unknown>;
        const result = await handleRecord(body as Parameters<typeof handleRecord>[0], requestDeps);
        sendJson(res, result.status, result.data);
        return;
      }

      if (pathname === '/record-execution' && method === 'POST') {
        const body = await parseBody(req) as Record<string, unknown>;
        const result = await handleRecordExecution(
          body as unknown as Parameters<typeof handleRecordExecution>[0],
          requestDeps,
          orgIdentity?.agentId,
        );
        sendJson(res, result.status, result.data);
        return;
      }

      if (pathname === '/policy' && method === 'GET') {
        if (orgMode && !canReadOrgAudit(orgIdentity)) {
          sendJson(res, 403, { error: 'Policy reads require an audit role', code: 'FORBIDDEN' });
          return;
        }
        const query = parseQuery(req.url ?? '');
        const result = await handlePolicy(query, requestDeps);
        sendJson(res, result.status, result.data);
        return;
      }

      if (pathname === '/clauses' && method === 'GET') {
        if (orgMode && !canReadOrgAudit(orgIdentity)) {
          sendJson(res, 403, { error: 'Clause reads require an audit role', code: 'FORBIDDEN' });
          return;
        }
        const query = parseQuery(req.url ?? '');
        const result = await handleClauses(query, requestDeps);
        sendJson(res, result.status, result.data);
        return;
      }

      if (pathname === '/audit' && method === 'GET') {
        if (orgMode && !canReadOrgAudit(orgIdentity)) {
          sendJson(res, 403, { error: 'Audit reads require an audit role', code: 'FORBIDDEN' });
          return;
        }
        const query = parseQuery(req.url ?? '');
        const result = await handleAudit(query, requestDeps);
        sendJson(res, result.status, result.data);
        return;
      }

      sendJson(res, 404, { error: 'Not found', code: 'NOT_FOUND' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      logger.error({ err, pathname, method }, 'Request handler error');

      if (message === 'Invalid JSON body') {
        sendJson(res, 400, { error: message, code: 'INVALID_BODY' });
      } else {
        sendJson(res, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;

      logger.info({ host, port: boundPort, authEnabled: Boolean(bearerToken) }, 'HTTP server started');

      resolve({
        server,
        close() {
          return new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
        },
        address() {
          const a = server.address();
          if (typeof a === 'object' && a) {
            return { host: a.address, port: a.port };
          }
          return null;
        },
      });
    });
  });
}
