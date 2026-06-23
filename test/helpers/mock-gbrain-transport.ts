/**
 * Mock G-Brain Transport — Simulates mounted/unmounted brain access.
 *
 * Provides a local, test-only transport that reads brain fixtures
 * and returns data for mounted brains, nothing for unmounted brains.
 */

import type { BrainFixture } from './org-fixture-loader.js';

export interface BrainQuery {
  brainId: string;
  key?: string;
}

export interface BrainQueryResult {
  brainId: string;
  mounted: boolean;
  data: Record<string, unknown> | null;
}

export interface MockGBrainTransport {
  /** Query a brain by ID. Returns data if mounted, null if not. */
  query(query: BrainQuery): BrainQueryResult;
  /** Check whether a brain is mounted (accessible). */
  isMounted(brainId: string): boolean;
  /** Mount a brain (make it accessible). */
  mount(brainId: string): void;
  /** Unmount a brain (make it inaccessible). */
  unmount(brainId: string): void;
  /** Get all mounted brain IDs. */
  getMountedBrainIds(): string[];
  /** Get all known brain IDs (mounted and unmounted). */
  getAllBrainIds(): string[];
}

/**
 * Create a mock G-brain transport from brain fixtures.
 */
export function createMockGBrainTransport(brains: BrainFixture[]): MockGBrainTransport {
  const brainMap = new Map<string, BrainFixture>();
  for (const brain of brains) {
    brainMap.set(brain.brainId, { ...brain });
  }

  return {
    query(queryParams: BrainQuery): BrainQueryResult {
      const brain = brainMap.get(queryParams.brainId);

      if (!brain) {
        return { brainId: queryParams.brainId, mounted: false, data: null };
      }

      if (!brain.mounted) {
        return { brainId: queryParams.brainId, mounted: false, data: null };
      }

      if (queryParams.key) {
        const value = brain.data[queryParams.key];
        return {
          brainId: queryParams.brainId,
          mounted: true,
          data: value !== undefined ? { [queryParams.key]: value } : null,
        };
      }

      return {
        brainId: queryParams.brainId,
        mounted: true,
        data: brain.data,
      };
    },

    isMounted(brainId: string): boolean {
      const brain = brainMap.get(brainId);
      return brain?.mounted ?? false;
    },

    mount(brainId: string): void {
      const brain = brainMap.get(brainId);
      if (brain) {
        brain.mounted = true;
      }
    },

    unmount(brainId: string): void {
      const brain = brainMap.get(brainId);
      if (brain) {
        brain.mounted = false;
      }
    },

    getMountedBrainIds(): string[] {
      return Array.from(brainMap.values())
        .filter((b) => b.mounted)
        .map((b) => b.brainId);
    },

    getAllBrainIds(): string[] {
      return Array.from(brainMap.keys());
    },
  };
}
