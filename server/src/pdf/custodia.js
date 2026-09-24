import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import path from 'node:path';
import { eur, itDate } from '../lib/util.js';
import { letterhead, ASSETS, C, M, W, CONTENT_TOP, CONTENT_BOTTOM } from './distinta.js';

const fullDT = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);

/**
 * Modulo Catena di custodia della busta Mondialpol.
 * Aperto da chi prepara la busta; firmato da utente e operatore di logistica alla consegna;
 * terzo riquadro per la ricezione al centro conta / banca.
 */
export async function buildCustodyPdf({ report, company, site, preparedBy, preparedAt }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: `Catena di custodia ${report.envelope_code || report.slip_number}`, Author: company.name } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  doc.addPage();
  letterhead(doc, company);
  let y = CONTENT_TOP;
  doc.rect(M.left, y, W, 26).fill(C.teal);
  doc.font('B').fontSize(13).fillColor('#FFFFFF').text('CATENA DI CUSTODIA · BUSTA VALORI', M.left + 10, y + 7, { lineBreak: false });
  doc.font('B').fontSize(8.5).fillColor(C.silk).text(`Rif. distinta ${report.slip_number || '-'}`, M.left, y + 9.5, { width: W - 10, align: 'right' });
  y += 36;

  // Identificazione
  const info = [
    ['Azienda', company.name],
    ['Sede', `${site.name} (${site.code})${site.address ? `, ${site.address}` : ''}${site.city ? `, ${site.city}` : ''}${site.province ? ` (${site.province})` : ''}`],
    ['Rendiconto del', itDate(report.report_date)],
  ];
  const infoW = W * 0.58;
  let iy = y;
  for (const [k, v] of info) {
    doc.font('R').fontSize(8).fillColor(C.grey).text(k, M.left, iy, { width: 90 });
    doc.font('B').fontSize(9).fillColor(C.jet).text(v, M.left + 92, iy - 0.5, { width: infoW - 92 });
    iy = doc.y + 3.5;
  }
  const bx = M.left + infoW + 8, bw = W - infoW - 8, bh = 78;
  doc.roundedRect(bx, y - 2, bw, bh, 4).lineWidth(1).strokeColor(C.teal).stroke();
  doc.font('B').fontSize(8).fillColor(C.teal).text('CODICE BUSTA MONDIALPOL', bx + 8, y + 4);
  if (report.envelope_code) {
    const bc = await bwipjs.toBuffer({ bcid: 'code128', text: report.envelope_code, scale: 3, height: 13, includetext: false, backgroundcolor: 'FFFFFF' });
    doc.image(bc, bx + 8, y + 17, { fit: [bw - 16, 38], align: 'center' });
    doc.font('B').fontSize(10).fillColor(C.jet).text(report.envelope_code, bx, y + 58, { width: bw, align: 'center', characterSpacing: 1 });
  } else {
    doc.font('R').fontSize(9).fillColor(C.grey).text('Nessuna busta', bx, y + 34, { width: bw, align: 'center' });
  }
  y = Math.max(iy, y + bh) + 14;

  // Tre passaggi di custodia
  const step = (n, title, subtitle, rows, h) => {
    doc.roundedRect(M.left, y, W, h, 5).lineWidth(0.9).strokeColor(C.teal).stroke();
    doc.circle(M.left + 18, y + 16, 10).fill(C.teal);
    doc.font('B').fontSize(10).fillColor('#FFFFFF').text(String(n), M.left + 8, y + 10.5, { width: 20, align: 'center' });
    doc.font('B').fontSize(10).fillColor(C.jet).text(title, M.left + 36, y + 9);
    doc.font('R').fontSize(8).fillColor(C.grey).text(subtitle, M.left + 36, y + 22, { width: W - 46 });
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

  step(1, 'Preparazione e sigillatura della busta',
    'Chi ha elaborato la cassa inserisce il contante e la copia della distinta nella busta, la sigilla e ne verifica l\'integrità.',
    [['Preparata da', preparedBy], ['Data e ora', fullDT(preparedAt)], ['Sigillo integro (sì/no)', null], ['Firma di chi prepara', null]], 96);

  step(2, 'Operazione logistica: consegna all\'amministratore di sede',
    'L\'operatore di logistica trasporta la busta sigillata e la consegna all\'amministratore di sede, che verifica codice a barre e integrità del sigillo e la ripone in cassaforte. Firmano entrambi.',
    [['Operatore logistica (nome e cognome)', report.pickup_operator || null], ['Data e ora consegna', fullDT(report.pickup_at)], ['Documento / matricola operatore', null], ['Ricevuta da (amministratore di sede)', null],
      ['Firma operatore logistica', null], ['Firma amministratore di sede', null]], 120);

  step(3, 'Ricezione Area Finance - Toscana Diagnostica',
    'Riconteggio e verifica del contenuto. Eventuali differenze rispetto alla distinta generano una segnalazione alla sede.',
    [['Riconteggiata da', report.verified_by_name || null], ['Data e ora', fullDT(report.verified_at)], ['Importo verificato', report.verified_amount != null ? eur(report.verified_amount) : null], ['Anomalie riscontrate', report.verified_amount != null ? (Number(report.verified_amount) === Number(report.cash_to_deposit) ? 'Nessuna' : `Differenza ${eur(report.verified_amount - report.cash_to_deposit)}`) : null], ['Firma Area Finance', null], ['Timbro', null]], 120);

  // Note e piè
  const noteY = Math.min(y, CONTENT_BOTTOM - 40);
  doc.font('R').fontSize(7.5).fillColor(C.grey).text(
    `Modulo generato dal sistema Cash Management il ${fullDT(new Date())}. ID rendiconto ${report.id}. Una copia firmata resta in sede, una segue la busta. ` +
    'Ogni passaggio di mano deve essere firmato: in assenza di firma la custodia resta in capo all\'ultimo firmatario.', M.left, noteY, { width: W });
  doc.end();
  return done;
}
