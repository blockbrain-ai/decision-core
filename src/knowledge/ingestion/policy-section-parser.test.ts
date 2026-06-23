import { describe, it, expect } from 'vitest';
import { parseSections } from './policy-section-parser.js';

describe('PolicySectionParser', () => {
  it('parses sections from headings', () => {
    const content = `# Policy

## Section A

Content of section A.

## Section B

Content of section B.
`;
    const sections = parseSections(content);

    expect(sections).toHaveLength(2);
    expect(sections[0]!.title).toBe('Section A');
    expect(sections[0]!.content).toBe('Content of section A.');
    expect(sections[1]!.title).toBe('Section B');
    expect(sections[1]!.content).toBe('Content of section B.');
  });

  it('builds correct heading paths', () => {
    const content = `# Root

## Parent

### Child

Some content here.
`;
    const sections = parseSections(content);

    expect(sections).toHaveLength(1);
    expect(sections[0]!.headingPath).toBe('Root > Parent > Child');
  });

  it('assigns sequential order indices', () => {
    const content = `# Doc

## First

Content 1.

## Second

Content 2.

## Third

Content 3.
`;
    const sections = parseSections(content);

    expect(sections).toHaveLength(3);
    expect(sections[0]!.order).toBe(0);
    expect(sections[1]!.order).toBe(1);
    expect(sections[2]!.order).toBe(2);
  });

  it('handles nested heading hierarchy correctly', () => {
    const content = `# Root

## A

### A1

Content A1.

### A2

Content A2.

## B

Content B.
`;
    const sections = parseSections(content);

    expect(sections).toHaveLength(3);
    expect(sections[0]!.headingPath).toBe('Root > A > A1');
    expect(sections[1]!.headingPath).toBe('Root > A > A2');
    expect(sections[2]!.headingPath).toBe('Root > B');
  });

  it('returns empty array for empty document', () => {
    const sections = parseSections('');
    expect(sections).toHaveLength(0);
  });

  it('returns empty array for headings-only document', () => {
    const content = `# Title

## Section

### Subsection
`;
    const sections = parseSections(content);
    expect(sections).toHaveLength(0);
  });

  it('computes content hash for each section', () => {
    const content = `# Doc

## Section

Some content.
`;
    const sections = parseSections(content);

    expect(sections[0]!.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces stable content hash for same content', () => {
    const content = `# Doc

## Section

Stable content.
`;
    const first = parseSections(content);
    const second = parseSections(content);

    expect(first[0]!.contentHash).toBe(second[0]!.contentHash);
  });
});
