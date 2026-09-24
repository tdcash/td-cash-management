import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, todayRome, eur, itDate } from '../lib/util.js';
import { Params, siteScope, assertSite, isAdmin, requireRole } from '../lib/access.js';
import { BANKNOTES, CIRCUITS, computeTotals, STATUS_LABEL } from '../lib/cash.js';
import { buildSlipPdf } from '../pdf/distinta.js';
import crypto from 'node:crypto';

const r = Router();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ENVELOPE_RE = /^[A-Za-z0-9-]{6,40}$/;

async function event(c, reportId, ev, detail, userId) {
  await c.query('INSERT INTO report_events (report_id, event, detail, user_id) VALUES ($1,$2,$3,$4)', [reportId, ev, detail || null, userId]);
}

async function loadReport(user, id) {
  const rep = await one(`SELECT r.*, s.company_id, s.name AS site_name, s.code AS site_code FROM cash_reports r
    JOIN sites s ON s.id=r.site_id WHERE r.id=$1`, [id]);
  if (!rep) throw notFound('Rendiconto non trovato');
  await assertSite(user, rep.site_id);
  return rep;
}

async function fullReport(id) {
  const rep = await one(`SELECT r.id, r.site_id, r.report_date, r.status, r.cash_float, r.coins_total, r.cash_counted, r.cash_to_deposit,
      r.pos_total, r.transfer_total, r.expected_total, r.envelope_code, r.envelope_at, r.slip_number, r.slip_revision, r.slip_sha256,
      r.processed_at, r.pickup_operator, r.pickup_at, r.deposit_amount, r.deposit_date, r.notes, r.created_at, r.updated_at,
      (r.slip_pdf IS NOT NULL) AS has_pdf,
      s.name AS site_name, s.code AS site_code, s.company_id, c.name AS company_name, c.code AS company_code,
      pu.full_name AS processed_by_name, cu.full_name AS created_by_name
    FROM cash_reports r JOIN sites s ON s.id=r.site_id JOIN companies c ON c.id=s.company_id
    LEFT JOIN users pu ON pu.id=r.processed_by LEFT JOIN users cu ON cu.id=r.created_by WHERE r.id=$1`, [id]);
  const den = await many('SELECT denom, qty FROM report_denominations WHERE report_id=$1', [id]);
  rep.denominations = Object.fromEntries(BANKNOTES.map((d) => [d, den.find((x) => Number(x.denom) === d)?.qty || 0]));
  rep.receipts = await many('SELECT * FROM pos_receipts WHERE report_id=$1 ORDER BY id', [id]);
  rep.transfers = await many('SELECT * FROM bank_transfers WHERE report_id=$1 ORDER BY id', [id]);
  rep.events = await many(`SELECT e.*, u.full_name FROM report_events e LEFT JOIN users u ON u.id=e.user_id WHERE report_id=$1 ORDER BY at`, [id]);
  rep.nonconformities = await many('SELECT id, kind, severity, title, status, created_at FROM nonconformities WHERE report_id=$1 ORDER BY id', [id]);
  Object.assign(rep, { notes_total: computeTotals(rep).notes_total, day_total: Number(rep.cash_to_deposit) + Number(rep.pos_total) + Number(rep.transfer_total) });
  rep.difference = rep.expected_total == null ? null : Number((rep.day_total - rep.expected_total).toFixed(2));
  return rep;
}

r.get('/', ah(async (req, res) => {
  const P = new Params();
  const where = [siteScope(req.user, P)];
  const { site_id, company_id, status, from, to } = req.query;
  if (site_id) where.push(`r.site_id = ${P.add(Number(site_id))}`);
  if (company_id) where.push(`s.company_id = ${P.add(Number(company_id))}`);
  if (status) where.push(`r.status = ANY(${P.add(String(status).split(','))})`);
  if (from) where.push(`r.report_date >= ${P.add(from)}`);
  if (to) where.push(`r.report_date <= ${P.add(to)}`);
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  res.json(await many(`SELECT r.id, r.site_id, r.report_date, r.status, r.cash_counted, r.cash_float, r.cash_to_deposit, r.pos_total, r.transfer_total,
      r.expected_total, r.envelope_code, r.slip_number, r.pickup_at, r.deposit_amount, r.deposit_date,
      (r.cash_to_deposit + r.pos_total + r.transfer_total) AS day_total,
      s.name AS site_name, s.code AS site_code, c.name AS company_name, c.id AS company_id,
      (SELECT count(*)::int FROM nonconformities n WHERE n.report_id=r.id AND n.status<>'CHIUSA') AS open_nc
    FROM cash_reports r JOIN sites s ON s.id=r.site_id JOIN companies c ON c.id=s.company_id
    WHERE ${where.join(' AND ')} ORDER BY r.report_date DESC, s.name LIMIT ${limit}`, P.values));
}));

