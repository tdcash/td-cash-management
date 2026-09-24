-- Canone di ospitalità per sede: Toscana Diagnostica è ospite con il proprio corner
-- e riconosce alla struttura ospitante una quota fissa mensile e/o una percentuale sui ricavi, più IVA.
ALTER TABLE sites
  ADD COLUMN host_name            TEXT,                                   -- struttura ospitante
  ADD COLUMN host_vat             TEXT,
  ADD COLUMN royalty_fixed_monthly NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (royalty_fixed_monthly >= 0),
  ADD COLUMN royalty_pct          NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (royalty_pct >= 0 AND royalty_pct <= 100),
  ADD COLUMN royalty_base         TEXT NOT NULL DEFAULT 'TOTALE' CHECK (royalty_base IN ('TOTALE','CONTANTI_POS','CONTANTI')),
  ADD COLUMN royalty_vat_rate     NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (royalty_vat_rate >= 0 AND royalty_vat_rate <= 100),
  ADD COLUMN royalty_notes        TEXT;

CREATE TABLE site_royalty_history (
  id         SERIAL PRIMARY KEY,
  site_id    INT NOT NULL REFERENCES sites(id),
  fixed_monthly NUMERIC(12,2),
  pct        NUMERIC(5,2),
  vat_rate   NUMERIC(5,2),
  base       TEXT,
  changed_by INT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
