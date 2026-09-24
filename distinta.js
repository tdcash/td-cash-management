import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eur, itDate } from '../lib/util.js';

const fullDT = (d) => new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
import { BANKNOTES } from '../lib/cash.js';

export const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
export const C = { teal: '#1C505E', blue: '#71B1BD', jet: '#01212C', silk: '#FFFAE3', mauve: '#DEC0F1', grey: '#5B6B70', line: '#C9D9DC' };
const CIRCUIT_LABEL = { BANCOMAT: 'Bancomat', CARTA_CREDITO: 'Carta di credito', BUONI_PASTO: 'Buoni pasto', APP: 'App di pagamento', ALTRO: 'Altro' };

const MM = 2.8346;
export const PAGE = { w: 595.28, h: 841.89 };
export const M = { left: 20 * MM, right: 20 * MM, top: 12 * MM, bottom: 14 * MM };
export const CONTENT_TOP = 42 * MM;           // sotto l'intestazione
export const CONTENT_BOTTOM = PAGE.h - 30 * MM; // sopra il piè di pagina
export const W = PAGE.w - M.left - M.right;

async function barcode(text) {
  return bwipjs.toBuffer({ bcid: 'code128', text, scale: 3, height: 13, includetext: false, backgroundcolor: 'FFFFFF' });
}

export function letterhead(doc, company) {
  // Intestazione: logo a sinistra, contatti a destra (come la carta intestata aziendale)
  const top = M.top;
  if (company.logo) {
    try { doc.image(company.logo, M.left, top + 2, { fit: [66 * MM, 20 * MM] }); } catch { /* logo non leggibile */ }
  } else {
    doc.font('B').fontSize(16).fillColor(C.teal).text(company.name, M.left, top + 8);
  }
  const contacts = [
    company.email && ['icon-mail.png', company.email],
    company.pec && ['icon-mail.png', company.pec],
    company.website && ['icon-web.png', company.website],
  ].filter(Boolean);
  let y = top + 3;
  doc.font('R').fontSize(8).fillColor(C.teal);
  for (const [icon, txt] of contacts) {
    const tw = doc.widthOfString(txt);
    const x = PAGE.w - M.right - tw;
    try { doc.image(path.join(ASSETS, icon), x - 11, y + 0.5, { width: 8 }); } catch { /* */ }
    doc.text(txt, x, y, { lineBreak: false });
    y += 13;
  }
  // Piè di pagina
  const fy = PAGE.h - M.bottom - 20;
  doc.font('B').fontSize(8).fillColor(C.teal).text(company.name, M.left, fy, { width: W, align: 'center' });
  const footer = company.letterhead_footer ||
    [company.address, [company.zip, company.city, company.province && `(${company.province})`].filter(Boolean).join(' '),
      company.vat_number && `P.IVA ${company.vat_number}`].filter(Boolean).join(', ');
  doc.font('R').fontSize(7.5).fillColor(C.teal).text(footer, M.left, fy + 10, { width: W, align: 'center', lineGap: 1 });
}

