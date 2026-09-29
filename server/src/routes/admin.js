import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse } from '../lib/util.js';
import { requireRole, isSuper, Params, siteScope, assertCompany, assertSite, FINANCE_ROLES } from '../lib/access.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });

const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const ibanRe = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

// ---------------- Aziende ----------------
const companyFields = {
  name: z.string().min(2).max(200),
  vat_number: opt(z.string().max(20)),
  tax_code: opt(z.string().max(20)),
  address: opt(z.string().max(200)),
  zip: opt(z.string().max(10)),
  city: opt(z.string().max(100)),
  province: opt(z.string().max(4)),
  phone: opt(z.string().max(40)),
  email: opt(z.string().email().or(z.literal(''))),
  pec: opt(z.string().email().or(z.literal(''))),
  website: opt(z.string().max(200)),
  letterhead_footer: opt(z.string().max(600)),
};
const sepaFields = {
  iban: opt(z.string().transform((v) => v.replace(/\s/g, '').toUpperCase()).refine((v) => !v || ibanRe.test(v), 'IBAN non valido')),
  bic: opt(z.string().max(11)),
  sepa_mandate_id: opt(z.string().max(35)),
  sepa_mandate_date: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  active: z.boolean().optional(),
};
const COMPANY_COLS = `id, code, name, vat_number, tax_code, address, zip, city, province, phone, email, pec, website,
  letterhead_footer, iban, bic, sepa_mandate_id, sepa_mandate_date, sepa_first_done, is_franchisor, active,
  (logo IS NOT NULL) AS has_logo, created_at`;

r.get('/companies', ah(async (req, res) => {
  const P = new Params();
  const rows = await many(`SELECT ${COMPANY_COLS},
      (SELECT count(*)::int FROM sites s WHERE s.company_id=c.id AND s.active) AS sites_count,
      (SELECT count(*)::int FROM users u WHERE u.company_id=c.id AND u.active) AS users_count
    FROM companies c WHERE ${isSuper(req.user) ? 'TRUE' : `c.id = ${P.add(req.user.company_id)}`} ORDER BY c.is_franchisor DESC, c.name`, P.values);
  res.json(rows);
}));

r.post('/companies', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ code: z.string().regex(/^[A-Z0-9_-]{2,12}$/, 'codice: 2-12 caratteri maiuscoli/numeri'), ...companyFields, ...sepaFields }), req.body);
  if (await one('SELECT 1 FROM companies WHERE code=$1', [d.code])) throw bad('Codice azienda già esistente');
  const cols = Object.keys(d);
  const row = await one(`INSERT INTO companies (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, cols.map((c) => d[c]));
  await audit(req, 'COMPANY_CREATE', 'company', row.id, d);
  res.status(201).json(row);
}));

r.put('/companies/:id', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const id = Number(req.params.id);
  assertCompany(req.user, id);
  const schema = isSuper(req.user) ? z.object({ ...companyFields, ...sepaFields }).partial() : z.object(companyFields).partial();
  const d = parse(schema, req.body);
  const cols = Object.keys(d);
  if (!cols.length) return res.json({ ok: true });
  await q(`UPDATE companies SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [id, ...cols.map((c) => d[c])]);
  await audit(req, 'COMPANY_UPDATE', 'company', id, d);
  res.json({ ok: true });
}));

r.post('/companies/:id/logo', requireRole('SUPERADMIN', 'ADMIN'), upload.single('logo'), ah(async (req, res) => {
  const id = Number(req.params.id);
  assertCompany(req.user, id);
  if (!req.file) throw bad('File mancante');
  if (!['image/png', 'image/jpeg'].includes(req.file.mimetype)) throw bad('Formato ammesso: PNG o JPEG');
  await q('UPDATE companies SET logo=$2, logo_mime=$3, updated_at=now() WHERE id=$1', [id, req.file.buffer, req.file.mimetype]);
  await audit(req, 'COMPANY_LOGO', 'company', id);
  res.json({ ok: true });
}));

r.get('/companies/:id/logo', ah(async (req, res) => {
  const id = Number(req.params.id);
  assertCompany(req.user, id);
  const c = await one('SELECT logo, logo_mime FROM companies WHERE id=$1', [id]);
  if (!c?.logo) throw notFound();
  res.type(c.logo_mime).set('Cache-Control', 'private, max-age=300').send(c.logo);
}));

