import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, parse, eur, itDate, todayRome, r2 } from '../lib/util.js';
import { requireRole, assertCompany, isSuper, Params } from '../lib/access.js';
import { buildDepositPdf } from '../pdf/versamento.js';

// Versamenti al portavalori: livello azienda, solo rendiconti verificati (in cassaforte)
const r = Router();
r.use(requireRole('SUPERADMIN', 'ADMIN'));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ENVELOPE_RE = /^[A-Za-z0-9-]{6,40}$/;

async function devent(c, id, ev, detail, userId) {
  await c.query('INSERT INTO deposit_events (deposit_id, event, detail, user_id) VALUES ($1,$2,$3,$4)', [id, ev, detail || null, userId]);
}

function companyOf(req) {
  const cid = Number(req.query.company_id || req.body?.company_id || req.user.company_id);
  if (!cid) throw bad('Indica l\'azienda');
  assertCompany(req.user, cid);
  return cid;
}

// Cassaforte: rendiconti verificati non ancora versati
r.get('/safe', ah(async (req, res) => {
  const cid = companyOf(req);
  const rows = await many(`SELECT r.id, r.report_date, r.envelope_code, r.cash_to_deposit, r.verified_amount, r.verified_at, s.name AS site_name, s.code AS site_code, u.full_name AS verified_by_name
    FROM cash_reports r JOIN sites s ON s.id=r.site_id LEFT JOIN users u ON u.id=r.verified_by
    WHERE s.company_id=$1 AND r.status='VERIFIED' AND r.deposit_id IS NULL ORDER BY r.report_date, s.name`, [cid]);
  const pending = await one(`SELECT count(*)::int AS n, coalesce(sum(r.cash_to_deposit),0) AS amount FROM cash_reports r JOIN sites s ON s.id=r.site_id
    WHERE s.company_id=$1 AND r.status IN ('CLOSED','PROCESSED','PICKED_UP')`, [cid]);
  res.json({ reports: rows, total: r2(rows.reduce((a, x) => a + Number(x.verified_amount), 0)), pending_count: pending.n, pending_amount: Number(pending.amount) });
}));

r.get('/', ah(async (req, res) => {
  const P = new Params();
  const where = [isSuper(req.user) ? 'TRUE' : `d.company_id = ${P.add(req.user.company_id)}`];
  if (req.query.company_id) where.push(`d.company_id = ${P.add(Number(req.query.company_id))}`);
  res.json(await many(`SELECT d.id, d.company_id, d.number, d.deposit_date, d.total_amount, d.envelopes, d.operator_name, d.picked_at, d.status, d.bank_amount, d.bank_date, d.notes, d.created_at,
      c.name AS company_name, u.full_name AS created_by_name, (SELECT count(*)::int FROM cash_reports r WHERE r.deposit_id=d.id) AS reports_count
    FROM cash_deposits d JOIN companies c ON c.id=d.company_id LEFT JOIN users u ON u.id=d.created_by WHERE ${where.join(' AND ')} ORDER BY d.deposit_date DESC, d.id DESC LIMIT 500`, P.values));
}));

async function loadDeposit(req, id) {
  const d = await one('SELECT * FROM cash_deposits WHERE id=$1', [id]);
  if (!d) throw notFound('Versamento non trovato');
  assertCompany(req.user, d.company_id);
  return d;
}
async function fullDeposit(id) {
  const d = await one(`SELECT d.id, d.company_id, d.number, d.deposit_date, d.total_amount, d.envelopes, d.operator_name, d.picked_at, d.status, d.bank_amount, d.bank_date, d.notes, d.created_at,
      c.name AS company_name, u.full_name AS created_by_name, (d.slip_pdf IS NOT NULL) AS has_pdf
    FROM cash_deposits d JOIN companies c ON c.id=d.company_id LEFT JOIN users u ON u.id=d.created_by WHERE d.id=$1`, [id]);
  d.reports = await many(`SELECT r.id, r.report_date, r.envelope_code, r.cash_to_deposit, r.verified_amount, s.name AS site_name FROM cash_reports r JOIN sites s ON s.id=r.site_id WHERE r.deposit_id=$1 ORDER BY r.report_date, s.name`, [id]);
  d.events = await many('SELECT e.*, u.full_name FROM deposit_events e LEFT JOIN users u ON u.id=e.user_id WHERE deposit_id=$1 ORDER BY at', [id]);
  return d;
}

r.get('/:id', ah(async (req, res) => { await loadDeposit(req, Number(req.params.id)); res.json(await fullDeposit(Number(req.params.id))); }));