export async function buildSlipPdf({ report, company, site, number, revision, processedBy, processedAt }) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true,
    info: { Title: `Distinta ${number} rev. ${revision}`, Author: company.name, Subject: 'Distinta di versamento', Creator: 'TD Cash Management' } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const bc = report.envelope_code ? await barcode(report.envelope_code) : null;
  const copies = ['COPIA SEDE', 'COPIA IN BUSTA'];

  for (let ci = 0; ci < copies.length; ci++) {
    let y;
    const newPage = () => { doc.addPage(); letterhead(doc, company); y = CONTENT_TOP; };
    const ensure = (h) => { if (y + h > CONTENT_BOTTOM) { newPage(); cont(); } };
    const cont = () => {
      doc.font('R').fontSize(8).fillColor(C.grey).text(`Distinta ${number} rev. ${revision} · ${copies[ci]} · segue`, M.left, y, { width: W, align: 'right' });
      y += 14;
    };
    newPage();

    // Titolo
    doc.rect(M.left, y, W, 26).fill(C.teal);
    doc.font('B').fontSize(13).fillColor('#FFFFFF').text('DISTINTA DI VERSAMENTO INCASSO', M.left + 10, y + 7, { lineBreak: false });
    doc.font('B').fontSize(8.5).fillColor(C.silk).text(`${copies[ci]} · ${ci + 1} di 2`, M.left, y + 9.5, { width: W - 10, align: 'right' });
    y += 34;

    // Dati identificativi
    const info = [
      ['Azienda', `${company.name} (${company.code})`],
      ['Sede', `${site.name} (${site.code})${site.address ? `, ${site.address}` : ''}${site.city ? `, ${site.city}` : ''}`],
      ['Data incasso', itDate(report.report_date)],
      ['N. distinta', `${number}  ·  rev. ${revision}`],
      ['Elaborata il', fullDT(processedAt)],
    ];
    const infoW = W * 0.58;
    let iy = y;
    for (const [k, v] of info) {
      doc.font('R').fontSize(8).fillColor(C.grey).text(k, M.left, iy, { width: 70 });
      doc.font('B').fontSize(9).fillColor(C.jet).text(v, M.left + 72, iy - 0.5, { width: infoW - 72 });
      iy = doc.y + 3.5;
    }
    // Riquadro busta Mondialpol
    const bx = M.left + infoW + 8, bw = W - infoW - 8, bh = 78;
    doc.roundedRect(bx, y - 2, bw, bh, 4).lineWidth(1).strokeColor(C.teal).stroke();
    doc.font('B').fontSize(8).fillColor(C.teal).text('BUSTA MONDIALPOL', bx + 8, y + 4);
    if (bc) {
      doc.image(bc, bx + 8, y + 17, { fit: [bw - 16, 38], align: 'center' });
      doc.font('B').fontSize(10).fillColor(C.jet).text(report.envelope_code, bx, y + 58, { width: bw, align: 'center', characterSpacing: 1 });
    } else {
      doc.font('R').fontSize(9).fillColor(C.grey).text('Nessun contante da versare', bx, y + 34, { width: bw, align: 'center' });
    }
    y = Math.max(iy, y + bh) + 10;

    // Tabelle affiancate: conteggio contante (sx) e riepilogo incassi (dx)
    const gap = 12;
    const colW = (W - gap) / 2;
    const table = (x0, w, widths, startY) => {
      let ty = startY;
      const cols = widths.map((p) => w * p);
      return {
        get y() { return ty; },
        title(t) { doc.font('B').fontSize(9.5).fillColor(C.teal).text(t, x0, ty); ty += 14; },
        row(cells, { bold = false, fill = null, color = C.jet, size = 8.5, h = 14 } = {}) {
          if (fill) doc.rect(x0, ty, w, h).fill(fill);
          let x = x0;
          cells.forEach((cell, i) => {
            doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(color)
              .text(cell ?? '', x + 5, ty + (h - size) / 2 - 0.5, { width: cols[i] - 10, align: i === 0 ? 'left' : 'right', lineBreak: false });
            x += cols[i];
          });
          ty += h;
          doc.moveTo(x0, ty).lineTo(x0 + w, ty).lineWidth(0.4).strokeColor(C.line).stroke();
        },
      };
    };
    const L = table(M.left, colW, [0.5, 0.18, 0.32], y);
    L.title('Conteggio contante in cassa');
    L.row(['Taglio', 'Pezzi', 'Importo'], { bold: true, fill: C.blue, color: '#FFFFFF', size: 8 });
    for (const d of BANKNOTES) {
      const n = Number(report.denominations[d] || 0);
      L.row([`Banconote da ${eur(d).replace(',00', '')}`, n ? String(n) : '–', n ? eur(n * d) : '–']);
    }
    L.row(['Monete (totale)', '', eur(report.coins_total)]);
    L.row(['Totale contante contato', '', eur(report.cash_counted)], { bold: true });
    L.row(['Fondo cassa trattenuto', '', `– ${eur(report.cash_float)}`]);
    L.row(['VERSATO IN BUSTA', '', eur(report.cash_to_deposit)], { bold: true, fill: C.silk, size: 10.5, h: 20 });

    const R = table(M.left + colW + gap, colW, [0.52, 0.18, 0.30], y);
    R.title('Riepilogo incassi della giornata');
    R.row(['Metodo', 'N.', 'Importo'], { bold: true, fill: C.blue, color: '#FFFFFF', size: 8 });
    R.row(['Contanti (netto fondo cassa)', '', eur(report.cash_to_deposit)]);
    R.row(['POS', String(report.receipts.length), eur(report.pos_total)]);
    R.row(['Bonifici', String(report.transfers.length), eur(report.transfer_total)]);
    R.row(['TOTALE GIORNATA', '', eur(report.day_total)], { bold: true, fill: '#EEF5F6' });
    if (report.expected_total != null) {
      R.row(['Incasso da gestionale', '', eur(report.expected_total)]);
      R.row(['Differenza di cassa', '', eur(report.difference)], { bold: true, color: report.difference ? '#A0302A' : C.jet });
    }
    y = Math.max(L.y, R.y) + 12;

    // righe a tutta larghezza (dettagli)
    let cols = [W * 0.62, W * 0.16, W * 0.22];
    const row = (cells, { bold = false, fill = null, color = C.jet, size = 8, h = 12.5 } = {}) => {
      ensure(h);
      if (fill) doc.rect(M.left, y, W, h).fill(fill);
      let x = M.left;
      cells.forEach((cell, i) => {
        doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(color)
          .text(cell ?? '', x + 5, y + (h - size) / 2 - 0.5, { width: cols[i] - 10, align: i === 0 ? 'left' : 'right', lineBreak: false });
        x += cols[i];
      });
      y += h;
      doc.moveTo(M.left, y).lineTo(M.left + W, y).lineWidth(0.4).strokeColor(C.line).stroke();
    };
    const section = (t) => { ensure(28); doc.font('B').fontSize(9.5).fillColor(C.teal).text(t, M.left, y); y += 14; };

    // Dettagli POS e bonifici
    const detail = (title, headers, widths, rows) => {
      if (!rows.length) return;
      section(title);
      cols = widths.map((p) => W * p);
      row(headers, { bold: true, fill: '#E4EEF0', size: 7.5, h: 13 });
      rows.forEach((r) => row(r));
      y += 8;
    };
    detail('Dettaglio scontrini POS', ['Circuito / terminale / n. scontrino', 'Autorizz.', 'Importo'], [0.62, 0.16, 0.22],
      report.receipts.map((x) => [
        [CIRCUIT_LABEL[x.circuit] || x.circuit, x.terminal_id && `TID ${x.terminal_id}`, x.receipt_number && `n. ${x.receipt_number}`].filter(Boolean).join(' · '),
        x.auth_code || '', eur(x.amount)]));
    detail('Dettaglio bonifici', ['CRO / TRN · ordinante', 'Valuta', 'Importo'], [0.62, 0.16, 0.22],
      report.transfers.map((x) => [[x.cro, x.payer].filter(Boolean).join(' · '), x.value_date ? itDate(x.value_date) : '', eur(x.amount)]));

    if (report.notes) {
      section('Note');
      doc.font('R').fontSize(8.5).fillColor(C.jet);
      const h = doc.heightOfString(report.notes, { width: W });
      ensure(h + 6);
      doc.text(report.notes, M.left, y, { width: W });
      y += h + 10;
    }

    // Firma di chi ha elaborato la cassa: sempre in fondo all'ultima pagina della copia
    const sigH = 84;
    if (y + sigH > CONTENT_BOTTOM) { newPage(); cont(); }
    y = CONTENT_BOTTOM - sigH;
    const sw = W * 0.6;
    const sx = M.left + (W - sw) / 2;
    doc.roundedRect(sx, y, sw, sigH - 6, 4).lineWidth(0.8).strokeColor(C.teal).stroke();
    doc.font('B').fontSize(8.5).fillColor(C.teal).text('CASSA ELABORATA E FIRMATA DA', sx + 8, y + 7);
    let ly = y + 22;
    for (const [label, value] of [['Nome', processedBy], ['Data', fullDT(processedAt)], ['Firma', null]]) {
      doc.font('R').fontSize(8).fillColor(C.grey).text(label, sx + 8, ly);
      if (value) doc.font('B').fontSize(8.5).fillColor(C.jet).text(value, sx + 60, ly - 0.5, { width: sw - 68, lineBreak: false });
      else doc.moveTo(sx + 60, ly + 9).lineTo(sx + sw - 8, ly + 9).lineWidth(0.5).strokeColor(C.grey).stroke();
      ly += 17;
    }
    doc.font('R').fontSize(7.5).fillColor(C.grey).text(
      'La consegna della busta alla logistica e le relative firme sono registrate sul modulo Catena di custodia.', M.left, y + sigH - 2, { width: W, align: 'center' });
  }

  // Numerazione pagine
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font('R').fontSize(7).fillColor(C.grey)
      .text(`ID rendiconto ${report.id} · pag. ${i + 1}/${range.count}`, M.left, PAGE.h - M.bottom + 8, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
