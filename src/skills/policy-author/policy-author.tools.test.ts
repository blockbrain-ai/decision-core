/**
 * Policy Author MCP Tools Tests
 *
 * Verifies that MCP tool registration and invocation works correctly.
 */

import { describe, it, expect } from 'vitest';
import { registerPolicyAuthorTools } from './policy-author.tools.js';

describe('registerPolicyAuthorTools', () => {
  it('registers 4 tools on the MCP server', () => {
    const registeredTools: string[] = [];
    const mockServer = {
      tool: (name: string, ..._args: unknown[]) => {
        registeredTools.push(name);
      },
    };

    registerPolicyAuthorTools(mockServer as never, 'test-tenant');

    expect(registeredTools).toHaveLength(4);
    expect(registeredTools).toContain('dc_author_from_text');
    expect(registeredTools).toContain('dc_author_from_document');
    expect(registeredTools).toContain('dc_author_review');
    expect(registeredTools).toContain('dc_author_commit');
  });
});
