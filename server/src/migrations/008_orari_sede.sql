-- v6.3: orari delle sedi (per giorno lun..dom: apertura e chiusura); il sollecito parte 60 minuti dopo la chiusura
ALTER TABLE sites ADD COLUMN IF NOT EXISTS hours JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS hours_note TEXT;
