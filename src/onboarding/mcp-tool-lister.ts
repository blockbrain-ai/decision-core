/**
 * Opt-in live MCP tool lister for onboarding discovery (B1). Spawns a *local
 * stdio* MCP server (the user's own, declared in .mcp.json), connects as a client,
 * calls `tools/list`, and closes. READ-ONLY: it lists tools, never calls one.
 *
 * This is the only place that spawns a process, and only for stdio servers the
 * project itself declares — so it is gated behind an explicit opt-in at the call
 * site (e.g. `decision-core setup --discover-live`). Remote servers are handled by
 * the caller's allowRemote flag (and would use an HTTP transport, not added here).
 */

import { createLogger } from '../utils/logger.js';
import type { LiveToolLister } from './tool-discovery.js';

const logger = createLogger('mcp-tool-lister');

/** A LiveToolLister backed by the MCP SDK stdio client. Best-effort + read-only. */
export function createStdioMcpLister(): LiveToolLister {
  return async (server, opts) => {
    if (server.transport !== 'stdio' || !server.command) return [];
    let client: {
      connect: (t: unknown) => Promise<void>;
      close: () => Promise<void>;
      listTools: () => Promise<{ tools: Array<{ name: string }> }>;
    } | undefined;
    try {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      const transport = new StdioClientTransport({ command: server.command, args: server.args ?? [] });
      client = new Client({ name: 'decision-core-discovery', version: '0.1.0' }) as unknown as typeof client;
      await client!.connect(transport as never);
      const result = await client!.listTools();
      return (result.tools ?? []).map((t) => t.name).filter((n): n is string => typeof n === 'string');
    } catch (err) {
      logger.info({ server: server.name, err: err instanceof Error ? err.message : String(err), timeoutMs: opts.timeoutMs }, 'live MCP tool listing skipped');
      return [];
    } finally {
      try { await client?.close(); } catch { /* ignore */ }
    }
  };
}
