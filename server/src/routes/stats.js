import { Router } from 'express';
import { many, one } from '../db.js';
import { ah, todayRome, getSetting } from '../lib/util.js';
import { Params, siteScope } from '../lib/access.js';

const r = Router();

function channelTotals(req, from, to) {
  const P = new Params();
  const w = [req.user.role === 'SUPERADMIN' ? 'TRUE' : req.user.role === 'ADMIN' ? `cr.company_id = ${P.add(req.user.company_id)}` : 'FALSE'];
  if (req.query.company_id) w.push(`cr.company_id = ${P.add(Number(req.query.company_id))}`);
  if (req.query.site_id) w.push(`cr.site_id = ${P.add(Number(req.query.site_id))}`);
  w.push(`cr.rev_date BETWEEN ${P.add(from)} AND ${P.add(to)}`);
  return one(`SELECT coalesce(sum(cr.gross_amount),0) AS gross, coalesce(sum(cr.franchisor_share),0) AS franchisor_share
    FROM channel_revenues cr WHERE ${w.join(' AND ')}`, P.values);
}

function filters(req) {
  const P = new Params();
  const to = req.query.to || todayRome();
  const from = req.query.from || new Date(new Date(to).getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const where = [siteScope(req.user, P)];
  if (req.query.company_id) where.push(`s.company_id = ${P.add(Number(req.query.company_id))}`);
  if (req.query.site_id) where.push(`s.id = ${P.add(Number(req.query.site_id))}`);
  return { P, where, from, to };
}

r.get('/summary', ah(async (req, res) => {
  const { P, where, from, to } = filters(req);
  const pf = P.add(from), pt = P.add(to);
  const scope = where.join(' AND ');
  const repWhere = `${scope} AND r.report_date BETWEEN ${pf} AND ${pt}`;
  // le bozze non entrano nei totali (conteggio incompleto), ma contano negli stati
  const base = `FROM cash_reports r JOIN sites s ON s.id=r.site_id JOIN companies c ON c.id=s.company_id WHERE ${repWhere} AND r.status <> 'DRAFT'`;

  const [totals, byDay, bySite, byCompany, byCircuit, byStatus, channels] = await Promise.all([
    one(`SELECT coalesce(sum(r.cash_to_deposit),0) AS cash, coalesce(sum(r.pos_total),0) AS pos, coalesce(sum(r.transfer_total),0) AS transfer,
        count(*)::int AS reports,
        coalesce(sum(CASE WHEN r.expected_total IS NOT NULL THEN (r.cash_to_deposit+r.pos_total+r.transfer_total) - r.expected_total END),0) AS differences,
        count(*) FILTER (WHERE r.expected_total IS NOT NULL AND abs((r.cash_to_deposit+r.pos_total+r.transfer_total) - r.expected_total) >= 0.01)::int AS reports_with_diff
      ${base}`, P.values),
    many(`SELECT r.report_date AS date, sum(r.cash_to_deposit) AS cash, sum(r.pos_total) AS pos, sum(r.transfer_total) AS transfer
      ${base} GROUP BY r.report_date ORDER BY r.report_date`, P.values),
    many(`SELECT s.id AS site_id, s.name AS site_name, s.code AS site_code, c.name AS company_name, count(*)::int AS reports,
        sum(r.cash_to_deposit) AS cash, sum(r.pos_total) AS pos, sum(r.transfer_total) AS transfer,
        sum(r.cash_to_deposit + r.pos_total + r.transfer_total) AS total
      ${base} GROUP BY s.id, c.name ORDER BY total DESC`, P.values),
    many(`SELECT c.id AS company_id, c.name AS company_name, count(*)::int AS reports,
        sum(r.cash_to_deposit) AS cash, sum(r.pos_total) AS pos, sum(r.transfer_total) AS transfer,
        sum(r.cash_to_deposit + r.pos_total + r.transfer_total) AS total
      ${base} GROUP BY c.id ORDER BY total DESC`, P.values),
    many(`SELECT p.circuit, count(*)::int AS count, sum(p.amount) AS amount
      FROM pos_receipts p JOIN cash_reports r ON r.id=p.report_id JOIN sites s ON s.id=r.site_id JOIN companies c ON c.id=s.company_id
      WHERE ${repWhere} GROUP BY p.circuit ORDER BY amount DESC`, P.values),
    many(`SELECT r.status, count(*)::int AS n FROM cash_reports r JOIN sites s ON s.id=r.site_id WHERE ${repWhere} GROUP BY r.status`, P.values),
    channelTotals(req, from, to),
  ]);

  // Rendiconti mancanti: giorni operativi senza rendiconto (fino a ieri)
  const yesterday = new Date(new Date(todayRome()).getTime() - 86400000).toISOString().slice(0, 10);
  const P2 = new Params();
  const w2 = [siteScope(req.user, P2), 's.active'];
  if (req.query.company_id) w2.push(`s.company_id = ${P2.add(Number(req.query.company_id))}`);
  if (req.query.site_id) w2.push(`s.id = ${P2.add(Number(req.query.site_id))}`);
  const mFrom = P2.add(from), mTo = P2.add(to < yesterday ? to : yesterday);
  const missing = await many(`SELECT s.id AS site_id, s.name AS site_name, c.name AS company_name, d::date AS date
    FROM sites s JOIN companies c ON c.id=s.company_id
    CROSS JOIN LATERAL generate_series(greatest(${mFrom}::date, s.created_at::date), ${mTo}::date, interval '1 day') d
    WHERE ${w2.join(' AND ')}
      AND substr(s.operating_days, extract(isodow FROM d)::int, 1) = '1'
      AND NOT EXISTS (SELECT 1 FROM cash_reports r WHERE r.site_id=s.id AND r.report_date=d::date)
    ORDER BY d DESC, s.name LIMIT 500`, P2.values);

  const alertDays = Number(await getSetting('pickup_alert_days', '2'));
  const P3 = new Params();
  const w3 = [siteScope(req.user, P3)];
  if (req.query.company_id) w3.push(`s.company_id = ${P3.add(Number(req.query.company_id))}`);
  if (req.query.site_id) w3.push(`s.id = ${P3.add(Number(req.query.site_id))}`);
  const late = await many(`SELECT r.id, r.report_date, r.status, r.cash_to_deposit, r.envelope_code, s.name AS site_name, c.name AS company_name,
      CASE WHEN r.status IN ('DRAFT','CLOSED') THEN 'Distinta non elaborata'
           WHEN r.status='PROCESSED' THEN 'Operazione logistica non registrata'
           WHEN r.status='PICKED_UP' THEN 'Riconteggio non eseguito'
           ELSE 'In cassaforte, non versato' END AS issue
    FROM cash_reports r JOIN sites s ON s.id=r.site_id JOIN companies c ON c.id=s.company_id
    WHERE ${w3.join(' AND ')} AND r.status <> 'DEPOSITED'
      AND r.report_date < (current_date - ${P3.add(alertDays)}::int)
    ORDER BY r.report_date LIMIT 300`, P3.values);

  const P4 = new Params();
  const ncScope = req.user.role === 'SUPERADMIN' ? 'TRUE' : req.user.role === 'ADMIN'
    ? `company_id = ${P4.add(req.user.company_id)}` : `site_id = ANY(${P4.add(req.user.site_ids || [])}::int[])`;
  const nc = await one(`SELECT count(*) FILTER (WHERE status='APERTA')::int AS open, count(*) FILTER (WHERE status='RISPOSTA')::int AS answered,
      count(*) FILTER (WHERE status<>'CHIUSA' AND due_date < current_date)::int AS overdue FROM nonconformities WHERE ${ncScope}`, P4.values);

  const total = Number(totals.cash) + Number(totals.pos) + Number(totals.transfer);
  res.json({
    from, to,
    totals: { ...totals, total, channels_gross: channels.gross, channels_withheld: channels.franchisor_share },
    by_day: byDay, by_site: bySite, by_company: byCompany, by_circuit: byCircuit,
    by_status: Object.fromEntries(byStatus.map((x) => [x.status, x.n])),
    missing, late, nc, alert_days: alertDays,
  });
}));

// Stato di oggi per le sedi visibili
r.get('/today', ah(async (req, res) => {
  const P = new Params();
  const today = P.add(todayRome());
  res.json(await many(`SELECT s.id AS site_id, s.name AS site_name, s.code AS site_code, c.name AS company_name, s.cash_float,
      r.id AS report_id, r.status, (r.cash_to_deposit + r.pos_total + r.transfer_total) AS day_total,
      substr(s.operating_days, extract(isodow FROM ${today}::date)::int, 1) = '1' AS operating
    FROM sites s JOIN companies c ON c.id=s.company_id
    LEFT JOIN cash_reports r ON r.site_id=s.id AND r.report_date=${today}::date
    WHERE ${siteScope(req.user, P)} AND s.active ORDER BY c.name, s.name`, P.values));
}));

// Export CSV dei rendiconti (separatore ; per Excel italiano)
r.get('/export.csv', ah(async (req, res) => {
  const { P, where, from, to } = filters(req);
  const rows = await many(`SELECT c.name AS azienda, s.code AS cod_sede, s.name AS sede, r.report_date AS data, r.status AS stato,
      r.cash_counted AS contante_contato, r.cash_float AS fondo_cassa, r.cash_to_deposit AS contante_versato,
      r.pos_total AS pos, r.transfer_total AS bonifici, (r.cash_to_deposit+r.pos_total+r.transfer_total) AS totale,
      r.expected_total AS gestionale, r.envelope_code AS busta_mondialpol, r.slip_number AS distinta,
      r.pickup_operator AS operatore_logistica, r.pickup_at AS logistica_il, r.verified_amount AS riconteggiato, r.verified_at AS verificato_il, dep.number AS versamento
    FROM cash_reports r JOIN sites s ON s.id=r.site_id JOIN companies c ON c.id=s.company_id LEFT JOIN cash_deposits dep ON dep.id=r.deposit_id
    WHERE ${where.join(' AND ')} AND r.report_date BETWEEN ${P.add(from)} AND ${P.add(to)} ORDER BY r.report_date, c.name, s.name`, P.values);
  const cols = rows.length ? Object.keys(rows[0]) : ['azienda'];
  const fmt = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    if (v instanceof Date) return v.toISOString();
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [cols.join(';'), ...rows.map((row) => cols.map((c) => fmt(row[c])).join(';'))].join('\r\n');
  res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="rendiconti_${from}_${to}.csv"`).send(csv);
}));

export default r;