// Creazione: seleziona rendiconti verificati, registra le buste nuove, genera la distinta PDF
r.post('/', ah(async (req, res) => {
  const cid = companyOf(req);
  const d = parse(z.object({
    company_id: z.number().int().optional(),
    report_ids: z.array(z.number().int()).min(1),
    deposit_date: isoDate,
    envelopes: z.array(z.object({ code: z.string().trim(), amount: z.number().min(0).nullable().optional() })).min(1),
    notes: z.string().max(1000).nullable().optional(),
  }), req.body);
  if (d.deposit_date > todayRome()) throw bad('Data di versamento nel futuro');
  const codes = d.envelopes.map((e) => e.code.toUpperCase());
  for (const c of codes) if (!ENVELOPE_RE.test(c)) throw bad(`Codice busta non valido: ${c}`);
  if (new Set(codes).size !== codes.length) throw bad('Busta duplicata');
  const dupSite = await one('SELECT envelope_code FROM cash_reports WHERE envelope_code = ANY($1) LIMIT 1', [codes]);
  if (dupSite) throw bad(`Il codice ${dupSite.envelope_code} è già usato da una busta di sede`);
  const dupDep = await one(`SELECT number FROM cash_deposits WHERE envelopes @> ANY(SELECT jsonb_build_array(jsonb_build_object('code', c)) FROM unnest($1::text[]) c) LIMIT 1`, [codes]);
  if (dupDep) throw bad(`Uno dei codici busta è già usato nel versamento ${dupDep.number}`);
  const reports = await many(`SELECT r.*, s.name AS site_name, s.company_id FROM cash_reports r JOIN sites s ON s.id=r.site_id WHERE r.id = ANY($1)`, [d.report_ids]);
  if (reports.length !== d.report_ids.length) throw bad('Alcuni rendiconti non esistono');
  for (const rep of reports) {
    if (rep.company_id !== cid) throw bad(`Rendiconto ${rep.site_name} ${rep.report_date} di un'altra azienda`);
    if (rep.status !== 'VERIFIED' || rep.deposit_id) throw bad(`Rendiconto ${rep.site_name} del ${rep.report_date} non è verificato o è già versato`);
  }
  const total = r2(reports.reduce((a, x) => a + Number(x.verified_amount), 0));
  const envTotal = d.envelopes.some((e) => e.amount != null) ? r2(d.envelopes.reduce((a, e) => a + Number(e.amount || 0), 0)) : null;
  if (envTotal != null && envTotal !== total) throw bad(`La somma delle buste (${eur(envTotal)}) non coincide con il totale dei rendiconti (${eur(total)})`);
  const company = await one('SELECT * FROM companies WHERE id=$1', [cid]);
  const dep = await tx(async (c) => {
    await c.query('LOCK TABLE cash_deposits IN SHARE ROW EXCLUSIVE MODE');
    const year = d.deposit_date.slice(0, 4);
    const seq = (await c.query(`SELECT count(*)::int + 1 AS n FROM cash_deposits WHERE company_id=$1 AND number LIKE $2`, [cid, `${company.code}-V${year}-%`])).rows[0].n;
    const number = `${company.code}-V${year}-${String(seq).padStart(4, '0')}`;
    const row = (await c.query(`INSERT INTO cash_deposits (company_id, number, deposit_date, total_amount, envelopes, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [cid, number, d.deposit_date, total, JSON.stringify(d.envelopes.map((e, i) => ({ code: codes[i], amount: e.amount ?? null }))), d.notes || null, req.user.id])).rows[0];
    await c.query(`UPDATE cash_reports SET status='DEPOSITED', deposit_id=$2, updated_at=now() WHERE id = ANY($1)`, [d.report_ids, row.id]);
    for (const rep of reports) await c.query(`INSERT INTO report_events (report_id, event, detail, user_id) VALUES ($1,'VERSATO',$2,$3)`, [rep.id, `Incluso nel versamento ${number}`, req.user.id]);
    await devent(c, row.id, 'CREATO', `${reports.length} rendiconti, ${eur(total)}, buste ${codes.join(', ')}`, req.user.id);
    return row;
  });
  const full = await fullDeposit(dep.id);
  const pdf = await buildDepositPdf({ deposit: full, company, reports: full.reports, preparedBy: req.user.full_name });
  await q('UPDATE cash_deposits SET slip_pdf=$2 WHERE id=$1', [dep.id, pdf]);
  await audit(req, 'DEPOSIT_CREATE', 'deposit', dep.id, { number: dep.number, total, reports: d.report_ids, envelopes: codes });
  res.status(201).json(await fullDeposit(dep.id));
}));

r.get('/:id/pdf', ah(async (req, res) => {
  const d = await loadDeposit(req, Number(req.params.id));
  const company = await one('SELECT * FROM companies WHERE id=$1', [d.company_id]);
  const full = await fullDeposit(d.id);
  // rigenerato a ogni richiesta così riporta ritiro e accredito aggiornati
  const pdf = await buildDepositPdf({ deposit: full, company, reports: full.reports, preparedBy: full.created_by_name });
  res.type('application/pdf').set('Content-Disposition', `inline; filename="Versamento_${d.number}.pdf"`).send(pdf);
}));

// Ritiro da parte del portavalori
r.post('/:id/pickup', ah(async (req, res) => {
  const d = await loadDeposit(req, Number(req.params.id));
  if (d.status !== 'PREPARATO') throw bad('Ritiro già registrato');
  const b = parse(z.object({ operator_name: z.string().trim().min(3).max(120), picked_at: z.string().datetime({ offset: true }).optional() }), req.body);
  await tx(async (c) => {
    await c.query(`UPDATE cash_deposits SET status='RITIRATO', operator_name=$2, picked_at=$3, updated_at=now() WHERE id=$1`, [d.id, b.operator_name, b.picked_at ? new Date(b.picked_at) : new Date()]);
    await devent(c, d.id, 'RITIRATO', `Operatore portavalori: ${b.operator_name}`, req.user.id);
  });
  await audit(req, 'DEPOSIT_PICKUP', 'deposit', d.id, b);
  res.json(await fullDeposit(d.id));
}));

// Conferma accredito in banca (chiude il versamento)
r.post('/:id/bank', ah(async (req, res) => {
  const d = await loadDeposit(req, Number(req.params.id));
  if (d.status === 'ACCREDITATO') throw bad('Accredito già confermato');
  const b = parse(z.object({ amount: z.number().min(0), date: isoDate }), req.body);
  const diff = r2(b.amount - Number(d.total_amount));
  await tx(async (c) => {
    await c.query(`UPDATE cash_deposits SET status='ACCREDITATO', bank_amount=$2, bank_date=$3, bank_confirmed_by=$4, updated_at=now() WHERE id=$1`, [d.id, b.amount, b.date, req.user.id]);
    await devent(c, d.id, 'ACCREDITATO', `Accredito ${eur(b.amount)} del ${itDate(b.date)}${diff ? `, differenza ${eur(diff)}` : ''}`, req.user.id);
    if (diff !== 0) {
      await c.query(`INSERT INTO nonconformities (company_id, site_id, kind, severity, title, description, created_by) VALUES ($1,NULL,'ERRORE',$2,$3,$4,$5)`,
        [d.company_id, Math.abs(diff) >= 50 ? 'ALTA' : 'MEDIA', `Differenza accredito versamento ${d.number}: ${eur(diff)}`,
          `Versamento ${d.number} del ${d.deposit_date}: versato ${eur(d.total_amount)}, accreditato ${eur(b.amount)} il ${b.date}. Generata automaticamente.`, req.user.id]);
    }
  });
  await audit(req, 'DEPOSIT_BANK', 'deposit', d.id, { ...b, diff });
  res.json(await fullDeposit(d.id));
}));

// Annulla ultimo passaggio o l'intero versamento (se non accreditato)
r.post('/:id/undo', ah(async (req, res) => {
  const d = await loadDeposit(req, Number(req.params.id));
  const b = parse(z.object({ reason: z.string().trim().min(5).max(500) }), req.body);
  await tx(async (c) => {
    if (d.status === 'ACCREDITATO') {
      await c.query(`UPDATE cash_deposits SET status='RITIRATO', bank_amount=NULL, bank_date=NULL, bank_confirmed_by=NULL, updated_at=now() WHERE id=$1`, [d.id]);
      await devent(c, d.id, 'ANNULLATO', `Accredito annullato. ${b.reason}`, req.user.id);
    } else if (d.status === 'RITIRATO') {
      await c.query(`UPDATE cash_deposits SET status='PREPARATO', operator_name=NULL, picked_at=NULL, updated_at=now() WHERE id=$1`, [d.id]);
      await devent(c, d.id, 'ANNULLATO', `Ritiro annullato. ${b.reason}`, req.user.id);
    } else throw bad('Il versamento è solo preparato: per rimuoverlo usa Elimina versamento');
  });
  await audit(req, 'DEPOSIT_UNDO', 'deposit', d.id, { from: d.status, reason: b.reason });
  res.json(await fullDeposit(d.id));
}));

r.delete('/:id', ah(async (req, res) => {
  const d = await loadDeposit(req, Number(req.params.id));
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) throw bad('Indica la motivazione (almeno 5 caratteri)');
  const snapshot = await fullDeposit(d.id);
  await tx(async (c) => {
    const ids = (await c.query('SELECT id FROM cash_reports WHERE deposit_id=$1', [d.id])).rows.map((x) => x.id);
    await c.query(`UPDATE cash_reports SET status='VERIFIED', deposit_id=NULL, updated_at=now() WHERE deposit_id=$1`, [d.id]);
    for (const id of ids) await c.query(`INSERT INTO report_events (report_id, event, detail, user_id) VALUES ($1,'VERSAMENTO_ANNULLATO',$2,$3)`, [id, `Versamento ${d.number} eliminato: ${reason}. Il rendiconto torna in cassaforte`, req.user.id]);
    await c.query('DELETE FROM cash_deposits WHERE id=$1', [d.id]);
  });
  await audit(req, 'DEPOSIT_DELETE', 'deposit', d.id, { number: d.number, total: d.total_amount, status: d.status, reason, snapshot: { ...snapshot, events: undefined } });
  res.json({ ok: true });
}));

export default r;
