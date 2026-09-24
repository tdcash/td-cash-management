import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Field, Loading, ErrorBox, Empty, Badge, Icon } from '../components/ui.jsx';
import { eur, prevMonth, today, itDate } from '../format.js';
import { qs } from '../api.js';

const BASE_SHORT = { TOTALE: 'totale', CONTANTI_POS: 'contanti+POS', CONTANTI: 'contanti' };

export default function SiteRoyalty() {
  const { user } = useAuth();
  const companies = useApi(user.role === 'SUPERADMIN' ? '/companies' : null);
  const [f, setF] = useState({ period: prevMonth(), company_id: '' });
  const { data: d, error } = useApi(`/canoni/summary${qs(f)}`);
  const rows = (d?.rows || []).filter((r) => Number(r.royalty_fixed_monthly) > 0 || Number(r.royalty_pct) > 0 || r.host_name);
  const others = (d?.rows || []).length - rows.length;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Royalty di sede</h1><div className="sub">Canone mensile riconosciuto alla struttura che ospita il corner Toscana Diagnostica: quota fissa, percentuale sui ricavi, IVA</div></div>
      </div>
      <div className="filters">
        {user.role === 'SUPERADMIN' && <Field label="Azienda"><select value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}><option value="">Tutte</option>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Mese"><input type="month" value={f.period} max={today().slice(0, 7)} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
      </div>
      <ErrorBox error={error} />
      {!d ? <Loading /> : <>
        <div className="grid g4">
          <Kpi accent label="Totale canoni del mese" value={eur(d.totals.total)} foot={`${rows.length} sedi con canone · ${itDate(d.start)} – ${itDate(d.end)}`} />
          <Kpi label="Quote fisse" value={eur(d.totals.fixed)} />
          <Kpi label="Quote variabili" value={eur(d.totals.variable)} foot={`su incassi ${eur(d.totals.revenue)}`} />
          <Kpi label="IVA" value={eur(d.totals.vat)} foot={`imponibile ${eur(d.totals.taxable)}`} />
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          {!rows.length ? <Empty>Nessuna sede con canone configurato. Le condizioni si impostano in Sedi e fondo cassa.</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Sede</th><th>Struttura ospitante</th><th>Condizioni</th><th className="num">Incassi</th><th className="num">Base</th><th className="num">Variabile</th><th className="num">Fissa</th><th className="num">Imponibile</th><th className="num">IVA</th><th className="num">Totale</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.site_id}>
                  <td><b>{r.site_name}</b><div className="small muted">{r.site_code}{user.role === 'SUPERADMIN' ? ` · ${r.company_name}` : ''}</div>{r.drafts > 0 && <Badge tone="red">{r.drafts} bozze escluse</Badge>}</td>
                  <td>{r.host_name || '–'}</td>
                  <td className="small">{Number(r.royalty_fixed_monthly) > 0 && <div>{eur(r.royalty_fixed_monthly)}/mese</div>}{Number(r.royalty_pct) > 0 && <div>{r.royalty_pct}% su {BASE_SHORT[r.royalty_base]}</div>}<div className="muted">IVA {r.royalty_vat_rate}%</div></td>
                  <td className="num">{eur(r.revenue.total)}</td><td className="num">{eur(r.base)}</td><td className="num">{eur(r.variable)}</td><td className="num">{eur(r.fixed)}</td>
                  <td className="num">{eur(r.taxable)}</td><td className="num">{eur(r.vat)}</td><td className="num strong">{eur(r.total)}</td>
                  <td className="num"><a className="btn sm ghost" href={`/api/canoni/sites/${r.site_id}/pdf?period=${f.period}`} target="_blank" rel="noopener"><Icon name="print" size={14} />Report</a></td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={3}>Totale</td><td className="num">{eur(d.totals.revenue)}</td><td /><td className="num">{eur(d.totals.variable)}</td><td className="num">{eur(d.totals.fixed)}</td><td className="num">{eur(d.totals.taxable)}</td><td className="num">{eur(d.totals.vat)}</td><td className="num">{eur(d.totals.total)}</td><td /></tr></tfoot>
            </table></div>
          )}
        </div>
        {others > 0 && <div className="small muted" style={{ marginTop: 10 }}>{others} sedi senza canone configurato non sono mostrate.</div>}
        <div style={{ marginTop: 16 }}><Card title="Come funziona">
          <p className="small" style={{ margin: 0 }}>Il canone si calcola sui rendiconti giornalieri della sede non in bozza: percentuale sulla base scelta (totale, contanti e POS, o solo contanti) più la quota fissa mensile, più IVA all'aliquota impostata. Le condizioni si modificano nell'anagrafica della sede e ogni variazione resta nello storico. Il report PDF per sede è su carta intestata e include il dettaglio giornaliero.</p>
        </Card></div>
      </>}
    </div>
  );
}
