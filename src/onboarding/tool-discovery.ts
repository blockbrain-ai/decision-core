/**
 * Live tool discovery (B1) — augment the static config scan with a real
 * enumeration of the tools an agent actually has, so onboarding governs the live
 * surface rather than whatever happens to be written in a config file.
 *
 * Safety (non-negotiable): discovery is READ-ONLY and must never EXECUTE a tool.
 * It is local-by-default — only stdio MCP servers declared in the project are
 * enumerated; remote/HTTP/SSE servers require an explicit opt-in. Every call is
 * time-bounded. The actual MCP enumeration is injected as a `LiveToolLister` so
 * the policy here stays pure/testable and the process-spawning adapter is a thin,
 * opt-in layer; with no lister we cleanly fall back to the config scan.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ToolDetection } from './detect-agent-env.js';

export interface DiscoveredTool {
  name: string;
  /** Every source that surfaced this tool (provenance), e.g. ['.mcp.json:fs', 'live:fs']. */
  sources: string[];
}

export interface McpServerRef {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  /** stdio command (local) or url (remote). */
  command?: string;
  args?: string[];
  url?: string;
}

/** Injected MCP `tools/list` enumerator. MUST be read-only (list only; never call a tool). */
export type LiveToolLister = (server: McpServerRef, opts: { timeoutMs: number }) => Promise<string[]>;

export interface DiscoverOptions {
  /** Enumerate remote (http/sse) MCP servers too. OFF by default — local only. */
  allowRemote?: boolean;
  /** Per-server enumeration timeout. Default 3000ms. */
  timeoutMs?: number;
  /** The live enumerator. Omit → config scan only (safe fallback). */
  lister?: LiveToolLister;
}

/** Parse the project's `.mcp.json` into server refs (best-effort; tolerant of shapes). */
export function readMcpServers(scanRoot: string): McpServerRef[] {
  const path = join(scanRoot, '.mcp.json');
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
  const servers = (parsed as { mcpServers?: Record<string, unknown>; servers?: Record<string, unknown> } | null);
  const map = (servers?.mcpServers ?? servers?.servers ?? {}) as Record<string, Record<string, unknown>>;
  const refs: McpServerRef[] = [];
  for (const [name, cfg] of Object.entries(map)) {
    const url = typeof cfg?.['url'] === 'string' ? (cfg['url'] as string) : undefined;
    const command = typeof cfg?.['command'] === 'string' ? (cfg['command'] as string) : undefined;
    const args = Array.isArray(cfg?.['args']) ? (cfg['args'] as unknown[]).filter((a): a is string => typeof a === 'string') : undefined;
    const transport: McpServerRef['transport'] = url ? (String(cfg?.['type'] ?? 'http').includes('sse') ? 'sse' : 'http') : 'stdio';
    refs.push({ name, transport, command, args, url });
  }
  return refs;
}

/** Merge config-detected + live-detected tools, de-duplicated by name with provenance. */
export function mergeToolSources(...detections: ToolDetection[][]): DiscoveredTool[] {
  const byName = new Map<string, Set<string>>();
  for (const list of detections) {
    for (const d of list) {
      if (!d.name) continue;
      const set = byName.get(d.name) ?? new Set<string>();
      set.add(d.source);
      byName.set(d.name, set);
    }
  }
  return [...byName.entries()]
    .map(([name, sources]) => ({ name, sources: [...sources].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Live-enumerate tools from the project's MCP servers via the injected lister.
 * Local stdio servers only unless allowRemote; time-bounded; never executes tools.
 * Returns [] (config-scan-only fallback) when no lister is supplied.
 */
export async function discoverLiveTools(scanRoot: string, opts: DiscoverOptions = {}): Promise<ToolDetection[]> {
  if (!opts.lister) return [];
  const timeoutMs = opts.timeoutMs ?? 3000;
  const servers = readMcpServers(scanRoot).filter((s) => s.transport === 'stdio' || opts.allowRemote);

  const out: ToolDetection[] = [];
  for (const server of servers) {
    try {
      const names = await withTimeout(opts.lister(server, { timeoutMs }), timeoutMs);
      for (const name of names) {
        if (typeof name === 'string' && name.length > 0) out.push({ name, source: `live:${server.name}` });
      }
    } catch {
      // Discovery is best-effort and must never block onboarding — skip a server
      // that times out or errors; the config scan still covers it.
    }
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tool discovery timed out')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
