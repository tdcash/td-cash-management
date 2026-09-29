import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Field, Loading, ErrorBox, Empty, Badge, Icon, PromptModal, useToast } from '../components/ui.jsx';
import { eur, currentMonth, today, itDate, itDateTime } from '../format.js';
import { api, qs } from '../api.js';

const BASE_SHORT = { TOTALE: 'totale', CONTANTI_POS: 'contanti+POS', CONTANTI: 'contanti' };

export default function SiteRoyalty() {
  const { user } = useAuth();
  const companies = useApi(user.role === 'SUPERADMIN' ? '/companies' : null);
  const toast = useToast();
  const admin = ['SUPERADMIN', 'ADMIN'].includes(user.role);
  const partner = user.role === 'PARTNER';
  const [f, setF] = useState({ period: currentMonth(), company_id: '' });
  const [err, setErr] = useState(null);
  const [unconf, setUnconf] = useState(null);
  const { data: d, error, reload } = useApi(`/canoni/summary${qs(f)}`);
  const confirm = async (r) => { setErr(null); try { const out = await api.post(`/canoni/sites/${r.site_id}/confirm`, { period: f.period }); toast(out.mail?.status === 'INVIATA' ? 'Report confermato e inviato alla struttura ospitante' : out.mail?.status === 'NON_CONFIGURATA' ? 'Report confermato (email non configurata: invio registrato)' : `Report confermato. Email non inviata: ${out.mail?.error || 'destinatario mancante'}`, out.mail?.status === 'INVIATA' ? 'ok' : 'err'); reload(); } catch (e) { setErr(e); } };
  const rows = (d?.rows || []).filter((r) => r.pending || r.confirmed || Number(r.royalty_fixed_monthly) > 0 || Number(r.royalty_pct) > 0 || r.host_name);
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
      <ErrorBox error={error || err} />
      {d && !d.closed && admin && <div className="alert info" style={{ marginBottom: 14 }}>Mese in corso: valori provvisori. La conferma per la fatturazione si fa dal primo giorno del mese successivo.</div>}
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
              <thead><tr><th>Sede</th><th>Struttura ospitante</th><th>Condizioni</th><th className="num">Incassi</th><th className="num">Base</th><th className="num">Variabile</th><th className="num">Fissa</th><th className="num">Imponibile</th><th className="num">IVA</th><th className="num">Totale</th><th>Stato</th><th /></tr></thead>
              <tbody>{rows.map((r) => r.pending ? (
                <tr key={r.site_id}><td><b>{r.site_name}</b><div className="small muted">{r.site_code}</div></td><td>{r.host_name || '–'}</td><td colSpan={8} className="muted">Report in attesa di conferma dell'amministratore di sede</td><td><Badge>In attesa</Badge></td><td /></tr>
              ) : (
                <tr key={r.site_id}>
                  <td><b>{r.site_name}</b><div className="small muted">{r.site_code}{user.role === 'SUPERADMIN' ? ` · ${r.company_name}` : ''}</div>{r.drafts > 0 && <Badge tone="red">{r.drafts} bozze escluse</Badge>}</td>
                  <td>{r.host_name || '–'}</td>
                  <td className="small">{Number(r.royalty_fixed_monthly) > 0 && <div>{eur(r.royalty_fixed_monthly)}/mese</div>}{Number(r.royalty_pct) > 0 && <div>{r.royalty_pct}% su {BASE_SHORT[r.royalty_base]}</div>}<div className="muted">IVA {r.royalty_vat_rate}%</div></td>
                  <td className="num">{eur(r.revenue.total)}</td><td className="num">{eur(r.base)}</td><td className="num">{eur(r.variable)}</td><td className="num">{eur(r.fixed)}</td>
                  <td className="num">{eur(r.taxable)}</td><td className="num">{eur(r.vat)}</td><td className="num strong">{eur(r.total)}</td>
                  <td>{r.confirmed ? <Badge tone="green">Confermato</Badge> : <Badge>Provvisorio</Badge>}{r.confirmed && <div className="small muted">{itDateTime(r.confirmed_at)}</div>}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>
                    <a className="btn sm ghost" href={`/api/canoni/sites/${r.site_id}/pdf?period=${f.period}`} target="_blank" rel="noopener"><Icon name="print" size={14} />Report</a>
                    {admin && !r.confirmed && d.closed && <>{' '}<button className="btn sm" disabled={r.drafts > 0} title={r.drafts > 0 ? 'Ci sono rendiconti in bozza' : ''} onClick={() => confirm(r)}>Conferma</button></>}
                    {admin && r.confirmed && <>{' '}<button className="btn sm danger" onClick={() => setUnconf(r)}>Annulla conferma</button></>}
                  </td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={3}>Totale</td><td className="num">{eur(d.totals.revenue)}</td><td /><td className="num">{eur(d.totals.variable)}</td><td className="num">{eur(d.totals.fixed)}</td><td className="num">{eur(d.totals.taxable)}</td><td className="num">{eur(d.totals.vat)}</td><td className="num">{eur(d.totals.total)}</td><td colSpan={2} /></tr></tfoot>
            </table></div>
          )}
        </div>
        {others > 0 && <div className="small muted" style={{ marginTop: 10 }}>{others} sedi senza canone configurato non sono mostrate.</div>}
        <div style={{ marginTop: 16 }}><Card title="Come funziona">
          <p className="small" style={{ margin: 0 }}>{partner
            ? 'Il report mensile diventa visibile e stampabile quando l\'amministratore di sede lo conferma, a inizio del mese successivo. Su quei valori la struttura ospitante emette la fattura.'
            : 'Il canone si calcola sui rendiconti giornalieri della sede non in bozza: percentuale sulla base scelta più la quota fissa mensile, più IVA. A inizio del mese successivo l\'amministratore di sede conferma il report: i valori si congelano, il partner lo vede e lo stampa per fatturare. Una conferma si può annullare con motivazione.'}</p>
        </Card></div>
        {unconf && <PromptModal title={`Annulla conferma ${unconf.site_name}`} label="Motivazione (resta nel registro attività)" confirmText="Annulla conferma" danger onClose={() => setUnconf(null)}
          onConfirm={async (reason) => { await api.post(`/canoni/sites/${unconf.site_id}/unconfirm`, { period: f.period, reason }); toast('Conferma annullata'); reload(); }} />}
      </>}
    </div>
  );
}
