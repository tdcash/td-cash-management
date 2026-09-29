-- v6.1: data di avvio della sede = primo giorno di lavoro da cui ci si aspetta il rendiconto
ALTER TABLE sites ADD COLUMN IF NOT EXISTS start_date DATE;
UPDATE sites SET start_date = created_at::date WHERE start_date IS NULL;
ALTER TABLE sites ALTER COLUMN start_date SET NOT NULL;
