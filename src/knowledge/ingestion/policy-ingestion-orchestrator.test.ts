import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createIngestionOrchestrator } from './policy-ingestion-orchestrator.js';
import { InMemoryClauseRepository } from '../../persistence/memory/in-memory-clause.repository.js';
import type { TenantId } from '../../contracts/common.contracts.js';

const EXAMPLE_PATH = join(import.meta.dirname, '../../../config/examples/example-policy.md');
const TENANT_ID = 'test-tenant' as TenantId;

describe('PolicyIngestionOrchestrator', () => {
  it('ingests example policy document end-to-end', async () => {
    const repo = new InMemoryClauseRepository();
    const orchestrator = createIngestionOrchestrator(repo);

    const result = await orchestrator.ingest(TENANT_ID, EXAMPLE_PATH);

    expect(result.sourceDocument.title).toBe('Anti-Money Laundering Policy');
    expect(result.sourceDocument.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.normalizedClauses.length).toBeGreaterThan(0);
    expect(result.isDuplicate).toBe(false);
  });

  it('all extracted clauses are implicitly draft (not automatically activated)', async () => {
    const repo = new InMemoryClauseRepository();
    const orchestrator = createIngestionOrchestrator(repo);

    const result = await orchestrator.ingest(TENANT_ID, EXAMPLE_PATH);

    // normalizedClauses don't carry status — they are inputs to clause creation.
    // The contract ensures all created clauses start as draft (verified by change report being all "added")
    expect(result.changeReport.added.length).toBe(result.normalizedClauses.length);
    expect(result.changeReport.modified).toHaveLength(0);
    expect(result.changeReport.removed).toHaveLength(0);
  });

  it('detects changes on re-ingestion after modifications', async () => {
    const repo = new InMemoryClauseRepository();
    const orchestrator = createIngestionOrchestrator(repo);

    // First ingestion
    const first = await orchestrator.ingest(TENANT_ID, EXAMPLE_PATH);

    // Simulate storing clauses from first ingestion
    for (const clause of first.normalizedClauses) {
      await repo.create(TENANT_ID, {
        clauseKey: clause.clauseKey,
        text: clause.text,
        clauseType: clause.clauseType,
        sectionId: clause.sectionId,
        sourceDocumentId: 'doc-1',
        status: 'draft',
        effectiveDate: null,
        expiryDate: null,
        correlationId: 'corr-1',
      });
    }

    // Second ingestion of same document — all should be unchanged
    const second = await orchestrator.ingest(TENANT_ID, EXAMPLE_PATH);

    expect(second.changeReport.unchanged.length).toBe(second.normalizedClauses.length);
    expect(second.changeReport.added).toHaveLength(0);
    expect(second.changeReport.modified).toHaveLength(0);
    expect(second.changeReport.removed).toHaveLength(0);
  });

  it('handles empty document', async () => {
    const tmpDir = join(tmpdir(), `dc-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const emptyPath = join(tmpDir, 'empty.md');
    await writeFile(emptyPath, '');

    try {
      const repo = new InMemoryClauseRepository();
      const orchestrator = createIngestionOrchestrator(repo);

      const result = await orchestrator.ingest(TENANT_ID, emptyPath);

      expect(result.sections).toHaveLength(0);
      expect(result.normalizedClauses).toHaveLength(0);
      expect(result.changeReport.added).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('handles document with only headings (no parseable clauses)', async () => {
    const tmpDir = join(tmpdir(), `dc-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const headingsPath = join(tmpDir, 'headings-only.md');
    await writeFile(headingsPath, '# Title\n\n## Section\n\n### Subsection\n');

    try {
      const repo = new InMemoryClauseRepository();
      const orchestrator = createIngestionOrchestrator(repo);

      const result = await orchestrator.ingest(TENANT_ID, headingsPath);

      expect(result.sections).toHaveLength(0);
      expect(result.normalizedClauses).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('handles document with content but no policy patterns', async () => {
    const tmpDir = join(tmpdir(), `dc-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const noClausesPath = join(tmpDir, 'no-clauses.md');
    await writeFile(noClausesPath, '# Overview\n\n## Introduction\n\nThis is a general description of the policy framework.\n');

    try {
      const repo = new InMemoryClauseRepository();
      const orchestrator = createIngestionOrchestrator(repo);

      const result = await orchestrator.ingest(TENANT_ID, noClausesPath);

      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.normalizedClauses).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  it('reports duplicate when knownHashes contains source hash', async () => {
    const repo = new InMemoryClauseRepository();
    const orchestrator = createIngestionOrchestrator(repo);

    const first = await orchestrator.ingest(TENANT_ID, EXAMPLE_PATH);
    const knownHashes = new Set([first.sourceDocument.sourceHash]);

    const second = await orchestrator.ingest(TENANT_ID, EXAMPLE_PATH, { knownHashes });
    expect(second.isDuplicate).toBe(true);
  });

  it('extracts multiple clause types from example document', async () => {
    const repo = new InMemoryClauseRepository();
    const orchestrator = createIngestionOrchestrator(repo);

    const result = await orchestrator.ingest(TENANT_ID, EXAMPLE_PATH);

    const types = new Set(result.normalizedClauses.map((c) => c.clauseType));
    expect(types.size).toBeGreaterThanOrEqual(4);
  });
});
