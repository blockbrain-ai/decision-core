/**
 * Backup/restore helpers for mutating CLI commands.
 *
 * Creates timestamped backups under .decision-core/backups/ before
 * overwriting policy-pack.yaml or decision-core.yaml.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, appendFileSync, realpathSync } from 'fs';
import { resolve, basename, dirname, sep } from 'path';

export interface BackupEntry {
  timestamp: string;
  files: string[];
  command: string;
}

export function createBackup(
  files: string[],
  command: string,
  dcDir: string,
): BackupEntry {
  const resolvedDcDir = resolve(dcDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = resolve(resolvedDcDir, 'backups', timestamp);
  mkdirSync(backupDir, { recursive: true });

  const backedUp: string[] = [];
  for (const file of files) {
    const resolvedFile = resolve(file);
    if (existsSync(resolvedFile) && isDecisionCoreOwnedPath(resolvedFile, resolvedDcDir)) {
      const dest = resolve(backupDir, basename(resolvedFile));
      copyFileSync(resolvedFile, dest);
      backedUp.push(resolvedFile);
    }
  }

  const entry: BackupEntry = { timestamp, files: backedUp, command };
  const manifestPath = resolve(backupDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(entry, null, 2), 'utf-8');

  return entry;
}

export function listBackups(dcDir: string): BackupEntry[] {
  const backupsDir = resolve(dcDir, 'backups');
  if (!existsSync(backupsDir)) return [];

  const entries: BackupEntry[] = [];
  for (const dir of readdirSync(backupsDir).sort().reverse()) {
    const manifestPath = resolve(backupsDir, dir, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        entries.push(JSON.parse(readFileSync(manifestPath, 'utf-8')));
      } catch {
        // skip corrupt manifests
      }
    }
  }
  return entries;
}

export function restoreLatestBackup(dcDir: string): BackupEntry | null {
  const resolvedDcDir = resolve(dcDir);
  const backupsDir = resolve(resolvedDcDir, 'backups');
  if (!existsSync(backupsDir)) return null;

  const dirs = readdirSync(backupsDir).sort().reverse();
  if (dirs.length === 0) return null;

  const latestDir = resolve(backupsDir, dirs[0]);
  const manifestPath = resolve(latestDir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;

  const entry: BackupEntry = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  for (const originalPath of entry.files) {
    const resolvedOriginal = resolve(originalPath);
    if (!isDecisionCoreOwnedPath(resolvedOriginal, resolvedDcDir)) continue;

    const backupCopy = resolve(latestDir, basename(resolvedOriginal));
    if (existsSync(backupCopy)) {
      mkdirSync(dirname(resolvedOriginal), { recursive: true });
      copyFileSync(backupCopy, resolvedOriginal);
    }
  }

  return entry;
}

export function decisionCoreDirForPack(packPath: string): string {
  const packDir = dirname(resolve(packPath));
  return basename(packDir) === '.decision-core'
    ? packDir
    : resolve(process.cwd(), '.decision-core');
}

export function appendRuleChange(dcDir: string, command: string, message: string): void {
  const reportPath = resolve(dcDir, 'reports', 'rule-changes.md');
  mkdirSync(dirname(reportPath), { recursive: true });

  if (!existsSync(reportPath)) {
    writeFileSync(reportPath, '# Rule Changes\n\n', 'utf-8');
  }

  appendFileSync(
    reportPath,
    `- ${new Date().toISOString()} — ${command}: ${message}\n`,
    'utf-8',
  );
}

function isDecisionCoreOwnedPath(filePath: string, dcDir: string): boolean {
  const canonicalFilePath = canonicalPath(filePath);
  const canonicalDcDir = canonicalPath(dcDir);
  const rootConfigPath = canonicalPath(resolve(canonicalDcDir, '..', 'decision-core.yaml'));
  return canonicalFilePath === rootConfigPath || canonicalFilePath.startsWith(canonicalDcDir + sep);
}

function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}
