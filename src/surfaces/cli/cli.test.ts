/**
 * CLI Entry Point Tests
 *
 * Tests arg parsing and command dispatch.
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it('parses command from argv', () => {
    const result = parseArgs(['node', 'script.js', 'evaluate']);
    expect(result.command).toBe('evaluate');
    expect(result.positionals).toEqual([]);
  });

  it('defaults to help when no command', () => {
    const result = parseArgs(['node', 'script.js']);
    expect(result.command).toBe('help');
  });

  it('parses --key value flags', () => {
    const result = parseArgs(['node', 'script.js', 'evaluate', '--surface', 'cli', '--action', 'deploy']);
    expect(result.command).toBe('evaluate');
    expect(result.flags['surface']).toBe('cli');
    expect(result.flags['action']).toBe('deploy');
  });

  it('parses --key=value flags', () => {
    const result = parseArgs(['node', 'script.js', 'serve', '--port=8080']);
    expect(result.flags['port']).toBe('8080');
  });

  it('parses boolean flags', () => {
    const result = parseArgs(['node', 'script.js', 'serve', '--mcp', '--json']);
    expect(result.flags['mcp']).toBe(true);
    expect(result.flags['json']).toBe(true);
  });

  it('captures subcommand in positionals', () => {
    const result = parseArgs(['node', 'script.js', 'providers', 'list']);
    expect(result.command).toBe('providers');
    expect(result.subcommand).toBe('list');
    expect(result.positionals).toEqual(['list']);
  });

  it('handles mixed positionals and flags', () => {
    const result = parseArgs(['node', 'script.js', 'ingest', 'policy.md', '--json']);
    expect(result.command).toBe('ingest');
    expect(result.positionals).toEqual(['policy.md']);
    expect(result.flags['json']).toBe(true);
  });
});
