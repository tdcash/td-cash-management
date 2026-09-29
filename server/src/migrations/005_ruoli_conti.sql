-- v6: ruoli Cassiere e Finance Specialist, conti correnti aziendali, accredito su conto specifico
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('SUPERADMIN','ADMIN','CASSIERE','FINANCE','OPERATOR','PARTNER'));

CREATE TABLE IF NOT EXISTS company_bank_accounts (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  bank_name   TEXT,
  iban        TEXT NOT NULL,
  bic         TEXT,
  notes       TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_company ON company_bank_accounts(company_id);

ALTER TABLE cash_deposits ADD COLUMN IF NOT EXISTS bank_account_id INT REFERENCES company_bank_accounts(id);
ALTER TABLE cash_deposits ADD COLUMN IF NOT EXISTS bank_reference TEXT;
