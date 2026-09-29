import ExcelJS from 'exceljs';

// Modelli Excel per l'anagrafica: intestazione in riga 1, istruzioni nel foglio "Istruzioni", validazioni a tendina
export const SITE_COLUMNS = [
  ['codice', 'Codice sede (2-12 caratteri, univoco nell\'azienda)', true],
  ['azienda', 'Codice azienda (solo super amministratore; altrimenti lasciare vuoto)', false],
  ['nome', 'Denominazione sede', true],
  ['indirizzo', 'Indirizzo', false], ['citta', 'Città', false], ['provincia', 'Provincia (sigla)', false],
  ['email_sede', 'Email della sede (solleciti e comunicazioni)', false],
  ['fondo_cassa', 'Fondo cassa in euro (es. 150,00)', true],
  ['data_avvio', 'Data di avvio: primo giorno atteso (GG/MM/AAAA)', true],
  ['giorni_operativi', 'Giorni operativi lun..dom, 7 cifre 1/0 (es. 1111110)', false],
  ['orario_apertura', 'Orario di apertura HH:MM, uguale per tutti i giorni operativi (per orari diversi per giorno usare la scheda sede)', false],
  ['orario_chiusura', 'Orario di chiusura HH:MM: il sollecito parte 60 minuti dopo', false],
  ['terminali_pos', 'TID dei terminali POS separati da virgola', false],
  ['tipo', 'PROPRIA oppure OSPITATA', true],
  ['struttura_ospitante', 'Ragione sociale della struttura ospitante (solo OSPITATA)', false],
  ['piva_struttura', 'P.IVA struttura ospitante', false],
  ['email_struttura', 'Email struttura ospitante (riceve il report royalty)', false],
  ['quota_fissa_mensile', 'Royalty: quota fissa mensile in euro', false],
  ['percentuale', 'Royalty: percentuale sui ricavi (es. 2,5)', false],
  ['base_percentuale', 'TOTALE, CONTANTI_POS oppure CONTANTI', false],
  ['iva', 'IVA % sulla royalty (es. 22)', false],
  ['note_contratto', 'Note contrattuali', false],
];
export const USER_COLUMNS = [
  ['email', 'Email (per Microsoft 365 la stessa dell\'account)', true],
  ['nome_cognome', 'Nome e cognome', true],
  ['ruolo', 'ADMIN, CASSIERE, FINANCE, OPERATOR, PARTNER', true],
  ['azienda', 'Codice azienda (solo super amministratore; altrimenti lasciare vuoto)', false],
  ['accesso', 'MICROSOFT, PASSWORD oppure ENTRAMBI', true],
  ['sedi', 'Codici sede separati da virgola (obbligatorio per OPERATOR, CASSIERE, PARTNER)', false],
  ['attivo', 'SI oppure NO', false],
];

export async function buildTemplate(kind, sample) {
  const cols = kind === 'sites' ? SITE_COLUMNS : USER_COLUMNS;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Toscana Diagnostica Cash Management';
  const ws = wb.addWorksheet(kind === 'sites' ? 'Sedi' : 'Utenti');
  ws.columns = cols.map(([key, header]) => ({ header: key, key, width: Math.max(14, Math.min(34, header.length * 0.6)) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C505E' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of sample) ws.addRow(row);
  // validazioni a tendina
  const dv = (col, list) => { for (let i = 2; i <= 500; i++) ws.getCell(`${col}${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${list.join(',')}"`] }; };
  const colLetter = (key) => ws.getColumn(key).letter;
  if (kind === 'sites') { dv(colLetter('tipo'), ['PROPRIA', 'OSPITATA']); dv(colLetter('base_percentuale'), ['TOTALE', 'CONTANTI_POS', 'CONTANTI']); for (let i = 2; i <= 500; i++) ws.getCell(`${colLetter('data_avvio')}${i}`).numFmt = 'dd/mm/yyyy'; }
  else { dv(colLetter('ruolo'), ['ADMIN', 'CASSIERE', 'FINANCE', 'OPERATOR', 'PARTNER']); dv(colLetter('accesso'), ['MICROSOFT', 'PASSWORD', 'ENTRAMBI']); dv(colLetter('attivo'), ['SI', 'NO']); }
  const info = wb.addWorksheet('Istruzioni');
  info.columns = [{ header: 'Colonna', key: 'c', width: 24 }, { header: 'Contenuto', key: 'd', width: 80 }, { header: 'Obbligatoria', key: 'o', width: 14 }];
  info.getRow(1).font = { bold: true };
  for (const [key, header, req] of cols) info.addRow({ c: key, d: header, o: req ? 'sì' : '' });
  info.addRow({});
  info.addRow({ c: 'Regole', d: kind === 'sites'
    ? 'Una riga per sede. Se il codice esiste già nell\'azienda la sede viene aggiornata, altrimenti creata. La riga di esempio va sostituita. Non modificare la riga di intestazione.'
    : 'Una riga per utente. Se l\'email esiste già l\'utente viene aggiornato (ruolo, nome, sedi, accesso, stato), altrimenti creato con password temporanea mostrata al termine dell\'importazione. Non modificare la riga di intestazione.' });
  return wb.xlsx.writeBuffer();
}

// Legge il primo foglio: array di oggetti con chiavi = intestazioni (riga 1), valori stringa
export async function readSheet(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Foglio vuoto');
  const headers = [];
  ws.getRow(1).eachCell((c, i) => { headers[i] = String(cellText(c.value)).trim().toLowerCase(); });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = { _row: n };
    let empty = true;
    row.eachCell({ includeEmpty: false }, (c, i) => { const k = headers[i]; if (!k) return; const v = cellText(c.value); if (v !== '') empty = false; o[k] = v; });
    if (!empty) rows.push(o);
  });
  return rows;
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}`;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text) return String(v.text);
    if (v.result != null) return cellText(v.result);
    return '';
  }
  return String(v).trim();
}

export const parseItDate = (s) => {
  const m = String(s || '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
};
export const parseNum = (s) => { if (s === '' || s == null) return null; const t = String(s).replace(/\s|€/g, ''); const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return Number.isFinite(n) ? n : NaN; };
