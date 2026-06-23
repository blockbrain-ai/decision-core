# Memory Sources

Use this reference to choose the right source-specific instruction file.

Source files:

- `docs/MEMORY-SOURCES.md`
- `docs/MEMORY-SOURCE-AUDIT.md`
- `config/examples/memory-source-manifest.yaml`
- `src/onboarding/memory-evidence/memory-source-instructions.ts`

## Consent Model

Ask for consent before reading each source. Ask separately before writing any onboarding summary back.

Allowed consent states:

- No access: do not read or write.
- Read-only: collect redacted evidence for onboarding inference.
- Read and write-back: collect evidence and later write a short setup summary.

## Source Map

Use these files:

- G-Brain or MemPalace: `memory-systems/gbrain-mempalace.md`
- OpenClaw native memory: `memory-systems/openclaw-native.md`
- Hermes memory or active provider: `memory-systems/hermes-memory.md`
- Obsidian or Markdown vault: `memory-systems/obsidian-markdown.md`
- Mem0: `memory-systems/mem0.md`
- Honcho: `memory-systems/honcho.md`
- Zep or Graphiti: `memory-systems/zep-graphiti.md`
- Generic MCP memory source: `memory-systems/generic-mcp-memory.md`
- Any other source: `memory-systems/provider-export-format.md`

## Evidence Rules

Return evidence as `MemoryEvidenceExport` JSON.

Include:

- Short summaries of relevant work, tools, domains, data classes, and operational constraints.
- Source references that let the user audit where a suggestion came from.
- Confidence values.
- Suggested profile patches only when evidence is clear.

Do not include:

- Raw private notes unless the user explicitly asks and they are necessary.
- Secrets, credentials, tokens, private keys, cookies, or passwords.
- Full document dumps.
- Policy clauses written directly from memory without user confirmation.

## Inference Rules

Use memory to suggest:

- Profile mode.
- Jobs the agent performs.
- Tool risk tiers.
- Sensitive data classes.
- Compliance or approval needs.
- Candidate memory write-back scope.

After inference, show the user the suggested profile fields and ask them to confirm or correct them.
