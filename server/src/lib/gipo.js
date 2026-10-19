// Lettura della "Stampa cassa per utente" di GIPO: blocchi "Utente <email>" con righe movimento
// "N/SS- GG/MM/AAAA INTESTATARIO importo imponibile iva" dove SS è il sezionale (= sede).
// In fondo al documento: "Totali per modalità di pagamento" riferiti all'intero file.
import { PDFParse } from 'pdf-parse';
import { classifyMode } from './gestionale.js';

const AMT = /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*€?/g;
const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const isoOf = (d) => { const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

export async function readGipoPdf(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const text = (await parser.getText()).text || '';
  await parser.destroy();
  return parseGipoText(text);
}

export function parseGipoText(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^--\s*\d+\s+of\s+\d+\s*--$/.test(l));
  const out = { from: null, to: null, users: [], movements: [], modes: [], totals: {}, warnings: [] };
  let user = null;
  const dal = text.match(/\bDal\s+(\d{2}\/\d{2}\/\d{4})/i), al = text.match(/\bAl\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (dal) out.from = isoOf(dal[1]); if (al) out.to = isoOf(al[1]);
  let inModes = false;
  for (const line of lines) {
    const u = line.match(/^Utente\s+(\S+@\S+)/i);
    if (u) { user = u[1].toLowerCase(); if (!out.users.includes(user)) out.users.push(user); inModes = false; continue; }
    if (/^Totali per modalit/i.test(line)) { inModes = true; continue; }
    if (inModes) {
      if (/^(priv\.?|conv\.?|totali)(\s|$)/i.test(line)) continue;
      const a = [...line.matchAll(AMT)].map((m) => num(m[1]));
      if (a.length >= 1) { const label = line.replace(AMT, '').replace(/€/g, '').trim(); out.modes.push({ label, kind: classifyMode(label), amount: a[a.length - 1], priv: a.length >= 3 ? a[0] : null, conv: a.length >= 3 ? a[1] : null }); }
      continue;
    }
    // riga movimento: "1/02- 16/10/2026 GRECO ROSETTA 207,00 € 207,00 € 0,00 €"
    const m = line.match(/^(\d+)\/(\d+)-?\s+(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*€?\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*€?\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*€?$/);
    if (m) {
      if (!user) out.warnings.push(`Movimento ${m[1]}/${m[2]} senza utente: ${line.slice(0, 80)}`);
      out.movements.push({ user, number: `${m[1]}/${m[2]}`, sezionale: m[2].padStart(2, '0'), date: isoOf(m[3]), holder: m[4].trim(), amount: num(m[5]), taxable: num(m[6]), vat: num(m[7]) });
      continue;
    }
    const t = line.match(/^Totale\s+(incassato|non incassato|bolli|IVA|imponibile|SSN|private)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
    if (t) out.totals[t[1].toLowerCase().replace(/\s+/g, '_')] = num(t[2]);
    else if (/^Totale\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})/.test(line)) out.totals.totale = num(line.match(/(-?\d{1,3}(?:\.\d{3})*,\d{2})/)[1]);
  }
  return out;
}
