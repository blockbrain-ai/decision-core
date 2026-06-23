# Generic Integration Guide

## Prerequisites

- Any Node.js project or standalone setup
- Decision Core installed: `npm install @decision-core/core`

## Setup

```bash
decision-core setup --agent generic --profile personal
```

Or for a business setup:

```bash
decision-core setup --agent generic --profile business
```

If you already have memory systems such as G-Brain, MemPalace, Obsidian, Mem0,
or Honcho, keep them in place and let setup inspect them with consent rather
than exporting everything into a new store first.

## What Gets Detected

- `package.json` — identifies as a Node project
- `.mcp.json` — MCP server tools
- Provider env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
- Memory sources if configured (Obsidian vault, Mem0, etc.)

## Integration Pattern

After setup, integrate Decision Core's policy evaluation point (PEP) before tool execution:

```typescript
import { evaluate } from '@decision-core/core';

async function beforeToolExecution(toolName: string, surface = 'api') {
  const result = await evaluate({
    action: toolName,
    surface,
  });

  if (result.decision === 'deny') {
    throw new Error(`Denied: ${result.rationale}`);
  }

  if (result.decision === 'approve_required') {
    const approved = await requestApproval(result);
    if (!approved) throw new Error('Not approved');
  }

  // Proceed with tool execution
}
```

## Post-Setup

1. Review generated policies in `.decision-core/policies/`
2. Validate: `decision-core validate .decision-core/policies/000-baseline.md`
3. Lint: `decision-core lint .decision-core/policies/`
4. Run `decision-core doctor` to verify setup health
