import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { many, one, q } from '../db.js';
import { ah, bad, forbidden, eur, itDate, audit, parse, todayRome } from '../lib/util.js';
import { Params, siteScope, assertSite } from '../lib/access.js';
import { computeSiteRoyalty, BASE_LABEL } from '../lib/siteRoyalty.js';
import { letterhead, ASSETS, C, M, W, CONTENT_TOP } from '../pdf/distinta.js';
import { notifyRoyaltyConfirmed } from '../lib/alerts.js';

const r = Router();
r.use((req, _res, next) => (['OPERATOR', 'CASSIERE', 'FINANCE'].includes(req.user.role) ? next(forbidden('Sezione riservata ad amministratori e partner')) : next()));
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthRange = (p) => {
  const [y, m] = p.split('-').map(Number);
  return { start: `${p}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const periodLabel = (p) => `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;

async function siteRevenue(siteId, start, end) {
  const rev = await one(`SELECT coalesce(sum(cash_to_deposit),0) AS cash, coalesce(sum(pos_total),0) AS pos, coalesce(sum(transfer_total),0) AS transfer,
      count(*) FILTER (WHERE status <> 'DRAFT')::int AS reports, count(*) FILTER (WHERE status = 'DRAFT')::int AS drafts
    FROM cash_reports WHERE site_id=$1 AND report_date BETWEEN $2 AND $3 AND status <> 'DRAFT'`, [siteId, start, end]);
  const days = await many(`SELECT report_date, cash_to_deposit AS cash, pos_total AS pos, transfer_total AS transfer
    FROM cash_reports WHERE site_id=$1 AND report_date BETWEEN $2 AND $3 AND status <> 'DRAFT' ORDER BY report_date`, [siteId, start, end]);
  const drafts = await one(`SELECT count(*)::int AS n FROM cash_reports WHERE site_id=$1 AND report_date BETWEEN $2 AND $3 AND status='DRAFT'`, [siteId, start, end]);
  return { cash: Number(rev.cash), pos: Number(rev.pos), transfer: Number(rev.transfer), reports: rev.reports, drafts: drafts.n, days };
}

// Riepilogo mensile di tutte le sedi visibili
r.get('/summary', ah(async (req, res) => {
  const period = String(req.query.period || '');
  if (!PERIOD.test(period)) throw bad('Periodo non valido (AAAA-MM)');
  const { start, end } = monthRange(period);
  const P = new Params();
  const where = [siteScope(req.user, P)];
  if (req.query.company_id) where.push(`s.company_id = ${P.add(Number(req.query.company_id))}`);
  const sites = await many(`SELECT s.*, c.name AS company_name FROM sites s JOIN companies c ON c.id=s.company_id WHERE ${where.join(' AND ')} ORDER BY c.name, s.name`, P.values);
  const confirmed = await many(`SELECT * FROM site_royalty_statements WHERE period=$1 AND cancelled_at IS NULL AND site_id = ANY($2)`, [period, sites.map((x) => x.id)]);
  const partner = req.user.role === 'PARTNER';
  const rows = [];
  for (const s of sites) {
    const st = confirmed.find((x) => x.site_id === s.id);
    if (st) {
      // valori congelati alla conferma
      rows.push({ site_id: s.id, site_name: s.name, site_code: s.code, company_name: s.company_name, host_name: st.terms.host_name ?? s.host_name,
        royalty_fixed_monthly: st.terms.fixed_monthly, royalty_pct: st.terms.pct, royalty_base: st.terms.base, royalty_vat_rate: st.terms.vat_rate,
        revenue: { cash: Number(st.revenue_cash), pos: Number(st.revenue_pos), transfer: Number(st.revenue_transfer), total: Number(st.revenue_cash) + Number(st.revenue_pos) + Number(st.revenue_transfer) },
        reports: st.reports, drafts: 0, base: Number(st.base), fixed: Number(st.fixed), variable: Number(st.variable), taxable: Number(st.taxable), vat: Number(st.vat), total: Number(st.total),
        confirmed: true, confirmed_at: st.confirmed_at, statement_id: st.id });
      continue;
    }
    if (partner) {
      rows.push({ site_id: s.id, site_name: s.name, site_code: s.code, company_name: s.company_name, host_name: s.host_name, confirmed: false, pending: true });
      continue;
    }
    const rev = await siteRevenue(s.id, start, end);
    const k = computeSiteRoyalty(s, rev);
    rows.push({ site_id: s.id, site_name: s.name, site_code: s.code, company_name: s.company_name, host_name: s.host_name,
      royalty_fixed_monthly: s.royalty_fixed_monthly, royalty_pct: s.royalty_pct, royalty_base: s.royalty_base, royalty_vat_rate: s.royalty_vat_rate,
      revenue: { cash: rev.cash, pos: rev.pos, transfer: rev.transfer, total: rev.cash + rev.pos + rev.transfer }, reports: rev.reports, drafts: rev.drafts, ...k, confirmed: false });
  }
  const tot = (f) => rows.filter((x) => !x.pending).reduce((a, x) => a + Number(f(x) || 0), 0);
  res.json({ period, start, end, closed: end < todayRome(), rows, totals: { revenue: tot((x) => x.revenue.total), fixed: tot((x) => x.fixed), variable: tot((x) => x.variable), taxable: tot((x) => x.taxable), vat: tot((x) => x.vat), total: tot((x) => x.total) } });
}));

// Dettaglio di una sede
r.get('/sites/:id', ah(async (req, res) => {
  const period = String(req.query.period || '');
  if (!PERIOD.test(period)) throw bad('Periodo non valido (AAAA-MM)');
  const site = await assertSite(req.user, Number(req.params.id));
  const { start, end } = monthRange(period);
  const st = await one('SELECT * FROM site_royalty_statements WHERE site_id=$1 AND period=$2 AND cancelled_at IS NULL', [site.id, period]);
  if (req.user.role === 'PARTNER' && !st) throw forbidden('Report non ancora confermato dall\'amministratore');
  const rev = await siteRevenue(site.id, start, end);
  res.json({ period, start, end, site, revenue: rev, ...computeSiteRoyalty(site, rev), confirmed: !!st, statement: st || null });
}));

// Conferma mensile (amministratore di sede), solo a periodo concluso: congela valori e condizioni
r.post('/sites/:id/confirm', ah(async (req, res) => {
  if (!['SUPERADMIN', 'ADMIN'].includes(req.user.role)) throw forbidden();
  const period = String(req.body?.period || '');
  if (!PERIOD.test(period)) throw bad('Periodo non valido (AAAA-MM)');
  const site = await assertSite(req.user, Number(req.params.id));
  const { start, end } = monthRange(period);
  if (end >= todayRome()) throw bad('Il mese non è ancora concluso: la conferma si fa dal primo giorno del mese successivo');
  const ex = await one('SELECT id FROM site_royalty_statements WHERE site_id=$1 AND period=$2 AND cancelled_at IS NULL', [site.id, period]);
  if (ex) throw bad('Report già confermato');
  const rev = await siteRevenue(site.id, start, end);
  if (rev.drafts > 0) throw bad(`${rev.drafts} rendiconti del mese sono ancora in bozza: chiudili o eliminali prima di confermare`);
  const k = computeSiteRoyalty(site, rev);
  const row = await one(`INSERT INTO site_royalty_statements (site_id, period, revenue_cash, revenue_pos, revenue_transfer, base, fixed, variable, taxable, vat, total, terms, reports, confirmed_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
  [site.id, period, rev.cash, rev.pos, rev.transfer, k.base, k.fixed, k.variable, k.taxable, k.vat, k.total,
    JSON.stringify({ fixed_monthly: site.royalty_fixed_monthly, pct: site.royalty_pct, base: site.royalty_base, vat_rate: site.royalty_vat_rate, host_name: site.host_name, host_vat: site.host_vat }), rev.reports, req.user.id]);
  await audit(req, 'SITE_ROYALTY_CONFIRM', 'site', site.id, { period, total: k.total });
  let mail = null;
  try {
    const built = await buildSiteRoyaltyPdf(req, null, { period, siteId: site.id });
    mail = await notifyRoyaltyConfirmed({ site, period, statement: { id: row.id, ...k }, pdf: built.pdf, confirmedBy: req.user.full_name });
  } catch (e) { mail = { status: 'FALLITA', error: e.message }; }
  res.status(201).json({ id: row.id, mail });
}));

// Annulla conferma (amministratore), con motivazione: il partner non vede più il report
r.post('/sites/:id/unconfirm', ah(async (req, res) => {
  if (!['SUPERADMIN', 'ADMIN'].includes(req.user.role)) throw forbidden();
  const d = parse(z.object({ period: z.string().regex(PERIOD), reason: z.string().trim().min(5).max(500) }), req.body);
  const site = await assertSite(req.user, Number(req.params.id));
  const st = await one('SELECT id FROM site_royalty_statements WHERE site_id=$1 AND period=$2 AND cancelled_at IS NULL', [site.id, d.period]);
  if (!st) throw bad('Nessuna conferma da annullare');
  await q('UPDATE site_royalty_statements SET cancelled_by=$2, cancelled_at=now(), cancel_reason=$3 WHERE id=$1', [st.id, req.user.id, d.reason]);
  await audit(req, 'SITE_ROYALTY_UNCONFIRM', 'site', site.id, d);
  res.json({ ok: true });
}));

// Report PDF mensile per sede, su carta intestata dell'azienda
r.get('/sites/:id/pdf', ah(async (req, res) => {
  const out = await buildSiteRoyaltyPdf(req, res);
  if (out) res.type('application/pdf').set('Content-Disposition', `inline; filename="Canone_${out.site.code}_${out.period}.pdf"`).send(out.pdf);
}));

async function buildSiteRoyaltyPdf(req, _res, override = {}) {
  const res = null;
  const period = String(override.period || req.query.period || '');
  if (!PERIOD.test(period)) throw bad('Periodo non valido (AAAA-MM)');
  const site0 = await assertSite(req.user, Number(override.siteId || req.params.id));
  const company = await one('SELECT * FROM companies WHERE id=$1', [site0.company_id]);
  const { start, end } = monthRange(period);
  const st = await one('SELECT s.*, u.full_name AS confirmed_by_name FROM site_royalty_statements s LEFT JOIN users u ON u.id=s.confirmed_by WHERE s.site_id=$1 AND s.period=$2 AND s.cancelled_at IS NULL', [site0.id, period]);
  if (req.user.role === 'PARTNER' && !st) throw forbidden('Report non ancora confermato dall\'amministratore');
  let rev = await siteRevenue(site0.id, start, end);
  let site = site0;
  let k;
  if (st) {
    site = { ...site0, royalty_fixed_monthly: st.terms.fixed_monthly, royalty_pct: st.terms.pct, royalty_base: st.terms.base, royalty_vat_rate: st.terms.vat_rate, host_name: st.terms.host_name ?? site0.host_name, host_vat: st.terms.host_vat ?? site0.host_vat };
    rev = { ...rev, cash: Number(st.revenue_cash), pos: Number(st.revenue_pos), transfer: Number(st.revenue_transfer), reports: st.reports, drafts: 0 };
    k = { base: Number(st.base), fixed: Number(st.fixed), variable: Number(st.variable), taxable: Number(st.taxable), vat: Number(st.vat), total: Number(st.total) };
  } else {
    k = computeSiteRoyalty(site, rev);
  }

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Canone sede ${site.code} ${period}`, Author: company.name } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  void res;
  letterhead(doc, company);
  let y = CONTENT_TOP;
  doc.rect(M.left, y, W, 26).fill(C.teal);
  doc.font('B').fontSize(13).fillColor('#FFFFFF').text('REPORT MENSILE ROYALTY DI SEDE', M.left + 10, y + 7, { lineBreak: false });
  doc.font('B').fontSize(9).fillColor(C.silk).text(`${periodLabel(period).toUpperCase()}${st ? ' · CONFERMATO' : ' · PROVVISORIO'}`, M.left, y + 9, { width: W - 10, align: 'right' });
  y += 38;
  const kv = [['Sede', `${site.name} (${site.code})${site.address ? `, ${site.address}` : ''}${site.city ? `, ${site.city}` : ''}${site.province ? ` (${site.province})` : ''}`],
    ['Struttura ospitante', [site.host_name, site.host_vat && `P.IVA ${site.host_vat}`].filter(Boolean).join(', ') || 'non indicata'],
    ['Periodo', `${itDate(start)} – ${itDate(end)}`],
    ['Rendiconti considerati', `${rev.reports}${rev.drafts ? ` (esclusi ${rev.drafts} in bozza)` : ''}`],
    ['Stato', st ? `Confermato da ${st.confirmed_by_name} il ${itDate(st.confirmed_at.toISOString())}: valori definitivi per la fatturazione` : 'Provvisorio, in attesa di conferma dell\'amministratore di sede'],
    ['Condizioni', `${site.royalty_fixed_monthly > 0 ? `quota fissa ${eur(site.royalty_fixed_monthly)}/mese` : ''}${site.royalty_fixed_monthly > 0 && site.royalty_pct > 0 ? ' + ' : ''}${site.royalty_pct > 0 ? `${site.royalty_pct}% su ${BASE_LABEL[site.royalty_base].toLowerCase()}` : ''}${!(site.royalty_fixed_monthly > 0) && !(site.royalty_pct > 0) ? 'nessun canone configurato' : ''}, IVA ${site.royalty_vat_rate}%`]];
  for (const [a, b] of kv) {
    doc.font('R').fontSize(8.5).fillColor(C.grey).text(a, M.left, y, { width: 110 });
    doc.font('B').fontSize(9).fillColor(C.jet).text(b, M.left + 112, y - 0.5, { width: W - 112 });
    y = doc.y + 4;
  }
  y += 8;
  const row = (cells, { bold = false, fill = null, size = 9, h = 16, color = C.jet } = {}) => {
    if (fill) doc.rect(M.left, y, W, h).fill(fill);
    doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(color).text(cells[0], M.left + 6, y + (h - size) / 2 - 0.5, { width: W * 0.7, lineBreak: false });
    doc.text(cells[1], M.left, y + (h - size) / 2 - 0.5, { width: W - 6, align: 'right', lineBreak: false });
    y += h;
    doc.moveTo(M.left, y).lineTo(M.left + W, y).lineWidth(0.4).strokeColor(C.line).stroke();
  };
  doc.font('B').fontSize(9.5).fillColor(C.teal).text('Incassi del periodo', M.left, y); y += 14;
  row(['Contanti (al netto del fondo cassa)', eur(rev.cash)]);
  row(['POS', eur(rev.pos)]);
  row(['Bonifici', eur(rev.transfer)]);
  row(['Totale incassi', eur(rev.cash + rev.pos + rev.transfer)], { bold: true });
  y += 12;
  doc.font('B').fontSize(9.5).fillColor(C.teal).text('Calcolo del canone', M.left, y); y += 14;
  row([`Base di calcolo: ${BASE_LABEL[site.royalty_base]}`, eur(k.base)]);
  row([`Quota variabile ${site.royalty_pct}%`, eur(k.variable)]);
  row(['Quota fissa mensile', eur(k.fixed)]);
  row(['Imponibile', eur(k.taxable)], { bold: true });
  row([`IVA ${site.royalty_vat_rate}%`, eur(k.vat)]);
  row(['TOTALE CANONE DEL MESE', eur(k.total)], { bold: true, fill: C.silk, size: 11, h: 22 });
  y += 14;
  if (rev.days.length) {
    doc.font('B').fontSize(9.5).fillColor(C.teal).text('Dettaglio giornaliero', M.left, y); y += 14;
    const cw = [W * 0.28, W * 0.18, W * 0.18, W * 0.18, W * 0.18];
    const drow = (cells, bold, fill) => {
      if (y > 760) { doc.addPage(); letterhead(doc, company); y = CONTENT_TOP; }
      if (fill) doc.rect(M.left, y, W, 13).fill(fill);
      let x = M.left;
      cells.forEach((c, i) => { doc.font(bold ? 'B' : 'R').fontSize(8).fillColor(bold && fill ? '#FFFFFF' : C.jet).text(c, x + 5, y + 2.5, { width: cw[i] - 10, align: i ? 'right' : 'left', lineBreak: false }); x += cw[i]; });
      y += 13; doc.moveTo(M.left, y).lineTo(M.left + W, y).lineWidth(0.3).strokeColor(C.line).stroke();
    };
    drow(['Data', 'Contanti', 'POS', 'Bonifici', 'Totale'], true, C.blue);
    for (const d of rev.days) drow([itDate(d.report_date), eur(d.cash), eur(d.pos), eur(d.transfer), eur(Number(d.cash) + Number(d.pos) + Number(d.transfer))]);
  }
  y += 14;
  if (y > 740) { doc.addPage(); letterhead(doc, company); y = CONTENT_TOP; }
  doc.font('R').fontSize(7.5).fillColor(C.grey).text(
    `Report generato il ${itDate(new Date().toISOString())} dal sistema Cash Management sui rendiconti giornalieri della sede. La quota fissa è applicata per intero anche in caso di mese parziale. ` +
    'Documento di riepilogo del calcolo: la fattura della struttura ospitante segue il flusso contabile ordinario.', M.left, y, { width: W });
  doc.end();
  return { pdf: await done, site, period };
}

export default r;
