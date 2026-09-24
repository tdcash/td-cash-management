import { r2, sum } from './util.js';

export const BANKNOTES = [500, 200, 100, 50, 20, 10, 5];
export const COINS = [2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
export const DENOMS = [...BANKNOTES, ...COINS];
export const CIRCUITS = ['BANCOMAT', 'CARTA_CREDITO', 'BUONI_PASTO', 'APP', 'ALTRO'];

export const STATUS_LABEL = {
  DRAFT: 'Bozza',
  CLOSED: 'Busta registrata',
  PROCESSED: 'Distinta elaborata',
  PICKED_UP: 'Operazione logistica',
  VERIFIED: 'Verificato, in cassaforte',
  DEPOSITED: 'Versato al portavalori',
};

// chiave stabile per i tagli (0.5 -> "0.5")
export const dkey = (d) => String(Number(d));

export function computeTotals({ denominations = {}, receipts = [], transfers = [], cash_float = 0 }) {
  const notes = sum(BANKNOTES, (d) => d * (Number(denominations[dkey(d)] ?? denominations[d]) || 0));
  const coins = sum(COINS, (d) => d * (Number(denominations[dkey(d)] ?? denominations[d]) || 0));
  const cash_counted = r2(notes + coins);
  const cash_to_deposit = r2(cash_counted - Number(cash_float || 0));
  const pos_total = sum(receipts, (x) => x.amount);
  const transfer_total = sum(transfers, (x) => x.amount);
  return { notes_total: notes, coins_total: coins, cash_counted, cash_to_deposit, pos_total, transfer_total, day_total: r2(cash_to_deposit + pos_total + transfer_total) };
}
