/**
 * SQLite Schema Migrations
 *
 * Creates all tables for Decision Core persistence.
 * JSON columns stored as TEXT, arrays as JSON-serialized TEXT.
 */

import type BetterSqlite3 from 'better-sqlite3';

export function runMigrations(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS policy_rules (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      action_type_pattern TEXT NOT NULL,
      risk_class TEXT NOT NULL,
      enforcement_point TEXT NOT NULL,
      policy_type TEXT NOT NULL,
      priority INTEGER NOT NULL,
      max_amount_usd REAL,
      max_count_per_day INTEGER,
      cooldown_minutes INTEGER,
      time_window_start TEXT,
      time_window_end TEXT,
      min_data_quality REAL,
      min_confidence REAL,
      required_constraints TEXT NOT NULL DEFAULT '[]',
      require_approval INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_policy_rules_tenant ON policy_rules(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_policy_rules_tenant_type ON policy_rules(tenant_id, policy_type);

    CREATE TABLE IF NOT EXISTS decision_logs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      surface TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL,
      model TEXT,
      latency REAL NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      quality_gate TEXT,
      correlation_id TEXT NOT NULL,
      audit_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decision_logs_tenant ON decision_logs(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_decision_logs_correlation ON decision_logs(tenant_id, correlation_id);

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      risk_class TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      constraint_drift INTEGER NOT NULL DEFAULT 0,
      policy_rule_id TEXT NOT NULL,
      action_payload TEXT NOT NULL,
      constraint_snapshot TEXT NOT NULL DEFAULT '[]',
      current_constraints TEXT NOT NULL DEFAULT '[]',
      execution_status TEXT,
      executed_at TEXT,
      execution_result TEXT,
      rollback_available INTEGER,
      resolved_by TEXT,
      resolved_at TEXT,
      resolution_notes TEXT,
      correlation_id TEXT NOT NULL,
      audit_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_tenant ON approvals(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(tenant_id, status);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      correlation_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(tenant_id, correlation_id);

    CREATE TABLE IF NOT EXISTS clauses (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      clause_key TEXT NOT NULL,
      text TEXT NOT NULL,
      normalized_hash TEXT NOT NULL,
      clause_type TEXT NOT NULL,
      section_id TEXT NOT NULL,
      source_document_id TEXT NOT NULL,
      status TEXT NOT NULL,
      effective_date TEXT,
      expiry_date TEXT,
      correlation_id TEXT NOT NULL,
      audit_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clauses_tenant ON clauses(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_clauses_source_doc ON clauses(tenant_id, source_document_id);
    CREATE INDEX IF NOT EXISTS idx_clauses_status ON clauses(tenant_id, status);

    CREATE TABLE IF NOT EXISTS compiled_rule_sets (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      clause_ids TEXT NOT NULL DEFAULT '[]',
      compiled_at TEXT NOT NULL,
      activated_at TEXT,
      correlation_id TEXT NOT NULL,
      audit_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compiled_rule_sets_tenant ON compiled_rule_sets(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_compiled_rule_sets_active ON compiled_rule_sets(tenant_id, status);

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      correlation_id TEXT NOT NULL,
      audit_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_edges_tenant ON graph_edges(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(tenant_id, source_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(tenant_id, target_id);
  `);

  // Additive migration: default_verdict column for deny-rule persistence
  const cols = db.pragma('table_info(policy_rules)') as Array<{ name: string }>;
  if (!cols.some(c => c.name === 'default_verdict')) {
    db.exec(`ALTER TABLE policy_rules ADD COLUMN default_verdict TEXT`);
  }

  // Additive migration: role-aware policy fields
  const colsAfterDv = db.pragma('table_info(policy_rules)') as Array<{ name: string }>;
  if (!colsAfterDv.some(c => c.name === 'required_roles')) {
    db.exec(`ALTER TABLE policy_rules ADD COLUMN required_roles TEXT`);
  }
  if (!colsAfterDv.some(c => c.name === 'role_match_mode')) {
    db.exec(`ALTER TABLE policy_rules ADD COLUMN role_match_mode TEXT`);
  }
  if (!colsAfterDv.some(c => c.name === 'approver_role')) {
    db.exec(`ALTER TABLE policy_rules ADD COLUMN approver_role TEXT`);
  }

  // Additive migration: approval routing fields
  const approvalCols = db.pragma('table_info(approvals)') as Array<{ name: string }>;
  if (!approvalCols.some(c => c.name === 'assigned_to_role')) {
    db.exec(`ALTER TABLE approvals ADD COLUMN assigned_to_role TEXT`);
  }
  if (!approvalCols.some(c => c.name === 'assigned_to_agent')) {
    db.exec(`ALTER TABLE approvals ADD COLUMN assigned_to_agent TEXT`);
  }
}
