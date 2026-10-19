import PDFDocument from 'pdfkit';
import path from 'node:path';
import { eur, itDate, itDateTime } from '../lib/util.js';
import { letterhead, ASSETS, C, M, W, CONTENT_TOP, CONTENT_BOTTOM } from './distinta.js';

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const periodLabel = (p) => { const [y, m] = p.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };

// Report PDF del controllo mensile: riepilogo, per sede, dettaglio anomalie, segnalazioni
export async function buildMonthlyCheckPdf({ check, company, OUTCOME }) {
  const S = check.summary;
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true, info: { Title: `Controllo mensile ${check.period}`, Author: company.name, Creator: 'TD Cash Management' } });
  doc.registerFont('R', path.join(ASSETS, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(ASSETS, 'LiberationSans-Bold.ttf'));
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  let y;
  const newPage = () => { doc.addPage(); letterhead(doc, company); y = CONTENT_TOP; };
  const need = (h) => { if (y + h > CONTENT_BOTTOM) { newPage(); doc.font('R').fontSize(8).fillColor(C.grey).text(`Controllo mensile ${periodLabel(check.period)} · segue`, M.left, y, { width: W, align: 'right' }); y += 14; } };
  const h2 = (t) => { need(30); doc.font('B').fontSize(11).fillColor(C.teal).text(t, M.left, y); y += 18; };
  const table = (headers, widths, rows, opts = {}) => {
    const cw = widths.map((w) => w * W);
    const row = (cells, { bold = false, fill = null, size = 8, color = C.jet } = {}) => {
      need(14);
      if (fill) doc.rect(M.left, y - 2, W, 13).fill(fill);
      let x = M.left;
      cells.forEach((c, i) => { doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(color).text(String(c ?? ''), x + 3, y, { width: cw[i] - 6, height: 12, align: opts.align?.[i] || 'left', lineBreak: false, ellipsis: true }); x += cw[i]; });
      y += 13;
    };
    row(headers, { bold: true, fill: '#E4EEF0', size: 7.5 });
    rows.forEach((r, i) => row(r.cells, { fill: r.fill || (i % 2 ? '#FAFCFC' : null), bold: r.bold, color: r.color }));
    y += 6;
  };

  newPage();
  doc.font('B').fontSize(16).fillColor(C.jet).text(`Controllo mensile casse · ${periodLabel(check.period)}`, M.left, y); y += 22;
  doc.font('R').fontSize(9).fillColor(C.grey).text(`Confronto tra la Stampa cassa per utente di GIPO e i rendiconti di Cash Management, per sede, giorno e operatore. Eseguito il ${itDateTime(check.created_at)} da ${check.created_by_name || ''}. File: ${S.files.map((f) => f.name).join(', ')}.`, M.left, y, { width: W }); y += 32;

  h2('Riepilogo');
  const kv = [
    ['Righe confrontate (sede · giorno · operatore)', S.rows], ['Incasso GIPO', eur(S.gipo_total)], ['Dichiarato in Cash Management', eur(S.declared_total)], ['Differenza complessiva', eur(S.declared_total - S.gipo_total)],
    ['Quadrano', S.quadra], ['Ammanchi', `${S.ammanco} · ${eur(S.ammanco_total)}`], ['Eccedenze', `${S.eccedenza} · ${eur(S.eccedenza_total)}`], ['Rendiconti mancanti', S.mancanti], ['Rendiconti in bozza', S.bozze], ['Rendiconti senza incasso GIPO', S.senza_gipo], ['Sede o operatore non riconosciuto', S.non_riconosciuti],
  ];
  table(['Voce', 'Valore'], [0.6, 0.4], kv.map(([k, v]) => ({ cells: [k, v] })), { align: ['left', 'right'] });

  h2('Modalità di pagamento (totale del mese)');
  table(['Modalità', 'GIPO', 'Dichiarato', 'Differenza'], [0.4, 0.2, 0.2, 0.2], [
    { cells: ['Contanti', eur(S.modes_gipo.cash), eur(S.modes_declared.cash), eur(S.modes_declared.cash - S.modes_gipo.cash)] },
    { cells: ['POS e carte', eur(S.modes_gipo.pos), eur(S.modes_declared.pos), eur(S.modes_declared.pos - S.modes_gipo.pos)] },
    { cells: ['Bonifici', eur(S.modes_gipo.transfer), eur(S.modes_declared.transfer), eur(S.modes_declared.transfer - S.modes_gipo.transfer)] },
    { cells: ['Altre modalità GIPO', eur(S.modes_gipo.other), '', ''] },
  ], { align: ['left', 'right', 'right', 'right'] });

  h2('Per sede');
  table(['Sede', 'GIPO', 'Dichiarato', 'Differenza', 'Righe', 'Anomalie'], [0.38, 0.15, 0.15, 0.14, 0.08, 0.1],
    S.by_site.map((x) => ({ cells: [x.site_name, eur(x.gipo), eur(x.declared), eur(x.diff), x.rows, x.issues], fill: x.issues ? '#FBE9E7' : null })), { align: ['left', 'right', 'right', 'right', 'right', 'right'] });

  const issues = check.rows.filter((x) => x.outcome !== 'QUADRA');
  h2(`Dettaglio anomalie (${issues.length})`);
  if (!issues.length) { doc.font('R').fontSize(9).fillColor(C.grey).text('Nessuna anomalia: tutte le casse quadrano.', M.left, y); y += 16; }
  else table(['Sede', 'Data', 'Operatore', 'GIPO', 'Dichiarato', 'Diff.', 'Esito'], [0.19, 0.09, 0.17, 0.1, 0.1, 0.1, 0.25],
    issues.map((x) => ({ cells: [x.site_name, itDate(x.date), x.operator_name, eur(x.gipo_amount), x.declared == null ? '–' : eur(x.declared), x.diff == null ? '–' : eur(x.diff), OUTCOME[x.outcome] || x.outcome], color: x.outcome === 'AMMANCO' ? '#B3261E' : C.jet })),
    { align: ['left', 'left', 'left', 'right', 'right', 'right', 'left'] });

  if (S.problems?.length) {
    h2('Segnalazioni di lettura');
    for (const p of S.problems) { need(14); doc.font('R').fontSize(8).fillColor(C.jet).text(`• ${p.detail}`, M.left, y, { width: W }); y += doc.heightOfString(`• ${p.detail}`, { width: W }) + 2; }
  }
  // numerazione pagine
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) { doc.switchToPage(i); doc.font('R').fontSize(7.5).fillColor(C.grey).text(`Pagina ${i + 1} di ${range.count}`, M.left, CONTENT_BOTTOM + 6, { width: W, align: 'right' }); }
  doc.end();
  return done;
}
