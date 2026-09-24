-- Toscana Diagnostica - Cash Management
-- Schema iniziale

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Impostazioni globali (dati creditore SEPA del franchisor, policy)
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Aziende (affiliati / società della rete)
CREATE TABLE companies (
  id               SERIAL PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  vat_number       TEXT,
  tax_code         TEXT,
  address          TEXT,
  zip              TEXT,
  city             TEXT,
  province         TEXT,
  phone            TEXT,
  email            TEXT,
  pec              TEXT,
  website          TEXT,
  letterhead_footer TEXT,             -- righe legali a piè di pagina della distinta
  logo             BYTEA,
  logo_mime        TEXT,
  -- Dati addebito SEPA (debitore)
  iban             TEXT,
  bic              TEXT,
  sepa_mandate_id  TEXT,
  sepa_mandate_date DATE,
  sepa_first_done  BOOLEAN NOT NULL DEFAULT FALSE,
  is_franchisor    BOOLEAN NOT NULL DEFAULT FALSE,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sedi
CREATE TABLE sites (
  id             SERIAL PRIMARY KEY,
  company_id     INT NOT NULL REFERENCES companies(id),
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  address        TEXT,
  city           TEXT,
  cash_float     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cash_float >= 0),
  operating_days TEXT NOT NULL DEFAULT '1111110' CHECK (operating_days ~ '^[01]{7}$'), -- lun..dom
  pos_terminals  TEXT,                -- elenco ID terminali, separati da virgola
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

-- Storico variazioni fondo cassa
CREATE TABLE cash_float_history (
  id         SERIAL PRIMARY KEY,
  site_id    INT NOT NULL REFERENCES sites(id),
  old_value  NUMERIC(12,2),
  new_value  NUMERIC(12,2) NOT NULL,
  changed_by INT,
  reason     TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Utenti
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('SUPERADMIN','ADMIN','OPERATOR')),
  company_id           INT REFERENCES companies(id),
  auth_provider        TEXT NOT NULL DEFAULT 'LOCAL' CHECK (auth_provider IN ('LOCAL','ENTRA','BOTH')),
  password_hash        TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  totp_secret          TEXT,
  totp_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  entra_oid            TEXT,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins        INT NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role = 'SUPERADMIN') OR (company_id IS NOT NULL))
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE user_sites (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);

-- Rendiconto giornaliero di cassa (uno per sede per giorno)
CREATE TABLE cash_reports (
  id                  SERIAL PRIMARY KEY,
  site_id             INT NOT NULL REFERENCES sites(id),
  report_date         DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','CLOSED','PROCESSED','PICKED_UP','DEPOSITED')),
  cash_float          NUMERIC(12,2) NOT NULL,          -- fotografia del fondo cassa
  coins_total         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (coins_total >= 0),
  cash_counted        NUMERIC(12,2) NOT NULL DEFAULT 0, -- banconote + monete in cassa
  cash_to_deposit     NUMERIC(12,2) NOT NULL DEFAULT 0, -- contato - fondo cassa
  pos_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  transfer_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_total      NUMERIC(12,2),                    -- incasso da gestionale (facoltativo)
  envelope_code       TEXT,                             -- codice a barre busta Mondialpol
  envelope_at         TIMESTAMPTZ,
  envelope_by         INT REFERENCES users(id),
  slip_number         TEXT,                             -- numero distinta
  slip_revision       INT NOT NULL DEFAULT 0,
  slip_pdf            BYTEA,
  slip_sha256         TEXT,
  processed_by        INT REFERENCES users(id),
  processed_at        TIMESTAMPTZ,
  pickup_operator     TEXT,                             -- operatore logistica che ritira
  pickup_at           TIMESTAMPTZ,
  pickup_registered_by INT REFERENCES users(id),
  deposit_amount      NUMERIC(12,2),                    -- importo accreditato in banca
  deposit_date        DATE,
  deposit_confirmed_by INT REFERENCES users(id),
  notes               TEXT,
  created_by          INT REFERENCES users(id),
  updated_by          INT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, report_date)
);
CREATE INDEX cash_reports_date_idx ON cash_reports (report_date);
CREATE UNIQUE INDEX cash_reports_envelope_uq ON cash_reports (envelope_code) WHERE envelope_code IS NOT NULL;

CREATE TABLE report_denominations (
  report_id INT NOT NULL REFERENCES cash_reports(id) ON DELETE CASCADE,
  denom     NUMERIC(8,2) NOT NULL,
  qty       INT NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (report_id, denom)
);

CREATE TABLE pos_receipts (
  id             SERIAL PRIMARY KEY,
  report_id      INT NOT NULL REFERENCES cash_reports(id) ON DELETE CASCADE,
  terminal_id    TEXT,
  receipt_number TEXT,
  circuit        TEXT NOT NULL DEFAULT 'BANCOMAT'
                 CHECK (circuit IN ('BANCOMAT','CARTA_CREDITO','BUONI_PASTO','APP','ALTRO')),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  auth_code      TEXT,
  note           TEXT,
  matched_tx_id  INT
);

CREATE TABLE bank_transfers (
  id         SERIAL PRIMARY KEY,
  report_id  INT NOT NULL REFERENCES cash_reports(id) ON DELETE CASCADE,
  cro        TEXT NOT NULL,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payer      TEXT,
  value_date DATE,
  note       TEXT
);

