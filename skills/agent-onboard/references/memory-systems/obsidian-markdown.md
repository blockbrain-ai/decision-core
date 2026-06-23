# Markdown / Obsidian Vault Evidence Collection

## When This Applies

You detected an `.obsidian/` directory, `OBSIDIAN_VAULT_PATH` env var, `PALACE_VAULTS` env var, or the user specified a vault path. Read consent has been granted.

## How to Query

### Direct Filesystem Scan

1. List `.md` files in the vault path (limit to recent 30 days unless directed otherwise).
2. Parse YAML frontmatter from each file for structured metadata.
3. Extract wikilinks (`[[link]]`) and tags (`#tag`) for topic discovery.
4. Search file content for each topic in the search topics list.

### MCP Tools (When Available)

If Obsidian MCP tools are configured (MCPVault, Obsidian Palace MCP, omega-obsidian):
- Use the search/query tools provided by the MCP server
- These tools handle vault access and return structured results

## Search Topics

1. Agent tools and workflows
2. Business domain and operations
3. Compliance requirements (PII, finance, credentials, regulated data)
4. Blocked or denied action patterns
5. Existing policy or governance preferences
6. Data handling rules
7. Approval workflows

## Export Format

Return a `MemoryEvidenceExport` JSON. See [provider-export-format.md](provider-export-format.md).

Set `sourceKind` to `markdown-vault`.

## Safety Rules

- Only read from the consented vault path — do not traverse parent directories
- Do not include raw API keys, bearer tokens, or private keys
- Mark items as `sensitive: true` if they contain personal or confidential information
- Obsidian does not need to be installed — vault is just a directory of markdown files
- Do not read binary attachments (images, PDFs) — only `.md` files
- Limit summaries to 2000 characters
