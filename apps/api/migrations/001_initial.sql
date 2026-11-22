CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY, email TEXT UNIQUE, phone TEXT UNIQUE, country CHAR(2) NOT NULL DEFAULT 'TG', display_name TEXT,
  password_hash TEXT, status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION','ACTIVE','FROZEN','CLOSED')),
  email_verified_at TIMESTAMPTZ, phone_verified_at TIMESTAMPTZ, mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE, mfa_secret_ciphertext TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_user_id TEXT UNIQUE;
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('client','support','payments','crypto','compliance','treasury','finance','marketing','admin','supervisor','auditor')),
  granted_by UUID REFERENCES users(id), granted_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ, PRIMARY KEY(user_id,role)
);
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), token_hash TEXT NOT NULL UNIQUE, device_label TEXT,
  ip_hash TEXT, mfa_verified_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_sessions_active_idx ON user_sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS otp_challenges (
  id UUID PRIMARY KEY, destination TEXT NOT NULL, code_hash TEXT NOT NULL, purpose TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_destination_idx ON otp_challenges(destination, created_at DESC);
CREATE TABLE IF NOT EXISTS kyc_cases (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), country CHAR(2) NOT NULL, level INTEGER NOT NULL DEFAULT 1,
  provider TEXT, provider_reference TEXT, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_REVIEW','VERIFIED','REJECTED','EXPIRED')),
  decision_reason TEXT, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS networks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, chain_id TEXT, enabled BOOLEAN NOT NULL DEFAULT FALSE, confirmations INTEGER NOT NULL DEFAULT 0,
  explorer_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, decimals SMALLINT NOT NULL, network_id TEXT NOT NULL REFERENCES networks(id),
  contract_address TEXT, enabled BOOLEAN NOT NULL DEFAULT FALSE, min_amount NUMERIC(78,0), max_amount NUMERIC(78,0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(symbol, network_id)
);
CREATE TABLE IF NOT EXISTS external_addresses (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), asset_id TEXT NOT NULL REFERENCES assets(id), address TEXT NOT NULL,
  memo TEXT, label TEXT, verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(user_id, asset_id, address)
);
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('buy','sell','swap')),
  country CHAR(2) NOT NULL, source_asset TEXT NOT NULL, target_asset TEXT, fiat_currency CHAR(3) NOT NULL DEFAULT 'XOF',
  fiat_amount NUMERIC(78,0) NOT NULL, rate NUMERIC(38,18) NOT NULL, spread NUMERIC(12,8) NOT NULL DEFAULT 0,
  fee NUMERIC(78,0) NOT NULL DEFAULT 0, estimated_crypto NUMERIC(78,0) NOT NULL, provider TEXT, mode TEXT NOT NULL DEFAULT 'demo',
  input_amount NUMERIC(78,0) NOT NULL DEFAULT 0, estimated_fiat NUMERIC(78,0),
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), quote_id UUID REFERENCES quotes(id), kind TEXT NOT NULL CHECK(kind IN ('buy','sell','swap')),
  country CHAR(2) NOT NULL, channel TEXT NOT NULL DEFAULT 'web', status TEXT NOT NULL DEFAULT 'DRAFT', mode TEXT NOT NULL DEFAULT 'demo',
  fiat_currency CHAR(3) NOT NULL DEFAULT 'XOF', fiat_amount NUMERIC(78,0) NOT NULL, crypto_asset TEXT NOT NULL,
  crypto_amount NUMERIC(78,0), source_crypto_amount NUMERIC(78,0), target_asset TEXT, receive_address TEXT, receive_memo TEXT, expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS idempotency_keys (key TEXT NOT NULL, user_id UUID NOT NULL REFERENCES users(id), request_hash TEXT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key));
CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY, order_id UUID NOT NULL REFERENCES orders(id), event_type TEXT NOT NULL, old_status TEXT, new_status TEXT,
  actor_id UUID, details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_proofs (
  id UUID PRIMARY KEY, order_id UUID NOT NULL REFERENCES orders(id), proof_type TEXT NOT NULL CHECK(proof_type IN ('FIAT_SETTLED','CRYPTO_RECEIVED','CRYPTO_DELIVERED','FIAT_PAID','SOURCE_CRYPTO_RECEIVED','TARGET_CRYPTO_DELIVERED')),
  source TEXT NOT NULL, external_reference TEXT NOT NULL, proof_digest TEXT NOT NULL, verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(order_id,proof_type,external_reference)
);
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY, order_id UUID NOT NULL REFERENCES orders(id), provider TEXT NOT NULL, provider_reference TEXT NOT NULL,
  currency CHAR(3) NOT NULL, amount NUMERIC(78,0) NOT NULL, status TEXT NOT NULL, signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  raw_digest TEXT, occurred_at TIMESTAMPTZ, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(provider, provider_reference)
);
CREATE TABLE IF NOT EXISTS blockchain_events (
  id UUID PRIMARY KEY, order_id UUID NOT NULL REFERENCES orders(id), network_id TEXT NOT NULL REFERENCES networks(id), tx_hash TEXT NOT NULL,
  address TEXT, amount NUMERIC(78,0), confirmations INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, block_height BIGINT,
  occurred_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(network_id, tx_hash)
);
CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY, order_id UUID NOT NULL REFERENCES orders(id), partner_id UUID, external_reference TEXT,
  executed_rate NUMERIC(38,18), fee NUMERIC(78,0), status TEXT NOT NULL, proof JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger_accounts (id UUID PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, currency TEXT NOT NULL, account_type TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE);
