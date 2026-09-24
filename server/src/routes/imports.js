import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { many, one, q, tx } from '../db.js';
import { ah, bad, audit, parse } from '../lib/util.js';
import { requireRole, assertCompany, Params, isSuper } from '../lib/access.js';
import { readCsv, parseAmount, parseDate, pick } from '../lib/csv.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
r.use(requireRole('SUPERADMIN', 'ADMIN'));

const CIRCUIT_MAP = { bancomat: 'BANCOMAT', pagobancomat: 'BANCOMAT', debit: 'BANCOMAT', maestro: 'BANCOMAT',
  visa: 'CARTA_CREDITO', mastercard: 'CARTA_CREDITO', amex: 'CARTA_CREDITO', credito: 'CARTA_CREDITO', carta_credito: 'CARTA_CREDITO',
  buoni_pasto: 'BUONI_PASTO', ticket: 'BUONI_PASTO', app: 'APP', satispay: 'APP', paypal: 'APP', applepay: 'APP', googlepay: 'APP' };
const normCircuit = (v) => CIRCUIT_MAP[String(v || '').toLowerCase().replace(/[\s-]/g, '_')] || (v ? 'ALTRO' : null);

async function siteResolver(companyId) {
  const sites = await many('SELECT id, code, pos_terminals FROM sites WHERE company_id=$1', [companyId]);
  const byCode = new Map(sites.map((s) => [s.code.toUpperCase(), s.id]));
  const byTid = new Map();
  for (const s of sites) for (const t of (s.pos_terminals || '').split(',').map((x) => x.trim()).filter(Boolean)) byTid.set(t, s.id);
  return (code, tid) => (code && byCode.get(String(code).toUpperCase())) || (tid && byTid.get(String(tid))) || null;
}

export async function reconcile(companyId, from, to) {
  return tx(async (c) => {
    const txs = (await c.query(`SELECT * FROM payment_transactions WHERE company_id=$1 AND matched_receipt_id IS NULL AND site_id IS NOT NULL
      AND tx_date BETWEEN $2 AND $3 ORDER BY tx_date, id`, [companyId, from, to])).rows;
    let matched = 0;
    for (const t of txs) {
      const rec = (await c.query(`SELECT p.id FROM pos_receipts p JOIN cash_reports r ON r.id=p.report_id
        WHERE r.site_id=$1 AND r.report_date=$2 AND p.amount=$3 AND p.matched_tx_id IS NULL
          AND ($4::text IS NULL OR p.terminal_id IS NULL OR p.terminal_id=$4)
        ORDER BY (p.terminal_id = $4) DESC NULLS LAST, p.id LIMIT 1 FOR UPDATE OF p`, [t.site_id, t.tx_date, t.amount, t.terminal_id])).rows[0];
      if (rec) {
        await c.query('UPDATE payment_transactions SET matched_receipt_id=$2 WHERE id=$1', [t.id, rec.id]);
        await c.query('UPDATE pos_receipts SET matched_tx_id=$2 WHERE id=$1', [rec.id, t.id]);
        matched++;
      }
    }
    return { examined: txs.length, matched };
  });
}

