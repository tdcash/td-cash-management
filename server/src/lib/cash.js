import { r2, sum } from './util.js';

export const BANKNOTES = [500, 200, 100, 50, 20, 10, 5];
export const CIRCUITS = ['BANCOMAT', 'CARTA_CREDITO', 'BUONI_PASTO', 'APP', 'ALTRO'];

export const STATUS_LABEL = {
  DRAFT: 'Bozza',
  CLOSED: 'Busta registrata',
  PROCESSED: 'Distinta elaborata',
  PICKED_UP: 'Ritirata',
  DEPOSITED: 'Versata in banca',
};

export function computeTotals({ denominations = {}, coins_total = 0, receipts = [], transfers = [], cash_float = 0 }) {
  const notes = sum(BANKNOTES, (d) => d * (Number(denominations[d]) || 0));
  const cash_counted = r2(notes + Number(coins_total || 0));
  const cash_to_deposit = r2(cash_counted - Number(cash_float || 0));
  const pos_total = sum(receipts, (x) => x.amount);
  const transfer_total = sum(transfers, (x) => x.amount);
  return {
    notes_total: notes,
    cash_counted,
    cash_to_deposit,
    pos_total,
    transfer_total,
    day_total: r2(cash_to_deposit + pos_total + transfer_total),
  };
}
