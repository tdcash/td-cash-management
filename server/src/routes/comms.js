import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../db.js';
import { ah, bad, audit, parse, todayRome, itDate } from '../lib/util.js';
import { requireRole, assertSite, assertCompany, isSuper, Params } from '../lib/access.js';
import { sendMail, mailStatus } from '../lib/mailer.js';
import { missingReports, sendMissingAlert, runDailyCheck, runClosingAlerts, closingTime } from '../lib/alerts.js';

const r = Router();
r.use(requireRole('SUPERADMIN', 'ADMIN'));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Controllo giornaliero: stato di ogni sede per una data
r.get('/daily', ah(async (req, res) => {
  const date = String(req.query.date || new Date(new Date(`${todayRome()}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Data non valida');
  const P = new Params();
  const where = [isSuper(req.user) ? 'TRUE' : `s.company_id = ${P.add(req.user.company_id)}`, 's.active'];
  if (req.query.company_id) where.push(`s.company_id = ${P.add(Number(req.query.company_id))}`);
  const d = P.add(date);
  const rows = await many(`SELECT s.id AS site_id, s.name AS site_name, s.code AS site_code, s.site_email, s.host_email, s.company_id, c.name AS company_name, s.expected_registers,
      (substr(s.operating_days, extract(isodow FROM ${d}::date)::int, 1) = '1' AND s.start_date <= ${d}::date) AS operating, s.start_date, s.hours,
      (SELECT count(*)::int FROM cash_reports r WHERE r.site_id=s.id AND r.report_date=${d}::date) AS reports_count,
      (SELECT count(*)::int FROM cash_reports r WHERE r.site_id=s.id AND r.report_date=${d}::date AND r.status<>'DRAFT') AS closed_count,
      (SELECT coalesce(sum(r.cash_to_deposit + r.pos_total + r.transfer_total),0) FROM cash_reports r WHERE r.site_id=s.id AND r.report_date=${d}::date AND r.status<>'DRAFT') AS day_total,
      (SELECT json_agg(json_build_object('id', r.id, 'status', r.status, 'operator_name', u.full_name, 'total', r.cash_to_deposit + r.pos_total + r.transfer_total, 'updated_at', r.updated_at) ORDER BY u.full_name)
         FROM cash_reports r LEFT JOIN users u ON u.id=r.operator_id WHERE r.site_id=s.id AND r.report_date=${d}::date) AS registers,
      (SELECT status FROM email_log e WHERE e.ref_key = 'SOLLECITO:' || s.id || ':' || ${d} ORDER BY e.created_at DESC LIMIT 1) AS alert_status,
      (SELECT created_at FROM email_log e WHERE e.ref_key = 'SOLLECITO:' || s.id || ':' || ${d} ORDER BY e.created_at DESC LIMIT 1) AS alert_at
    FROM sites s JOIN companies c ON c.id=s.company_id
    WHERE ${where.join(' AND ')} ORDER BY c.name, s.name`, P.values);
  for (const x of rows) { x.closing_time = closingTime(x, date); x.registers = x.registers || []; x.missing_registers = x.operating ? Math.max(0, x.expected_registers - x.reports_count) : 0; x.report_id = x.registers[0]?.id || null; x.status = x.registers.length === 1 ? x.registers[0].status : null; }
  const missing = rows.filter((x) => x.operating && x.missing_registers > 0);
  res.json({ date, rows, summary: { total: rows.length, operating: rows.filter((x) => x.operating).length, done: rows.filter((x) => x.operating && x.missing_registers === 0 && x.reports_count > 0).length, missing: missing.length,
    missing_registers: missing.reduce((a, x) => a + x.missing_registers, 0), expected_registers: rows.filter((x) => x.operating).reduce((a, x) => a + x.expected_registers, 0), done_registers: rows.reduce((a, x) => a + x.reports_count, 0),
    drafts: rows.reduce((a, x) => a + (x.reports_count - x.closed_count), 0) },
    mail: mailStatus() });
}));

// Sollecito manuale a una sede (o a tutte le mancanti)
r.post('/daily/alert', ah(async (req, res) => {
  const d = parse(z.object({ date: isoDate, site_id: z.number().int().optional(), company_id: z.number().int().optional() }), req.body);
  let targets;
  if (d.site_id) {
    const site = await assertSite(req.user, d.site_id);
    targets = [{ site_id: site.id, site_name: site.name, site_code: site.code, site_email: site.site_email, company_id: site.company_id }];
  } else {
    const cid = d.company_id || req.user.company_id || null;
    if (cid) assertCompany(req.user, cid);
    targets = await missingReports(d.date, cid);
  }
  const results = [];
  for (const t of targets) results.push({ site: t.site_name, ...(await sendMissingAlert(t, d.date, req.user.id)) });
  await audit(req, 'ALERT_MISSING', 'date', d.date, results);
  res.json(results);
}));

// Esegue subito il controllo automatico (super amministratore)
r.post('/daily/run', requireRole('SUPERADMIN'), ah(async (req, res) => {
  res.json({ morning: await runDailyCheck({ force: true }), closing: await runClosingAlerts({ force: true }) });
}));

// Comunicazione libera a una sede: email di sede + (opzionale) struttura ospitante + operatori della sede
r.post('/message', ah(async (req, res) => {
  const d = parse(z.object({ site_id: z.number().int(), subject: z.string().trim().min(3).max(200), body: z.string().trim().min(5).max(5000),
    to_site: z.boolean().default(true), to_host: z.boolean().default(false), to_operators: z.boolean().default(false) }), req.body);
  const site = await assertSite(req.user, d.site_id);
  const to = [];
  if (d.to_site && site.site_email) to.push(site.site_email);
  if (d.to_host && site.host_email) to.push(site.host_email);
  if (d.to_operators) to.push(...(await many(`SELECT u.email FROM users u JOIN user_sites us ON us.user_id=u.id WHERE us.site_id=$1 AND u.active AND u.role='OPERATOR'`, [site.id])).map((x) => x.email));
  if (!to.length) throw bad('Nessun destinatario: imposta le email nell\'anagrafica della sede o scegli gli operatori');
  const out = await sendMail({ kind: 'COMUNICAZIONE', to: [...new Set(to)], cc: req.user.email, companyId: site.company_id, siteId: site.id, sentBy: req.user.id,
    subject: `${d.subject} · ${site.name}`, title: d.subject, body: `${d.body}\n\n${req.user.full_name}` });
  await audit(req, 'MESSAGE_SEND', 'site', site.id, { subject: d.subject, to, status: out.status });
  res.json(out);
}));

// Registro invii
r.get('/log', ah(async (req, res) => {
  const P = new Params();
  const where = [isSuper(req.user) ? 'TRUE' : `(e.company_id = ${P.add(req.user.company_id)} OR e.company_id IS NULL)`];
  if (req.query.kind) where.push(`e.kind = ${P.add(req.query.kind)}`);
  if (req.query.site_id) where.push(`e.site_id = ${P.add(Number(req.query.site_id))}`);
  res.json(await many(`SELECT e.id, e.kind, e.to_addr, e.cc_addr, e.subject, e.body, e.attachment_name, e.status, e.error, e.created_at, s.name AS site_name, u.full_name AS sent_by_name
    FROM email_log e LEFT JOIN sites s ON s.id=e.site_id LEFT JOIN users u ON u.id=e.sent_by WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC LIMIT 500`, P.values));
}));

// Email di prova (super amministratore)
r.post('/test', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const d = parse(z.object({ to: z.string().email() }), req.body);
  const out = await sendMail({ kind: 'TEST', to: d.to, sentBy: req.user.id, subject: 'Email di prova · Cash Management', title: 'Configurazione email funzionante',
    body: `Questa è una email di prova inviata da Cash Management il ${itDate(todayRome())}.` });
  res.json({ ...out, mail: mailStatus() });
}));

export default r;
