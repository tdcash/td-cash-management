import { Router } from 'express';
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, parse, getSetting, eur, itDate, r2, todayRome } from '../lib/util.js';
import { requireRole, assertCompany, isSuper, Params } from '../lib/access.js';
import { computeRoyalty, normalizeTiers } from '../lib/royalty.js';
import { buildPain008, ibanValid, newMsgId } from '../lib/sepa.js';
import { letterhead, ASSETS, C, M, W, CONTENT_TOP } from '../pdf/distinta.js';

const r = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const monthRange = (p) => {
  const [y, m] = p.split('-').map(Number);
  const start = `${p}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end, year: y };
};

// ------------- Contratti -------------
const contractSchema = z.object({
  company_id: z.number().int(),
  valid_from: isoDate,
  valid_to: isoDate.nullable().optional(),
  revenue_base: z.enum(['LORDO', 'NETTO']),
  vat_rate: z.number().min(0).max(30).default(0),
  marketing_fee_pct: z.number().min(0).max(20),
  tier_mode: z.enum(['FASCIA', 'MARGINALE']),
  tier_basis: z.enum(['MENSILE', 'ANNUO_PROGRESSIVO']),
  tiers: z.array(z.object({ from: z.number().min(0), rate: z.number().min(0).max(50) })).min(1).max(20),
  min_monthly_fee: z.number().min(0).default(0),
  include_channels: z.boolean().default(true),
  payment_days: z.number().int().min(0).max(120).default(10),
  invoice_vat_rate: z.number().min(0).max(30).default(22),
  notes: z.string().max(1000).nullable().optional(),
});

r.get('/contracts', ah(async (req, res) => {
  const P = new Params();
  res.json(await many(`SELECT k.*, c.name AS company_name FROM royalty_contracts k JOIN companies c ON c.id=k.company_id
    WHERE ${isSuper(req.user) ? 'TRUE' : `k.company_id = ${P.add(req.user.company_id)}`} ORDER BY c.name, k.valid_from DESC`, P.values));
}));

async function checkOverlap(d, excludeId = 0) {
  const ov = await one(`SELECT id FROM royalty_contracts WHERE company_id=$1 AND id<>$2
    AND daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') && daterange($3::date, coalesce($4::date, 'infinity'::date), '[]')`,
  [d.company_id, excludeId, d.valid_from, d.valid_to || null]);
  if (ov) throw bad('Esiste già un contratto con validità sovrapposta per questa azienda');
}

