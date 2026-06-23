/**
 * Policy Clause Extractor
 *
 * Extracts clause candidates from parsed sections using deterministic
 * pattern matching. Identifies obligation, prohibition, threshold,
 * permission, evidence requirement, approval requirement, and other
 * clause types from text patterns.
 */

import type { ClauseType } from '../../contracts/clause.contracts.js';
import type { ParsedSection } from './policy-section-parser.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-clause-extractor');

export interface ExtractedClause {
  text: string;
  clauseType: ClauseType;
  sectionId: string;
  headingPath: string;
  indexInSection: number;
  confidence: number;
}

interface PatternRule {
  type: ClauseType;
  patterns: RegExp[];
  confidence: number;
}

const PATTERN_RULES: PatternRule[] = [
  // More specific patterns MUST come before generic "must"/"shall" to avoid false matches
  {
    type: 'protected_attribute_constraint',
    patterns: [
      /\b(?:must\s+not\s+consider|(?:race|religion|gender|age|national\s+origin).*(?:prohibited|must\s+not))\b/i,
      /\b(?:protected\s+(?:attribute|categor(?:y|ies)))\b/i,
    ],
    confidence: 0.9,
  },
  {
    type: 'routing_constraint',
    patterns: [
      /\b(?:(?:shall|must)\s+be\s+routed|routed\s+to|escalat(?:ed?|ion)\s+(?:to|path))\b/i,
    ],
    confidence: 0.85,
  },
  {
    type: 'approval_requirement',
    patterns: [
      /\b(?:must\s+be\s+approved|approval\s+required|approved\s+by)\b/i,
    ],
    confidence: 0.9,
  },
  {
    type: 'human_oversight_requirement',
    patterns: [
      /\b(?:human\s+(?:oversight|review(?:er)?)|human\s+reviewer\s+is\s+required)\b/i,
    ],
    confidence: 0.9,
  },
  {
    type: 'evidence_requirement',
    patterns: [
      /\b(?:evidence\s+of|proof\s+of|documentation\s+required|must\s+be\s+retained)\b/i,
    ],
    confidence: 0.85,
  },
  {
    type: 'threshold',
    patterns: [
      /\b(?:exceed(?:s|ing)?|more\s+than|greater\s+than|less\s+than|below|above)\b.*\$?\d/i,
      /\$\d[\d,]*(?:\.\d+)?/,
    ],
    confidence: 0.85,
  },
  {
    type: 'prohibition',
    patterns: [
      /\b(?:must\s+not|shall\s+not|is\s+forbidden|are\s+forbidden|is\s+prohibited|are\s+prohibited)\b/i,
    ],
    confidence: 0.95,
  },
  {
    type: 'obligation',
    patterns: [
      /\b(?:must|shall|is\s+required\s+to|are\s+required\s+to)\b/i,
    ],
    confidence: 0.9,
  },
  {
    type: 'permission',
    patterns: [
      /\b(?:may\b|is\s+allowed\s+to|are\s+allowed\s+to|is\s+permitted|are\s+permitted)\b/i,
    ],
    confidence: 0.8,
  },
];

export function extractClauses(sections: ParsedSection[]): ExtractedClause[] {
  const clauses: ExtractedClause[] = [];

  for (const section of sections) {
    const sectionClauses = extractFromSection(section);
    clauses.push(...sectionClauses);
  }

  logger.info({ clauseCount: clauses.length }, 'extracted clauses');
  return clauses;
}

function extractFromSection(section: ParsedSection): ExtractedClause[] {
  const clauses: ExtractedClause[] = [];
  const candidates = splitIntoCandidates(section.content);
  let indexInSection = 0;

  for (const candidate of candidates) {
    const text = candidate.trim();
    if (text.length === 0) continue;

    const match = classifyCandidate(text);
    if (match) {
      clauses.push({
        text,
        clauseType: match.type,
        sectionId: section.id,
        headingPath: section.headingPath,
        indexInSection,
        confidence: match.confidence,
      });
      indexInSection++;
    }
  }

  return clauses;
}

function splitIntoCandidates(content: string): string[] {
  const candidates: string[] = [];

  // Split by paragraph boundaries
  const blocks = content.split(/\n\n+/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Check if it's a table — extract rows
    if (isTable(trimmed)) {
      candidates.push(...extractTableRows(trimmed));
    }
    // Check if it's a bullet list — extract items
    else if (isBulletList(trimmed)) {
      candidates.push(...extractBulletItems(trimmed));
    }
    // Otherwise treat as a paragraph (may contain multiple sentences)
    else {
      candidates.push(trimmed);
    }
  }

  return candidates;
}

function isTable(text: string): boolean {
  const lines = text.split('\n');
  return lines.length >= 3 && lines.some((line) => /^\|.*\|$/.test(line.trim()));
}

function isBulletList(text: string): boolean {
  const lines = text.split('\n');
  return lines.every((line) => /^\s*[-*+]\s/.test(line) || line.trim() === '');
}

function extractTableRows(text: string): string[] {
  const lines = text.split('\n');
  const rows: string[] = [];
  let headerCells: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip header separator rows
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
    // Skip empty lines
    if (!trimmed) continue;
    // Must be a table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());

      if (!headerCells) {
        // First row is the header — save for context but don't emit as clause
        headerCells = cells;
      } else {
        // Data row: combine header + values for richer context
        const combined = cells.map((cell, i) => {
          const header = headerCells![i];
          return header ? `${header}: ${cell}` : cell;
        }).join(', ');
        rows.push(combined);
      }
    }
  }

  return rows;
}

function extractBulletItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*+]\s+/, '').trim())
    .filter((line) => line.length > 0);
}

function classifyCandidate(text: string): { type: ClauseType; confidence: number } | null {
  // Try rules in priority order (prohibition before obligation to catch "must not" before "must")
  for (const rule of PATTERN_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return { type: rule.type, confidence: rule.confidence };
      }
    }
  }

  return null;
}
