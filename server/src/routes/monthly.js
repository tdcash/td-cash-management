import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, parse, eur, itDate, r2 } from '../lib/util.js';
import { requireRole } from '../lib/access.js';
import { readGipoPdf } from '../lib/gipo.js';
import { buildMonthlyCheckPdf } from '../pdf/controllo.js';

// Controllo mensile massivo da GIPO: solo super amministratore
const r = Router();
r.use(requireRole('SUPERADMIN'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 12 } });
const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'gipo_sezionali_seed.json');

// ---- Sezionali (tabella di trascodifica GIPO -> sede) ----
export async function ensureSezionaliSeed() {
  const n = await one('SELECT count(*)::int AS n FROM gipo_sezionali');
  if (n.n) return;
  const rows = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  for (const s of rows) await q('INSERT INTO gipo_sezionali (code, description, gipo_site_id) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [s.code, s.description, s.gipo_site_id]);
}

r.get('/sezionali', ah(async (_req, res) => {
  await ensureSezionaliSeed();
  res.json(await many(`SELECT g.code, g.description, g.site_id, g.gipo_site_id, g.active, g.updated_at, s.name AS site_name, s.code AS site_code, c.name AS company_name
    FROM gipo_sezionali g LEFT JOIN sites s ON s.id=g.site_id LEFT JOIN companies c ON c.id=s.company_id ORDER BY g.code`));
}));

r.put('/sezionali/:code', ah(async (req, res) => {
  const code = String(req.params.code).padStart(2, '0');
  const d = parse(z.object({ description: z.string().max(200).nullable().optional(), site_id: z.number().int().nullable().optional(), gipo_site_id: z.number().int().nullable().optional(), active: z.boolean().optional() }), req.body);
  await q(`INSERT INTO gipo_sezionali (code, description, site_id, gipo_site_id, active) VALUES ($1,$2,$3,$4,coalesce($5, TRUE))
    ON CONFLICT (code) DO UPDATE SET description=coalesce($2, gipo_sezionali.description), site_id=CASE WHEN $6 THEN $3 ELSE gipo_sezionali.site_id END,
      gipo_site_id=coalesce($4, gipo_sezionali.gipo_site_id), active=coalesce($5, gipo_sezionali.active), updated_at=now()`,
  [code, d.description ?? null, d.site_id ?? null, d.gipo_site_id ?? null, d.active ?? null, d.site_id !== undefined]);
  await audit(req, 'SEZIONALE_UPDATE', 'sezionale', code, d);
  res.json(await one('SELECT * FROM gipo_sezionali WHERE code=$1', [code]));
}));

r.delete('/sezionali/:code', ah(async (req, res) => {
  await q('DELETE FROM gipo_sezionali WHERE code=$1', [String(req.params.code).padStart(2, '0')]);
  await audit(req, 'SEZIONALE_DELETE', 'sezionale', req.params.code);
  res.json({ ok: true });
}));

// ---- Controllo ----
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
function monthRange(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

async function runCheck(req, period, files) {
  const { from, to } = monthRange(period);
  await ensureSezionaliSeed();
  const sez = new Map((await many('SELECT g.code, g.site_id, g.description, s.name AS site_name, s.code AS site_code FROM gipo_sezionali g LEFT JOIN sites s ON s.id=g.site_id WHERE g.active')).map((x) => [x.code, x]));
  const users = new Map((await many(`SELECT id, lower(email) AS email, full_name FROM users`)).map((u) => [u.email, u]));
  // lettura dei PDF
  const parsed = [];
  for (const f of files) {
    let p;
    try { p = await readGipoPdf(f.buffer); } catch { throw bad(`File ${f.originalname} non leggibile`); }
    if (!p.movements.length) throw bad(`File ${f.originalname}: nessun movimento riconosciuto (serve la Stampa cassa per utente di GIPO)`);
    parsed.push({ name: f.originalname, ...p });
  }
  const problems = [];
  // aggregazione GIPO per (sede, data, operatore)
  const agg = new Map();
  for (const p of parsed) for (const m of p.movements) {
    if (m.date < from || m.date > to) { problems.push({ kind: 'FUORI_PERIODO', detail: `${p.name}: movimento ${m.number} del ${itDate(m.date)} fuori dal mese ${period}` }); continue; }
    const s = sez.get(m.sezionale);
    const u = users.get(m.user);
    if (!s || !s.site_id) problems.push({ kind: 'SEZIONALE', detail: `Sezionale /${m.sezionale} non associato a una sede (movimento ${m.number} del ${itDate(m.date)}, ${m.user})` });
    if (!u) problems.push({ kind: 'OPERATORE', detail: `Utente GIPO ${m.user} non censito in Cash Management (movimento ${m.number} del ${itDate(m.date)})` });
    const key = `${s?.site_id || 'x' + m.sezionale}|${m.date}|${u?.id || m.user}`;
    const row = agg.get(key) || { site_id: s?.site_id || null, sezionale: m.sezionale, site_name: s?.site_name || `Sezionale /${m.sezionale}`, site_code: s?.site_code || null, date: m.date, operator_id: u?.id || null, operator_name: u?.full_name || m.user, operator_email: m.user, gipo_amount: 0, gipo_count: 0 };
    row.gipo_amount = r2(row.gipo_amount + m.amount); row.gipo_count++;
    agg.set(key, row);
  }
  // rendiconti del mese
  const reps = await many(`SELECT r.id, r.site_id, r.report_date::text AS date, r.operator_id, r.status, r.cash_to_deposit, r.pos_total, r.transfer_total, r.verified_amount, r.expected_total,
      s.name AS site_name, s.code AS site_code, u.full_name AS operator_name, lower(u.email) AS operator_email
    FROM cash_reports r JOIN sites s ON s.id=r.site_id LEFT JOIN users u ON u.id=r.operator_id WHERE r.report_date BETWEEN $1 AND $2`, [from, to]);
  const repMap = new Map(reps.map((x) => [`${x.site_id}|${x.date}|${x.operator_id}`, x]));
  const rows = [];
  for (const [key, g] of agg) {
    const rep = repMap.get(key);
    if (rep) repMap.delete(key);
    const declared = rep ? r2(Number(rep.cash_to_deposit) + Number(rep.pos_total) + Number(rep.transfer_total)) : null;
    const diff = rep ? r2(declared - g.gipo_amount) : null;
    rows.push({ ...g, report_id: rep?.id || null, status: rep?.status || null, declared, cash_declared: rep ? Number(rep.cash_to_deposit) : null, verified: rep?.verified_amount != null ? Number(rep.verified_amount) : null,
      diff, outcome: !g.site_id || !g.operator_id ? 'NON_RICONOSCIUTO' : !rep ? 'RENDICONTO_MANCANTE' : rep.status === 'DRAFT' ? 'BOZZA' : diff === 0 ? 'QUADRA' : diff < 0 ? 'AMMANCO' : 'ECCEDENZA' });
  }
  // rendiconti senza incasso GIPO
  for (const rep of repMap.values()) {
    const declared = r2(Number(rep.cash_to_deposit) + Number(rep.pos_total) + Number(rep.transfer_total));
    rows.push({ site_id: rep.site_id, sezionale: null, site_name: rep.site_name, site_code: rep.site_code, date: rep.date, operator_id: rep.operator_id, operator_name: rep.operator_name, operator_email: rep.operator_email,
      gipo_amount: 0, gipo_count: 0, report_id: rep.id, status: rep.status, declared, cash_declared: Number(rep.cash_to_deposit), verified: rep.verified_amount != null ? Number(rep.verified_amount) : null, diff: declared, outcome: declared === 0 ? 'QUADRA' : 'SENZA_GIPO' });
  }
  rows.sort((a, b) => a.site_name.localeCompare(b.site_name) || a.date.localeCompare(b.date) || a.operator_name.localeCompare(b.operator_name));
  // modalità di pagamento complessive (totale file) vs dichiarato
  const modes = { cash: 0, pos: 0, transfer: 0, other: 0 };
  for (const p of parsed) for (const m of p.modes) modes[m.kind] = r2(modes[m.kind] + m.amount);
  const declaredModes = { cash: r2(reps.filter((x) => x.status !== 'DRAFT').reduce((a, x) => a + Number(x.cash_to_deposit), 0)), pos: r2(reps.filter((x) => x.status !== 'DRAFT').reduce((a, x) => a + Number(x.pos_total), 0)), transfer: r2(reps.filter((x) => x.status !== 'DRAFT').reduce((a, x) => a + Number(x.transfer_total), 0)) };
  const count = (k) => rows.filter((x) => x.outcome === k).length;
  const bySite = {};
  for (const x of rows) { const k = x.site_name; bySite[k] = bySite[k] || { site_name: k, site_code: x.site_code, gipo: 0, declared: 0, diff: 0, rows: 0, issues: 0 }; bySite[k].gipo = r2(bySite[k].gipo + x.gipo_amount); bySite[k].declared = r2(bySite[k].declared + (x.declared || 0)); bySite[k].diff = r2(bySite[k].declared - bySite[k].gipo); bySite[k].rows++; if (x.outcome !== 'QUADRA') bySite[k].issues++; }
  const summary = { period, from, to, files: parsed.map((p) => ({ name: p.name, from: p.from, to: p.to, users: p.users.length, movements: p.movements.length, total: p.totals.incassato ?? p.totals.totale ?? null })),
    gipo_total: r2(rows.reduce((a, x) => a + x.gipo_amount, 0)), declared_total: r2(rows.reduce((a, x) => a + (x.declared || 0), 0)),
    rows: rows.length, quadra: count('QUADRA'), ammanco: count('AMMANCO'), eccedenza: count('ECCEDENZA'), mancanti: count('RENDICONTO_MANCANTE'), bozze: count('BOZZA'), senza_gipo: count('SENZA_GIPO'), non_riconosciuti: count('NON_RICONOSCIUTO'),
    ammanco_total: r2(rows.filter((x) => x.outcome === 'AMMANCO').reduce((a, x) => a + x.diff, 0)), eccedenza_total: r2(rows.filter((x) => x.outcome === 'ECCEDENZA').reduce((a, x) => a + x.diff, 0)),
    modes_gipo: modes, modes_declared: declaredModes, by_site: Object.values(bySite).sort((a, b) => a.site_name.localeCompare(b.site_name)), problems: [...new Map(problems.map((p) => [p.detail, p])).values()] };
  return { summary, rows };
}

r.post('/run', upload.array('files', 12), ah(async (req, res) => {
  const period = String(req.body.period || '');
  if (!PERIOD.test(period)) throw bad('Periodo non valido (AAAA-MM)');
  if (!req.files?.length) throw bad('Carica almeno un PDF "Stampa cassa per utente"');
  const { summary, rows } = await runCheck(req, period, req.files);
  const { from, to } = monthRange(period);
  const row = await one(`INSERT INTO monthly_checks (period, date_from, date_to, files, summary, rows, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
    [period, from, to, JSON.stringify(summary.files), JSON.stringify(summary), JSON.stringify(rows), req.user.id]);
  await audit(req, 'MONTHLY_CHECK', 'period', period, { id: row.id, rows: rows.length, ammanco: summary.ammanco, mancanti: summary.mancanti });
  res.status(201).json({ id: row.id, created_at: row.created_at, period, summary, rows });
}));

r.get('/', ah(async (_req, res) => {
  res.json(await many(`SELECT m.id, m.period, m.date_from, m.date_to, m.created_at, u.full_name AS created_by_name, m.summary FROM monthly_checks m LEFT JOIN users u ON u.id=m.created_by ORDER BY m.created_at DESC LIMIT 100`));
}));

async function load(id) {
  const m = await one(`SELECT m.*, u.full_name AS created_by_name FROM monthly_checks m LEFT JOIN users u ON u.id=m.created_by WHERE m.id=$1`, [id]);
  if (!m) throw notFound('Controllo non trovato');
  return m;
}
r.get('/:id', ah(async (req, res) => { res.json(await load(Number(req.params.id))); }));
r.delete('/:id', ah(async (req, res) => { await q('DELETE FROM monthly_checks WHERE id=$1', [Number(req.params.id)]); await audit(req, 'MONTHLY_CHECK_DELETE', 'check', req.params.id); res.json({ ok: true }); }));

const OUTCOME = { QUADRA: 'Quadra', AMMANCO: 'Ammanco', ECCEDENZA: 'Eccedenza', RENDICONTO_MANCANTE: 'Rendiconto mancante', BOZZA: 'Rendiconto in bozza', SENZA_GIPO: 'Rendiconto senza incasso GIPO', NON_RICONOSCIUTO: 'Sede o operatore non riconosciuto' };

r.get('/:id/xlsx', ah(async (req, res) => {
  const m = await load(Number(req.params.id));
  const wb = new ExcelJS.Workbook(); wb.creator = 'TD Cash Management';
  const ws = wb.addWorksheet('Controllo');
  ws.columns = [{ header: 'Sede', key: 'site_name', width: 30 }, { header: 'Cod.', key: 'site_code', width: 8 }, { header: 'Sezionale', key: 'sezionale', width: 9 }, { header: 'Data', key: 'date', width: 12 }, { header: 'Operatore', key: 'operator_name', width: 26 }, { header: 'Email', key: 'operator_email', width: 32 },
    { header: 'Movimenti GIPO', key: 'gipo_count', width: 10 }, { header: 'Incasso GIPO', key: 'gipo_amount', width: 14 }, { header: 'Dichiarato', key: 'declared', width: 14 }, { header: 'di cui contanti', key: 'cash_declared', width: 14 }, { header: 'Verificato', key: 'verified', width: 14 }, { header: 'Differenza', key: 'diff', width: 14 }, { header: 'Esito', key: 'outcome', width: 30 }, { header: 'Stato rendiconto', key: 'status', width: 16 }];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } }; ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const x of m.rows) ws.addRow({ ...x, date: new Date(`${x.date}T00:00:00Z`), outcome: OUTCOME[x.outcome] || x.outcome, sezionale: x.sezionale ? `/${x.sezionale}` : '' });
  for (const k of ['gipo_amount', 'declared', 'cash_declared', 'verified', 'diff']) ws.getColumn(k).numFmt = '#,##0.00 €';
  ws.getColumn('date').numFmt = 'dd/mm/yyyy';
  ws.autoFilter = { from: 'A1', to: `N${m.rows.length + 1}` };
  const s = wb.addWorksheet('Riepilogo');
  s.columns = [{ header: 'Voce', key: 'k', width: 34 }, { header: 'Valore', key: 'v', width: 20 }];
  s.getRow(1).font = { bold: true };
  const S = m.summary;
  for (const [k, v] of [['Periodo', S.period], ['File letti', S.files.map((f) => f.name).join(', ')], ['Righe confrontate', S.rows], ['Incasso GIPO', S.gipo_total], ['Dichiarato in Cash Management', S.declared_total], ['Quadrano', S.quadra], ['Ammanchi', S.ammanco], ['Totale ammanchi', S.ammanco_total], ['Eccedenze', S.eccedenza], ['Totale eccedenze', S.eccedenza_total], ['Rendiconti mancanti', S.mancanti], ['Rendiconti in bozza', S.bozze], ['Rendiconti senza incasso GIPO', S.senza_gipo], ['Non riconosciuti', S.non_riconosciuti],
    ['GIPO contanti', S.modes_gipo.cash], ['Dichiarato contanti', S.modes_declared.cash], ['GIPO POS/carte', S.modes_gipo.pos], ['Dichiarato POS', S.modes_declared.pos], ['GIPO bonifici', S.modes_gipo.transfer], ['Dichiarato bonifici', S.modes_declared.transfer], ['GIPO altre modalità', S.modes_gipo.other]]) s.addRow({ k, v });
  const b = wb.addWorksheet('Per sede');
  b.columns = [{ header: 'Sede', key: 'site_name', width: 30 }, { header: 'Cod.', key: 'site_code', width: 8 }, { header: 'Incasso GIPO', key: 'gipo', width: 14 }, { header: 'Dichiarato', key: 'declared', width: 14 }, { header: 'Differenza', key: 'diff', width: 14 }, { header: 'Righe', key: 'rows', width: 8 }, { header: 'Anomalie', key: 'issues', width: 10 }];
  b.getRow(1).font = { bold: true };
  for (const x of S.by_site) b.addRow(x);
  for (const k of ['gipo', 'declared', 'diff']) b.getColumn(k).numFmt = '#,##0.00 €';
  if (S.problems?.length) { const p = wb.addWorksheet('Segnalazioni'); p.columns = [{ header: 'Tipo', key: 'kind', width: 16 }, { header: 'Dettaglio', key: 'detail', width: 110 }]; p.getRow(1).font = { bold: true }; for (const x of S.problems) p.addRow(x); }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Controllo_mensile_${m.period}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

r.get('/:id/pdf', ah(async (req, res) => {
  const m = await load(Number(req.params.id));
  const company = await one('SELECT * FROM companies WHERE is_franchisor ORDER BY id LIMIT 1') || await one('SELECT * FROM companies ORDER BY id LIMIT 1');
  const pdf = await buildMonthlyCheckPdf({ check: m, company, OUTCOME });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Controllo_mensile_${m.period}.pdf"`);
  res.send(pdf);
}));

export default r;
