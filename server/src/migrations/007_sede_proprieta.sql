-- v6.2: sedi di proprietà (nessuna struttura ospitante, nessuna royalty)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS ownership TEXT NOT NULL DEFAULT 'OSPITATA' CHECK (ownership IN ('PROPRIA','OSPITATA'));
