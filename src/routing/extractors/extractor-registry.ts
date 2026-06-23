import type { DeterministicExtractor } from './extractor.types.js';

const extractors = new Map<string, DeterministicExtractor>();

export function registerExtractor(extractor: DeterministicExtractor): void {
  extractors.set(extractor.surfaceId, extractor);
}

export function getExtractor(surfaceId: string): DeterministicExtractor | undefined {
  return extractors.get(surfaceId);
}

export function getAllExtractors(): ReadonlyMap<string, DeterministicExtractor> {
  return extractors;
}

export function hasExtractor(surfaceId: string): boolean {
  return extractors.has(surfaceId);
}

export function getExtractorIds(): string[] {
  return Array.from(extractors.keys());
}

export function clearExtractors(): void {
  extractors.clear();
}
