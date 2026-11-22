-- Safe upgrades for databases created before financial completion guards were added.
CREATE TABLE IF NOT EXISTS order_proofs (
  id UUID PRIMARY KEY, order_id UUID NOT NULL REFERENCES orders(id),
  proof_type TEXT NOT NULL CHECK(proof_type IN ('FIAT_SETTLED','CRYPTO_RECEIVED','CRYPTO_DELIVERED','FIAT_PAID','SOURCE_CRYPTO_RECEIVED','TARGET_CRYPTO_DELIVERED')),
  source TEXT NOT NULL, external_reference TEXT NOT NULL, proof_digest TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id,proof_type,external_reference)
);
CREATE TABLE IF NOT EXISTS reconciliation_order_links (
  reconciliation_id UUID NOT NULL REFERENCES reconciliations(id), order_id UUID NOT NULL REFERENCES orders(id),
  PRIMARY KEY(reconciliation_id,order_id)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ledger_entries_nonnegative_check') THEN
    ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_nonnegative_check CHECK(debit>=0 AND credit>=0);
  END IF;
END $$;
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
