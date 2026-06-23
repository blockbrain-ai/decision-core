import { createLogger } from '../../utils/logger.js';
import type { GBrainTransport } from './gbrain-client.js';
import type { GBrainPage, GBrainPutPageParams, GBrainSearchParams } from './gbrain.contracts.js';

const logger = createLogger('gbrain-http-transport');

export interface GBrainHttpTransportOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string;
  timeoutMs?: number;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

/**
 * G-Brain transport that uses the MCP-over-HTTP endpoint with OAuth 2.1
 * client_credentials. Avoids the PGLite single-process lock contention
 * that occurs with the CLI transport when the G-Brain HTTP server is running.
 */
export class GBrainHttpTransport implements GBrainTransport {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scopes: string;
  private readonly timeoutMs: number;
  private token: TokenState | null = null;

  constructor(options: GBrainHttpTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.scopes = options.scopes ?? 'read write';
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async search(params: GBrainSearchParams): Promise<GBrainPage[]> {
    const result = await this.callTool('search', {
      query: params.query,
      limit: params.limit,
      fuzzy: true,
    });
    if (!Array.isArray(result)) return [];
    return result.map((r: Record<string, unknown>) => this.toPage(r));
  }

  async putPage(params: GBrainPutPageParams): Promise<GBrainPage> {
    const result = await this.callTool('put_page', {
      slug: params.slug,
      title: params.title,
      content: params.content,
      entities: params.entities,
      metadata: params.metadata,
    });
    return {
      slug: params.slug,
      title: params.title,
      content: params.content,
      entities: params.entities,
      metadata: params.metadata,
      createdAt: new Date().toISOString(),
      ...(typeof result === 'object' && result !== null ? result as Record<string, unknown> : {}),
    } as GBrainPage;
  }

  async getPage(slug: string): Promise<GBrainPage | null> {
    try {
      const result = await this.callTool('get_page', { slug });
      if (!result || typeof result !== 'object') return null;
      return this.toPage(result as Record<string, unknown>, slug);
    } catch {
      return null;
    }
  }

  private toPage(raw: Record<string, unknown>, fallbackSlug?: string): GBrainPage {
    return {
      slug: (raw['slug'] as string) ?? fallbackSlug ?? '',
      title: (raw['title'] as string) ?? '',
      content: (raw['compiled_truth'] as string) ?? (raw['content'] as string) ?? '',
      entities: Array.isArray(raw['entities']) ? raw['entities'] as string[] : undefined,
      metadata: typeof raw['metadata'] === 'object' ? raw['metadata'] as Record<string, unknown> : undefined,
      createdAt: raw['created_at'] as string | undefined,
      updatedAt: raw['updated_at'] as string | undefined,
    } as GBrainPage;
  }

  private async parseResponse(resp: Response): Promise<{
    result?: { content?: Array<{ type: string; text: string }> };
    error?: { code: number; message: string };
  }> {
    const contentType = resp.headers.get('content-type') ?? '';

    if (contentType.includes('text/event-stream')) {
      const text = await resp.text();
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            return JSON.parse(data);
          } catch {
            continue;
          }
        }
      }
      throw new Error('No valid JSON-RPC message in SSE response');
    }

    return resp.json() as Promise<{
      result?: { content?: Array<{ type: string; text: string }> };
      error?: { code: number; message: string };
    }>;
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 30_000) {
      return this.token.accessToken;
    }

    logger.debug('exchanging client_credentials for access token');

    const resp = await fetch(`${this.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: this.scopes,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`G-Brain token exchange failed (HTTP ${resp.status}): ${text}`);
    }

    const data = await resp.json() as { access_token: string; expires_in: number };
    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    logger.debug({ expiresIn: data.expires_in }, 'access token acquired');
    return this.token.accessToken;
  }

  private async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const accessToken = await this.getAccessToken();

    logger.debug({ tool: toolName }, 'MCP tool call via HTTP');

    const resp = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`G-Brain MCP call failed for ${toolName} (HTTP ${resp.status}): ${text}`);
    }

    const rpc = await this.parseResponse(resp);

    if (rpc.error) {
      throw new Error(`G-Brain MCP error for ${toolName}: ${rpc.error.message}`);
    }

    const textContent = rpc.result?.content?.find((c) => c.type === 'text');
    if (!textContent?.text) return null;

    try {
      return JSON.parse(textContent.text);
    } catch {
      return textContent.text;
    }
  }
}
