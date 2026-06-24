import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { mergeToolSources, discoverLiveTools, readMcpServers, type LiveToolLister } from './tool-discovery.js';

describe('mergeToolSources', () => {
  it('dedupes by name and records every source (provenance)', () => {
    const merged = mergeToolSources(
      [{ name: 'fs.read', source: '.mcp.json:fs' }, { name: 'git.clone', source: 'CLAUDE.md' }],
      [{ name: 'fs.read', source: 'live:fs' }],
    );
    expect(merged).toHaveLength(2);
    const read = merged.find((d) => d.name === 'fs.read')!;
    expect(read.sources).toEqual(['.mcp.json:fs', 'live:fs']);
  });
});

describe('readMcpServers', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dc-mcp-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('parses stdio + remote servers from .mcp.json', () => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        fs: { command: 'mcp-fs', args: ['--root', '.'] },
        remote: { url: 'https://example.com/mcp', type: 'sse' },
      },
    }), 'utf-8');
    const servers = readMcpServers(dir);
    const fs = servers.find((s) => s.name === 'fs')!;
    expect(fs.transport).toBe('stdio');
    expect(fs.command).toBe('mcp-fs');
    expect(fs.args).toEqual(['--root', '.']);
    expect(servers.find((s) => s.name === 'remote')!.transport).toBe('sse');
  });

  it('returns [] for a missing or malformed .mcp.json', () => {
    expect(readMcpServers(dir)).toEqual([]);
  });
});

describe('discoverLiveTools', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dc-disc-'));
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { fs: { command: 'mcp-fs' }, remote: { url: 'https://x/mcp' } },
    }), 'utf-8');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns [] (config-scan fallback) when no lister is supplied — never spawns', async () => {
    expect(await discoverLiveTools(dir)).toEqual([]);
  });

  it('enumerates LOCAL stdio servers only by default (remote skipped)', async () => {
    const lister: LiveToolLister = async (server) => server.transport === 'stdio' ? ['fs.read', 'fs.write'] : ['remote.tool'];
    const tools = await discoverLiveTools(dir, { lister });
    expect(tools.map((t) => t.name).sort()).toEqual(['fs.read', 'fs.write']);
    expect(tools.every((t) => t.source === 'live:fs')).toBe(true);
  });

  it('includes remote servers only with allowRemote', async () => {
    const lister: LiveToolLister = async (server) => server.transport === 'stdio' ? ['fs.read'] : ['remote.tool'];
    const tools = await discoverLiveTools(dir, { lister, allowRemote: true });
    expect(tools.map((t) => t.name).sort()).toEqual(['fs.read', 'remote.tool']);
  });

  it('skips a server that times out / throws — never blocks onboarding', async () => {
    const lister: LiveToolLister = async () => { throw new Error('boom'); };
    expect(await discoverLiveTools(dir, { lister })).toEqual([]);
  });
});