r.get('/:id', ah(async (req, res) => {
  await loadReport(req.user, Number(req.params.id));
  res.json(await fullReport(Number(req.params.id)));
}));

r.post('/', ah(async (req, res) => {
  const d = parse(z.object({ site_id: z.number().int(), report_date: isoDate }), req.body);
  const site = await assertSite(req.user, d.site_id);
  if (!site.active) throw bad('Sede non attiva');
  if (d.report_date > todayRome()) throw bad('Non si può rendicontare una data futura');
  const ex = await one('SELECT id FROM cash_reports WHERE site_id=$1 AND report_date=$2', [d.site_id, d.report_date]);
  if (ex) return res.status(409).json({ error: 'Esiste già un rendiconto per questa sede e data', id: ex.id });
  const row = await tx(async (c) => {
    const rep = (await c.query(`INSERT INTO cash_reports (site_id, report_date, cash_float, cash_to_deposit, created_by, updated_by)
      VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`, [d.site_id, d.report_date, site.cash_float, -Number(site.cash_float), req.user.id])).rows[0];
    await event(c, rep.id, 'CREATO', `Fondo cassa ${eur(site.cash_float)}`, req.user.id);
    return rep;
  });
  await audit(req, 'REPORT_CREATE', 'report', row.id, d);
  res.status(201).json(row);
}));

const money = z.number().min(0).max(10_000_000);
const updateSchema = z.object({
  denominations: z.record(z.string(), z.number().int().min(0).max(100000)).default({}),
  coins_total: money.default(0),
  expected_total: money.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  receipts: z.array(z.object({
    terminal_id: z.string().max(40).nullable().optional(),
    receipt_number: z.string().max(40).nullable().optional(),
    circuit: z.enum(CIRCUITS),
    amount: z.number().positive().max(1_000_000),
    auth_code: z.string().max(40).nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  })).max(2000).default([]),
  transfers: z.array(z.object({
    cro: z.string().min(5, 'CRO/TRN troppo corto').max(40),
    amount: z.number().positive().max(10_000_000),
    payer: z.string().max(120).nullable().optional(),
    value_date: isoDate.nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  })).max(500).default([]),
});

r.put('/:id', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'DRAFT') throw bad('Il rendiconto non è in bozza: sbloccalo o chiedi la riapertura a un amministratore');
  const d = parse(updateSchema, req.body);
  for (const k of Object.keys(d.denominations)) if (!BANKNOTES.includes(Number(k))) throw bad(`Taglio non ammesso: ${k}`);
  const cros = d.transfers.map((t) => t.cro.trim().toUpperCase());
  if (new Set(cros).size !== cros.length) throw bad('CRO duplicato nello stesso rendiconto');
  if (cros.length) {
    const dup = await one(`SELECT t.cro, r.report_date FROM bank_transfers t JOIN cash_reports r ON r.id=t.report_id
      WHERE upper(t.cro) = ANY($1) AND t.report_id <> $2 LIMIT 1`, [cros, rep.id]);
    if (dup) throw bad(`CRO ${dup.cro} già registrato nel rendiconto del ${dup.report_date}`);
  }
  const t = computeTotals({ ...d, cash_float: rep.cash_float });
  await tx(async (c) => {
    await c.query('DELETE FROM report_denominations WHERE report_id=$1', [rep.id]);
    for (const den of BANKNOTES) {
      const qty = Number(d.denominations[den] || 0);
      if (qty) await c.query('INSERT INTO report_denominations (report_id, denom, qty) VALUES ($1,$2,$3)', [rep.id, den, qty]);
    }
    await c.query('DELETE FROM pos_receipts WHERE report_id=$1', [rep.id]);
    for (const x of d.receipts) {
      await c.query('INSERT INTO pos_receipts (report_id, terminal_id, receipt_number, circuit, amount, auth_code, note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [rep.id, x.terminal_id || null, x.receipt_number || null, x.circuit, x.amount, x.auth_code || null, x.note || null]);
    }
    await c.query('DELETE FROM bank_transfers WHERE report_id=$1', [rep.id]);
    for (const x of d.transfers) {
      await c.query('INSERT INTO bank_transfers (report_id, cro, amount, payer, value_date, note) VALUES ($1,$2,$3,$4,$5,$6)',
        [rep.id, x.cro.trim().toUpperCase(), x.amount, x.payer || null, x.value_date || null, x.note || null]);
    }
    await c.query(`UPDATE cash_reports SET coins_total=$2, cash_counted=$3, cash_to_deposit=$4, pos_total=$5, transfer_total=$6,
      expected_total=$7, notes=$8, updated_by=$9, updated_at=now() WHERE id=$1`,
    [rep.id, d.coins_total, t.cash_counted, t.cash_to_deposit, t.pos_total, t.transfer_total, d.expected_total ?? null, d.notes ?? null, req.user.id]);
  });
  res.json(await fullReport(rep.id));
}));

