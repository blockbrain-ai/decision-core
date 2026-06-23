/**
 * Optional-dependency probe for the native `better-sqlite3` binding.
 *
 * SQLite persistence is OPT-IN (the library defaults to in-memory). The native
 * `better-sqlite3` binary may not load in every environment — a CI runner or a
 * sandbox without a compiler toolchain or a matching prebuilt binary. In those
 * environments the SQLite-backed tests should SKIP cleanly rather than hard-fail
 * on a binary load error, so the suite stays green everywhere while still running
 * fully wherever the binding is present.
 */

import type BetterSqlite3 from 'better-sqlite3';

let cached: boolean | undefined;

/** True iff `better-sqlite3` can be loaded in this process. Result is cached. */
export function isBetterSqlite3Available(): boolean {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('better-sqlite3');
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

/** Reason string for skipped SQLite suites, so skipped coverage stays visible. */
export const BETTER_SQLITE3_UNAVAILABLE_REASON =
  'better-sqlite3 native binding not loadable in this environment (optional dependency) — SQLite tests skipped';

/**
 * Lazily load the `better-sqlite3` constructor at call time (inside a suite that
 * has already passed the `isBetterSqlite3Available()` skip guard). Tests must use
 * this instead of a top-level `import Database from 'better-sqlite3'`, whose
 * static load would crash the whole test file before `describe.skipIf` can skip.
 */
export function loadBetterSqlite3(): typeof BetterSqlite3 {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('better-sqlite3') as typeof BetterSqlite3;
}

/**
 * True when an error is the NATIVE better-sqlite3 module failing to load (a
 * missing/incompatible binary), as opposed to a real SQLite runtime error
 * (migration/schema, file permissions, a tenant bug). Used to turn an opaque
 * `.node` crash into an actionable "optional dependency unavailable" message
 * WITHOUT masking genuine SQLite failures.
 */
export function isBetterSqlite3LoadError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code ?? '';
  const message = err instanceof Error ? err.message : String(err);
  return /better[_-]?sqlite3|ERR_DLOPEN_FAILED|MODULE_NOT_FOUND|invalid ELF|GLIBC|\.node\b|require is not defined/i.test(
    `${message} ${code}`,
  );
}
