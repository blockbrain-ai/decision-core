import { readFileSync } from 'node:fs';
import { isMap, isSeq, parse as parseYaml, parseDocument } from 'yaml';
import {
  StructuredPolicyDocumentSchema,
  type StructuredPolicyDocument,
  type ParsedStructuredClause,
  type SourceLineRef,
} from './structured-clause.types.js';

export function parseYamlPolicy(content: string, filePath?: string): { document: StructuredPolicyDocument; parsedClauses: ParsedStructuredClause[] } {
  const parsed = parseYaml(content);
  const document = StructuredPolicyDocumentSchema.parse(parsed);
  const sourceLineRefs = extractYamlClauseLineRefs(content, filePath ?? '<inline>', document.clauses.length);

  const parsedClauses: ParsedStructuredClause[] = document.clauses.map((clause, index) => ({
    clause,
    sourceLineRef: sourceLineRefs[index] ?? { file: filePath ?? '<inline>', startLine: 1, endLine: 1 },
  }));

  return { document, parsedClauses };
}

export function parseYamlPolicyFile(filePath: string): { document: StructuredPolicyDocument; parsedClauses: ParsedStructuredClause[] } {
  const content = readFileSync(filePath, 'utf-8');
  return parseYamlPolicy(content, filePath);
}

function extractYamlClauseLineRefs(content: string, file: string, clauseCount: number): SourceLineRef[] {
  const lineStarts = buildLineStarts(content);
  const fallback = Array.from({ length: clauseCount }, () => ({ file, startLine: 1, endLine: 1 }));

  const doc = parseDocument(content, { keepSourceTokens: true });
  const root = doc.contents;
  if (!isMap(root)) return fallback;

  const clausesPair = root.items.find((pair) => pair.key?.toString() === 'clauses');
  if (!clausesPair || !isSeq(clausesPair.value)) return fallback;

  return clausesPair.value.items.map((item) => {
    const range = getRange(item);
    if (!range) return { file, startLine: 1, endLine: 1 };

    return {
      file,
      startLine: lineFromOffset(lineStarts, range[0]),
      endLine: lineFromOffset(lineStarts, Math.max(range[0], range[1] - 1)),
    };
  });
}

function buildLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineFromOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }

  return Math.max(1, high + 1);
}

function getRange(node: unknown): [number, number, number] | undefined {
  if (!node || typeof node !== 'object' || !('range' in node)) return undefined;
  const range = (node as { range?: unknown }).range;
  if (!Array.isArray(range) || range.length < 2) return undefined;
  if (typeof range[0] !== 'number' || typeof range[1] !== 'number') return undefined;
  return [range[0], range[1], typeof range[2] === 'number' ? range[2] : range[1]];
}