// ---------------- Sedi ----------------
const siteSchema = z.object({
  company_id: z.number().int(),
  code: z.string().regex(/^[A-Z0-9_-]{2,12}$/, 'codice: 2-12 caratteri maiuscoli/numeri'),
  name: z.string().min(2).max(120),
  address: opt(z.string().max(200)),
  city: opt(z.string().max(100)),
  province: opt(z.string().max(4).transform((v) => (v ? v.toUpperCase() : v))),
  site_email: opt(z.string().email().or(z.literal(''))),
  host_email: opt(z.string().email().or(z.literal(''))),
  cash_float: z.number().min(0).max(100000),
  operating_days: z.string().regex(/^[01]{7}$/).default('1111110'),
  pos_terminals: opt(z.string().max(300)),
  active: z.boolean().default(true),
  float_reason: z.string().max(300).optional(),
  host_name: opt(z.string().max(200)),
  host_vat: opt(z.string().max(20)),
  royalty_fixed_monthly: z.number().min(0).max(1_000_000).default(0),
  royalty_pct: z.number().min(0).max(100).default(0),
  royalty_base: z.enum(['TOTALE', 'CONTANTI_POS', 'CONTANTI']).default('TOTALE'),
  royalty_vat_rate: z.number().min(0).max(100).default(0),
  royalty_notes: opt(z.string().max(1000)),
});
// ---------------- Conti correnti aziendali ----------------
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const accountSchema = z.object({
  label: z.string().trim().min(2).max(80),
  bank_name: z.string().trim().max(120).nullable().optional(),
  iban: z.string().trim().transform((v) => v.replace(/\s+/g, '').toUpperCase()).refine((v) => IBAN_RE.test(v), 'IBAN non valido'),
  bic: z.string().trim().max(11).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  is_default: z.boolean().default(false),
  active: z.boolean().default(true),
});

// Elenco: chi conferma gli accrediti deve poter scegliere il conto
r.get('/companies/:id/bank-accounts', requireRole(...FINANCE_ROLES), ah(async (req, res) => {
  const cid = Number(req.params.id);
  assertCompany(req.user, cid);
  res.json(await many('SELECT id, company_id, label, bank_name, iban, bic, notes, is_default, active, created_at FROM company_bank_accounts WHERE company_id=$1 ORDER BY active DESC, is_default DESC, label', [cid]));
}));

r.post('/companies/:id/bank-accounts', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const cid = Number(req.params.id);
  assertCompany(req.user, cid);
  const d = parse(accountSchema, req.body);
  if (await one('SELECT 1 FROM company_bank_accounts WHERE company_id=$1 AND iban=$2', [cid, d.iban])) throw bad('IBAN già presente per questa azienda');
  const row = await tx(async (c) => {
    if (d.is_default) await c.query('UPDATE company_bank_accounts SET is_default=FALSE WHERE company_id=$1', [cid]);
    return (await c.query(`INSERT INTO company_bank_accounts (company_id, label, bank_name, iban, bic, notes, is_default, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [cid, d.label, d.bank_name || null, d.iban, d.bic || null, d.notes || null, d.is_default, d.active])).rows[0];
  });
  await audit(req, 'BANK_ACCOUNT_CREATE', 'bank_account', row.id, { company_id: cid, label: d.label, iban: d.iban });
  res.status(201).json(row);
}));

r.put('/companies/:id/bank-accounts/:aid', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const cid = Number(req.params.id);
  assertCompany(req.user, cid);
  const acc = await one('SELECT * FROM company_bank_accounts WHERE id=$1 AND company_id=$2', [Number(req.params.aid), cid]);
  if (!acc) throw notFound('Conto non trovato');
  const d = parse(z.object(Object.fromEntries(Object.entries(accountSchema.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.removeDefault() : v).optional()]))), req.body);
  await tx(async (c) => {
    if (d.is_default) await c.query('UPDATE company_bank_accounts SET is_default=FALSE WHERE company_id=$1', [cid]);
    const cols = Object.keys(d);
    if (cols.length) await c.query(`UPDATE company_bank_accounts SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [acc.id, ...cols.map((k) => d[k])]);
  });
  await audit(req, 'BANK_ACCOUNT_UPDATE', 'bank_account', acc.id, d);
  res.json(await one('SELECT * FROM company_bank_accounts WHERE id=$1', [acc.id]));
}));

