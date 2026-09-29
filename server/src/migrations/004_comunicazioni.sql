-- v5: comunicazioni email. Contatti di sede, registro invii, impostazioni di notifica.
ALTER TABLE sites
  ADD COLUMN site_email TEXT,        -- casella della sede (operatori): solleciti, segnalazioni, comunicazioni
  ADD COLUMN host_email TEXT;        -- struttura ospitante, destinataria del report royalty confermato

CREATE TABLE email_log (
  id          SERIAL PRIMARY KEY,
  company_id  INT REFERENCES companies(id),
  site_id     INT REFERENCES sites(id),
  kind        TEXT NOT NULL,          -- SOLLECITO, NC, NC_RISPOSTA, ROYALTY, COMUNICAZIONE, TEST, RIEPILOGO
  ref_key     TEXT,                   -- chiave anti-duplicato (es. SOLLECITO:site:date)
  to_addr     TEXT NOT NULL,
  cc_addr     TEXT,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  attachment_name TEXT,
  status      TEXT NOT NULL CHECK (status IN ('INVIATA','FALLITA','NON_CONFIGURATA')),
  error       TEXT,
  sent_by     INT REFERENCES users(id),   -- NULL = automatico
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_created_idx ON email_log (created_at DESC);
CREATE UNIQUE INDEX email_log_ref_uq ON email_log (ref_key) WHERE ref_key IS NOT NULL AND status = 'INVIATA';

INSERT INTO app_settings (key, value) VALUES ('daily_alert_hour', '10'), ('daily_alert_enabled', 'true'), ('daily_summary_admins', 'true')
  ON CONFLICT (key) DO NOTHING;