// Registrazione busta Mondialpol: DRAFT -> CLOSED
r.post('/:id/envelope', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'DRAFT') throw bad('Busta già registrata');
  if (Number(rep.cash_to_deposit) < 0) throw bad(`Il contante contato è inferiore al fondo cassa di ${eur(-rep.cash_to_deposit)}: verifica il conteggio o apri una non conformità`);
  const needsEnvelope = Number(rep.cash_to_deposit) > 0;
  let code = null;
  if (needsEnvelope) {
    const d = parse(z.object({ code: z.string().trim(), confirm: z.string().trim() }), req.body);
    code = d.code.toUpperCase();
    if (!ENVELOPE_RE.test(code)) throw bad('Codice busta non valido: 6-40 caratteri, lettere, numeri o trattino');
    if (code !== d.confirm.toUpperCase()) throw bad('I due codici busta non coincidono');
    const dup = await one('SELECT r.report_date, s.name FROM cash_reports r JOIN sites s ON s.id=r.site_id WHERE envelope_code=$1', [code]);
    if (dup) throw bad(`Busta ${code} già usata: ${dup.name}, ${dup.report_date}`);
  }
  await tx(async (c) => {
    await c.query(`UPDATE cash_reports SET status='CLOSED', envelope_code=$2, envelope_at=now(), envelope_by=$3, updated_at=now() WHERE id=$1`, [rep.id, code, req.user.id]);
    await event(c, rep.id, 'BUSTA_REGISTRATA', code ? `Busta Mondialpol ${code}, importo ${eur(rep.cash_to_deposit)}` : 'Nessun contante da versare', req.user.id);
  });
  await audit(req, 'REPORT_ENVELOPE', 'report', rep.id, { code });
  res.json(await fullReport(rep.id));
}));

// Sblocco (prima dell'elaborazione): CLOSED -> DRAFT
r.post('/:id/unlock', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'CLOSED') throw bad('Sblocco possibile solo prima di elaborare la distinta');
  await tx(async (c) => {
    await c.query(`UPDATE cash_reports SET status='DRAFT', envelope_code=NULL, envelope_at=NULL, envelope_by=NULL, updated_at=now() WHERE id=$1`, [rep.id]);
    await event(c, rep.id, 'SBLOCCATO', `Annullata registrazione busta ${rep.envelope_code || ''}`.trim(), req.user.id);
  });
  await audit(req, 'REPORT_UNLOCK', 'report', rep.id);
  res.json(await fullReport(rep.id));
}));

// Elaborazione distinta PDF: CLOSED -> PROCESSED
r.post('/:id/process', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'CLOSED') throw bad('Per elaborare la distinta registra prima la busta Mondialpol');
  const full = await fullReport(rep.id);
  const company = await one('SELECT * FROM companies WHERE id=$1', [full.company_id]);
  const site = await one('SELECT * FROM sites WHERE id=$1', [full.site_id]);
  const revision = rep.slip_revision + 1;
  const number = `${company.code}-${site.code}-${full.report_date.replaceAll('-', '')}`;
  const processedAt = new Date();
  const pdf = await buildSlipPdf({ report: full, company, site, number, revision, processedBy: req.user.full_name, processedAt });
  const sha = crypto.createHash('sha256').update(pdf).digest('hex');
  await tx(async (c) => {
    await c.query(`UPDATE cash_reports SET status='PROCESSED', slip_number=$2, slip_revision=$3, slip_pdf=$4, slip_sha256=$5,
      processed_by=$6, processed_at=$7, updated_at=now() WHERE id=$1`, [rep.id, number, revision, pdf, sha, req.user.id, processedAt]);
    await event(c, rep.id, 'DISTINTA_ELABORATA', `Distinta ${number} rev. ${revision}`, req.user.id);
  });
  await audit(req, 'REPORT_PROCESS', 'report', rep.id, { number, revision, sha });
  res.json(await fullReport(rep.id));
}));

r.get('/:id/pdf', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (!rep.slip_pdf) throw notFound('Distinta non ancora elaborata');
  res.type('application/pdf')
    .set('Content-Disposition', `inline; filename="Distinta_${rep.slip_number}_rev${rep.slip_revision}.pdf"`)
    .send(rep.slip_pdf);
}));

