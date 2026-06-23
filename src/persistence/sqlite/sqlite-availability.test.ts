import { describe, it, expect } from 'vitest';
import { isBetterSqlite3Available, isBetterSqlite3LoadError } from './sqlite-availability.js';

describe('isBetterSqlite3Available', () => {
  it('returns a boolean (true in the dev/test environment where the binding is installed)', () => {
    expect(typeof isBetterSqlite3Available()).toBe('boolean');
  });
});

describe('isBetterSqlite3LoadError', () => {
  it('detects native module load failures (so SQLite-unavailable gets an actionable error)', () => {
    expect(isBetterSqlite3LoadError(new Error("Cannot find module 'better-sqlite3'"))).toBe(true);
    expect(isBetterSqlite3LoadError(Object.assign(new Error('boom'), { code: 'MODULE_NOT_FOUND' }))).toBe(true);
    expect(isBetterSqlite3LoadError(Object.assign(new Error('dlopen failed'), { code: 'ERR_DLOPEN_FAILED' }))).toBe(true);
    expect(isBetterSqlite3LoadError(new Error('/x/better_sqlite3.node: /lib/libm.so.6: version `GLIBC_2.38\' not found'))).toBe(true);
    expect(isBetterSqlite3LoadError(new Error('require is not defined'))).toBe(true);
  });

  it('does NOT classify genuine SQLite runtime errors as load failures (no masking real bugs)', () => {
    expect(isBetterSqlite3LoadError(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'))).toBe(false);
    expect(isBetterSqlite3LoadError(new Error('table policy_rules already exists'))).toBe(false);
    expect(isBetterSqlite3LoadError(new Error('SQLITE_CANTOPEN: unable to open database file'))).toBe(false);
  });
});
