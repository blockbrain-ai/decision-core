/**
 * Policy Section Parser
 *
 * Splits a Markdown document by heading hierarchy. Each section gets a
 * heading path (e.g., "Anti-Money Laundering Policy > Transaction Monitoring > Thresholds"),
 * section order index, and content text.
 */

import { sha256Hex } from '../../utils/audit-hash.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-section-parser');

export interface ParsedSection {
  id: string;
  title: string;
  headingPath: string;
  level: number;
  order: number;
  content: string;
  contentHash: string;
}

export function parseSections(content: string): ParsedSection[] {
  const lines = content.split('\n');
  const sections: ParsedSection[] = [];
  const headingStack: { title: string; level: number }[] = [];

  let currentTitle = '';
  let currentLevel = 0;
  let currentLines: string[] = [];
  let sectionOrder = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // Flush previous section
      if (currentTitle) {
        const sectionContent = currentLines.join('\n').trim();
        if (sectionContent.length > 0) {
          sections.push(buildSection(currentTitle, currentLevel, headingStack, sectionContent, sectionOrder));
          sectionOrder++;
        }
      }

      const level = headingMatch[1]!.length;
      const title = headingMatch[2]!.trim();

      // Update heading stack
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
        headingStack.pop();
      }
      headingStack.push({ title, level });

      currentTitle = title;
      currentLevel = level;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Flush final section
  if (currentTitle) {
    const sectionContent = currentLines.join('\n').trim();
    if (sectionContent.length > 0) {
      sections.push(buildSection(currentTitle, currentLevel, headingStack, sectionContent, sectionOrder));
    }
  }

  logger.info({ sectionCount: sections.length }, 'parsed sections');
  return sections;
}

function buildSection(
  title: string,
  level: number,
  headingStack: { title: string; level: number }[],
  content: string,
  order: number,
): ParsedSection {
  const headingPath = headingStack.map((h) => h.title).join(' > ');
  const id = `section-${order}`;
  const contentHash = sha256Hex(content);

  return { id, title, headingPath, level, order, content, contentHash };
}