const ROYALTY_COLS = ['royalty_fixed_monthly', 'royalty_pct', 'royalty_vat_rate', 'royalty_base'];

r.get('/sites', ah(async (req, res) => {
  const P = new Params();
  const where = [siteScope(req.user, P)];
  if (req.query.company_id) where.push(`s.company_id = ${P.add(Number(req.query.company_id))}`);
  if (req.query.active === '1') where.push('s.active');
  const rows = await many(`SELECT s.*, c.name AS company_name, c.code AS company_code,
      (SELECT count(*)::int FROM user_sites us JOIN users u ON u.id=us.user_id WHERE us.site_id=s.id AND u.active) AS users_count
    FROM sites s JOIN companies c ON c.id=s.company_id WHERE ${where.join(' AND ')} ORDER BY c.name, s.name`, P.values);
  res.json(rows);
}));

r.get('/sites/:id/float-history', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  await assertSite(req.user, Number(req.params.id));
  res.json(await many(`SELECT h.*, u.full_name FROM cash_float_history h LEFT JOIN users u ON u.id=h.changed_by
    WHERE site_id=$1 ORDER BY changed_at DESC`, [Number(req.params.id)]));
}));

r.post('/sites', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const d = parse(siteSchema, req.body);
  assertCompany(req.user, d.company_id);
  if (await one('SELECT 1 FROM sites WHERE company_id=$1 AND code=$2', [d.company_id, d.code])) throw bad('Codice sede già esistente per questa azienda');
  const row = await tx(async (c) => {
    const s = (await c.query(`INSERT INTO sites (company_id, code, name, address, city, province, cash_float, operating_days, pos_terminals, active,
        host_name, host_vat, royalty_fixed_monthly, royalty_pct, royalty_base, royalty_vat_rate, royalty_notes, site_email, host_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [d.company_id, d.code, d.name, d.address, d.city, d.province, d.cash_float, d.operating_days, d.pos_terminals, d.active,
      d.host_name, d.host_vat, d.royalty_fixed_monthly, d.royalty_pct, d.royalty_base, d.royalty_vat_rate, d.royalty_notes, d.site_email || null, d.host_email || null])).rows[0];
    await c.query('INSERT INTO cash_float_history (site_id, old_value, new_value, changed_by, reason) VALUES ($1,NULL,$2,$3,$4)',
      [s.id, d.cash_float, req.user.id, 'Impostazione iniziale']);
    await c.query('INSERT INTO site_royalty_history (site_id, fixed_monthly, pct, vat_rate, base, changed_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [s.id, d.royalty_fixed_monthly, d.royalty_pct, d.royalty_vat_rate, d.royalty_base, req.user.id]);
    return s;
  });
  await audit(req, 'SITE_CREATE', 'site', row.id, d);
  res.status(201).json(row);
}));

r.put('/sites/:id', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const site = await assertSite(req.user, Number(req.params.id));
  // partial() applica comunque i default: li rimuovo per non azzerare i campi omessi
  const d = parse(z.object(Object.fromEntries(Object.entries(siteSchema.omit({ company_id: true, code: true }).shape)
    .map(([k, v]) => [k, (v instanceof z.ZodDefault ? v.removeDefault() : v).optional()]))), req.body);
  await tx(async (c) => {
    if (d.cash_float != null && Number(d.cash_float) !== Number(site.cash_float)) {
      if (!d.float_reason) throw bad('Indica il motivo della variazione del fondo cassa');
      await c.query('INSERT INTO cash_float_history (site_id, old_value, new_value, changed_by, reason) VALUES ($1,$2,$3,$4,$5)',
        [site.id, site.cash_float, d.cash_float, req.user.id, d.float_reason]);
    }
    delete d.float_reason;
    if (ROYALTY_COLS.some((k) => d[k] != null && String(d[k]) !== String(site[k]))) {
      await c.query('INSERT INTO site_royalty_history (site_id, fixed_monthly, pct, vat_rate, base, changed_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [site.id, d.royalty_fixed_monthly ?? site.royalty_fixed_monthly, d.royalty_pct ?? site.royalty_pct, d.royalty_vat_rate ?? site.royalty_vat_rate, d.royalty_base ?? site.royalty_base, req.user.id]);
    }
    const cols = Object.keys(d);
    if (cols.length) await c.query(`UPDATE sites SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [site.id, ...cols.map((k) => d[k])]);
  });
  await audit(req, 'SITE_UPDATE', 'site', site.id, req.body);
  res.json({ ok: true });
}));

