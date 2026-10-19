-- v7: casse per operatore (più rendiconti per sede e giorno), numero casse attese per sede, fondo cassa per operatore,
--     tabella sezionali GIPO e controlli mensili
ALTER TABLE cash_reports DROP CONSTRAINT IF EXISTS cash_reports_site_id_report_date_key;
ALTER TABLE cash_reports ADD COLUMN IF NOT EXISTS operator_id INT REFERENCES users(id);
UPDATE cash_reports SET operator_id = created_by WHERE operator_id IS NULL;
ALTER TABLE cash_reports ALTER COLUMN operator_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cash_reports_site_date_operator_uq ON cash_reports (site_id, report_date, operator_id);

ALTER TABLE sites ADD COLUMN IF NOT EXISTS expected_registers INT NOT NULL DEFAULT 1 CHECK (expected_registers BETWEEN 1 AND 20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS cash_float NUMERIC(12,2);   -- fondo cassa dell'operatore; NULL = quello della sede

-- Sezionali GIPO: suffisso numerico -> sede
CREATE TABLE IF NOT EXISTS gipo_sezionali (
  code        TEXT PRIMARY KEY,          -- es. '02'
  description TEXT,
  site_id     INT REFERENCES sites(id) ON DELETE SET NULL,
  gipo_site_id INT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Controlli mensili eseguiti dal super amministratore
CREATE TABLE IF NOT EXISTS monthly_checks (
  id          SERIAL PRIMARY KEY,
  period      TEXT NOT NULL,             -- AAAA-MM
  date_from   DATE NOT NULL,
  date_to     DATE NOT NULL,
  files       JSONB NOT NULL DEFAULT '[]',
  summary     JSONB NOT NULL DEFAULT '{}',
  rows        JSONB NOT NULL DEFAULT '[]',
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
