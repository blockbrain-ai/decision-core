/**
 * Policy Source Importer
 *
 * Loads Markdown policy documents, computes source hash (SHA-256),
 * and detects duplicate imports. First stage of the ingestion pipeline.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { sha256Hex } from '../../utils/audit-hash.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('policy-source-importer');

export interface ImportedSource {
  title: string;
  content: string;
  sourceHash: string;
  importedAt: string;
}

export interface ImporterOptions {
  title?: string;
  knownHashes?: Set<string>;
}

export interface ImportResult {
  source: ImportedSource;
  isDuplicate: boolean;
}

export async function importPolicySource(
  documentPath: string,
  options: ImporterOptions = {},
): Promise<ImportResult> {
  logger.info({ documentPath }, 'importing policy source');

  const content = await readFile(documentPath, 'utf-8');
  const sourceHash = sha256Hex(content);
  const title = options.title ?? extractTitle(content) ?? basename(documentPath, '.md');
  const isDuplicate = options.knownHashes?.has(sourceHash) ?? false;

  if (isDuplicate) {
    logger.info({ sourceHash, title }, 'duplicate document detected');
  }

  return {
    source: {
      title,
      content,
      sourceHash,
      importedAt: new Date().toISOString(),
    },
    isDuplicate,
  };
}

function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1]!.trim() : null;
}
