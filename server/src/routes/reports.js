import { Router } from 'express';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse, todayRome, eur, itDate } from '../lib/util.js';
import { Params, siteScope, assertSite, isAdmin, requireRole, REVIEW_ROLES, canCount } from '../lib/access.js';
import { BANKNOTES, COINS, DENOMS, dkey, CIRCUITS, computeTotals, STATUS_LABEL } from '../lib/cash.js';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { extractCashFigures } from '../lib/gestionale.js';
import { buildSlipPdf } from '../pdf/distinta.js';
import { buildCustodyPdf } from '../pdf/custodia.js';
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
  const rep = await one(`SELECT r.id, r.site_id, r.report_date, r.status, r.created_by, r.cash_float, r.coins_total, r.cash_counted, r.cash_to_deposit,
      r.pos_total, r.transfer_total, r.expected_total, r.expected_cash, r.expected_pos, r.expected_transfer, r.envelope_code, r.envelope_at,
      r.slip_number, r.slip_revision, r.slip_sha256, r.processed_at, r.pickup_operator, r.pickup_at,
      r.verified_amount, r.verified_at, r.verified_note, r.deposit_id, r.notes, r.created_at, r.updated_at,
      r.system_pdf_name, r.system_pdf_at, r.system_extracted, (r.system_pdf IS NOT NULL) AS has_system_pdf,
      (r.slip_pdf IS NOT NULL) AS has_pdf, vu.full_name AS verified_by_name, dep.number AS deposit_number, dep.status AS deposit_status,
      s.name AS site_name, s.code AS site_code, s.company_id, c.name AS company_name, c.code AS company_code,
      pu.full_name AS processed_by_name, cu.full_name AS created_by_name
    FROM cash_reports r JOIN sites s ON s.id=r.site_id JOIN companies c ON c.id=s.company_id
    LEFT JOIN users pu ON pu.id=r.processed_by LEFT JOIN users cu ON cu.id=r.created_by LEFT JOIN users vu ON vu.id=r.verified_by
    LEFT JOIN cash_deposits dep ON dep.id=r.deposit_id WHERE r.id=$1`, [id]);
  const den = await many('SELECT denom, qty FROM report_denominations WHERE report_id=$1', [id]);
  rep.denominations = Object.fromEntries(DENOMS.map((d) => [dkey(d), den.find((x) => Number(x.denom) === d)?.qty || 0]));
  rep.receipts = await many('SELECT * FROM pos_receipts WHERE report_id=$1 ORDER BY id', [id]);
  rep.transfers = await many('SELECT * FROM bank_transfers WHERE report_id=$1 ORDER BY id', [id]);
  rep.events = await many(`SELECT e.*, u.full_name FROM report_events e LEFT JOIN users u ON u.id=e.user_id WHERE report_id=$1 ORDER BY at`, [id]);
  rep.nonconformities = await many('SELECT id, kind, severity, title, status, created_at FROM nonconformities WHERE report_id=$1 ORDER BY id', [id]);
  const t = computeTotals(rep);
  Object.assign(rep, { notes_total: t.notes_total, day_total: Number((Number(rep.cash_to_deposit) + Number(rep.pos_total) + Number(rep.transfer_total)).toFixed(2)) });
  rep.difference = rep.expected_total == null ? null : Number((rep.day_total - rep.expected_total).toFixed(2));
  rep.verified_difference = rep.verified_amount == null ? null : Number((rep.verified_amount - rep.cash_to_deposit).toFixed(2));
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
  res.json(await many(`SELECT r.id, r.site_id, r.report_date, r.status, r.created_by, r.cash_counted, r.cash_float, r.cash_to_deposit, r.pos_total, r.transfer_total,
      r.expected_total, r.envelope_code, r.slip_number, r.pickup_at, r.verified_amount, r.verified_at, r.deposit_id, dep.number AS deposit_number,
      (r.cash_to_deposit + r.pos_total + r.transfer_total) AS day_total,
      s.name AS site_name, s.code AS site_code, c.name AS company_name, c.id AS company_id,
      (SELECT count(*)::int FROM nonconformities n WHERE n.report_id=r.id AND n.status<>'CHIUSA') AS open_nc
    FROM cash_reports r JOIN sites s ON s.id=r.site_id JOIN companies c ON c.id=s.company_id LEFT JOIN cash_deposits dep ON dep.id=r.deposit_id
    WHERE ${where.join(' AND ')} ORDER BY r.report_date DESC, s.name LIMIT ${limit}`, P.values));
}));

r.get('/:id', ah(async (req, res) => {
  await loadReport(req.user, Number(req.params.id));
  res.json(await fullReport(Number(req.params.id)));
}));

