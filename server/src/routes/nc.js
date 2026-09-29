import { Router } from 'express';
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse } from '../lib/util.js';
import { notifyNcOpened, notifyNcReply } from '../lib/alerts.js';
import { sendMail } from '../lib/mailer.js';
import { Params, isSuper, requireRole, assertSite, assertCompany, canSite, companyWide } from '../lib/access.js';

const r = Router();

// Visibilità: super tutto, admin la propria azienda, operatore le NC delle proprie sedi
function scope(user, P) {
  if (isSuper(user)) return 'TRUE';
  if (companyWide(user)) return `n.company_id = ${P.add(user.company_id)}`;
  return `n.site_id = ANY(${P.add(user.site_ids || [])}::int[])`;
}

async function load(user, id) {
  const n = await one('SELECT * FROM nonconformities WHERE id=$1', [id]);
  if (!n) throw notFound('Non conformità non trovata');
  if (isSuper(user)) return n;
  if (companyWide(user) && n.company_id === user.company_id) return n;
  if (['OPERATOR', 'CASSIERE'].includes(user.role) && n.site_id && canSite(user, { id: n.site_id, company_id: n.company_id })) return n;
  throw forbidden();
}

r.get('/', ah(async (req, res) => {
  const P = new Params();
  const where = [scope(req.user, P)];
  const { status, site_id, company_id, kind } = req.query;
  if (status) where.push(`n.status = ANY(${P.add(String(status).split(','))})`);
  if (site_id) where.push(`n.site_id = ${P.add(Number(site_id))}`);
  if (company_id) where.push(`n.company_id = ${P.add(Number(company_id))}`);
  if (kind) where.push(`n.kind = ${P.add(kind)}`);
  res.json(await many(`SELECT n.*, s.name AS site_name, c.name AS company_name, u.full_name AS created_by_name, r.report_date,
      (SELECT count(*)::int FROM nc_messages m WHERE m.nc_id=n.id) AS messages,
      (SELECT max(created_at) FROM nc_messages m WHERE m.nc_id=n.id) AS last_message_at
    FROM nonconformities n JOIN companies c ON c.id=n.company_id LEFT JOIN sites s ON s.id=n.site_id
    LEFT JOIN users u ON u.id=n.created_by LEFT JOIN cash_reports r ON r.id=n.report_id
    WHERE ${where.join(' AND ')} ORDER BY (n.status='CHIUSA'), n.created_at DESC LIMIT 1000`, P.values));
}));

r.get('/:id', ah(async (req, res) => {
  const n = await load(req.user, Number(req.params.id));
  const extra = await one(`SELECT s.name AS site_name, c.name AS company_name, u.full_name AS created_by_name, cu.full_name AS closed_by_name, r.report_date
    FROM nonconformities n JOIN companies c ON c.id=n.company_id LEFT JOIN sites s ON s.id=n.site_id LEFT JOIN users u ON u.id=n.created_by
    LEFT JOIN users cu ON cu.id=n.closed_by LEFT JOIN cash_reports r ON r.id=n.report_id WHERE n.id=$1`, [n.id]);
  const messages = await many(`SELECT m.*, u.full_name, u.role FROM nc_messages m LEFT JOIN users u ON u.id=m.user_id WHERE nc_id=$1 ORDER BY created_at`, [n.id]);
  res.json({ ...n, ...extra, messages });
}));

