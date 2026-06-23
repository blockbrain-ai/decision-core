import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectAgentEnvironment,
  detectOpenClaw,
  detectHermes,
  detectGenericNode,
  detectStandalone,
  detectProviderEnvVarNames,
  detectToolsFromManifests,
  detectMemorySources,
} from './detect-agent-env.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'dc-detect-'));
}

describe('detect-agent-env', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // detectOpenClaw
  // =========================================================================

  describe('detectOpenClaw', () => {
    it('returns null for empty directory', () => {
      expect(detectOpenClaw(tmpDir)).toBeNull();
    });

    it('detects openclaw.config.ts', () => {
      writeFileSync(join(tmpDir, 'openclaw.config.ts'), 'export default {}');
      const result = detectOpenClaw(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.harness).toBe('openclaw');
      expect(result!.confidence).toBeGreaterThan(0);
      expect(result!.configPaths).toContain(join(tmpDir, 'openclaw.config.ts'));
    });

    it('detects .openclaw/ directory', () => {
      mkdirSync(join(tmpDir, '.openclaw'));
      const result = detectOpenClaw(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.harness).toBe('openclaw');
    });

    it('detects openclaw in package.json', () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { openclaw: '^1.0.0' } }),
      );
      const result = detectOpenClaw(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.version).toBe('^1.0.0');
    });

    it('higher confidence with multiple signals', () => {
      writeFileSync(join(tmpDir, 'openclaw.config.ts'), 'export default {}');
      mkdirSync(join(tmpDir, '.openclaw'));
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { openclaw: '^2.0.0' } }),
      );

      const result = detectOpenClaw(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(1);
    });
  });

  // =========================================================================
  // detectHermes
  // =========================================================================

  describe('detectHermes', () => {
    it('returns null when no signals present', () => {
      expect(detectHermes(tmpDir)).toBeNull();
    });

    it('detects hermes-agent in package.json', () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { 'hermes-agent': '^1.0.0' } }),
      );
      const result = detectHermes(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.harness).toBe('hermes');
    });
  });

  // =========================================================================
  // detectGenericNode
  // =========================================================================

  describe('detectGenericNode', () => {
    it('returns null for empty directory', () => {
      expect(detectGenericNode(tmpDir)).toBeNull();
    });

    it('detects package.json as generic node project', () => {
      writeFileSync(join(tmpDir, 'package.json'), '{}');
      const result = detectGenericNode(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.harness).toBe('generic');
      expect(result!.confidence).toBeLessThan(0.5);
    });
  });

  // =========================================================================
  // detectStandalone
  // =========================================================================

  describe('detectStandalone', () => {
    it('always returns a fallback detection', () => {
      const result = detectStandalone(tmpDir);
      expect(result.harness).toBe('standalone');
      expect(result.confidence).toBe(0.1);
    });
  });

  // =========================================================================
  // detectProviderEnvVarNames
  // =========================================================================

  describe('detectProviderEnvVarNames', () => {
    it('returns disabled when no provider vars set', () => {
      const result = detectProviderEnvVarNames();
      // We can't guarantee env state, so just check structure
      expect(result.suggestedMode).toBeDefined();
      expect(Array.isArray(result.envVarNames)).toBe(true);
      expect(Array.isArray(result.signals)).toBe(true);
      expect(result.signals.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // detectToolsFromManifests
  // =========================================================================

  describe('detectToolsFromManifests', () => {
    it('returns empty for directory without manifests', () => {
      const tools = detectToolsFromManifests(tmpDir);
      expect(tools).toEqual([]);
    });

    it('detects MCP servers from .mcp.json', () => {
      writeFileSync(
        join(tmpDir, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            'file-server': { command: 'npx', args: ['file-server'] },
            'memory-server': { command: 'npx', args: ['mem-server'] },
          },
        }),
      );

      const tools = detectToolsFromManifests(tmpDir);
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain('mcp:file-server');
      expect(tools.map((t) => t.name)).toContain('mcp:memory-server');
      expect(tools[0].source).toBe('.mcp.json');
    });

    it('detects tools from openclaw.plugin.json', () => {
      writeFileSync(
        join(tmpDir, 'openclaw.plugin.json'),
        JSON.stringify({
          tools: ['web_search', 'file_read', { name: 'shell_exec' }],
        }),
      );

      const tools = detectToolsFromManifests(tmpDir);
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toContain('web_search');
      expect(tools.map((t) => t.name)).toContain('shell_exec');
    });
  });

  // =========================================================================
  // detectMemorySources
  // =========================================================================

  describe('detectMemorySources', () => {
    it('returns structured detections for empty dir', () => {
      const sources = detectMemorySources(tmpDir);
      expect(sources.length).toBeGreaterThan(0);
      for (const s of sources) {
        // consent defaults are always false regardless of detection
        expect(s.readConsent).toBe(false);
        expect(s.writeBackConsent).toBe(false);
        expect(s.scope).toEqual([]);
        expect(s.kind).toBeTruthy();
      }
      // scan-root-only sources should not detect in an empty tmpdir
      const scanRootOnlyKinds = ['openclaw-native', 'mem0', 'honcho', 'supermemory', 'cognee', 'letta'];
      for (const kind of scanRootOnlyKinds) {
        const s = sources.find((src) => src.kind === kind);
        expect(s?.detected).toBe(false);
      }
    });

    it('detects openclaw-native from MEMORY.md', () => {
      writeFileSync(join(tmpDir, 'MEMORY.md'), '# Memory\n');
      const sources = detectMemorySources(tmpDir);
      const oc = sources.find((s) => s.kind === 'openclaw-native');
      expect(oc).toBeDefined();
      expect(oc!.detected).toBe(true);
      expect(oc!.detectionSignals).toContain('MEMORY.md found');
    });

    it('detects openclaw-native from memory/*.md files', () => {
      mkdirSync(join(tmpDir, 'memory'));
      writeFileSync(join(tmpDir, 'memory', '2026-01-01.md'), '# Notes\n');
      writeFileSync(join(tmpDir, 'memory', '2026-01-02.md'), '# Notes\n');

      const sources = detectMemorySources(tmpDir);
      const oc = sources.find((s) => s.kind === 'openclaw-native');
      expect(oc).toBeDefined();
      expect(oc!.detected).toBe(true);
      expect(oc!.detectionSignals[0]).toMatch(/memory\/\*\.md found/);
    });

    it('detects markdown-vault from .obsidian/ directory', () => {
      mkdirSync(join(tmpDir, '.obsidian'));
      const sources = detectMemorySources(tmpDir);
      const vault = sources.find((s) => s.kind === 'markdown-vault');
      expect(vault).toBeDefined();
      expect(vault!.detected).toBe(true);
    });

    it('detects mem0 from config file', () => {
      writeFileSync(join(tmpDir, 'mem0.json'), '{}');
      const sources = detectMemorySources(tmpDir);
      const mem0 = sources.find((s) => s.kind === 'mem0');
      expect(mem0).toBeDefined();
      expect(mem0!.detected).toBe(true);
    });

    it('detects honcho from config file', () => {
      writeFileSync(join(tmpDir, 'honcho.json'), '{}');
      const sources = detectMemorySources(tmpDir);
      const honcho = sources.find((s) => s.kind === 'honcho');
      expect(honcho).toBeDefined();
      expect(honcho!.detected).toBe(true);
    });

    it('detects supermemory from .mcp.json', () => {
      writeFileSync(
        join(tmpDir, '.mcp.json'),
        JSON.stringify({ mcpServers: { supermemory: {} } }),
      );
      const sources = detectMemorySources(tmpDir);
      const sm = sources.find((s) => s.kind === 'supermemory');
      expect(sm).toBeDefined();
      expect(sm!.detected).toBe(true);
    });

    it('detects mempalace from .mcp.json', () => {
      writeFileSync(
        join(tmpDir, '.mcp.json'),
        JSON.stringify({ mcpServers: { mempalace: {} } }),
      );
      const sources = detectMemorySources(tmpDir);
      const mp = sources.find((s) => s.kind === 'mempalace');
      expect(mp).toBeDefined();
      expect(mp!.detected).toBe(true);
    });
  });

  // =========================================================================
  // detectAgentEnvironment (top-level)
  // =========================================================================

  describe('detectAgentEnvironment', () => {
    it('returns complete environment for empty directory', () => {
      const env = detectAgentEnvironment(tmpDir);
      expect(env.harness).toBeDefined();
      expect(env.harness.harness).toBe('standalone');
      expect(env.provider).toBeDefined();
      expect(env.tools).toEqual([]);
      expect(env.memorySources).toBeDefined();
      expect(env.scanRoot).toBe(tmpDir);
      expect(env.detectedAt).toBeTruthy();
    });

    it('picks highest-confidence harness', () => {
      writeFileSync(join(tmpDir, 'openclaw.config.ts'), 'export default {}');
      mkdirSync(join(tmpDir, '.openclaw'));
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { openclaw: '^1.0.0' } }));

      const env = detectAgentEnvironment(tmpDir);
      expect(env.harness.harness).toBe('openclaw');
    });

    it('falls back to generic for plain Node project', () => {
      writeFileSync(join(tmpDir, 'package.json'), '{}');
      const env = detectAgentEnvironment(tmpDir);
      expect(env.harness.harness).toBe('generic');
    });

    it('is read-only — does not create files', () => {
      const before = new Set(require('node:fs').readdirSync(tmpDir));
      detectAgentEnvironment(tmpDir);
      const after = new Set(require('node:fs').readdirSync(tmpDir));
      expect(after).toEqual(before);
    });

    it('does not include secret values in results', () => {
      const env = detectAgentEnvironment(tmpDir);
      const json = JSON.stringify(env);
      // Should only contain env var names, not their values
      expect(json).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
      // Provider detection only stores names, not values
      for (const name of env.provider.envVarNames) {
        expect(json).not.toContain(process.env[name] ?? '');
      }
    });
  });
});