// Fase di conteggio (bozza, busta, distinta, PDF gestionale): operatori e amministratori. Cassiere e Finance non compilano.
const countOnly = (req, _res, next) => (canCount(req.user) ? next() : next(forbidden('La compilazione del rendiconto è riservata agli operatori di sede')));
r.use((req, _res, next) => (req.user.role === 'FINANCE' && req.method !== 'GET' ? next(forbidden('Il profilo Finance consulta i rendiconti in sola lettura')) : next()));

r.post('/', countOnly, ah(async (req, res) => {
  const d = parse(z.object({ site_id: z.number().int(), report_date: isoDate }), req.body);
  const site = await assertSite(req.user, d.site_id);
  if (!site.active) throw bad('Sede non attiva');
  if (d.report_date < site.start_date) throw bad(`La sede ${site.name} è operativa dal ${itDate(site.start_date)}: nessun rendiconto atteso prima`);
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
  expected_total: money.nullable().optional(),
  expected_cash: money.nullable().optional(),
  expected_pos: money.nullable().optional(),
  expected_transfer: money.nullable().optional(),
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

r.put('/:id', countOnly, ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'DRAFT') throw bad('Il rendiconto non è in bozza: sbloccalo o chiedi la riapertura a un amministratore');
  const d = parse(updateSchema, req.body);
  for (const k of Object.keys(d.denominations)) if (!DENOMS.includes(Number(k))) throw bad(`Taglio non ammesso: ${k}`);
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
    for (const den of DENOMS) {
      const qty = Number(d.denominations[dkey(den)] ?? d.denominations[den] ?? 0);
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
      expected_total=$7, expected_cash=$10, expected_pos=$11, expected_transfer=$12, notes=$8, updated_by=$9, updated_at=now() WHERE id=$1`,
    [rep.id, t.coins_total, t.cash_counted, t.cash_to_deposit, t.pos_total, t.transfer_total, d.expected_total ?? null, d.notes ?? null, req.user.id,
      d.expected_cash ?? null, d.expected_pos ?? null, d.expected_transfer ?? null]);
  });
  res.json(await fullReport(rep.id));
}));

// Registrazione busta Mondialpol: DRAFT -> CLOSED
r.post('/:id/envelope', countOnly, ah(async (req, res) => {
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
r.post('/:id/unlock', countOnly, ah(async (req, res) => {
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
r.post('/:id/process', countOnly, ah(async (req, res) => {
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

// Operazione logistica (amministratore di sede): PROCESSED -> PICKED_UP
// L'amministratore riceve la busta sigillata dalla logistica, la porta in cassaforte e registra chi l'ha consegnata.
r.post('/:id/pickup', requireRole(...REVIEW_ROLES), ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'PROCESSED') throw bad('L\'operazione logistica si registra dopo l\'elaborazione della distinta');
  const d = parse(z.object({ operator_name: z.string().trim().min(3).max(120), picked_at: z.string().datetime({ offset: true }).optional() }), req.body);
  const at = d.picked_at ? new Date(d.picked_at) : new Date();
  if (at > new Date(Date.now() + 5 * 60000)) throw bad('Data nel futuro');
  await tx(async (c) => {
    await c.query(`UPDATE cash_reports SET status='PICKED_UP', pickup_operator=$2, pickup_at=$3, pickup_registered_by=$4, updated_at=now() WHERE id=$1`,
      [rep.id, d.operator_name, at, req.user.id]);
    await event(c, rep.id, 'LOGISTICA', `Busta ricevuta in cassaforte. Operatore logistica: ${d.operator_name}`, req.user.id);
  });
  await audit(req, 'REPORT_PICKUP', 'report', rep.id, d);
  res.json(await fullReport(rep.id));
}));

// Riconteggio e verifica (amministratore di sede): PICKED_UP -> VERIFIED. Chiude il ciclo della rendicontazione.
r.post('/:id/verify', requireRole(...REVIEW_ROLES), ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'PICKED_UP' && !(rep.status === 'PROCESSED' && Number(rep.cash_to_deposit) === 0)) throw bad('Il riconteggio si registra dopo l\'operazione logistica');
  const d = parse(z.object({ amount: z.number().min(0), note: z.string().max(500).nullable().optional() }), req.body);
  const diff = Number((d.amount - Number(rep.cash_to_deposit)).toFixed(2));
  await tx(async (c) => {
    await c.query(`UPDATE cash_reports SET status='VERIFIED', verified_amount=$2, verified_at=now(), verified_by=$3, verified_note=$4, updated_at=now() WHERE id=$1`,
      [rep.id, d.amount, req.user.id, d.note || null]);
    await event(c, rep.id, 'VERIFICATO', `Riconteggio ${eur(d.amount)}${diff ? `, differenza ${eur(diff)}` : ', nessuna differenza'}${d.note ? `. ${d.note}` : ''}`, req.user.id);
    if (diff !== 0) {
      const nc = (await c.query(`INSERT INTO nonconformities (company_id, site_id, report_id, kind, severity, title, description, created_by)
        VALUES ($1,$2,$3,'ERRORE',$4,$5,$6,$7) RETURNING id`,
      [rep.company_id, rep.site_id, rep.id, Math.abs(diff) >= 50 ? 'ALTA' : 'MEDIA',
        `Differenza al riconteggio ${eur(diff)}`,
        `Busta ${rep.envelope_code || '-'}: distinta ${eur(rep.cash_to_deposit)}, riconteggiato ${eur(d.amount)}. Differenza ${eur(diff)}. Generata automaticamente al riconteggio.`,
        req.user.id])).rows[0];
      await event(c, rep.id, 'NC_AUTOMATICA', `Aperta non conformità #${nc.id}`, req.user.id);
    }
  });
  await audit(req, 'REPORT_VERIFY', 'report', rep.id, { ...d, diff });
  res.json(await fullReport(rep.id));
}));

