import { r2 } from './util.js';

export const BASE_LABEL = { TOTALE: 'Totale incassi (contanti, POS, bonifici)', CONTANTI_POS: 'Contanti e POS', CONTANTI: 'Solo contanti' };

// Canone mensile di sede: quota fissa + percentuale sulla base scelta, più IVA.
// Il mese parziale (sede aperta o chiusa a metà mese) applica la quota fissa intera: regola semplice, dichiarata nel report.
export function computeSiteRoyalty(site, rev) {
  const base = site.royalty_base === 'CONTANTI' ? rev.cash : site.royalty_base === 'CONTANTI_POS' ? r2(rev.cash + rev.pos) : r2(rev.cash + rev.pos + rev.transfer);
  const fixed = r2(site.royalty_fixed_monthly);
  const variable = r2((base * Number(site.royalty_pct)) / 100);
  const taxable = r2(fixed + variable);
  const vat = r2((taxable * Number(site.royalty_vat_rate)) / 100);
  return { base, fixed, variable, taxable, vat, total: r2(taxable + vat) };
}