r.post('/', requireRole('SUPERADMIN', 'ADMIN', 'CASSIERE', 'FINANCE'), ah(async (req, res) => {
  const d = parse(z.object({
    company_id: z.number().int().optional(),
    site_id: z.number().int().nullable().optional(),
    report_id: z.number().int().nullable().optional(),
    kind: z.enum(['ERRORE', 'NON_CONFORMITA']),
    severity: z.enum(['BASSA', 'MEDIA', 'ALTA']),
    title: z.string().trim().min(4).max(200),
    description: z.string().trim().min(5).max(5000),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }), req.body);
  if (d.report_id) {
    const rep = await one('SELECT r.site_id, s.company_id FROM cash_reports r JOIN sites s ON s.id=r.site_id WHERE r.id=$1', [d.report_id]);
    if (!rep) throw bad('Rendiconto inesistente');
    d.site_id = rep.site_id; d.company_id = rep.company_id;
  }
  if (d.site_id) { const s = await assertSite(req.user, d.site_id); d.company_id = s.company_id; }
  if (!d.company_id) d.company_id = req.user.company_id;
  if (!d.company_id) throw bad('Indica azienda o sede');
  assertCompany(req.user, d.company_id);
  const row = await one(`INSERT INTO nonconformities (company_id, site_id, report_id, kind, severity, title, description, due_date, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
  [d.company_id, d.site_id || null, d.report_id || null, d.kind, d.severity, d.title, d.description, d.due_date || null, req.user.id]);
  if (d.report_id) await q(`INSERT INTO report_events (report_id, event, detail, user_id) VALUES ($1,'NC_APERTA',$2,$3)`, [d.report_id, `#${row.id} ${d.title}`, req.user.id]);
  if (d.site_id) { const site = await one('SELECT * FROM sites WHERE id=$1', [d.site_id]); notifyNcOpened({ ...d, id: row.id }, site, req.user.full_name).catch(() => {}); }
  await audit(req, 'NC_CREATE', 'nc', row.id, d);
  res.status(201).json(row);
}));

// Risposta dell'utente o nota dell'amministratore
r.post('/:id/messages', ah(async (req, res) => {
  const n = await load(req.user, Number(req.params.id));
  const d = parse(z.object({ body: z.string().trim().min(2).max(5000) }), req.body);
  if (n.status === 'CHIUSA') throw bad('La non conformità è chiusa');
  // chi ha aperto la NC (o il super amministratore) aggiunge note; gli altri rispondono
  const kind = req.user.id === n.created_by || isSuper(req.user) ? 'NOTA' : 'RISPOSTA';
  await tx(async (c) => {
    await c.query('INSERT INTO nc_messages (nc_id, user_id, kind, body) VALUES ($1,$2,$3,$4)', [n.id, req.user.id, kind, d.body]);
    if (kind === 'RISPOSTA') await c.query(`UPDATE nonconformities SET status='RISPOSTA' WHERE id=$1`, [n.id]);
  });
  if (kind === 'RISPOSTA') {
    const creator = n.created_by ? await one('SELECT email FROM users WHERE id=$1', [n.created_by]) : null;
    const site = n.site_id ? await one('SELECT * FROM sites WHERE id=$1', [n.site_id]) : null;
    notifyNcReply(n, site, req.user.full_name, d.body, creator?.email).catch(() => {});
  } else if (n.site_id) {
    const site = await one('SELECT * FROM sites WHERE id=$1', [n.site_id]);
    if (site?.site_email) sendMail({ kind: 'NC', to: site.site_email, companyId: n.company_id, siteId: site.id, sentBy: req.user.id, subject: `Nota su #${n.id} · ${site.name}: ${n.title}`, title: `Nota di ${req.user.full_name} sulla segnalazione #${n.id}`, body: d.body }).catch(() => {});
  }
  await audit(req, 'NC_MESSAGE', 'nc', n.id, { kind });
  res.status(201).json({ ok: true });
}));

r.post('/:id/close', requireRole('SUPERADMIN', 'ADMIN', 'CASSIERE', 'FINANCE'), ah(async (req, res) => {
  const n = await load(req.user, Number(req.params.id));
  const d = parse(z.object({ body: z.string().trim().min(2).max(2000) }), req.body);
  if (n.status === 'CHIUSA') throw bad('Già chiusa');
  await tx(async (c) => {
    await c.query('INSERT INTO nc_messages (nc_id, user_id, kind, body) VALUES ($1,$2,$3,$4)', [n.id, req.user.id, 'CHIUSURA', d.body]);
    await c.query(`UPDATE nonconformities SET status='CHIUSA', closed_by=$2, closed_at=now() WHERE id=$1`, [n.id, req.user.id]);
  });
  await audit(req, 'NC_CLOSE', 'nc', n.id);
  res.json({ ok: true });
}));

r.post('/:id/reopen', requireRole('SUPERADMIN', 'ADMIN', 'CASSIERE', 'FINANCE'), ah(async (req, res) => {
  const n = await load(req.user, Number(req.params.id));
  const d = parse(z.object({ body: z.string().trim().min(2).max(2000) }), req.body);
  if (n.status !== 'CHIUSA') throw bad('Non è chiusa');
  await tx(async (c) => {
    await c.query('INSERT INTO nc_messages (nc_id, user_id, kind, body) VALUES ($1,$2,$3,$4)', [n.id, req.user.id, 'RIAPERTURA', d.body]);
    await c.query(`UPDATE nonconformities SET status='APERTA', closed_by=NULL, closed_at=NULL WHERE id=$1`, [n.id]);
  });
  await audit(req, 'NC_REOPEN', 'nc', n.id);
  res.json({ ok: true });
}));

export default r;
