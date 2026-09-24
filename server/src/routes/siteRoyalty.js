import { Router } from 'express';
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { many, one } from '../db.js';
import { ah, bad, eur, itDate } from '../lib/util.js';
import { Params, siteScope, assertSite } from '../lib/access.js';
import { computeSiteRoyalty, BASE_LABEL } from '../lib/siteRoyalty.js';
import { letterhead, ASSETS, C, M, W, CONTENT_TOP } from '../pdf/distinta.js';

const r = Router();
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
  const rows = [];
  for (const s of sites) {
    const rev = await siteRevenue(s.id, start, end);
    const k = computeSiteRoyalty(s, rev);
    rows.push({ site_id: s.id, site_name: s.name, site_code: s.code, company_name: s.company_name, host_name: s.host_name,
      royalty_fixed_monthly: s.royalty_fixed_monthly, royalty_pct: s.royalty_pct, royalty_base: s.royalty_base, royalty_vat_rate: s.royalty_vat_rate,
      revenue: { cash: rev.cash, pos: rev.pos, transfer: rev.transfer, total: rev.cash + rev.pos + rev.transfer }, reports: rev.reports, drafts: rev.drafts, ...k });
  }
  const tot = (f) => rows.reduce((a, x) => a + Number(f(x)), 0);
  res.json({ period, start, end, rows, totals: { revenue: tot((x) => x.revenue.total), fixed: tot((x) => x.fixed), variable: tot((x) => x.variable), taxable: tot((x) => x.taxable), vat: tot((x) => x.vat), total: tot((x) => x.total) } });
}));

// Dettaglio di una sede
r.get('/sites/:id', ah(async (req, res) => {
  const period = String(req.query.period || '');
  if (!PERIOD.test(period)) throw bad('Periodo non valido (AAAA-MM)');
  const site = await assertSite(req.user, Number(req.params.id));
  const { start, end } = monthRange(period);
  const rev = await siteRevenue(site.id, start, end);
  res.json({ period, start, end, site, revenue: rev, ...computeSiteRoyalty(site, rev) });
}));

// Report PDF mensile per sede, su carta intestata dell'azienda
r.get('/sites/:id/pdf', ah(async (req, res) => {
  const period = String(req.query.period || '');
  if (!PERIOD.test(period)) throw bad('Periodo non valido (AAAA-MM)');
  const site = await assertSite(req.user, Number(req.params.id));
  const company = await one('SELECT * FROM companies WHERE id=$1', [site.company_id]);
  const { start, end } = monthRange(period);
  const rev = await siteRevenue(site.id, start, end);
  const k = computeSiteRoyalty(site, rev);

  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, info: { Title: `Canone sede ${site.code} ${period}`, Author: company.name } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  res.type('application/pdf').set('Content-Disposition', `inline; filename="Canone_${site.code}_${period}.pdf"`);
  doc.pipe(res);
  letterhead(doc, company);
  let y = CONTENT_TOP;
  doc.rect(M.left, y, W, 26).fill(C.teal);
  doc.font('B').fontSize(13).fillColor('#FFFFFF').text('REPORT MENSILE ROYALTY DI SEDE', M.left + 10, y + 7, { lineBreak: false });
  doc.font('B').fontSize(9).fillColor(C.silk).text(periodLabel(period).toUpperCase(), M.left, y + 9, { width: W - 10, align: 'right' });
  y += 38;
  const kv = [['Sede', `${site.name} (${site.code})${site.address ? `, ${site.address}` : ''}${site.city ? `, ${site.city}` : ''}`],
    ['Struttura ospitante', [site.host_name, site.host_vat && `P.IVA ${site.host_vat}`].filter(Boolean).join(', ') || 'non indicata'],
    ['Periodo', `${itDate(start)} – ${itDate(end)}`],
    ['Rendiconti considerati', `${rev.reports}${rev.drafts ? ` (esclusi ${rev.drafts} in bozza)` : ''}`],
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
}));

export default r;