INSERT INTO ledger_accounts(id,code,name,currency,account_type) VALUES
('10000000-0000-4000-8000-000000000001','CASH_XOF','Trésorerie XOF','XOF','ASSET'),
('10000000-0000-4000-8000-000000000002','PAYABLE_XOF','Dettes de règlement XOF','XOF','LIABILITY'),
('10000000-0000-4000-8000-000000000003','FEE_REVENUE_XOF','Revenus de frais XOF','XOF','REVENUE'),
('10000000-0000-4000-8000-000000000004','PROVIDER_CLEARING_XOF','Compte de compensation partenaire XOF','XOF','ASSET'),
('10000000-0000-4000-8000-000000000005','NETWORK_EXPENSE_XOF','Frais réseau XOF','XOF','EXPENSE')
ON CONFLICT(code) DO NOTHING;
CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY, transaction_id UUID NOT NULL, account_id UUID NOT NULL REFERENCES ledger_accounts(id), order_id UUID REFERENCES orders(id),
  currency TEXT NOT NULL, debit NUMERIC(78,0) NOT NULL DEFAULT 0, credit NUMERIC(78,0) NOT NULL DEFAULT 0,
  reference TEXT NOT NULL, reversal_of UUID REFERENCES ledger_entries(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((debit = 0) <> (credit = 0)), CHECK(debit >= 0 AND credit >= 0)
);
CREATE INDEX IF NOT EXISTS ledger_transaction_idx ON ledger_entries(transaction_id);
CREATE TABLE IF NOT EXISTS reconciliations (
  id UUID PRIMARY KEY, source TEXT NOT NULL, period_start TIMESTAMPTZ NOT NULL, period_end TIMESTAMPTZ NOT NULL,
  expected NUMERIC(78,0) NOT NULL DEFAULT 0, actual NUMERIC(78,0) NOT NULL DEFAULT 0, difference NUMERIC(78,0) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN', assigned_to UUID REFERENCES users(id), resolution TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS reconciliation_order_links (
  reconciliation_id UUID NOT NULL REFERENCES reconciliations(id), order_id UUID NOT NULL REFERENCES orders(id),
  PRIMARY KEY(reconciliation_id,order_id)
);
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY, name TEXT NOT NULL, country CHAR(2) NOT NULL, services TEXT[] NOT NULL DEFAULT '{}', assets TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'DISABLED', licensed BOOLEAN NOT NULL DEFAULT FALSE, sandbox_url TEXT, production_secret_ref TEXT,
  limits JSONB NOT NULL DEFAULT '{}', sla JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS provider_events (
  id UUID PRIMARY KEY, provider TEXT NOT NULL, event_key TEXT NOT NULL, event_type TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE, payload_digest TEXT NOT NULL, processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(provider,event_key)
);
CREATE TABLE IF NOT EXISTS price_sources (
  id UUID PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, pair TEXT NOT NULL, price NUMERIC(38,18) NOT NULL,
  capacity NUMERIC(78,0), observed_at TIMESTAMPTZ NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(provider,pair,observed_at)
);
CREATE TABLE IF NOT EXISTS risk_alerts (
  id UUID PRIMARY KEY, user_id UUID REFERENCES users(id), order_id UUID REFERENCES orders(id), alert_type TEXT NOT NULL,
  score SMALLINT NOT NULL DEFAULT 0, reason TEXT NOT NULL, evidence JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'OPEN',
  assigned_to UUID REFERENCES users(id), decision TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS config_changes (
  id UUID PRIMARY KEY, config_key TEXT NOT NULL, old_value JSONB, proposed_value JSONB NOT NULL,
  proposed_by UUID NOT NULL REFERENCES users(id), approved_by UUID REFERENCES users(id), reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_at TIMESTAMPTZ,
  CHECK(approved_by IS NULL OR approved_by <> proposed_by)
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY, destination_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, succeeded BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempt_rate_idx ON login_attempts(destination_hash,ip_hash,created_at DESC);
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), order_id UUID REFERENCES orders(id), category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL', status TEXT NOT NULL DEFAULT 'OPEN', assigned_to UUID REFERENCES users(id),
  sla_due_at TIMESTAMPTZ, resolution TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id UUID PRIMARY KEY, ticket_id UUID NOT NULL REFERENCES support_tickets(id), author_id UUID, body TEXT NOT NULL,
  attachment_refs JSONB NOT NULL DEFAULT '[]', internal_note BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT PRIMARY KEY, owner_id UUID NOT NULL REFERENCES users(id), campaign_id UUID, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY, code TEXT NOT NULL REFERENCES referral_codes(code), referred_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING', reward NUMERIC(78,0) NOT NULL DEFAULT 0, eligible_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(referred_user_id)
);
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY, name TEXT NOT NULL, country CHAR(2) NOT NULL, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  budget NUMERIC(78,0) NOT NULL DEFAULT 0, rules JSONB NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by UUID NOT NULL REFERENCES users(id), approved_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(approved_by IS NULL OR approved_by <> created_by)
);
CREATE TABLE IF NOT EXISTS notification_preferences (user_id UUID NOT NULL REFERENCES users(id), channel TEXT NOT NULL, category TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, consent_at TIMESTAMPTZ, consent_withdrawn_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(user_id, channel, category));
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY, actor_id UUID, action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT, reason TEXT,
  old_value JSONB, new_value JSONB, approval_by UUID, ip_hash TEXT, correlation_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_resource_idx ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES users(id), key_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}', rate_limit INTEGER NOT NULL DEFAULT 60, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY, api_key_id UUID NOT NULL REFERENCES api_keys(id), route TEXT NOT NULL, status_code SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_usage_rate_idx ON api_usage_logs(api_key_id,created_at DESC);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY, partner_id UUID REFERENCES partners(id), event_type TEXT NOT NULL, payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS country_configs (
  country CHAR(2) PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE, fiat_currency CHAR(3) NOT NULL,
  languages TEXT[] NOT NULL DEFAULT '{fr,en}', legal_reviewed BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO country_configs(country, enabled, fiat_currency, legal_reviewed) VALUES ('TG', false, 'XOF', false) ON CONFLICT DO NOTHING;
