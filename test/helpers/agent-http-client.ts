/**
 * Agent HTTP Client — Per-agent authenticated request helper.
 *
 * Creates HTTP clients bound to a specific agent identity via
 * deterministic test tokens. Used in org-mode integration tests.
 */

import { getAgentToken } from './org-fixture-loader.js';

export interface AgentRequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

export interface AgentResponse {
  status: number;
  data: unknown;
}

export interface AgentHttpClient {
  agentId: string;
  token: string;
  get(path: string, options?: AgentRequestOptions): Promise<AgentResponse>;
  post(path: string, options?: AgentRequestOptions): Promise<AgentResponse>;
  /** Send a request with no auth header. */
  getUnauthenticated(path: string): Promise<AgentResponse>;
  /** Send a request with an arbitrary token (for spoofing tests). */
  getWithToken(path: string, token: string): Promise<AgentResponse>;
  postWithToken(path: string, token: string, options?: AgentRequestOptions): Promise<AgentResponse>;
}

async function sendRequest(
  baseUrl: string,
  method: string,
  path: string,
  token: string | null,
  options: AgentRequestOptions = {},
): Promise<AgentResponse> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token !== null) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();
  return { status: res.status, data };
}

/**
 * Create an authenticated HTTP client for the given agent.
 *
 * @param baseUrl - Server base URL (e.g. http://127.0.0.1:PORT)
 * @param agentId - Agent ID from the Meridian Systems fixture
 */
export function createAgentHttpClient(baseUrl: string, agentId: string): AgentHttpClient {
  const token = getAgentToken(agentId);

  return {
    agentId,
    token,

    get(path, options) {
      return sendRequest(baseUrl, 'GET', path, token, options);
    },

    post(path, options) {
      return sendRequest(baseUrl, 'POST', path, token, options);
    },

    getUnauthenticated(path) {
      return sendRequest(baseUrl, 'GET', path, null);
    },

    getWithToken(path, customToken) {
      return sendRequest(baseUrl, 'GET', path, customToken);
    },

    postWithToken(path, customToken, options) {
      return sendRequest(baseUrl, 'POST', path, customToken, options);
    },
  };
}

/**
 * Create HTTP clients for all Meridian Systems agents.
 */
export function createAllAgentClients(baseUrl: string): Record<string, AgentHttpClient> {
  const agentIds = [
    'ceo-agent', 'cfo-agent', 'finance-analyst-agent',
    'vp-eng-agent', 'hr-lead-agent', 'product-agent', 'contractor-agent',
  ];

  const clients: Record<string, AgentHttpClient> = {};
  for (const id of agentIds) {
    clients[id] = createAgentHttpClient(baseUrl, id);
  }
  return clients;
}
