import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../../utils/logger.js';
import type { GBrainTransport } from './gbrain-client.js';
import type { GBrainPage, GBrainPutPageParams, GBrainSearchParams } from './gbrain.contracts.js';

const execFileAsync = promisify(execFile);
const logger = createLogger('gbrain-cli-transport');

export interface GBrainCliTransportOptions {
  binPath: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export class GBrainCliTransport implements GBrainTransport {
  private readonly binPath: string;
  private readonly cwd: string | undefined;
  private readonly timeoutMs: number;
  private readonly env: Record<string, string>;

  constructor(options: GBrainCliTransportOptions) {
    this.binPath = options.binPath;
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.env = options.env ?? {};
  }

  async search(params: GBrainSearchParams): Promise<GBrainPage[]> {
    const result = await this.call('search', params);
    return Array.isArray(result) ? result : [];
  }

  async putPage(params: GBrainPutPageParams): Promise<GBrainPage> {
    const result = await this.call('put_page', params);
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
      const result = await this.call('get_page', { slug });
      if (!result || typeof result !== 'object') return null;
      const page = result as Record<string, unknown>;
      return {
        slug: (page['slug'] as string) ?? slug,
        title: (page['title'] as string) ?? '',
        content: (page['compiled_truth'] as string) ?? (page['content'] as string) ?? '',
        createdAt: page['created_at'] as string | undefined,
        updatedAt: page['updated_at'] as string | undefined,
      } as GBrainPage;
    } catch {
      return null;
    }
  }

  private async call(tool: string, params: Record<string, unknown>): Promise<unknown> {
    const args = ['call', tool, JSON.stringify(params)];
    logger.debug({ tool, binPath: this.binPath }, 'gbrain cli call');

    try {
      const { stdout } = await execFileAsync(this.binPath, args, {
        cwd: this.cwd,
        timeout: this.timeoutMs,
        env: { ...process.env, ...this.env },
        maxBuffer: 4 * 1024 * 1024,
      });

      const trimmed = stdout.trim();
      if (!trimmed) return null;
      return JSON.parse(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ tool, err: message }, 'gbrain cli call failed');
      throw new Error(`G-Brain CLI call failed for ${tool}: ${message}`);
    }
  }
}
