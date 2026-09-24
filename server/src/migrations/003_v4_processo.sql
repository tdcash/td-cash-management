-- v4: nuovo ciclo del rendiconto, monete per taglio, provincia sede, versamenti azienda,
-- profilo Partner, conferma mensile royalty di sede, PDF del gestionale.

-- Stati: DRAFT -> CLOSED (busta) -> PROCESSED (distinta) -> PICKED_UP (operazione logistica)
--        -> VERIFIED (riconteggio e verifica, in cassaforte) -> DEPOSITED (incluso in un versamento azienda)
ALTER TABLE cash_reports DROP CONSTRAINT cash_reports_status_check;
ALTER TABLE cash_reports ADD CONSTRAINT cash_reports_status_check
  CHECK (status IN ('DRAFT','CLOSED','PROCESSED','PICKED_UP','VERIFIED','DEPOSITED'));

ALTER TABLE cash_reports
  ADD COLUMN verified_amount   NUMERIC(12,2),
  ADD COLUMN verified_at       TIMESTAMPTZ,
  ADD COLUMN verified_by       INT REFERENCES users(id),
  ADD COLUMN verified_note     TEXT,
  ADD COLUMN deposit_id        INT,
  ADD COLUMN expected_cash     NUMERIC(12,2),
  ADD COLUMN expected_pos      NUMERIC(12,2),
  ADD COLUMN expected_transfer NUMERIC(12,2),
  ADD COLUMN system_pdf        BYTEA,
  ADD COLUMN system_pdf_name   TEXT,
  ADD COLUMN system_pdf_at     TIMESTAMPTZ,
  ADD COLUMN system_extracted  JSONB;

-- I rendiconti già "versati" nella v3 (accredito confermato per sede) diventano verificati
UPDATE cash_reports SET status='VERIFIED', verified_amount=deposit_amount, verified_at=now(), verified_by=deposit_confirmed_by
  WHERE status='DEPOSITED';

ALTER TABLE sites ADD COLUMN province TEXT;

-- Versamenti al portavalori, a livello azienda
CREATE TABLE cash_deposits (
  id             SERIAL PRIMARY KEY,
  company_id     INT NOT NULL REFERENCES companies(id),
  number         TEXT NOT NULL UNIQUE,
  deposit_date   DATE NOT NULL,
  total_amount   NUMERIC(12,2) NOT NULL,
  envelopes      JSONB NOT NULL DEFAULT '[]',      -- [{code, amount}]
  operator_name  TEXT,                             -- operatore portavalori
  picked_at      TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'PREPARATO' CHECK (status IN ('PREPARATO','RITIRATO','ACCREDITATO')),
  bank_amount    NUMERIC(12,2),
  bank_date      DATE,
  bank_confirmed_by INT REFERENCES users(id),
  notes          TEXT,
  slip_pdf       BYTEA,
  created_by     INT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE cash_reports ADD CONSTRAINT cash_reports_deposit_fk FOREIGN KEY (deposit_id) REFERENCES cash_deposits(id) ON DELETE SET NULL;
CREATE INDEX cash_reports_deposit_idx ON cash_reports (deposit_id);

CREATE TABLE deposit_events (
  id         SERIAL PRIMARY KEY,
  deposit_id INT NOT NULL REFERENCES cash_deposits(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,
  detail     TEXT,
  user_id    INT REFERENCES users(id),
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profilo Partner (struttura ospitante): sola lettura su statistiche e royalty confermate delle sue sedi
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('SUPERADMIN','ADMIN','OPERATOR','PARTNER'));

-- Royalty di sede confermate a inizio mese successivo dall'amministratore
CREATE TABLE site_royalty_statements (
  id            SERIAL PRIMARY KEY,
  site_id       INT NOT NULL REFERENCES sites(id),
  period        TEXT NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  revenue_cash  NUMERIC(14,2) NOT NULL,
  revenue_pos   NUMERIC(14,2) NOT NULL,
  revenue_transfer NUMERIC(14,2) NOT NULL,
  base          NUMERIC(14,2) NOT NULL,
  fixed         NUMERIC(12,2) NOT NULL,
  variable      NUMERIC(12,2) NOT NULL,
  taxable       NUMERIC(12,2) NOT NULL,
  vat           NUMERIC(12,2) NOT NULL,
  total         NUMERIC(12,2) NOT NULL,
  terms         JSONB NOT NULL,                    -- condizioni applicate (fissa, %, base, iva, ospitante)
  reports       INT NOT NULL,
  confirmed_by  INT REFERENCES users(id),
  confirmed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_by  INT REFERENCES users(id),
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT
);
CREATE UNIQUE INDEX site_royalty_statements_uq ON site_royalty_statements (site_id, period) WHERE cancelled_at IS NULL;
