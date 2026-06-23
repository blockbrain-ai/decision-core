/**
 * SQLite Connection Wrapper
 *
 * Manages a better-sqlite3 database instance with WAL mode
 * and automatic migration on first connect.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { runMigrations } from './migrations.js';

export type SqliteDatabase = BetterSqlite3.Database;

export interface SqliteConnectionOptions {
  path: string;
}

export function createSqliteConnection(options: SqliteConnectionOptions): SqliteDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DatabaseConstructor = require('better-sqlite3') as typeof BetterSqlite3;
  const db = new DatabaseConstructor(options.path);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}