// Annulla l'ultimo passaggio (amministratori): torna allo stato precedente, con motivazione
const PREV = { CLOSED: 'DRAFT', PROCESSED: 'CLOSED', PICKED_UP: 'PROCESSED', VERIFIED: 'PICKED_UP' };
r.post('/:id/undo', requireRole(...REVIEW_ROLES), ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  const d = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
  if (rep.status === 'DEPOSITED') throw bad('Rendiconto incluso in un versamento: annulla prima il versamento');
  const prev = PREV[rep.status];
  if (!prev) throw bad('Nessun passaggio da annullare');
  await tx(async (c) => {
    const sets = { updated_at: 'now()' };
    let detail = `${STATUS_LABEL[rep.status]} annullato, torna a ${STATUS_LABEL[prev]}. ${d.reason}`;
    if (rep.status === 'CLOSED') Object.assign(sets, { status: "'DRAFT'", envelope_code: 'NULL', envelope_at: 'NULL', envelope_by: 'NULL' });
    if (rep.status === 'PROCESSED') Object.assign(sets, { status: "'CLOSED'", slip_pdf: 'NULL', processed_at: 'NULL', processed_by: 'NULL' });
    if (rep.status === 'PICKED_UP') Object.assign(sets, { status: "'PROCESSED'", pickup_operator: 'NULL', pickup_at: 'NULL', pickup_registered_by: 'NULL' });
    if (rep.status === 'VERIFIED') Object.assign(sets, { status: "'PICKED_UP'", verified_amount: 'NULL', verified_at: 'NULL', verified_by: 'NULL', verified_note: 'NULL' });
    if (rep.status === 'VERIFIED' && Number(rep.cash_to_deposit) === 0 && !rep.pickup_at) sets.status = "'PROCESSED'";
    await c.query(`UPDATE cash_reports SET ${Object.entries(sets).map(([k, v]) => `${k}=${v}`).join(', ')} WHERE id=$1`, [rep.id]);
    await event(c, rep.id, 'ANNULLATO', detail, req.user.id);
  });
  await audit(req, 'REPORT_UNDO', 'report', rep.id, { from: rep.status, to: prev, reason: d.reason });
  res.json(await fullReport(rep.id));
}));

// Riapertura completa (amministratori), solo prima dell'operazione logistica
r.post('/:id/reopen', requireRole(...REVIEW_ROLES), ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (!['CLOSED', 'PROCESSED'].includes(rep.status)) throw bad('Riapertura completa possibile solo prima dell\'operazione logistica. Usa "Annulla ultimo passaggio".');
  const d = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
  await tx(async (c) => {
    await c.query(`UPDATE cash_reports SET status='DRAFT', envelope_code=NULL, envelope_at=NULL, envelope_by=NULL,
      slip_pdf=NULL, processed_at=NULL, processed_by=NULL, updated_at=now() WHERE id=$1`, [rep.id]);
    await event(c, rep.id, 'RIAPERTO', `${d.reason}${rep.slip_number ? ` (annullata distinta rev. ${rep.slip_revision}, busta ${rep.envelope_code || '-'})` : ''}`, req.user.id);
  });
  await audit(req, 'REPORT_REOPEN', 'report', rep.id, d);
  res.json(await fullReport(rep.id));
}));