r.post('/transactions', upload.single('file'), ah(async (req, res) => {
  const companyId = Number(req.body.company_id || req.user.company_id);
  assertCompany(req.user, companyId);
  if (!req.file) throw bad('File CSV mancante');
  const rows = readCsv(req.file.buffer);
  const resolve = await siteResolver(companyId);
  const errors = [];
  const good = [];
  rows.forEach((row, i) => {
    const date = parseDate(pick(row, 'data', 'date', 'data_operazione'));
    const amount = parseAmount(pick(row, 'importo', 'amount', 'importo_eur'));
    const tid = pick(row, 'terminale', 'tid', 'terminal_id');
    const siteId = resolve(pick(row, 'sede', 'cod_sede', 'site'), tid);
    if (!date || !Number.isFinite(amount) || amount <= 0) { errors.push(`Riga ${i + 2}: data o importo non validi`); return; }
    good.push({ date, amount, tid, siteId, circuit: normCircuit(pick(row, 'circuito', 'circuit', 'tipo')), ref: pick(row, 'riferimento', 'reference', 'id_transazione') });
  });
  if (!good.length) throw bad(`Nessuna riga valida. ${errors.slice(0, 5).join('; ')}`);
  let skipped = 0;
  await tx(async (c) => {
    for (const g of good) {
      if (g.ref) {
        const dup = await c.query('SELECT 1 FROM payment_transactions WHERE company_id=$1 AND reference=$2', [companyId, g.ref]);
        if (dup.rowCount) { skipped++; continue; }
      }
      await c.query(`INSERT INTO payment_transactions (company_id, site_id, tx_date, amount, circuit, terminal_id, reference, source_file, imported_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [companyId, g.siteId, g.date, g.amount, g.circuit, g.tid, g.ref, req.file.originalname, req.user.id]);
    }
  });
  const dates = good.map((g) => g.date).sort();
  const rec = await reconcile(companyId, dates[0], dates[dates.length - 1]);
  await audit(req, 'IMPORT_TRANSACTIONS', 'company', companyId, { file: req.file.originalname, rows: good.length, skipped, ...rec });
  res.json({ imported: good.length - skipped, skipped_duplicates: skipped, without_site: good.filter((g) => !g.siteId).length, errors, ...rec });
}));

r.post('/reconcile', ah(async (req, res) => {
  const d = parse(z.object({ company_id: z.number().int(), from: z.string(), to: z.string() }), req.body);
  assertCompany(req.user, d.company_id);
  res.json(await reconcile(d.company_id, d.from, d.to));
}));

r.get('/reconciliation', ah(async (req, res) => {
  const companyId = Number(req.query.company_id || req.user.company_id);
  assertCompany(req.user, companyId);
  const { from, to } = req.query;
  const txs = await many(`SELECT t.*, s.name AS site_name, p.receipt_number, r.id AS report_id
    FROM payment_transactions t LEFT JOIN sites s ON s.id=t.site_id LEFT JOIN pos_receipts p ON p.id=t.matched_receipt_id
    LEFT JOIN cash_reports r ON r.id=p.report_id
    WHERE t.company_id=$1 AND t.tx_date BETWEEN $2 AND $3 ORDER BY t.tx_date DESC, t.id`, [companyId, from, to]);
  const receipts = await many(`SELECT p.*, r.report_date, r.id AS report_id, s.name AS site_name
    FROM pos_receipts p JOIN cash_reports r ON r.id=p.report_id JOIN sites s ON s.id=r.site_id
    WHERE s.company_id=$1 AND r.report_date BETWEEN $2 AND $3 AND p.matched_tx_id IS NULL ORDER BY r.report_date DESC`, [companyId, from, to]);
  res.json({
    transactions: txs,
    unmatched_receipts: receipts,
    summary: {
      tx_total: txs.length, tx_matched: txs.filter((t) => t.matched_receipt_id).length,
      tx_unmatched_amount: txs.filter((t) => !t.matched_receipt_id).reduce((a, t) => a + Number(t.amount), 0),
      receipts_unmatched: receipts.length, receipts_unmatched_amount: receipts.reduce((a, p) => a + Number(p.amount), 0),
    },
  });
}));

// Incassi canali digitali (e-commerce, app, prenotazioni online) con eventuale split alla fonte
r.post('/channels', upload.single('file'), ah(async (req, res) => {
  const companyId = Number(req.body.company_id || req.user.company_id);
  assertCompany(req.user, companyId);
  if (!req.file) throw bad('File CSV mancante');
  const rows = readCsv(req.file.buffer);
  const resolve = await siteResolver(companyId);
  const errors = [];
  let n = 0;
  await tx(async (c) => {
    for (const [i, row] of rows.entries()) {
      const date = parseDate(pick(row, 'data', 'date'));
      const gross = parseAmount(pick(row, 'importo_lordo', 'lordo', 'importo', 'gross'));
      const share = parseAmount(pick(row, 'quota_franchisor', 'trattenuta', 'split') ?? '0') || 0;
      const channel = String(pick(row, 'canale', 'channel') || 'ONLINE').toUpperCase().slice(0, 30);
      if (!date || !Number.isFinite(gross)) { errors.push(`Riga ${i + 2}: data o importo non validi`); continue; }
      if (share > gross) { errors.push(`Riga ${i + 2}: quota franchisor superiore al lordo`); continue; }
      await c.query(`INSERT INTO channel_revenues (company_id, site_id, rev_date, channel, gross_amount, franchisor_share, reference, source_file, imported_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [companyId, resolve(pick(row, 'sede', 'cod_sede')), date, channel, gross, share, pick(row, 'riferimento', 'reference'), req.file.originalname, req.user.id]);
      n++;
    }
  });
  await audit(req, 'IMPORT_CHANNELS', 'company', companyId, { file: req.file.originalname, n });
  res.json({ imported: n, errors });
}));

r.get('/channels', ah(async (req, res) => {
  const P = new Params();
  const where = [isSuper(req.user) ? 'TRUE' : `cr.company_id = ${P.add(req.user.company_id)}`];
  if (req.query.company_id) where.push(`cr.company_id = ${P.add(Number(req.query.company_id))}`);
  if (req.query.from) where.push(`cr.rev_date >= ${P.add(req.query.from)}`);
  if (req.query.to) where.push(`cr.rev_date <= ${P.add(req.query.to)}`);
  res.json(await many(`SELECT cr.*, c.name AS company_name, s.name AS site_name FROM channel_revenues cr
    JOIN companies c ON c.id=cr.company_id LEFT JOIN sites s ON s.id=cr.site_id WHERE ${where.join(' AND ')} ORDER BY cr.rev_date DESC LIMIT 2000`, P.values));
}));

r.delete('/channels/:id', ah(async (req, res) => {
  const row = await one('SELECT company_id FROM channel_revenues WHERE id=$1', [Number(req.params.id)]);
  if (!row) throw bad('Non trovato');
  assertCompany(req.user, row.company_id);
  await q('DELETE FROM channel_revenues WHERE id=$1', [Number(req.params.id)]);
  await audit(req, 'CHANNEL_DELETE', 'channel', req.params.id);
  res.json({ ok: true });
}));

export default r;