// ---------------- Utenti ----------------
const tempPassword = () => {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(14)) s += alpha[b % alpha.length];
  return s.slice(0, 4) + '-' + s.slice(4, 9) + '-' + s.slice(9) + '7a';
};

const userSchema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase()),
  full_name: z.string().min(2).max(120),
  role: z.enum(['SUPERADMIN', 'ADMIN', 'CASSIERE', 'FINANCE', 'OPERATOR', 'PARTNER']),
  company_id: z.number().int().nullable().optional(),
  auth_provider: z.enum(['LOCAL', 'ENTRA', 'BOTH']),
  site_ids: z.array(z.number().int()).default([]),
  active: z.boolean().default(true),
});

async function checkUserPayload(req, d, existing) {
  if (!isSuper(req.user)) {
    if (d.role === 'SUPERADMIN') throw forbidden('Solo il super amministratore può creare super amministratori');
    d.company_id = req.user.company_id;
    if (existing && (existing.role === 'SUPERADMIN' || existing.company_id !== req.user.company_id)) throw forbidden();
  }
  if (d.role === 'SUPERADMIN') { d.company_id = null; d.site_ids = []; }
  else if (!d.company_id) throw bad('Azienda obbligatoria');
  if (['ADMIN', 'FINANCE'].includes(d.role)) d.site_ids = []; // amministratore e finance operano su tutta l'azienda
  if (['OPERATOR', 'CASSIERE', 'PARTNER'].includes(d.role) && !d.site_ids.length) throw bad('Assegna almeno una sede');
  if (d.site_ids.length) {
    const bad2 = await one('SELECT count(*)::int AS n FROM sites WHERE id = ANY($1::int[]) AND company_id <> $2', [d.site_ids, d.company_id]);
    if (bad2.n) throw bad("Le sedi devono appartenere all'azienda dell'utente");
  }
}

r.get('/users', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const P = new Params();
  const where = [isSuper(req.user) ? 'TRUE' : `u.company_id = ${P.add(req.user.company_id)}`];
  if (req.query.company_id) where.push(`u.company_id = ${P.add(Number(req.query.company_id))}`);
  const rows = await many(`SELECT u.id, u.email, u.full_name, u.role, u.company_id, u.auth_provider, u.totp_enabled, u.active,
      u.must_change_password, u.last_login_at, u.locked_until, c.name AS company_name,
      coalesce((SELECT array_agg(site_id) FROM user_sites WHERE user_id=u.id), '{}') AS site_ids
    FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE ${where.join(' AND ')} ORDER BY u.active DESC, u.full_name`, P.values);
  res.json(rows);
}));