r.post('/contracts', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(contractSchema, req.body);
  try { d.tiers = normalizeTiers(d.tiers); } catch (e) { throw bad(e.message); }
  await checkOverlap(d);
  const row = await one(`INSERT INTO royalty_contracts (company_id, valid_from, valid_to, revenue_base, vat_rate, marketing_fee_pct, tier_mode, tier_basis,
      tiers, min_monthly_fee, include_channels, payment_days, invoice_vat_rate, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
  [d.company_id, d.valid_from, d.valid_to || null, d.revenue_base, d.vat_rate, d.marketing_fee_pct, d.tier_mode, d.tier_basis,
    JSON.stringify(d.tiers), d.min_monthly_fee, d.include_channels, d.payment_days, d.invoice_vat_rate, d.notes || null]);
  await audit(req, 'CONTRACT_CREATE', 'contract', row.id, d);
  res.status(201).json(row);
}));

r.put('/contracts/:id', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const d = parse(contractSchema, req.body);
  try { d.tiers = normalizeTiers(d.tiers); } catch (e) { throw bad(e.message); }
  const used = await one(`SELECT count(*)::int AS n FROM royalty_statements WHERE contract_id=$1 AND status<>'ANNULLATO'`, [id]);
  if (used.n) throw bad('Contratto già usato per estratti emessi: chiudilo (data fine) e creane uno nuovo');
  await checkOverlap(d, id);
  await q(`UPDATE royalty_contracts SET company_id=$2, valid_from=$3, valid_to=$4, revenue_base=$5, vat_rate=$6, marketing_fee_pct=$7, tier_mode=$8,
      tier_basis=$9, tiers=$10, min_monthly_fee=$11, include_channels=$12, payment_days=$13, invoice_vat_rate=$14, notes=$15 WHERE id=$1`,
  [id, d.company_id, d.valid_from, d.valid_to || null, d.revenue_base, d.vat_rate, d.marketing_fee_pct, d.tier_mode, d.tier_basis,
    JSON.stringify(d.tiers), d.min_monthly_fee, d.include_channels, d.payment_days, d.invoice_vat_rate, d.notes || null]);
  await audit(req, 'CONTRACT_UPDATE', 'contract', id, d);
  res.json({ ok: true });
}));

r.post('/contracts/:id/close', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ valid_to: isoDate }), req.body);
  await q('UPDATE royalty_contracts SET valid_to=$2 WHERE id=$1', [Number(req.params.id), d.valid_to]);
  await audit(req, 'CONTRACT_CLOSE', 'contract', req.params.id, d);
  res.json({ ok: true });
}));

// ------------- Calcolo -------------
async function revenue(companyId, from, to) {
  const rep = await one(`SELECT coalesce(sum(r.cash_to_deposit + r.pos_total + r.transfer_total),0) AS gross,
      count(*) FILTER (WHERE r.status='DRAFT')::int AS drafts
    FROM cash_reports r JOIN sites s ON s.id=r.site_id WHERE s.company_id=$1 AND r.report_date BETWEEN $2 AND $3`, [companyId, from, to]);
  const ch = await one(`SELECT coalesce(sum(gross_amount),0) AS gross, coalesce(sum(franchisor_share),0) AS withheld
    FROM channel_revenues WHERE company_id=$1 AND rev_date BETWEEN $2 AND $3`, [companyId, from, to]);
  return { gross: Number(rep.gross), drafts: rep.drafts, channelsGross: Number(ch.gross), withheld: Number(ch.withheld) };
}

async function calc(companyId, p) {
  const { start, end, year } = monthRange(p);
  const contract = await one(`SELECT * FROM royalty_contracts WHERE company_id=$1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to >= $3)
    ORDER BY valid_from DESC LIMIT 1`, [companyId, start, end]);
  if (!contract) return { error: 'Nessun contratto royalty valido per il periodo' };
  const rev = await revenue(companyId, start, end);
  let ytdBefore = 0;
  if (contract.tier_basis === 'ANNUO_PROGRESSIVO' && start > `${year}-01-01`) {
    const from = contract.valid_from > `${year}-01-01` ? contract.valid_from : `${year}-01-01`;
    const prevEnd = new Date(new Date(start).getTime() - 86400000).toISOString().slice(0, 10);
    const y = await revenue(companyId, from, prevEnd);
    const g = y.gross + (contract.include_channels ? y.channelsGross : 0);
    ytdBefore = contract.revenue_base === 'NETTO' ? r2(g / (1 + Number(contract.vat_rate) / 100)) : g;
  }
  const res = computeRoyalty(contract, { gross: rev.gross, channelsGross: rev.channelsGross, withheld: rev.withheld, ytdBefore });
  return { contract, period_start: start, period_end: end, drafts: rev.drafts, ...res };
}

r.post('/preview', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ company_id: z.number().int(), period }), req.body);
  assertCompany(req.user, d.company_id);
  res.json(await calc(d.company_id, d.period));
}));

r.post('/statements', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ period, company_ids: z.array(z.number().int()).optional() }), req.body);
  const { start, end } = monthRange(d.period);
  if (end >= todayRome()) throw bad('Il periodo non è ancora concluso');
  const companies = await many(`SELECT DISTINCT c.id, c.name FROM companies c JOIN royalty_contracts k ON k.company_id=c.id
    WHERE c.active AND ($1::int[] IS NULL OR c.id = ANY($1))`, [d.company_ids?.length ? d.company_ids : null]);
  const prefix = (await getSetting('royalty_invoice_prefix', 'RY')) || 'RY';
  const results = [];
  for (const c of companies) {
    const ex = await one(`SELECT number FROM royalty_statements WHERE company_id=$1 AND period_start=$2 AND period_end=$3 AND status<>'ANNULLATO'`, [c.id, start, end]);
    if (ex) { results.push({ company: c.name, skipped: `già emesso ${ex.number}` }); continue; }
    const k = await calc(c.id, d.period);
    if (k.error) { results.push({ company: c.name, skipped: k.error }); continue; }
    const row = await tx(async (cl) => {
      await cl.query('LOCK TABLE royalty_statements IN SHARE ROW EXCLUSIVE MODE');
      const year = start.slice(0, 4);
      const seq = (await cl.query(`SELECT count(*)::int + 1 AS n FROM royalty_statements WHERE number LIKE $1`, [`${prefix}${year}-%`])).rows[0].n;
      const number = `${prefix}${year}-${String(seq).padStart(4, '0')}`;
      const due = new Date(new Date(todayRome()).getTime() + k.contract.payment_days * 86400000).toISOString().slice(0, 10);
      return (await cl.query(`INSERT INTO royalty_statements (number, company_id, contract_id, period_start, period_end, gross_revenue, base_revenue,
          royalty_amount, marketing_amount, vat_amount, withheld_amount, total_due, details, due_date, created_by, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, number`,
      [number, c.id, k.contract.id, start, end, k.gross_revenue, k.base_revenue, k.royalty_amount, k.marketing_amount, k.vat_amount,
        k.withheld_amount, k.total_due, JSON.stringify({ ...k.details, drafts_at_issue: k.drafts }), due, req.user.id,
        k.total_due > 0 ? 'EMESSO' : 'PAGATO'])).rows[0];
    });
    results.push({ company: c.name, number: row.number, total_due: k.total_due, drafts_warning: k.drafts || 0 });
  }
  await audit(req, 'ROYALTY_ISSUE', 'period', d.period, results);
  res.json(results);
}));

r.get('/statements', ah(async (req, res) => {
  if (!['SUPERADMIN', 'ADMIN'].includes(req.user.role)) return res.json([]);
  const P = new Params();
  const where = [isSuper(req.user) ? 'TRUE' : `st.company_id = ${P.add(req.user.company_id)}`];
  if (req.query.company_id) where.push(`st.company_id = ${P.add(Number(req.query.company_id))}`);
  if (req.query.status) where.push(`st.status = ANY(${P.add(String(req.query.status).split(','))})`);
  res.json(await many(`SELECT st.*, c.name AS company_name, c.iban IS NOT NULL AND c.sepa_mandate_id IS NOT NULL AS has_mandate, b.msg_id
    FROM royalty_statements st JOIN companies c ON c.id=st.company_id LEFT JOIN sepa_batches b ON b.id=st.sepa_batch_id
    WHERE ${where.join(' AND ')} ORDER BY st.period_start DESC, c.name`, P.values));
}));

r.post('/statements/:id/status', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ status: z.enum(['PAGATO', 'INSOLUTO', 'ANNULLATO', 'EMESSO']), paid_at: isoDate.optional() }), req.body);
  const st = await one('SELECT * FROM royalty_statements WHERE id=$1', [Number(req.params.id)]);
  if (!st) throw notFound();
  if (st.status === 'ANNULLATO') throw bad('Estratto annullato');
  if (d.status === 'ANNULLATO' && st.status === 'PAGATO') throw bad('Un estratto pagato non si annulla: emetti una nota di credito fuori sistema');
  await q('UPDATE royalty_statements SET status=$2, paid_at=$3 WHERE id=$1', [st.id, d.status, d.status === 'PAGATO' ? (d.paid_at || todayRome()) : null]);
  await audit(req, 'ROYALTY_STATUS', 'statement', st.id, d);
  res.json({ ok: true });
}));

r.get('/statements/:id/pdf', ah(async (req, res) => {
  const st = await one(`SELECT st.*, k.revenue_base, k.marketing_fee_pct, k.invoice_vat_rate FROM royalty_statements st
    JOIN royalty_contracts k ON k.id=st.contract_id WHERE st.id=$1`, [Number(req.params.id)]);
  if (!st) throw notFound();
  if (!['SUPERADMIN', 'ADMIN'].includes(req.user.role)) throw notFound();
  assertCompany(req.user, st.company_id);
  const franchisor = await one('SELECT * FROM companies WHERE is_franchisor ORDER BY id LIMIT 1');
  const debtor = await one('SELECT * FROM companies WHERE id=$1', [st.company_id]);
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  res.type('application/pdf').set('Content-Disposition', `inline; filename="Estratto_${st.number}.pdf"`);
  doc.pipe(res);
  letterhead(doc, franchisor);
  let y = CONTENT_TOP;
  doc.rect(M.left, y, W, 26).fill(C.teal);
  doc.font('B').fontSize(13).fillColor('#FFFFFF').text(`ESTRATTO ROYALTY ${st.number}`, M.left + 10, y + 7);
  y += 40;
  doc.font('R').fontSize(9).fillColor(C.jet);
  const kv = [['Affiliato', `${debtor.name}${debtor.vat_number ? `, P.IVA ${debtor.vat_number}` : ''}`],
    ['Periodo', `${itDate(st.period_start)} - ${itDate(st.period_end)}`], ['Emesso il', itDate(st.created_at.toISOString())],
    ['Scadenza', itDate(st.due_date)], ['Stato', st.status]];
  for (const [k, v] of kv) { doc.font('R').fillColor(C.grey).text(k, M.left, y); doc.font('B').fillColor(C.jet).text(v, M.left + 90, y); y += 15; }
  y += 10;
  const lines = [
    ['Fatturato registrato (rendiconti)', eur(st.details?.reports_gross ?? st.gross_revenue)],
    ['Incassi canali digitali', eur(st.details?.channels_gross ?? 0)],
    [`Base di calcolo (${st.revenue_base.toLowerCase()})`, eur(st.base_revenue)],
    [`Royalty${st.details?.min_fee_applied ? ' (minimo contrattuale)' : ` (aliquota effettiva ${st.details?.applied_rate ?? '-'}%)`}`, eur(st.royalty_amount)],
    [`Fee marketing (${st.marketing_fee_pct}%)`, eur(st.marketing_amount)],
    [`IVA ${st.invoice_vat_rate}%`, eur(st.vat_amount)],
    ['Già trattenuto alla fonte (split payment)', `– ${eur(st.withheld_amount)}`],
  ];
  for (const [k, v] of lines) {
    doc.font('R').fontSize(9.5).fillColor(C.jet).text(k, M.left + 6, y + 4);
    doc.text(v, M.left, y + 4, { width: W - 6, align: 'right' });
    y += 20; doc.moveTo(M.left, y).lineTo(M.left + W, y).lineWidth(0.4).strokeColor(C.line).stroke();
  }
  doc.rect(M.left, y, W, 24).fill(C.silk);
  doc.font('B').fontSize(11).fillColor(C.jet).text('TOTALE DA ADDEBITARE', M.left + 6, y + 7);
  doc.text(eur(st.total_due), M.left, y + 7, { width: W - 6, align: 'right' });
  y += 40;
  doc.font('R').fontSize(8).fillColor(C.grey).text(
    `Addebito tramite SEPA Direct Debit sul conto ${debtor.iban || 'da comunicare'}${debtor.sepa_mandate_id ? `, mandato ${debtor.sepa_mandate_id}` : ''}. ` +
    'Documento di riepilogo del calcolo contrattuale: la fattura elettronica è emessa tramite SDI dal gestionale contabile.', M.left, y, { width: W });
  doc.end();
}));

// ------------- SEPA Direct Debit -------------
r.get('/sepa/batches', requireRole('SUPERADMIN'), ah(async (_req, res) => {
  res.json(await many(`SELECT b.id, b.msg_id, b.collection_date, b.tx_count, b.total_amount, b.status, b.created_at, u.full_name AS created_by_name
    FROM sepa_batches b LEFT JOIN users u ON u.id=b.created_by ORDER BY b.created_at DESC`));
}));

r.post('/sepa/batches', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ statement_ids: z.array(z.number().int()).min(1), collection_date: isoDate }), req.body);
  const minDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  if (d.collection_date < minDate) throw bad(`Data di addebito troppo vicina: minimo ${itDate(minDate)} (verifica i tempi richiesti dalla banca)`);
  const creditor = {
    name: await getSetting('creditor_name'), iban: await getSetting('creditor_iban'),
    bic: await getSetting('creditor_bic'), id: await getSetting('creditor_id'),
  };
  if (!creditor.name || !creditor.iban || !creditor.id) throw bad('Completa i dati del creditore SEPA in Impostazioni (ragione sociale, IBAN, Creditor Identifier)');
  if (!ibanValid(creditor.iban)) throw bad('IBAN del creditore non valido');
  const sts = await many(`SELECT st.*, c.name AS company_name, c.iban, c.bic, c.sepa_mandate_id, c.sepa_mandate_date, c.sepa_first_done
    FROM royalty_statements st JOIN companies c ON c.id=st.company_id WHERE st.id = ANY($1)`, [d.statement_ids]);
  const errors = [];
  for (const s of sts) {
    if (!['EMESSO', 'INSOLUTO'].includes(s.status)) errors.push(`${s.number}: stato ${s.status}`);
    if (!s.iban || !ibanValid(s.iban)) errors.push(`${s.company_name}: IBAN mancante o non valido`);
    if (!s.sepa_mandate_id || !s.sepa_mandate_date) errors.push(`${s.company_name}: mandato SEPA mancante`);
    if (Number(s.total_due) <= 0) errors.push(`${s.number}: importo nullo`);
  }
  if (sts.length !== d.statement_ids.length) errors.push('Alcuni estratti non esistono');
  if (errors.length) throw bad(errors.join('; '));
  const msgId = newMsgId();
  const firstSeen = new Set();
  const items = sts.map((s) => {
    const seq = s.sepa_first_done || firstSeen.has(s.company_id) ? 'RCUR' : 'FRST';
    firstSeen.add(s.company_id);
    return {
      endToEndId: `${s.number}`.slice(0, 35), amount: s.total_due, mandateId: s.sepa_mandate_id, mandateDate: s.sepa_mandate_date,
      seqType: seq, debtorName: s.company_name, debtorIban: s.iban, debtorBic: s.bic,
      remittance: `Royalty ${s.number} periodo ${itDate(s.period_start)}-${itDate(s.period_end)}`, statementId: s.id, companyId: s.company_id,
    };
  });
  const xml = buildPain008({ msgId, creditor, collectionDate: d.collection_date, items });
  const total = r2(items.reduce((a, i) => a + Number(i.amount), 0));
  const batch = await tx(async (c) => {
    const b = (await c.query(`INSERT INTO sepa_batches (msg_id, collection_date, tx_count, total_amount, xml, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [msgId, d.collection_date, items.length, total, xml, req.user.id])).rows[0];
    for (const i of items) {
      await c.query(`UPDATE royalty_statements SET status='IN_ADDEBITO', sepa_batch_id=$2, sepa_end_to_end=$3 WHERE id=$1`, [i.statementId, b.id, i.endToEndId]);
      await c.query('UPDATE companies SET sepa_first_done=TRUE WHERE id=$1', [i.companyId]);
    }
    return b;
  });
  await audit(req, 'SEPA_BATCH', 'sepa', batch.id, { msgId, total, n: items.length });
  res.status(201).json({ id: batch.id, msg_id: msgId, total, count: items.length });
}));

r.get('/sepa/batches/:id/xml', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const b = await one('SELECT msg_id, xml FROM sepa_batches WHERE id=$1', [Number(req.params.id)]);
  if (!b) throw notFound();
  res.type('application/xml').set('Content-Disposition', `attachment; filename="${b.msg_id}.xml"`).send(b.xml);
}));

r.post('/sepa/batches/:id/status', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ status: z.enum(['INVIATO', 'ESITATO']) }), req.body);
  await q('UPDATE sepa_batches SET status=$2 WHERE id=$1', [Number(req.params.id), d.status]);
  await audit(req, 'SEPA_STATUS', 'sepa', req.params.id, d);
  res.json({ ok: true });
}));

export default r;
