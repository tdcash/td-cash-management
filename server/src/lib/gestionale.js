// Lettura del PDF "Stampa cassa" del gestionale (chiusura per operatore).
// Fonte dei valori: la tabella finale "Totali per modalità di pagamento" (colonna Totali = Priv. + Conv.)
// e la riga "Totale incassato". Se il tracciato non viene riconosciuto, ripiega sulla lettura euristica per parole chiave.
const AMOUNT = /(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:\.\d{2}))\s*(?:€|eur)?/gi;

function amounts(line) {
  return [...line.matchAll(AMOUNT)].map((m) => {
    let s = m[1].replace(/\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }).filter((n) => n != null);
}
const lastAmount = (line) => { const a = amounts(line); return a.length ? a[a.length - 1] : null; };
const r2 = (n) => Math.round(n * 100) / 100;

// Classificazione delle modalità di pagamento del gestionale
export function classifyMode(label) {
  const l = String(label || '').toLowerCase();
  if (/contant|cash|denaro/.test(l)) return 'cash';
  if (/bonific|cro\b|trn\b|rid\b|sdd|addebito|banca/.test(l)) return 'transfer';
  if (/pos|bancomat|pagobancomat|cart[ae]|credito|debito|satispay|apple|google|elettronic|digitale|app\b|paypal|nexi|sumup/.test(l)) return 'pos';
  return 'other';
}

function parseModes(lines) {
  const start = lines.findIndex((l) => /totali?\s+per\s+modalit/i.test(l));
  if (start < 0) return null;
  const out = { cash: 0, pos: 0, transfer: 0, other: 0, modes: [] };
  let found = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^--\s*\d+\s+of\s+\d+\s*--$/.test(line) || /^(priv\.?|conv\.?|totali)(\s|$)/i.test(line)) continue;
    const a = amounts(line);
    if (!a.length) { if (found) break; continue; }
    const label = line.replace(AMOUNT, '').replace(/[€]/g, '').trim();
    if (!label) continue;
    const total = a[a.length - 1];
    const kind = classifyMode(label);
    out[kind] = r2(out[kind] + total);
    out.modes.push({ label, kind, amount: total, priv: a.length >= 3 ? a[0] : null, conv: a.length >= 3 ? a[1] : null });
    found++;
  }
  return found ? out : null;
}

const RULES = [
  ['total', /\btotale\s+(incass|giornat|cassa|generale|complessivo|chiusura)|\btotale\b(?!.*\b(pos|contant|bonific|iva)\b)/i],
  ['cash', /\bcontant|\bcash\b|\bdenaro\b/i],
  ['pos', /\bpos\b|\bbancomat\b|\bcarte?\b|\belettronic/i],
  ['transfer', /\bbonific|\bcro\b|\btrn\b/i],
];

export function extractCashFigures(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = { total: null, cash: null, pos: null, transfer: null, other: null, lines: {}, modes: [], format: 'euristico' };
  const modes = parseModes(lines);
  if (modes) {
    out.format = 'stampa_cassa';
    out.cash = modes.cash; out.pos = modes.pos; out.transfer = modes.transfer; out.other = modes.other; out.modes = modes.modes;
    out.lines = { cash: 'Totali per modalità di pagamento', pos: 'Totali per modalità di pagamento', transfer: 'Totali per modalità di pagamento' };
    const inc = lines.find((l) => /^totale\s+incassato/i.test(l));
    out.total = inc ? lastAmount(inc) : r2(modes.cash + modes.pos + modes.transfer + modes.other);
    out.lines.total = inc ? 'Totale incassato' : 'somma delle modalità di pagamento';
    const notInc = lines.find((l) => /^totale\s+non\s+incassato/i.test(l));
    if (notInc) out.not_collected = lastAmount(notInc);
  } else {
    for (const line of lines) {
      for (const [key, re] of RULES) {
        if (out[key] == null && re.test(line)) {
          const v = lastAmount(line);
          if (v != null) { out[key] = v; out.lines[key] = line.slice(0, 120); }
        }
      }
    }
    if (out.total == null && (out.cash != null || out.pos != null || out.transfer != null)) {
      out.total = r2((out.cash || 0) + (out.pos || 0) + (out.transfer || 0));
      out.lines.total = 'somma delle voci riconosciute';
    }
  }
  const dal = String(text || '').match(/\bdal\s+(\d{2})[/.-](\d{2})[/.-](\d{4})/i) || String(text || '').match(/\b(\d{2})[/.-](\d{2})[/.-](\d{4})\b/);
  if (dal) out.date = `${dal[3]}-${dal[2]}-${dal[1]}`;
  const al = String(text || '').match(/\bal\s+(\d{2})[/.-](\d{2})[/.-](\d{4})/i);
  if (al) out.date_to = `${al[3]}-${al[2]}-${al[1]}`;
  out.confidence = out.format === 'stampa_cassa' ? 1 : ['total', 'cash', 'pos', 'transfer'].filter((k) => out[k] != null).length / 4;
  return out;
}