r.post('/users', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const d = parse(userSchema, req.body);
  await checkUserPayload(req, d);
  if (await one('SELECT 1 FROM users WHERE lower(email)=$1', [d.email])) throw bad('Email già registrata');
  const needsPwd = d.auth_provider !== 'ENTRA';
  const pwd = needsPwd ? tempPassword() : null;
  const row = await tx(async (c) => {
    const u = (await c.query(`INSERT INTO users (email, full_name, role, company_id, auth_provider, password_hash, must_change_password, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [d.email, d.full_name, d.role, d.company_id, d.auth_provider, pwd ? await bcrypt.hash(pwd, 12) : null, needsPwd, d.active])).rows[0];
    for (const s of d.site_ids) await c.query('INSERT INTO user_sites VALUES ($1,$2)', [u.id, s]);
    return u;
  });
  await audit(req, 'USER_CREATE', 'user', row.id, { ...d });
  res.status(201).json({ id: row.id, temporaryPassword: pwd });
}));

r.put('/users/:id', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await one('SELECT * FROM users WHERE id=$1', [id]);
  if (!existing) throw notFound();
  const d = parse(userSchema, req.body);
  await checkUserPayload(req, d, existing);
  if (id === req.user.id && (!d.active || d.role !== existing.role)) throw bad('Non puoi disattivare o cambiare ruolo al tuo utente');
  const dup = await one('SELECT 1 FROM users WHERE lower(email)=$1 AND id<>$2', [d.email, id]);
  if (dup) throw bad('Email già registrata');
  let pwd = null;
  await tx(async (c) => {
    // passaggio da solo-Entra a locale: serve una password
    if (d.auth_provider !== 'ENTRA' && !existing.password_hash) {
      pwd = tempPassword();
      await c.query('UPDATE users SET password_hash=$2, must_change_password=TRUE WHERE id=$1', [id, await bcrypt.hash(pwd, 12)]);
    }
    await c.query(`UPDATE users SET email=$2, full_name=$3, role=$4, company_id=$5, auth_provider=$6, active=$7, updated_at=now() WHERE id=$1`,
      [id, d.email, d.full_name, d.role, d.company_id, d.auth_provider, d.active]);
    await c.query('DELETE FROM user_sites WHERE user_id=$1', [id]);
    for (const s of d.site_ids) await c.query('INSERT INTO user_sites VALUES ($1,$2)', [id, s]);
    if (!d.active) await c.query(`DELETE FROM "session" WHERE (sess->>'userId')::int = $1`, [id]);
  });
  await audit(req, 'USER_UPDATE', 'user', id, d);
  res.json({ ok: true, temporaryPassword: pwd });
}));

async function manageable(req, id) {
  const u = await one('SELECT * FROM users WHERE id=$1', [id]);
  if (!u) throw notFound();
  if (!isSuper(req.user) && (u.role === 'SUPERADMIN' || u.company_id !== req.user.company_id)) throw forbidden();
  return u;
}

r.post('/users/:id/reset-password', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const u = await manageable(req, Number(req.params.id));
  if (u.auth_provider === 'ENTRA') throw bad("L'utente accede solo con Microsoft: la password si gestisce in Office 365");
  const pwd = tempPassword();
  await q('UPDATE users SET password_hash=$2, must_change_password=TRUE, failed_logins=0, locked_until=NULL WHERE id=$1', [u.id, await bcrypt.hash(pwd, 12)]);
  await q(`DELETE FROM "session" WHERE (sess->>'userId')::int = $1`, [u.id]);
  await audit(req, 'USER_RESET_PASSWORD', 'user', u.id);
  res.json({ temporaryPassword: pwd });
}));

r.post('/users/:id/reset-totp', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const u = await manageable(req, Number(req.params.id));
  await q('UPDATE users SET totp_secret=NULL, totp_enabled=FALSE WHERE id=$1', [u.id]);
  await audit(req, 'USER_RESET_TOTP', 'user', u.id);
  res.json({ ok: true });
}));

// ---------------- Impostazioni (creditore SEPA) ----------------
const SETTINGS_KEYS = ['creditor_name', 'creditor_iban', 'creditor_bic', 'creditor_id', 'royalty_invoice_prefix', 'pickup_alert_days', 'daily_alert_hour', 'daily_alert_enabled', 'daily_summary_admins'];

r.get('/settings', requireRole('SUPERADMIN'), ah(async (_req, res) => {
  const rows = await many('SELECT key, value FROM app_settings WHERE key = ANY($1)', [SETTINGS_KEYS]);
  res.json(Object.fromEntries(rows.map((x) => [x.key, x.value])));
}));

r.put('/settings', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({
    creditor_name: z.string().max(70).optional(),
    creditor_iban: z.string().transform((v) => v.replace(/\s/g, '').toUpperCase()).refine((v) => !v || ibanRe.test(v), 'IBAN non valido').optional(),
    creditor_bic: z.string().max(11).optional(),
    creditor_id: z.string().max(35).optional(),
    royalty_invoice_prefix: z.string().max(10).optional(),
    pickup_alert_days: z.string().regex(/^\d{1,2}$/).optional(),
    daily_alert_hour: z.string().regex(/^([01]?\d|2[0-3])$/).optional(),
    daily_alert_enabled: z.enum(['true', 'false']).optional(),
    daily_summary_admins: z.enum(['true', 'false']).optional(),
  }), req.body);
  for (const [k, v] of Object.entries(d)) {
    await q('INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
  }
  await audit(req, 'SETTINGS_UPDATE', 'settings', null, d);
  res.json({ ok: true });
}));

// ---------------- Audit ----------------
r.get('/audit', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const P = new Params();
  const where = [isSuper(req.user) ? 'TRUE' : `u.company_id = ${P.add(req.user.company_id)}`];
  if (req.query.action) where.push(`a.action = ${P.add(req.query.action)}`);
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(await many(`SELECT a.*, u.full_name, u.email FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    WHERE ${where.join(' AND ')} ORDER BY a.at DESC LIMIT ${limit}`, P.values));
}));

export default r;
