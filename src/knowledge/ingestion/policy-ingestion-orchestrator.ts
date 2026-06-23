/**
 * Policy Ingestion Orchestrator
 *
 * Wires all pipeline stages together: import → parse → extract → normalize → detect changes.
 * Entry point for ingesting a Markdown policy document into structured clause records.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClause } from '../../contracts/clause.contracts.js';
import type { ClauseRepository } from '../../persistence/interfaces/clause.repository.js';
import { importPolicySource } from './policy-source-importer.js';
import type { ImportedSource } from './policy-source-importer.js';
import { parseSections } from './policy-section-parser.js';
import type { ParsedSection } from './policy-section-parser.js';
import { extractClauses } from './policy-clause-extractor.js';
import type { ExtractedClause } from './policy-clause-extractor.js';
import { normalizeClauses } from './policy-clause-normalizer.js';
import type { NormalizedClause } from './policy-clause-normalizer.js';
import { detectChanges } from './policy-change-detector.js';
import type { ChangeReport } from './policy-change-detector.js';
import { detectFrontmatter, parseStructuredDocument } from '../authoring/frontmatter-parser.js';
import { convertStructuredClauses, type StructuredCompilerInput } from '../authoring/structured-to-clause.js';
import type { PolicyFrontmatter } from '../authoring/structured-clause.types.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-ingestion-orchestrator');

export interface IngestionOptions {
  title?: string;
  knownHashes?: Set<string>;
}

export interface IngestionResult {
  sourceDocument: ImportedSource;
  sections: ParsedSection[];
  extractedClauses: ExtractedClause[];
  normalizedClauses: NormalizedClause[];
  changeReport: ChangeReport;
  isDuplicate: boolean;
  structured: boolean;
  frontmatter?: PolicyFrontmatter;
  structuredCompilerInputs?: StructuredCompilerInput[];
}

export interface PolicyIngestionOrchestrator {
  ingest(tenantId: TenantId, documentPath: string, options?: IngestionOptions): Promise<IngestionResult>;
}

export function createIngestionOrchestrator(clauseRepository: ClauseRepository): PolicyIngestionOrchestrator {
  return {
    async ingest(tenantId: TenantId, documentPath: string, options: IngestionOptions = {}): Promise<IngestionResult> {
      logger.info({ tenantId, documentPath }, 'starting policy ingestion');

      // Stage 1: Import source
      const importResult = await importPolicySource(documentPath, {
        title: options.title,
        knownHashes: options.knownHashes,
      });

      const content = importResult.source.content;
      const isStructured = detectFrontmatter(content);

      let extractedClauses: ExtractedClause[];
      let sections: ParsedSection[];
      let frontmatter: PolicyFrontmatter | undefined;
      let structuredCompilerInputs: StructuredCompilerInput[] | undefined;

      if (isStructured) {
        logger.info({ documentPath }, 'detected structured frontmatter, using structured parse path');
        const { document, parsedClauses } = parseStructuredDocument(content, documentPath);
        frontmatter = document.frontmatter;

        const conversion = convertStructuredClauses(parsedClauses, frontmatter);
        extractedClauses = conversion.extractedClauses;
        structuredCompilerInputs = conversion.compilerInputs;
        sections = [];
      } else {
        // Stage 2: Parse sections
        sections = parseSections(content);

        // Stage 3: Extract clauses
        extractedClauses = extractClauses(sections);
      }

      // Stage 4: Normalize clauses
      const normalizedClauses = normalizeClauses(extractedClauses);

      // Stage 5: Detect changes against existing clauses
      let existingClauses: PolicyClause[] = [];
      try {
        existingClauses = await clauseRepository.findByTenant(tenantId);
      } catch {
        logger.warn('no existing clauses found, treating as fresh ingestion');
      }
      const changeReport = detectChanges(normalizedClauses, existingClauses);

      logger.info(
        {
          sections: sections.length,
          clauses: normalizedClauses.length,
          isDuplicate: importResult.isDuplicate,
          structured: isStructured,
        },
        'policy ingestion complete',
      );

      return {
        sourceDocument: importResult.source,
        sections,
        extractedClauses,
        normalizedClauses,
        changeReport,
        isDuplicate: importResult.isDuplicate,
        structured: isStructured,
        frontmatter,
        structuredCompilerInputs,
      };
    },
  };
}