// Ritiro da parte dell'operatore di logistica: PROCESSED -> PICKED_UP
r.post('/:id/pickup', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'PROCESSED') throw bad('Il ritiro si registra dopo l\'elaborazione della distinta');
  const d = parse(z.object({ operator_name: z.string().trim().min(3).max(120), picked_at: z.string().datetime({ offset: true }).optional() }), req.body);
  const at = d.picked_at ? new Date(d.picked_at) : new Date();
  if (at > new Date(Date.now() + 5 * 60000)) throw bad('Data di ritiro nel futuro');
  await tx(async (c) => {
    await c.query(`UPDATE cash_reports SET status='PICKED_UP', pickup_operator=$2, pickup_at=$3, pickup_registered_by=$4, updated_at=now() WHERE id=$1`,
      [rep.id, d.operator_name, at, req.user.id]);
    await event(c, rep.id, 'RITIRATA', `Operatore logistica: ${d.operator_name}`, req.user.id);
  });
  await audit(req, 'REPORT_PICKUP', 'report', rep.id, d);
  res.json(await fullReport(rep.id));
}));

// Conferma accredito in banca (amministratori): PICKED_UP -> DEPOSITED
r.post('/:id/deposit', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'PICKED_UP' && !(rep.status === 'PROCESSED' && Number(rep.cash_to_deposit) === 0)) throw bad('Conferma possibile solo dopo il ritiro della busta');
  const d = parse(z.object({ amount: z.number().min(0), date: isoDate }), req.body);
  const diff = Number((d.amount - Number(rep.cash_to_deposit)).toFixed(2));
  await tx(async (c) => {
    await c.query(`UPDATE cash_reports SET status='DEPOSITED', deposit_amount=$2, deposit_date=$3, deposit_confirmed_by=$4, updated_at=now() WHERE id=$1`,
      [rep.id, d.amount, d.date, req.user.id]);
    await event(c, rep.id, 'VERSATA', `Accredito ${eur(d.amount)} del ${itDate(d.date)}${diff ? `, differenza ${eur(diff)}` : ''}`, req.user.id);
    if (diff !== 0) {
      const nc = (await c.query(`INSERT INTO nonconformities (company_id, site_id, report_id, kind, severity, title, description, created_by)
        VALUES ($1,$2,$3,'ERRORE',$4,$5,$6,$7) RETURNING id`,
      [rep.company_id, rep.site_id, rep.id, Math.abs(diff) >= 50 ? 'ALTA' : 'MEDIA',
        `Differenza di versamento ${eur(diff)}`,
        `Busta ${rep.envelope_code}: distinta ${eur(rep.cash_to_deposit)}, accreditato ${eur(d.amount)} il ${itDate(d.date)}. Differenza ${eur(diff)}. Generata automaticamente alla conferma dell'accredito.`,
        req.user.id])).rows[0];
      await event(c, rep.id, 'NC_AUTOMATICA', `Aperta non conformità #${nc.id}`, req.user.id);
    }
  });
  await audit(req, 'REPORT_DEPOSIT', 'report', rep.id, { ...d, diff });
  res.json(await fullReport(rep.id));
}));

// Riapertura (amministratori), solo prima del ritiro
r.post('/:id/reopen', requireRole('SUPERADMIN', 'ADMIN'), ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (!['CLOSED', 'PROCESSED'].includes(rep.status)) throw bad('Riapertura possibile solo prima del ritiro. Dopo il ritiro le correzioni si gestiscono con una non conformità.');
  const d = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
  await tx(async (c) => {
    await c.query(`UPDATE cash_reports SET status='DRAFT', envelope_code=NULL, envelope_at=NULL, envelope_by=NULL,
      slip_pdf=NULL, processed_at=NULL, processed_by=NULL, updated_at=now() WHERE id=$1`, [rep.id]);
    await event(c, rep.id, 'RIAPERTO', `${d.reason}${rep.slip_number ? ` (annullata distinta rev. ${rep.slip_revision}, busta ${rep.envelope_code || '-'})` : ''}`, req.user.id);
  });
  await audit(req, 'REPORT_REOPEN', 'report', rep.id, d);
  res.json(await fullReport(rep.id));
}));

r.delete('/:id', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'DRAFT' || rep.slip_revision > 0) throw bad('Si possono eliminare solo bozze mai elaborate');
  if (!isAdmin(req.user) && rep.created_by !== req.user.id) throw forbidden('Solo chi ha creato la bozza o un amministratore può eliminarla');
  await q('DELETE FROM cash_reports WHERE id=$1', [rep.id]);
  await audit(req, 'REPORT_DELETE', 'report', rep.id, { site_id: rep.site_id, date: rep.report_date });
  res.json({ ok: true });
}));

export { STATUS_LABEL };
export default r;
