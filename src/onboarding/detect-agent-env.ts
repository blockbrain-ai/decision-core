/**
 * Agent Environment Detection
 *
 * Lightweight, read-only detection of agent harness, provider env var names,
 * tool manifests, and memory sources. Does not perform cloud calls or auth flows.
 * Reads env var names (not values) and filesystem markers.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  HarnessType,
  ProfileProviderMode,
  MemorySourceKind,
  MemorySourceDetection,
} from '../contracts/onboarding-profile.contracts.js';

// ===========================================================================
// Detection Result Types
// ===========================================================================

export interface DetectionSignal {
  signal: string;
  found: boolean;
  path?: string;
}

export interface HarnessDetection {
  harness: HarnessType;
  version?: string;
  confidence: number;
  signals: DetectionSignal[];
  configPaths: string[];
}

export interface ProviderDetection {
  suggestedMode: ProfileProviderMode;
  envVarNames: string[];
  signals: DetectionSignal[];
}

export interface ToolDetection {
  name: string;
  source: string;
}

export interface AgentEnvironment {
  harness: HarnessDetection;
  provider: ProviderDetection;
  tools: ToolDetection[];
  memorySources: MemorySourceDetection[];
  scanRoot: string;
  detectedAt: string;
}

// ===========================================================================
// Filesystem Helpers
// ===========================================================================

function fileExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readPackageDeps(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
}

function readTextSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function dirExists(path: string): boolean {
  try {
    const entries = readdirSync(path);
    return entries.length >= 0;
  } catch {
    return false;
  }
}

function envVarDefined(name: string): boolean {
  return name in process.env;
}

// ===========================================================================
// Harness Detection
// ===========================================================================

export function detectOpenClaw(scanRoot: string): HarnessDetection | null {
  const signals: DetectionSignal[] = [];
  const configPaths: string[] = [];
  let version: string | undefined;

  const configTs = join(scanRoot, 'openclaw.config.ts');
  const configJson = join(scanRoot, 'openclaw.config.json');
  const dotDir = join(scanRoot, '.openclaw');
  const pluginJson = join(scanRoot, 'openclaw.plugin.json');
  const pkgJson = join(scanRoot, 'package.json');

  signals.push({ signal: 'openclaw.config.ts', found: fileExists(configTs), path: configTs });
  signals.push({ signal: 'openclaw.config.json', found: fileExists(configJson), path: configJson });
  signals.push({ signal: '.openclaw/ directory', found: dirExists(dotDir), path: dotDir });
  signals.push({ signal: 'openclaw.plugin.json', found: fileExists(pluginJson), path: pluginJson });

  if (fileExists(configTs)) configPaths.push(configTs);
  if (fileExists(configJson)) configPaths.push(configJson);

  const pkg = readJsonSafe(pkgJson);
  if (pkg) {
    const deps = readPackageDeps(pkg);
    const hasOc = 'openclaw' in deps || '@openclaw/core' in deps;
    signals.push({ signal: 'openclaw in package.json', found: hasOc, path: pkgJson });
    if (hasOc && deps['openclaw']) version = deps['openclaw'];
    if (hasOc && deps['@openclaw/core']) version = deps['@openclaw/core'];
  }

  const found = signals.filter((s) => s.found).length;
  if (found === 0) return null;

  return {
    harness: 'openclaw',
    version,
    confidence: Math.min(found / 3, 1),
    signals,
    configPaths,
  };
}

// `hostHome` is injectable so detection is hermetic in tests and does not depend on
// the developer's real `~/.hermes` (etc.) state. Production callers default to the
// real HOME; tests pass an isolated directory.
export function detectHermes(scanRoot: string, hostHome: string = process.env['HOME'] ?? ''): HarnessDetection | null {
  const signals: DetectionSignal[] = [];
  const configPaths: string[] = [];

  const hermesHome = process.env['HERMES_HOME'];
  const defaultHermesDir = join(hostHome, '.hermes');
  const hermesDir = hermesHome ?? defaultHermesDir;

  const configYaml = join(hermesDir, 'config.yaml');
  const memoriesDir = join(hermesDir, 'memories');

  signals.push({ signal: 'HERMES_HOME env var', found: envVarDefined('HERMES_HOME') });
  signals.push({ signal: '~/.hermes/config.yaml', found: fileExists(configYaml), path: configYaml });
  signals.push({ signal: '~/.hermes/memories/', found: dirExists(memoriesDir), path: memoriesDir });

  const pkgJson = join(scanRoot, 'package.json');
  const pkg = readJsonSafe(pkgJson);
  if (pkg) {
    const deps = readPackageDeps(pkg);
    const hasHermes = 'hermes-agent' in deps || '@hermes/agent' in deps;
    signals.push({ signal: 'hermes-agent in package.json', found: hasHermes, path: pkgJson });
  }

  if (fileExists(configYaml)) configPaths.push(configYaml);

  const found = signals.filter((s) => s.found).length;
  if (found === 0) return null;

  return {
    harness: 'hermes',
    confidence: Math.min(found / 2, 1),
    signals,
    configPaths,
  };
}

export function detectGenericNode(scanRoot: string): HarnessDetection | null {
  const signals: DetectionSignal[] = [];
  const configPaths: string[] = [];

  const pkgJson = join(scanRoot, 'package.json');
  signals.push({ signal: 'package.json', found: fileExists(pkgJson), path: pkgJson });
  if (fileExists(pkgJson)) configPaths.push(pkgJson);

  const found = signals.filter((s) => s.found).length;
  if (found === 0) return null;

  return {
    harness: 'generic',
    confidence: 0.3,
    signals,
    configPaths,
  };
}

export function detectStandalone(_scanRoot: string): HarnessDetection {
  return {
    harness: 'standalone',
    confidence: 0.1,
    signals: [{ signal: 'fallback — no harness detected', found: true }],
    configPaths: [],
  };
}

// ===========================================================================
// Provider Env Var Detection
// ===========================================================================

const PROVIDER_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'COHERE_API_KEY',
  'TOGETHER_API_KEY',
  'OPENROUTER_API_KEY',
  'OLLAMA_HOST',
  'LM_STUDIO_HOST',
] as const;

export function detectProviderEnvVarNames(): ProviderDetection {
  const signals: DetectionSignal[] = [];
  const envVarNames: string[] = [];

  for (const name of PROVIDER_ENV_VARS) {
    const found = envVarDefined(name);
    signals.push({ signal: `${name} env var name`, found });
    if (found) envVarNames.push(name);
  }

  const localSignals = ['OLLAMA_HOST', 'LM_STUDIO_HOST'];
  const hasLocal = envVarNames.some((v) => localSignals.includes(v));
  const hasCloud = envVarNames.some((v) => !localSignals.includes(v));

  let suggestedMode: ProfileProviderMode = 'disabled';
  if (hasLocal) suggestedMode = 'local';
  if (hasCloud) suggestedMode = 'direct';

  return { suggestedMode, envVarNames, signals };
}

// ===========================================================================
// Tool Detection from Manifests
// ===========================================================================

export function detectToolsFromManifests(scanRoot: string): ToolDetection[] {
  const tools: ToolDetection[] = [];

  const claudeMd = join(scanRoot, 'CLAUDE.md');
  if (fileExists(claudeMd)) {
    const content = readTextSafe(claudeMd);
    if (content) {
      const toolMatches = content.match(/(?:tool|command|function)s?:\s*([^\n]+)/gi);
      if (toolMatches) {
        for (const match of toolMatches) {
          tools.push({ name: match.trim(), source: 'CLAUDE.md' });
        }
      }
    }
  }

  const mcpSettings = join(scanRoot, '.mcp.json');
  if (fileExists(mcpSettings)) {
    const mcp = readJsonSafe(mcpSettings);
    if (mcp && typeof mcp === 'object') {
      const servers = (mcp.mcpServers ?? mcp.servers) as Record<string, unknown> | undefined;
      if (servers && typeof servers === 'object') {
        for (const name of Object.keys(servers)) {
          tools.push({ name: `mcp:${name}`, source: '.mcp.json' });
        }
      }
    }
  }

  const ocPlugin = join(scanRoot, 'openclaw.plugin.json');
  if (fileExists(ocPlugin)) {
    const plugin = readJsonSafe(ocPlugin);
    if (plugin && Array.isArray(plugin.tools)) {
      for (const tool of plugin.tools) {
        if (typeof tool === 'string') {
          tools.push({ name: tool, source: 'openclaw.plugin.json' });
        } else if (tool && typeof tool === 'object' && 'name' in tool) {
          tools.push({ name: String((tool as { name: unknown }).name), source: 'openclaw.plugin.json' });
        }
      }
    }
  }

  return tools;
}

// ===========================================================================
// Memory Source Detection
// ===========================================================================

function makeDetection(
  kind: MemorySourceKind,
  detected: boolean,
  detectionSignals: string[],
): MemorySourceDetection {
  return {
    kind,
    detected,
    detectionSignals,
    readConsent: false,
    writeBackConsent: false,
    scope: [],
  };
}

export function detectMemorySources(scanRoot: string, hostHome: string = process.env['HOME'] ?? ''): MemorySourceDetection[] {
  const sources: MemorySourceDetection[] = [];

  // G-Brain
  {
    const signals: string[] = [];
    const gbrainDir = join(hostHome, '.gbrain');
    if (dirExists(gbrainDir)) signals.push('~/.gbrain/ directory found');
    if (envVarDefined('GBRAIN_DATABASE_URL')) signals.push('GBRAIN_DATABASE_URL env var defined');

    const pkg = readJsonSafe(join(scanRoot, 'package.json'));
    if (pkg) {
      const deps = readPackageDeps(pkg);
      if ('gbrain' in deps || '@gbrain/sdk' in deps) signals.push('gbrain in package.json');
    }
    sources.push(makeDetection('gbrain', signals.length > 0, signals));
  }

  // MemPalace
  {
    const signals: string[] = [];
    const mpDir = join(hostHome, '.mempalace');
    if (dirExists(mpDir)) signals.push('~/.mempalace/ directory found');

    const mcpSettings = join(scanRoot, '.mcp.json');
    if (fileExists(mcpSettings)) {
      const content = readTextSafe(mcpSettings);
      if (content && content.includes('mempalace')) signals.push('mempalace in .mcp.json');
    }

    const pkg = readJsonSafe(join(scanRoot, 'package.json'));
    if (pkg) {
      const deps = readPackageDeps(pkg);
      if ('mempalace' in deps || '@mempalace/sdk' in deps) signals.push('mempalace in package.json');
    }
    sources.push(makeDetection('mempalace', signals.length > 0, signals));
  }

  // OpenClaw native memory
  {
    const signals: string[] = [];
    if (fileExists(join(scanRoot, 'MEMORY.md'))) signals.push('MEMORY.md found');
    const memDir = join(scanRoot, 'memory');
    if (dirExists(memDir)) {
      try {
        const files = readdirSync(memDir).filter((f) => f.endsWith('.md'));
        if (files.length > 0) signals.push(`memory/*.md found (${files.length} files)`);
      } catch { /* ignore */ }
    }
    if (fileExists(join(scanRoot, '.openclaw', 'memory.json'))) signals.push('.openclaw/memory.json found');
    sources.push(makeDetection('openclaw-native', signals.length > 0, signals));
  }

  // Hermes built-in
  {
    const signals: string[] = [];
    const hermesDir = process.env['HERMES_HOME'] ?? join(hostHome, '.hermes');
    const memoryMd = join(hermesDir, 'memories', 'MEMORY.md');
    const userMd = join(hermesDir, 'memories', 'USER.md');
    if (fileExists(memoryMd)) signals.push('~/.hermes/memories/MEMORY.md found');
    if (fileExists(userMd)) signals.push('~/.hermes/memories/USER.md found');
    sources.push(makeDetection('hermes-built-in', signals.length > 0, signals));
  }

  // Hermes active provider
  {
    const signals: string[] = [];
    const hermesDir = process.env['HERMES_HOME'] ?? join(hostHome, '.hermes');
    const configPath = join(hermesDir, 'config.yaml');
    if (fileExists(configPath)) {
      const content = readTextSafe(configPath);
      if (content && /memory\.provider/i.test(content)) {
        signals.push('memory.provider configured in Hermes config.yaml');
      }
    }
    sources.push(makeDetection('hermes-active-provider', signals.length > 0, signals));
  }

  // Markdown / Obsidian vault
  {
    const signals: string[] = [];
    if (envVarDefined('OBSIDIAN_VAULT_PATH')) signals.push('OBSIDIAN_VAULT_PATH env var defined');
    if (envVarDefined('PALACE_VAULTS')) signals.push('PALACE_VAULTS env var defined');

    const obsidianDir = join(scanRoot, '.obsidian');
    if (dirExists(obsidianDir)) signals.push('.obsidian/ directory found');
    sources.push(makeDetection('markdown-vault', signals.length > 0, signals));
  }

  // Mem0
  {
    const signals: string[] = [];
    if (envVarDefined('MEM0_API_KEY')) signals.push('MEM0_API_KEY env var defined');
    if (fileExists(join(scanRoot, 'mem0.json'))) signals.push('mem0.json config found');

    const pkg = readJsonSafe(join(scanRoot, 'package.json'));
    if (pkg) {
      const deps = readPackageDeps(pkg);
      if ('mem0ai' in deps || 'mem0' in deps) signals.push('mem0 in package.json');
    }
    sources.push(makeDetection('mem0', signals.length > 0, signals));
  }

  // Honcho
  {
    const signals: string[] = [];
    if (envVarDefined('HONCHO_API_KEY')) signals.push('HONCHO_API_KEY env var defined');
    if (fileExists(join(scanRoot, 'honcho.json'))) signals.push('honcho.json config found');

    const pkg = readJsonSafe(join(scanRoot, 'package.json'));
    if (pkg) {
      const deps = readPackageDeps(pkg);
      if ('honcho-ai' in deps) signals.push('honcho-ai in package.json');
    }
    sources.push(makeDetection('honcho', signals.length > 0, signals));
  }

  // Zep / Graphiti
  {
    const signals: string[] = [];
    if (envVarDefined('ZEP_API_KEY')) signals.push('ZEP_API_KEY env var defined');
    if (envVarDefined('NEO4J_URI')) signals.push('NEO4J_URI env var defined');

    const pkg = readJsonSafe(join(scanRoot, 'package.json'));
    if (pkg) {
      const deps = readPackageDeps(pkg);
      if ('zep-cloud' in deps || 'zep-python' in deps || '@getzep/zep-cloud' in deps) {
        signals.push('zep in package.json');
      }
      if ('graphiti-core' in deps) signals.push('graphiti in package.json');
    }
    sources.push(makeDetection('zep-graphiti', signals.length > 0, signals));
  }

  // Supermemory (Tier 2)
  {
    const signals: string[] = [];
    const mcpSettings = join(scanRoot, '.mcp.json');
    if (fileExists(mcpSettings)) {
      const content = readTextSafe(mcpSettings);
      if (content && content.includes('supermemory')) signals.push('supermemory in .mcp.json');
    }
    sources.push(makeDetection('supermemory', signals.length > 0, signals));
  }

  // Cognee (Tier 2)
  {
    const signals: string[] = [];
    const pkg = readJsonSafe(join(scanRoot, 'package.json'));
    if (pkg) {
      const deps = readPackageDeps(pkg);
      if ('cognee' in deps) signals.push('cognee in package.json');
    }
    sources.push(makeDetection('cognee', signals.length > 0, signals));
  }

  // Letta (Tier 2)
  {
    const signals: string[] = [];
    if (envVarDefined('LETTA_API_KEY')) signals.push('LETTA_API_KEY env var defined');
    const pkg = readJsonSafe(join(scanRoot, 'package.json'));
    if (pkg) {
      const deps = readPackageDeps(pkg);
      if ('letta-client' in deps || 'letta' in deps) signals.push('letta in package.json');
    }
    sources.push(makeDetection('letta', signals.length > 0, signals));
  }

  return sources;
}

// ===========================================================================
// Top-Level Detection
// ===========================================================================

export function detectAgentEnvironment(scanRoot: string, hostHome: string = process.env['HOME'] ?? ''): AgentEnvironment {
  const root = resolve(scanRoot);

  const ocDetection = detectOpenClaw(root);
  const hermesDetection = detectHermes(root, hostHome);
  const genericDetection = detectGenericNode(root);

  const candidates = [ocDetection, hermesDetection, genericDetection].filter(
    (d): d is HarnessDetection => d !== null,
  );

  candidates.sort((a, b) => b.confidence - a.confidence);
  const harness = candidates[0] ?? detectStandalone(root);

  const provider = detectProviderEnvVarNames();
  const tools = detectToolsFromManifests(root);
  const memorySources = detectMemorySources(root, hostHome);

  return {
    harness,
    provider,
    tools,
    memorySources,
    scanRoot: root,
    detectedAt: new Date().toISOString(),
  };
}
