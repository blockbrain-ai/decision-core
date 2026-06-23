import { parse as parseYaml } from 'yaml';
import {
  PolicyFrontmatterSchema,
  StructuredClauseBlockSchema,
  StructuredPolicyDocumentSchema,
  type PolicyFrontmatter,
  type StructuredPolicyDocument,
  type ParsedStructuredClause,
  type SourceLineRef,
} from './structured-clause.types.js';

const FRONTMATTER_DELIMITER = '---';
const CLAUSE_FENCE_OPEN = /^```decision-core-clause\s*$/;
const CLAUSE_FENCE_CLOSE = /^```\s*$/;

export function detectFrontmatter(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith(FRONTMATTER_DELIMITER + '\n') || trimmed.startsWith(FRONTMATTER_DELIMITER + '\r\n');
}

export interface FrontmatterParseResult {
  frontmatter: PolicyFrontmatter;
  body: string;
  bodyStartLine: number;
}

export function parseFrontmatter(content: string): FrontmatterParseResult {
  const lines = content.split(/\r?\n/);
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_DELIMITER) {
      if (start === -1) {
        start = i;
      } else {
        end = i;
        break;
      }
    } else if (start === -1 && lines[i].trim() !== '') {
      throw new Error(`Expected frontmatter delimiter '---' at line ${i + 1}, found: ${lines[i]}`);
    }
  }

  if (start === -1 || end === -1) {
    throw new Error('Incomplete YAML frontmatter: missing closing ---');
  }

  const yamlContent = lines.slice(start + 1, end).join('\n');
  const parsed = parseYaml(yamlContent);
  const frontmatter = PolicyFrontmatterSchema.parse(parsed);

  const bodyStartLine = end + 2; // 1-indexed, first line after closing ---
  const body = lines.slice(end + 1).join('\n');

  return { frontmatter, body, bodyStartLine };
}

export function parseStructuredClauseBlocks(body: string, filePath?: string, bodyStartLine = 1): ParsedStructuredClause[] {
  const lines = body.split(/\r?\n/);
  const results: ParsedStructuredClause[] = [];

  let inBlock = false;
  let blockLines: string[] = [];
  let blockStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inBlock && CLAUSE_FENCE_OPEN.test(line)) {
      inBlock = true;
      blockLines = [];
      blockStartLine = bodyStartLine + i;
      continue;
    }

    if (inBlock && CLAUSE_FENCE_CLOSE.test(line)) {
      const yamlContent = blockLines.join('\n');
      const parsed = parseYaml(yamlContent);
      const clause = StructuredClauseBlockSchema.parse(parsed);

      const sourceLineRef: SourceLineRef = {
        file: filePath ?? '<inline>',
        startLine: blockStartLine,
        endLine: bodyStartLine + i,
      };

      results.push({ clause, sourceLineRef });
      inBlock = false;
      blockLines = [];
      continue;
    }

    if (inBlock) {
      blockLines.push(line);
    }
  }

  if (inBlock) {
    throw new Error(`Unclosed decision-core-clause block starting at line ${blockStartLine}`);
  }

  return results;
}

export function parseStructuredDocument(content: string, filePath?: string): { document: StructuredPolicyDocument; parsedClauses: ParsedStructuredClause[] } {
  const { frontmatter, body, bodyStartLine } = parseFrontmatter(content);
  const parsedClauses = parseStructuredClauseBlocks(body, filePath, bodyStartLine);

  const clauses = parsedClauses.map((pc) => pc.clause);
  const document = StructuredPolicyDocumentSchema.parse({ frontmatter, clauses });

  return { document, parsedClauses };
}