INSERT INTO networks(id,name,enabled,confirmations) VALUES
  ('bitcoin','Bitcoin',false,6),('ethereum','Ethereum',false,12),('tron','TRON',false,20)
ON CONFLICT(id) DO NOTHING;
INSERT INTO assets(id,symbol,name,decimals,network_id,enabled) VALUES
  ('BTC:bitcoin','BTC','Bitcoin',8,'bitcoin',false),('ETH:ethereum','ETH','Ethereum',18,'ethereum',false),('USDT:tron','USDT','Tether',6,'tron',false)
ON CONFLICT(id) DO NOTHING;
CREATE OR REPLACE FUNCTION skalet_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only record cannot be modified'; END; $$;
DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION skalet_reject_mutation();
DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION skalet_reject_mutation();
CREATE OR REPLACE FUNCTION skalet_ledger_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM ledger_entries WHERE transaction_id=NEW.transaction_id GROUP BY currency HAVING sum(debit)<>sum(credit)) THEN
    RAISE EXCEPTION 'Ledger transaction is not balanced per currency';
  END IF;
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS ledger_transaction_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_transaction_balanced AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION skalet_ledger_balance_guard();
CREATE OR REPLACE FUNCTION skalet_completed_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required_a TEXT; required_b TEXT;
BEGIN
  IF OLD.status IN ('COMPLETED','FAILED','CANCELLED','EXPIRED','REFUNDED') AND NEW.status<>OLD.status THEN
    RAISE EXCEPTION 'Terminal order state is immutable';
  END IF;
  IF NEW.status='COMPLETED' AND OLD.status<>'COMPLETED' THEN
    IF NEW.kind='buy' THEN required_a:='FIAT_SETTLED'; required_b:='CRYPTO_DELIVERED';
    ELSIF NEW.kind='sell' THEN required_a:='CRYPTO_RECEIVED'; required_b:='FIAT_PAID';
    ELSE required_a:='SOURCE_CRYPTO_RECEIVED'; required_b:='TARGET_CRYPTO_DELIVERED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM order_proofs WHERE order_id=NEW.id AND proof_type=required_a)
       OR NOT EXISTS(SELECT 1 FROM order_proofs WHERE order_id=NEW.id AND proof_type=required_b)
       OR NOT EXISTS(SELECT 1 FROM reconciliation_order_links l JOIN reconciliations r ON r.id=l.reconciliation_id WHERE l.order_id=NEW.id AND r.status='MATCHED') THEN
      RAISE EXCEPTION 'Order completion requires verified funds/delivery proofs and a matched reconciliation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS orders_completion_guard ON orders;
CREATE TRIGGER orders_completion_guard BEFORE UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION skalet_completed_order_guard();
