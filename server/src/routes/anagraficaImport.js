import { Router } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { many, one, tx } from '../db.js';
import { ah, bad, audit } from '../lib/util.js';
import { requireRole, isSuper } from '../lib/access.js';
import { buildTemplate, readSheet, parseItDate, parseNum } from '../lib/xlsxImport.js';

// Import massivo di sedi e utenti da modello Excel: anteprima (dry run) e importazione
const r = Router();
r.use(requireRole('SUPERADMIN', 'ADMIN'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const tempPassword = () => {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(14)) s += alpha[b % alpha.length];
  return s.slice(0, 4) + '-' + s.slice(4, 9) + '-' + s.slice(9) + '7a';
};

r.get('/template/:kind.xlsx', ah(async (req, res) => {
  const kind = req.params.kind;
  if (!['sites', 'users'].includes(kind)) throw bad('Modello inesistente');
  const sample = kind === 'sites'
    ? [{ codice: 'ESEMPIO01', azienda: isSuper(req.user) ? 'TD' : '', nome: 'Punto prelievo Esempio', indirizzo: 'Via Roma 1', citta: 'Firenze', provincia: 'FI', email_sede: 'esempio@toscanadiagnostica.it', fondo_cassa: 150, data_avvio: '01/10/2026', giorni_operativi: '1111110', orario_apertura: '07:30', orario_chiusura: '13:00', terminali_pos: '', tipo: 'OSPITATA', struttura_ospitante: 'Farmacia Esempio', piva_struttura: '', email_struttura: 'amministrazione@farmaciaesempio.it', quota_fissa_mensile: 300, percentuale: 2.5, base_percentuale: 'TOTALE', iva: 22, note_contratto: '' }]
    : [{ email: 'mario.rossi@toscanadiagnostica.it', nome_cognome: 'Mario Rossi', ruolo: 'OPERATOR', azienda: isSuper(req.user) ? 'TD' : '', accesso: 'ENTRAMBI', sedi: 'ESEMPIO01', attivo: 'SI' }];
  const buf = await buildTemplate(kind, sample);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="modello_${kind === 'sites' ? 'sedi' : 'utenti'}_TD_Cash.xlsx"`);
  res.send(Buffer.from(buf));
}));

async function companyResolver(req) {
  const rows = isSuper(req.user) ? await many('SELECT id, code FROM companies WHERE active') : await many('SELECT id, code FROM companies WHERE id=$1', [req.user.company_id]);
  const byCode = new Map(rows.map((c) => [c.code.toUpperCase(), c.id]));
  return (code) => {
    if (!isSuper(req.user)) return req.user.company_id;
    if (!code) return rows.length === 1 ? rows[0].id : null;
    return byCode.get(String(code).toUpperCase()) || null;
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- Sedi ----
async function checkSites(req, rows) {
  const company = await companyResolver(req);
  const out = [];
  const seen = new Set();
  for (const x of rows) {
    const errors = [];
    const cid = company(x.azienda);
    if (!cid) errors.push(isSuper(req.user) ? `Azienda "${x.azienda || ''}" non trovata` : 'Azienda non determinabile');
    const code = String(x.codice || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(code)) errors.push('Codice mancante o non valido (2-12 lettere/cifre)');
    if (seen.has(`${cid}:${code}`)) errors.push('Codice ripetuto nel file');
    seen.add(`${cid}:${code}`);
    const name = String(x.nome || '').trim();
    if (name.length < 2) errors.push('Denominazione mancante');
    const cash_float = parseNum(x.fondo_cassa);
    if (cash_float == null || Number.isNaN(cash_float) || cash_float < 0) errors.push('Fondo cassa mancante o non numerico');
    const start_date = parseItDate(x.data_avvio);
    if (!start_date) errors.push('Data di avvio mancante o non valida (GG/MM/AAAA)');
    const od = String(x.giorni_operativi || '1111110').trim();
    if (!/^[01]{7}$/.test(od)) errors.push('Giorni operativi: 7 cifre 0/1');
    const tipo = String(x.tipo || 'OSPITATA').trim().toUpperCase();
    const hhmm = (v) => { if (v === '' || v == null) return null; const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})/); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : NaN; };
    const hOpen = hhmm(x.orario_apertura), hClose = hhmm(x.orario_chiusura);
    if (Number.isNaN(hOpen) || Number.isNaN(hClose)) errors.push('Orari: formato HH:MM');
    const hours = {};
    if (!Number.isNaN(hOpen) && !Number.isNaN(hClose) && (hOpen || hClose)) for (let i = 0; i < 7; i++) if (od[i] === '1') hours[String(i + 1)] = { open: hOpen, close: hClose };
    if (!['PROPRIA', 'OSPITATA'].includes(tipo)) errors.push('Tipo: PROPRIA o OSPITATA');
    for (const [k, label] of [['email_sede', 'Email sede'], ['email_struttura', 'Email struttura']]) if (x[k] && !EMAIL_RE.test(String(x[k]).trim())) errors.push(`${label} non valida`);
    const fixed = parseNum(x.quota_fissa_mensile) ?? 0, pct = parseNum(x.percentuale) ?? 0, vat = parseNum(x.iva) ?? 0;
    if ([fixed, pct, vat].some(Number.isNaN)) errors.push('Royalty: valori non numerici');
    const base = String(x.base_percentuale || 'TOTALE').trim().toUpperCase();
    if (!['TOTALE', 'CONTANTI_POS', 'CONTANTI'].includes(base)) errors.push('Base percentuale: TOTALE, CONTANTI_POS o CONTANTI');
    const existing = cid && code ? await one('SELECT id FROM sites WHERE company_id=$1 AND code=$2', [cid, code]) : null;
    const d = { company_id: cid, code, name, address: x.indirizzo || null, city: x.citta || null, province: x.provincia ? String(x.provincia).toUpperCase() : null,
      site_email: x.email_sede ? String(x.email_sede).trim().toLowerCase() : null, cash_float, start_date, operating_days: od, hours: JSON.stringify(hours), pos_terminals: x.terminali_pos || null, ownership: tipo,
      host_name: tipo === 'PROPRIA' ? null : x.struttura_ospitante || null, host_vat: tipo === 'PROPRIA' ? null : x.piva_struttura || null, host_email: tipo === 'PROPRIA' ? null : (x.email_struttura ? String(x.email_struttura).trim().toLowerCase() : null),
      royalty_fixed_monthly: tipo === 'PROPRIA' ? 0 : fixed, royalty_pct: tipo === 'PROPRIA' ? 0 : pct, royalty_base: base, royalty_vat_rate: tipo === 'PROPRIA' ? 0 : vat, royalty_notes: tipo === 'PROPRIA' ? null : x.note_contratto || null };
    out.push({ row: x._row, code, name, action: existing ? 'AGGIORNA' : 'CREA', id: existing?.id || null, errors, data: d });
  }
  return out;
}

r.post('/sites', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  let rows;
  try { rows = await readSheet(req.file.buffer); } catch { throw bad('File non leggibile: usa il modello Excel scaricato dall\'app'); }
  if (!rows.length) throw bad('Il file non contiene righe');
  const checked = await checkSites(req, rows);
  const dry = String(req.query.dry || '') === '1';
  if (dry || checked.some((c) => c.errors.length)) return res.json({ dry: true, rows: checked.map(({ data, ...x }) => x), ok: !checked.some((c) => c.errors.length) });
  await tx(async (c) => {
    for (const it of checked) {
      const d = it.data;
      if (it.id) {
        const old = (await c.query('SELECT * FROM sites WHERE id=$1', [it.id])).rows[0];
        const cols = Object.keys(d).filter((k) => k !== 'company_id' && k !== 'code');
        await c.query(`UPDATE sites SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [it.id, ...cols.map((k) => d[k])]);
        if (Number(old.cash_float) !== Number(d.cash_float)) await c.query('INSERT INTO cash_float_history (site_id, old_value, new_value, changed_by, reason) VALUES ($1,$2,$3,$4,$5)', [it.id, old.cash_float, d.cash_float, req.user.id, 'Importazione da Excel']);
        if (['royalty_fixed_monthly', 'royalty_pct', 'royalty_vat_rate', 'royalty_base'].some((k) => String(old[k]) !== String(d[k]))) await c.query('INSERT INTO site_royalty_history (site_id, fixed_monthly, pct, vat_rate, base, changed_by) VALUES ($1,$2,$3,$4,$5,$6)', [it.id, d.royalty_fixed_monthly, d.royalty_pct, d.royalty_vat_rate, d.royalty_base, req.user.id]);
      } else {
        const cols = Object.keys(d);
        const s = (await c.query(`INSERT INTO sites (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, cols.map((k) => d[k]))).rows[0];
        it.id = s.id;
        await c.query('INSERT INTO cash_float_history (site_id, old_value, new_value, changed_by, reason) VALUES ($1,NULL,$2,$3,$4)', [s.id, d.cash_float, req.user.id, 'Importazione da Excel']);
        await c.query('INSERT INTO site_royalty_history (site_id, fixed_monthly, pct, vat_rate, base, changed_by) VALUES ($1,$2,$3,$4,$5,$6)', [s.id, d.royalty_fixed_monthly, d.royalty_pct, d.royalty_vat_rate, d.royalty_base, req.user.id]);
      }
    }
  });
  await audit(req, 'SITES_IMPORT', 'file', req.file.originalname, { created: checked.filter((x) => x.action === 'CREA').length, updated: checked.filter((x) => x.action === 'AGGIORNA').length });
  res.json({ dry: false, ok: true, rows: checked.map(({ data, ...x }) => x) });
}));

// ---- Utenti ----
const ROLES = ['ADMIN', 'CASSIERE', 'FINANCE', 'OPERATOR', 'PARTNER'];
const ACCESS = { MICROSOFT: 'ENTRA', PASSWORD: 'LOCAL', ENTRAMBI: 'BOTH', ENTRA: 'ENTRA', LOCAL: 'LOCAL', BOTH: 'BOTH' };

async function checkUsers(req, rows) {
  const company = await companyResolver(req);
  const out = [];
  const seen = new Set();
  for (const x of rows) {
    const errors = [];
    const cid = company(x.azienda);
    if (!cid) errors.push(isSuper(req.user) ? `Azienda "${x.azienda || ''}" non trovata` : 'Azienda non determinabile');
    const email = String(x.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) errors.push('Email mancante o non valida');
    if (seen.has(email)) errors.push('Email ripetuta nel file');
    seen.add(email);
    const full_name = String(x.nome_cognome || '').trim();
    if (full_name.length < 2) errors.push('Nome e cognome mancante');
    const role = String(x.ruolo || '').trim().toUpperCase();
    if (!ROLES.includes(role)) errors.push(`Ruolo: ${ROLES.join(', ')}`);
    const auth_provider = ACCESS[String(x.accesso || 'ENTRAMBI').trim().toUpperCase()];
    if (!auth_provider) errors.push('Accesso: MICROSOFT, PASSWORD o ENTRAMBI');
    const active = !['NO', 'N', 'FALSE', '0'].includes(String(x.attivo || 'SI').trim().toUpperCase());
    const codes = String(x.sedi || '').split(/[,;]/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    let site_ids = [];
    if (['OPERATOR', 'CASSIERE', 'PARTNER'].includes(role)) {
      if (!codes.length) errors.push('Sedi obbligatorie per questo ruolo');
      else if (cid) {
        const found = await many('SELECT id, code FROM sites WHERE company_id=$1 AND code = ANY($2)', [cid, codes]);
        const missing = codes.filter((c) => !found.some((f) => f.code === c));
        if (missing.length) errors.push(`Sedi non trovate: ${missing.join(', ')}`);
        site_ids = found.map((f) => f.id);
      }
    }
    const existing = email ? await one('SELECT id, role, company_id FROM users WHERE lower(email)=$1', [email]) : null;
    if (existing && (existing.role === 'SUPERADMIN' || (!isSuper(req.user) && existing.company_id !== req.user.company_id))) errors.push('Utente non modificabile da questo profilo');
    if (existing && existing.id === req.user.id) errors.push('Non puoi importare il tuo stesso utente');
    out.push({ row: x._row, email, full_name, role, action: existing ? 'AGGIORNA' : 'CREA', id: existing?.id || null, errors,
      data: { email, full_name, role, company_id: cid, auth_provider, active, site_ids } });
  }
  return out;
}

r.post('/users', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('File mancante');
  let rows;
  try { rows = await readSheet(req.file.buffer); } catch { throw bad('File non leggibile: usa il modello Excel scaricato dall\'app'); }
  if (!rows.length) throw bad('Il file non contiene righe');
  const checked = await checkUsers(req, rows);
  const dry = String(req.query.dry || '') === '1';
  if (dry || checked.some((c) => c.errors.length)) return res.json({ dry: true, rows: checked.map(({ data, ...x }) => x), ok: !checked.some((c) => c.errors.length) });
  const credentials = [];
  await tx(async (c) => {
    for (const it of checked) {
      const d = it.data;
      if (it.id) {
        await c.query('UPDATE users SET full_name=$2, role=$3, company_id=$4, auth_provider=$5, active=$6, updated_at=now() WHERE id=$1', [it.id, d.full_name, d.role, d.company_id, d.auth_provider, d.active]);
        await c.query('DELETE FROM user_sites WHERE user_id=$1', [it.id]);
      } else {
        const needsPwd = d.auth_provider !== 'ENTRA';
        const pwd = needsPwd ? tempPassword() : null;
        const u = (await c.query(`INSERT INTO users (email, full_name, role, company_id, auth_provider, password_hash, must_change_password, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [d.email, d.full_name, d.role, d.company_id, d.auth_provider, pwd ? await bcrypt.hash(pwd, 12) : null, needsPwd, d.active])).rows[0];
        it.id = u.id;
        if (pwd) credentials.push({ email: d.email, temporaryPassword: pwd });
      }
      for (const s of d.site_ids) await c.query('INSERT INTO user_sites VALUES ($1,$2)', [it.id, s]);
    }
  });
  await audit(req, 'USERS_IMPORT', 'file', req.file.originalname, { created: checked.filter((x) => x.action === 'CREA').length, updated: checked.filter((x) => x.action === 'AGGIORNA').length });
  res.json({ dry: false, ok: true, rows: checked.map(({ data, ...x }) => x), credentials });
}));

export default r;
