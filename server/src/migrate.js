import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`[migrate] applicata ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw new Error(`Migrazione ${f} fallita: ${e.message}`);
    } finally {
      c.release();
    }
  }
  await seed();
}

async function seed() {
  // Azienda capofila (franchisor) con carta intestata Toscana Diagnostica
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM companies');
  if (rows[0].n === 0) {
    const logo = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'logo-td.png'));
    await pool.query(
      `INSERT INTO companies (code, name, vat_number, tax_code, address, zip, city, province, phone, email, pec, website,
         letterhead_footer, logo, logo_mime, is_franchisor)
       VALUES ('TD','Toscana Diagnostica S.r.l.','07528130482','07528130482','Via di Pratignone, 13/4','50019','Sesto Fiorentino','FI',
         '055776511','info@toscanadiagnostica.it','toscanadiagnostica@pec.it','www.toscanadiagnostica.it',
         $1, $2, 'image/png', TRUE)`,
      [
        'Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI). Tel. e Fax: 055776511. Direttore Sanitario: prof. Gian Luigi Taddei.\nP.IVA e C.F.: 07528130482, REA n. FI-709602, Capitale Sociale: € 50.000,00 i.v.',
        logo,
      ],
    );
    console.log('[seed] creata azienda TD');
  }
  if (config.seed.superadminEmail) {
    const ex = await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)', [config.seed.superadminEmail]);
    if (!ex.rows.length) {
      if (!config.seed.superadminPassword || config.seed.superadminPassword.length < 12) {
        throw new Error('SEED_SUPERADMIN_PASSWORD obbligatoria (min 12 caratteri) per creare il super amministratore');
      }
      const hash = await bcrypt.hash(config.seed.superadminPassword, 12);
      await pool.query(
        `INSERT INTO users (email, full_name, role, auth_provider, password_hash, must_change_password)
         VALUES ($1,$2,'SUPERADMIN','BOTH',$3,TRUE)`,
        [config.seed.superadminEmail, config.seed.superadminName, hash],
      );
      console.log(`[seed] creato super amministratore ${config.seed.superadminEmail}`);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
