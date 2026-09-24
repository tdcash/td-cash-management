// Lettura euristica del PDF di chiusura cassa del gestionale.
// Cerca le righe con parole chiave e l'ultimo importo in euro sulla riga. Da affinare sul tracciato reale.
const AMOUNT = /(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:\.\d{2}))\s*(?:€|eur)?/gi;

function lastAmount(line) {
  const m = [...line.matchAll(AMOUNT)];
  if (!m.length) return null;
  let s = m[m.length - 1][1].replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const RULES = [
  ['total', /\btotale\s+(incass|giornat|cassa|generale|complessivo|chiusura)|\btotale\b(?!.*\b(pos|contant|bonific|iva)\b)/i],
  ['cash', /\bcontant|\bcash\b|\bdenaro\b/i],
  ['pos', /\bpos\b|\bbancomat\b|\bcarte?\b|\belettronic/i],
  ['transfer', /\bbonific|\bcro\b|\btrn\b/i],
];

export function extractCashFigures(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = { total: null, cash: null, pos: null, transfer: null, lines: {} };
  for (const line of lines) {
    for (const [key, re] of RULES) {
      if (out[key] == null && re.test(line)) {
        const v = lastAmount(line);
        if (v != null) { out[key] = v; out.lines[key] = line.slice(0, 120); }
      }
    }
  }
  if (out.total == null && (out.cash != null || out.pos != null || out.transfer != null)) {
    out.total = Math.round(((out.cash || 0) + (out.pos || 0) + (out.transfer || 0)) * 100) / 100;
    out.lines.total = 'somma delle voci riconosciute';
  }
  const dateM = String(text || '').match(/\b(\d{2})[/.-](\d{2})[/.-](\d{4})\b/);
  if (dateM) out.date = `${dateM[3]}-${dateM[2]}-${dateM[1]}`;
  out.confidence = ['total', 'cash', 'pos', 'transfer'].filter((k) => out[k] != null).length / 4;
  return out;
}