-- Tracciamento degli eventi di un rendiconto
CREATE TABLE report_events (
  id        SERIAL PRIMARY KEY,
  report_id INT NOT NULL REFERENCES cash_reports(id) ON DELETE CASCADE,
  event     TEXT NOT NULL,
  detail    TEXT,
  user_id   INT REFERENCES users(id),
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transazioni importate da gateway/POS acquirer (riconciliazione)
CREATE TABLE payment_transactions (
  id           SERIAL PRIMARY KEY,
  company_id   INT NOT NULL REFERENCES companies(id),
  site_id      INT REFERENCES sites(id),
  tx_date      DATE NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  circuit      TEXT,
  terminal_id  TEXT,
  reference    TEXT,
  source_file  TEXT,
  imported_by  INT REFERENCES users(id),
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_receipt_id INT REFERENCES pos_receipts(id) ON DELETE SET NULL
);
CREATE INDEX payment_tx_idx ON payment_transactions (company_id, tx_date);

-- Incassi da canali digitali (e-commerce, app, prenotazioni online) con split alla fonte
CREATE TABLE channel_revenues (
  id               SERIAL PRIMARY KEY,
  company_id       INT NOT NULL REFERENCES companies(id),
  site_id          INT REFERENCES sites(id),
  rev_date         DATE NOT NULL,
  channel          TEXT NOT NULL,
  gross_amount     NUMERIC(12,2) NOT NULL,
  franchisor_share NUMERIC(12,2) NOT NULL DEFAULT 0,  -- trattenuto alla fonte (split payment)
  reference        TEXT,
  source_file      TEXT,
  imported_by      INT REFERENCES users(id),
  imported_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Errori e non conformità
CREATE TABLE nonconformities (
  id          SERIAL PRIMARY KEY,
  company_id  INT NOT NULL REFERENCES companies(id),
  site_id     INT REFERENCES sites(id),
  report_id   INT REFERENCES cash_reports(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('ERRORE','NON_CONFORMITA')),
  severity    TEXT NOT NULL DEFAULT 'MEDIA' CHECK (severity IN ('BASSA','MEDIA','ALTA')),
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'APERTA' CHECK (status IN ('APERTA','RISPOSTA','CHIUSA')),
  due_date    DATE,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by   INT REFERENCES users(id),
  closed_at   TIMESTAMPTZ
);

CREATE TABLE nc_messages (
  id         SERIAL PRIMARY KEY,
  nc_id      INT NOT NULL REFERENCES nonconformities(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id),
  kind       TEXT NOT NULL CHECK (kind IN ('RISPOSTA','NOTA','CHIUSURA','RIAPERTURA')),
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contratti royalty
CREATE TABLE royalty_contracts (
  id                SERIAL PRIMARY KEY,
  company_id        INT NOT NULL REFERENCES companies(id),
  valid_from        DATE NOT NULL,
  valid_to          DATE,
  revenue_base      TEXT NOT NULL DEFAULT 'LORDO' CHECK (revenue_base IN ('LORDO','NETTO')),
  vat_rate          NUMERIC(5,2) NOT NULL DEFAULT 0,      -- scorporo per base NETTO
  marketing_fee_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  tier_mode         TEXT NOT NULL DEFAULT 'FASCIA' CHECK (tier_mode IN ('FASCIA','MARGINALE')),
  tier_basis        TEXT NOT NULL DEFAULT 'MENSILE' CHECK (tier_basis IN ('MENSILE','ANNUO_PROGRESSIVO')),
  tiers             JSONB NOT NULL DEFAULT '[{"from":0,"rate":5}]',
  min_monthly_fee   NUMERIC(12,2) NOT NULL DEFAULT 0,
  include_channels  BOOLEAN NOT NULL DEFAULT TRUE,
  payment_days      INT NOT NULL DEFAULT 10,
  invoice_vat_rate  NUMERIC(5,2) NOT NULL DEFAULT 22,   -- IVA su royalty e fee (da validare con il commercialista)
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sepa_batches (
  id              SERIAL PRIMARY KEY,
  msg_id          TEXT NOT NULL UNIQUE,
  collection_date DATE NOT NULL,
  tx_count        INT NOT NULL,
  total_amount    NUMERIC(12,2) NOT NULL,
  xml             TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'GENERATO' CHECK (status IN ('GENERATO','INVIATO','ESITATO')),
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE royalty_statements (
  id               SERIAL PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  company_id       INT NOT NULL REFERENCES companies(id),
  contract_id      INT NOT NULL REFERENCES royalty_contracts(id),
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  gross_revenue    NUMERIC(14,2) NOT NULL,
  base_revenue     NUMERIC(14,2) NOT NULL,
  royalty_amount   NUMERIC(12,2) NOT NULL,
  marketing_amount NUMERIC(12,2) NOT NULL,
  vat_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  withheld_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- già trattenuto con split payment
  total_due        NUMERIC(12,2) NOT NULL,
  details          JSONB,
  status           TEXT NOT NULL DEFAULT 'EMESSO'
                   CHECK (status IN ('EMESSO','IN_ADDEBITO','PAGATO','INSOLUTO','ANNULLATO')),
  due_date         DATE,
  sepa_batch_id    INT REFERENCES sepa_batches(id),
  sepa_end_to_end  TEXT,
  paid_at          DATE,
  created_by       INT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX royalty_statements_period_uq
  ON royalty_statements (company_id, period_start, period_end) WHERE status <> 'ANNULLATO';

-- Audit trail
CREATE TABLE audit_log (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INT,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  data      JSONB,
  ip        TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- Sessioni (connect-pg-simple)
CREATE TABLE "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