// PDF del gestionale: caricamento, estrazione automatica degli importi, conferma
r.post('/:id/system-pdf', countOnly, upload.single('file'), ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'DRAFT') throw bad('Il file del gestionale si carica finché il rendiconto è in bozza');
  if (!req.file) throw bad('File mancante');
  if (req.file.mimetype !== 'application/pdf' && !req.file.originalname.toLowerCase().endsWith('.pdf')) throw bad('Serve un file PDF');
  let text = '';
  try {
    const parser = new PDFParse({ data: new Uint8Array(req.file.buffer) });
    text = (await parser.getText()).text || '';
    await parser.destroy();
  } catch { throw bad('PDF non leggibile'); }
  text = text.replace(/^-- \d+ of \d+ --$/gm, '');
  const extracted = extractCashFigures(text);
  await q(`UPDATE cash_reports SET system_pdf=$2, system_pdf_name=$3, system_pdf_at=now(), system_extracted=$4, updated_at=now() WHERE id=$1`,
    [rep.id, req.file.buffer, req.file.originalname, JSON.stringify(extracted)]);
  await q(`INSERT INTO report_events (report_id, event, detail, user_id) VALUES ($1,'GESTIONALE',$2,$3)`, [rep.id, `Caricato ${req.file.originalname}${extracted.total != null ? `, totale letto ${eur(extracted.total)}` : ', importi non riconosciuti'}`, req.user.id]);
  await audit(req, 'REPORT_SYSTEM_PDF', 'report', rep.id, { file: req.file.originalname, extracted });
  res.json({ extracted, report: await fullReport(rep.id) });
}));

r.get('/:id/system-pdf', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  const row = await one('SELECT system_pdf, system_pdf_name FROM cash_reports WHERE id=$1', [rep.id]);
  if (!row?.system_pdf) throw notFound('Nessun file del gestionale');
  res.type('application/pdf').set('Content-Disposition', `inline; filename="${row.system_pdf_name || 'gestionale.pdf'}"`).send(row.system_pdf);
}));

r.delete('/:id/system-pdf', countOnly, ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (rep.status !== 'DRAFT') throw bad('Modificabile solo in bozza');
  await q('UPDATE cash_reports SET system_pdf=NULL, system_pdf_name=NULL, system_pdf_at=NULL, system_extracted=NULL WHERE id=$1', [rep.id]);
  res.json({ ok: true });
}));

// Eliminazione: l'amministratore può eliminare qualsiasi rendiconto con motivazione; l'operatore solo le proprie bozze mai elaborate
r.delete('/:id', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  const reason = String(req.body?.reason || req.query.reason || '').trim();
  if (rep.status === 'DEPOSITED') throw bad('Rendiconto incluso in un versamento: annulla prima il versamento');
  if (isAdmin(req.user)) {
    if (rep.status !== 'DRAFT' && reason.length < 5) throw bad('Indica la motivazione dell\'eliminazione (almeno 5 caratteri)');
  } else {
    if (rep.status !== 'DRAFT' || rep.slip_revision > 0) throw bad('Puoi eliminare solo bozze mai elaborate. Per gli altri casi chiedi a un amministratore.');
    if (rep.created_by !== req.user.id) throw forbidden('Solo chi ha creato la bozza o un amministratore può eliminarla');
  }
  const snapshot = await fullReport(rep.id);
  delete snapshot.events;
  await q('DELETE FROM cash_reports WHERE id=$1', [rep.id]);
  await audit(req, 'REPORT_DELETE', 'report', rep.id, { reason: reason || null, status: rep.status, site: rep.site_name, date: rep.report_date,
    envelope: rep.envelope_code, slip: rep.slip_number, snapshot });
  res.json({ ok: true });
}));

// Modulo catena di custodia (dalla distinta elaborata in avanti)
r.get('/:id/custody.pdf', ah(async (req, res) => {
  const rep = await loadReport(req.user, Number(req.params.id));
  if (!['PROCESSED', 'PICKED_UP', 'VERIFIED', 'DEPOSITED'].includes(rep.status)) throw bad('Il modulo si genera dopo l\'elaborazione della distinta');
  const full = await fullReport(rep.id);
  const company = await one('SELECT * FROM companies WHERE id=$1', [full.company_id]);
  const site = await one('SELECT * FROM sites WHERE id=$1', [full.site_id]);
  const pdf = await buildCustodyPdf({ report: full, company, site, preparedBy: full.processed_by_name, preparedAt: full.processed_at });
  res.type('application/pdf').set('Content-Disposition', `inline; filename="Custodia_${rep.envelope_code || rep.slip_number}.pdf"`).send(pdf);
}));

export { STATUS_LABEL };
export default r;
