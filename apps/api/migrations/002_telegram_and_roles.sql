-- Kept separate for deployments that already applied the initial schema.
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_user_id TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_ciphertext TEXT;
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('client','support','payments','crypto','compliance','treasury','finance','marketing','admin','supervisor','auditor')),
  granted_by UUID REFERENCES users(id), granted_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ, PRIMARY KEY(user_id,role)
);
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check CHECK(role IN ('client','support','payments','crypto','compliance','treasury','finance','marketing','admin','supervisor','auditor'));
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS consent_withdrawn_at TIMESTAMPTZ;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
