import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import path from 'node:path';
import { eur, itDate } from '../lib/util.js';
import { letterhead, ASSETS, C, M, W, CONTENT_TOP, CONTENT_BOTTOM } from './distinta.js';

const fullDT = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);

/**
 * Distinta di versamento al portavalori (livello azienda) con catena di custodia.
 * Pagina 1: distinta (rendiconti inclusi, buste, totale, firma di chi prepara).
 * Pagina 2: catena di custodia azienda -> portavalori -> banca.
 */
export async function buildDepositPdf({ deposit, company, reports, preparedBy }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true,
    info: { Title: `Versamento ${deposit.number}`, Author: company.name } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  let y;
  const newPage = () => { doc.addPage(); letterhead(doc, company); y = CONTENT_TOP; };
  const title = (t, right) => {
    doc.rect(M.left, y, W, 26).fill(C.teal);
    doc.font('B').fontSize(13).fillColor('#FFFFFF').text(t, M.left + 10, y + 7, { lineBreak: false });
    if (right) doc.font('B').fontSize(8.5).fillColor(C.silk).text(right, M.left, y + 9.5, { width: W - 10, align: 'right' });
    y += 36;
  };
  const kv = (rows) => {
    for (const [k, v] of rows) {
      doc.font('R').fontSize(8).fillColor(C.grey).text(k, M.left, y, { width: 110 });
      doc.font('B').fontSize(9).fillColor(C.jet).text(v, M.left + 112, y - 0.5, { width: W - 112 });
      y = doc.y + 3.5;
    }
    y += 6;
  };
  let cols = [];
  const row = (cells, { bold = false, fill = null, color = C.jet, size = 8.5, h = 14 } = {}) => {
    if (y + h > CONTENT_BOTTOM - 10) { newPage(); }
    if (fill) doc.rect(M.left, y, W, h).fill(fill);
    let x = M.left;
    cells.forEach((cell, i) => {
      doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(color).text(cell ?? '', x + 5, y + (h - size) / 2 - 0.5, { width: cols[i] - 10, align: i === 0 ? 'left' : 'right', lineBreak: false });
      x += cols[i];
    });
    y += h;
    doc.moveTo(M.left, y).lineTo(M.left + W, y).lineWidth(0.4).strokeColor(C.line).stroke();
  };
  const section = (t) => { doc.font('B').fontSize(9.5).fillColor(C.teal).text(t, M.left, y); y += 14; };

  // ---- Pagina 1: distinta di versamento
  newPage();
  title('DISTINTA DI VERSAMENTO AL PORTAVALORI', `N. ${deposit.number}`);
  kv([['Azienda', `${company.name}${company.vat_number ? `, P.IVA ${company.vat_number}` : ''}`],
    ['Data versamento', itDate(deposit.deposit_date)],
    ['Preparata da', `${preparedBy}, ${fullDT(deposit.created_at)}`],
    ['Rendiconti inclusi', `${reports.length}`],
    ['Note', deposit.notes || '–']]);

  section('Rendiconti verificati inclusi nel versamento');
  cols = [W * 0.16, W * 0.34, W * 0.2, W * 0.15, W * 0.15];
  row(['Data', 'Sede', 'Busta sede', 'Distinta', 'Verificato'], { bold: true, fill: C.blue, color: '#FFFFFF', size: 8 });
  for (const r of reports) row([itDate(r.report_date), r.site_name, r.envelope_code || '–', eur(r.cash_to_deposit), eur(r.verified_amount)]);
  cols = [W * 0.85, W * 0.15];
  row(['TOTALE VERSATO', eur(deposit.total_amount)], { bold: true, fill: C.silk, size: 10.5, h: 20 });
  y += 12;

  section('Buste Mondialpol del versamento');
  const envs = deposit.envelopes || [];
  const bw = Math.min(W, 170), gap = 12;
  const perRow = Math.max(1, Math.floor((W + gap) / (bw + gap)));
  for (let i = 0; i < envs.length; i++) {
    const col = i % perRow;
    if (col === 0 && i > 0) y += 84;
    if (y + 80 > CONTENT_BOTTOM - 10) { newPage(); }
    const x = M.left + col * (bw + gap);
    doc.roundedRect(x, y, bw, 78, 4).lineWidth(0.8).strokeColor(C.teal).stroke();
    const bc = await bwipjs.toBuffer({ bcid: 'code128', text: envs[i].code, scale: 3, height: 12, includetext: false, backgroundcolor: 'FFFFFF' });
    doc.image(bc, x + 8, y + 8, { fit: [bw - 16, 34], align: 'center' });
    doc.font('B').fontSize(9.5).fillColor(C.jet).text(envs[i].code, x, y + 46, { width: bw, align: 'center', characterSpacing: 1 });
    doc.font('R').fontSize(8).fillColor(C.grey).text(envs[i].amount != null ? eur(envs[i].amount) : '', x, y + 60, { width: bw, align: 'center' });
  }
  y += envs.length ? 90 : 4;

  // firma di chi prepara
  const sigH = 78;
  if (y + sigH > CONTENT_BOTTOM) newPage();
  y = Math.max(y, CONTENT_BOTTOM - sigH);
  const sw = W * 0.6, sx = M.left + (W - sw) / 2;
  doc.roundedRect(sx, y, sw, sigH - 6, 4).lineWidth(0.8).strokeColor(C.teal).stroke();
  doc.font('B').fontSize(8.5).fillColor(C.teal).text('VERSAMENTO PREPARATO E FIRMATO DA', sx + 8, y + 7);
  let ly = y + 22;
  for (const [label, value] of [['Nome', preparedBy], ['Data', fullDT(deposit.created_at)], ['Firma', null]]) {
    doc.font('R').fontSize(8).fillColor(C.grey).text(label, sx + 8, ly);
    if (value) doc.font('B').fontSize(8.5).fillColor(C.jet).text(value, sx + 60, ly - 0.5, { width: sw - 68, lineBreak: false });
    else doc.moveTo(sx + 60, ly + 9).lineTo(sx + sw - 8, ly + 9).lineWidth(0.5).strokeColor(C.grey).stroke();
    ly += 16;
  }

  // ---- Pagina 2: catena di custodia del versamento
  newPage();
  title('CATENA DI CUSTODIA · VERSAMENTO', `N. ${deposit.number}`);
  kv([['Azienda', company.name], ['Data versamento', itDate(deposit.deposit_date)], ['Importo', eur(deposit.total_amount)],
    ['Buste', envs.map((e) => e.code).join(', ') || '–']]);
  const step = (n, t, sub, rows, h) => {
    doc.roundedRect(M.left, y, W, h, 5).lineWidth(0.9).strokeColor(C.teal).stroke();
    doc.circle(M.left + 18, y + 16, 10).fill(C.teal);
    doc.font('B').fontSize(10).fillColor('#FFFFFF').text(String(n), M.left + 8, y + 10.5, { width: 20, align: 'center' });
    doc.font('B').fontSize(10).fillColor(C.jet).text(t, M.left + 36, y + 9);
    doc.font('R').fontSize(8).fillColor(C.grey).text(sub, M.left + 36, y + 22, { width: W - 46 });
    let ry = y + 40;
    const colW = (W - 24) / 2;
    rows.forEach(([label, value], i) => {
      const col = i % 2, x = M.left + 12 + col * colW;
      if (col === 0 && i > 0) ry += 24;
      doc.font('R').fontSize(7.5).fillColor(C.grey).text(label, x, ry);
      if (value) doc.font('B').fontSize(9).fillColor(C.jet).text(value, x, ry + 9, { width: colW - 16, lineBreak: false });
      else doc.moveTo(x, ry + 18).lineTo(x + colW - 16, ry + 18).lineWidth(0.5).strokeColor(C.grey).stroke();
    });
    y += h + 10;
  };
  step(1, 'Preparazione delle buste (Area Finance)', 'Il contante verificato viene inserito nelle buste, sigillato e i codici registrati a sistema.',
    [['Preparato da', preparedBy], ['Data e ora', fullDT(deposit.created_at)], ['Sigilli integri (sì/no)', null], ['Firma Area Finance', null]], 96);
  step(2, 'Consegna al portavalori', 'L\'operatore del portavalori verifica i codici a barre e l\'integrità dei sigilli, poi prende in carico le buste. Firmano entrambi.',
    [['Operatore portavalori (nome e cognome)', deposit.operator_name || null], ['Data e ora ritiro', fullDT(deposit.picked_at)], ['Documento / matricola', null], ['Targa o codice mezzo', null],
      ['Firma di chi consegna', null], ['Firma operatore portavalori', null]], 120);
  step(3, 'Accredito in banca', 'Compilato alla conferma dell\'accredito sul conto. Differenze rispetto al versato generano una segnalazione.',
    [['Importo accreditato', deposit.bank_amount != null ? eur(deposit.bank_amount) : null], ['Data accredito', deposit.bank_date ? itDate(deposit.bank_date) : null], ['Differenza', deposit.bank_amount != null ? eur(deposit.bank_amount - deposit.total_amount) : null], ['Verificato da', null]], 96);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font('R').fontSize(7).fillColor(C.grey).text(`Versamento ${deposit.number} · pag. ${i + 1}/${range.count}`, M.left, 841.89 - M.bottom + 8, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
