// api/_auth/tables.ts
// 鉴权相关的建表语句（DDL）。每次改动只影响结构，不涉及业务流程。
// 语句顺序即执行顺序：先引用方（app_roles）再被引用方（app_users）。
import type { SqlTx } from '../_dbAdapter.js';

/** 返回在同一事务里执行的全部建表/加列语句。 */
export function authSchemaStatements(tx: SqlTx) {
  return [
    tx`CREATE TABLE IF NOT EXISTS app_auth (
        id INTEGER PRIMARY KEY DEFAULT 1,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        token_secret TEXT NOT NULL,
        token_version INTEGER NOT NULL DEFAULT 1,
        initialized_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        CHECK (id = 1)
      )`,
    tx`ALTER TABLE app_auth ADD COLUMN IF NOT EXISTS recovery_key_hash TEXT`,
    tx`ALTER TABLE app_auth ADD COLUMN IF NOT EXISTS recovery_key_salt TEXT`,
    tx`CREATE TABLE IF NOT EXISTS app_telemetry_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        ip_salt TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        CHECK (id = 1)
      )`,
    tx`CREATE TABLE IF NOT EXISTS app_roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        permissions JSONB NOT NULL DEFAULT '[]',
        built_in BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
    tx`CREATE TABLE IF NOT EXISTS app_users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role_id TEXT NOT NULL REFERENCES app_roles(id),
        status TEXT NOT NULL DEFAULT 'active',
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        token_version INTEGER NOT NULL DEFAULT 1,
        last_login_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`,
    tx`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_lower ON app_users (LOWER(username))`,
    tx`CREATE TABLE IF NOT EXISTS app_user_scopes (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL,
        grade_id TEXT NOT NULL DEFAULT '',
        class_id TEXT NOT NULL DEFAULT '',
        UNIQUE(user_id, scope_type, grade_id, class_id)
      )`,
    tx`CREATE TABLE IF NOT EXISTS app_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT,
        username TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL DEFAULT '',
        resource_id TEXT NOT NULL DEFAULT '',
        grade_id TEXT NOT NULL DEFAULT '',
        class_id TEXT NOT NULL DEFAULT '',
        detail JSONB,
        created_at BIGINT NOT NULL
      )`,
    tx`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email TEXT`,
    tx`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_bound_at BIGINT`,
    tx`CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_users (email) WHERE email IS NOT NULL`,
    tx`CREATE TABLE IF NOT EXISTS email_verification_codes (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'login',
        code TEXT NOT NULL,
        expires_at BIGINT NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL,
        ip TEXT NOT NULL DEFAULT ''
      )`,
    tx`CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_verification_codes (email)`,
    tx`CREATE INDEX IF NOT EXISTS idx_email_codes_expires ON email_verification_codes (expires_at)`,
    tx`CREATE TABLE IF NOT EXISTS email_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        smtp_host TEXT NOT NULL DEFAULT '',
        smtp_port INTEGER NOT NULL DEFAULT 465,
        smtp_secure BOOLEAN NOT NULL DEFAULT TRUE,
        smtp_require_tls BOOLEAN NOT NULL DEFAULT FALSE,
        smtp_user TEXT NOT NULL DEFAULT '',
        smtp_pass_enc TEXT NOT NULL DEFAULT '',
        smtp_from TEXT NOT NULL DEFAULT '',
        smtp_from_name TEXT NOT NULL DEFAULT '',
        admin_emails TEXT NOT NULL DEFAULT '',
        updated_at BIGINT NOT NULL DEFAULT 0,
        CHECK (id = 1)
      )`,
    tx`ALTER TABLE email_config ADD COLUMN IF NOT EXISTS init_bind_policy TEXT NOT NULL DEFAULT 'optional'`,
    tx`CREATE TABLE IF NOT EXISTS email_outbox (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'login',
        code_id BIGINT,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        next_attempt_at BIGINT NOT NULL,
        last_error TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        sent_at BIGINT,
        updated_at BIGINT NOT NULL
      )`,
    tx`CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox (status, next_attempt_at)`,
    tx`CREATE TABLE IF NOT EXISTS mail_throttle (
        id INTEGER PRIMARY KEY DEFAULT 1,
        last_sent_at BIGINT NOT NULL DEFAULT 0,
        CHECK (id = 1)
      )`,
  ];
}
