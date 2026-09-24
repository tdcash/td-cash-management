import { r2 } from './util.js';

// Scaglioni: [{from: 0, rate: 6}, {from: 50000, rate: 5}] (rate in %)
export function normalizeTiers(tiers) {
  const t = [...tiers].map((x) => ({ from: Number(x.from), rate: Number(x.rate) })).sort((a, b) => a.from - b.from);
  if (!t.length || t[0].from !== 0) throw new Error('Il primo scaglione deve partire da 0');
  return t;
}

export function feeOn(amount, tiers, mode) {
  const t = normalizeTiers(tiers);
  if (amount <= 0) return 0;
  if (mode === 'FASCIA') {
    const tier = t.filter((x) => x.from <= amount).pop();
    return r2((amount * tier.rate) / 100);
  }
  // MARGINALE: ogni quota di fatturato paga l'aliquota del proprio scaglione
  let fee = 0;
  for (let i = 0; i < t.length; i++) {
    const lo = t[i].from;
    const hi = i + 1 < t.length ? t[i + 1].from : Infinity;
    if (amount <= lo) break;
    fee += ((Math.min(amount, hi) - lo) * t[i].rate) / 100;
  }
  return r2(fee);
}

export function rateFor(amount, tiers) {
  return normalizeTiers(tiers).filter((x) => x.from <= Math.max(amount, 0)).pop().rate;
}

/**
 * Calcolo royalty del periodo.
 * base: fatturato del periodo già portato a base contrattuale (lordo o netto)
 * ytdBefore: fatturato base dell'anno fino al giorno prima del periodo (solo per ANNUO_PROGRESSIVO)
 */
export function computeRoyalty(contract, { gross, channelsGross, withheld, ytdBefore = 0 }) {
  const grossTotal = r2(gross + (contract.include_channels ? channelsGross : 0));
  const base = contract.revenue_base === 'NETTO' ? r2(grossTotal / (1 + Number(contract.vat_rate) / 100)) : grossTotal;
  let fee;
  let appliedRate;
  if (contract.tier_basis === 'ANNUO_PROGRESSIVO') {
    const after = ytdBefore + base;
    if (contract.tier_mode === 'FASCIA') {
      appliedRate = rateFor(after, contract.tiers);
      fee = r2((base * appliedRate) / 100);
    } else {
      fee = r2(feeOn(after, contract.tiers, 'MARGINALE') - feeOn(ytdBefore, contract.tiers, 'MARGINALE'));
      appliedRate = base ? r2((fee / base) * 100) : 0;
    }
  } else {
    fee = feeOn(base, contract.tiers, contract.tier_mode);
    appliedRate = base ? r2((fee / base) * 100) : 0;
  }
  const minApplied = fee < Number(contract.min_monthly_fee);
  const royalty = minApplied ? Number(contract.min_monthly_fee) : fee;
  const marketing = r2((base * Number(contract.marketing_fee_pct)) / 100);
  const taxable = r2(royalty + marketing);
  const vat = r2((taxable * Number(contract.invoice_vat_rate ?? 22)) / 100);
  const w = contract.include_channels ? r2(withheld) : 0;
  const due = r2(taxable + vat - w);
  return {
    gross_revenue: grossTotal,
    base_revenue: base,
    royalty_amount: r2(royalty),
    marketing_amount: marketing,
    vat_amount: vat,
    withheld_amount: w,
    total_due: Math.max(due, 0),
    details: {
      reports_gross: r2(gross), channels_gross: r2(channelsGross), ytd_before: r2(ytdBefore),
      computed_fee: fee, applied_rate: appliedRate, min_fee_applied: minApplied,
      tier_mode: contract.tier_mode, tier_basis: contract.tier_basis, tiers: contract.tiers,
      credit_carried: due < 0 ? r2(-due) : 0,
    },
  };
}
