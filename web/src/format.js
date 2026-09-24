const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const numFmt = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' });
export const eur = (n) => (n == null || n === '' ? '–' : eurFmt.format(Number(n)));
export const eurShort = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M€`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toLocaleString('it-IT', { maximumFractionDigits: 1 })} k€`;
  return eurFmt.format(v);
};
export const num = (n) => numFmt.format(Number(n || 0));
export const itDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short' });
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
export const addDays = (iso, n) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const monthStart = (iso = today()) => `${iso.slice(0, 7)}-01`;
export const prevMonth = () => {
  const d = new Date(`${today().slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
// "1.234,50" -> 1234.5
export const parseMoney = (s) => {
  if (typeof s === 'number') return s;
  const t = String(s || '').replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export const STATUS = {
  DRAFT: { label: 'Bozza', tone: 'grey' },
  CLOSED: { label: 'Busta registrata', tone: 'blue' },
  PROCESSED: { label: 'Distinta elaborata', tone: 'teal' },
  PICKED_UP: { label: 'Ritirata', tone: 'mauve' },
  DEPOSITED: { label: 'Versata', tone: 'green' },
};
export const ROLE = { SUPERADMIN: 'Super amministratore', ADMIN: 'Amministratore', OPERATOR: 'Operatore' };
export const CIRCUITS = { BANCOMAT: 'Bancomat', CARTA_CREDITO: 'Carta di credito', BUONI_PASTO: 'Buoni pasto', APP: 'App di pagamento', ALTRO: 'Altro' };
export const NC_STATUS = { APERTA: { label: 'Aperta', tone: 'red' }, RISPOSTA: { label: 'Risposta ricevuta', tone: 'blue' }, CHIUSA: { label: 'Chiusa', tone: 'green' } };
export const SEVERITY = { BASSA: 'grey', MEDIA: 'mauve', ALTA: 'red' };
export const ROY_STATUS = { EMESSO: 'blue', IN_ADDEBITO: 'mauve', PAGATO: 'green', INSOLUTO: 'red', ANNULLATO: 'grey' };
