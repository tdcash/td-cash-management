import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Card, Field, Kpi, Loading, ErrorBox, Empty, Badge, useToast } from '../components/ui.jsx';
import { PeriodFilter, PRESETS } from '../components/filters.jsx';
import { eur, itDate, CIRCUITS } from '../format.js';

export default function Reconcile() {
  const { user } = useAuth();
  const toast = useToast();
  const companies = useApi(user.role === 'SUPERADMIN' ? '/companies' : null);
  const [f, setF] = useState({ company_id: user.company_id || '', ...PRESETS['30g']() });
  const [tab, setTab] = useState('pos');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const cid = f.company_id || companies.data?.[0]?.id || '';
  const rec = useApi(cid ? `/imports/reconciliation${qs({ company_id: cid, from: f.from, to: f.to })}` : null);
  const ch = useApi(cid ? `/imports/channels${qs({ company_id: cid, from: f.from, to: f.to })}` : null);

  const upload = async (e, kind) => {
    const file = e.target.files[0]; if (!file) return;
    setErr(null); setRes(null);
    const fd = new FormData(); fd.append('company_id', String(cid)); fd.append('file', file);
    try { const r = await api.upload(`/imports/${kind}`, fd); setRes(r); toast('Import completato'); rec.reload(); ch.reload(); } catch (e2) { setErr(e2); }
    e.target.value = '';
  };
  const run = async () => { try { const r = await api.post('/imports/reconcile', { company_id: Number(cid), from: f.from, to: f.to }); toast(`Riconciliati ${r.matched} su ${r.examined}`); rec.reload(); } catch (e) { setErr(e); } };
  const s = rec.data?.summary;

  return (
    <div className="page">
      <div className="page-head"><div><h1>Riconciliazione pagamenti</h1><div className="sub">Confronto tra scontrini POS registrati in sede e transazioni dell'acquirer o del gateway</div></div></div>
      <div className="filters">
        {user.role === 'SUPERADMIN' && <Field label="Azienda"><select value={cid} onChange={(e) => setF({ ...f, company_id: e.target.value })}>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <PeriodFilter value={f} onChange={setF} />
      </div>
      <ErrorBox error={err} />
      {res && <div className="alert ok" style={{ marginBottom: 14 }}>Importate {res.imported} righe{res.skipped_duplicates ? `, ${res.skipped_duplicates} duplicati ignorati` : ''}{res.matched != null ? `, riconciliate ${res.matched}` : ''}{res.without_site ? `, ${res.without_site} senza sede riconosciuta` : ''}. {res.errors?.length ? `Errori: ${res.errors.slice(0, 3).join('; ')}` : ''}</div>}
      <div className="tabs"><button className={tab === 'pos' ? 'on' : ''} onClick={() => setTab('pos')}>POS e gateway</button><button className={tab === 'ch' ? 'on' : ''} onClick={() => setTab('ch')}>Canali digitali e split payment</button></div>

      {tab === 'pos' && <>
        <div className="grid g4">
          <Kpi label="Transazioni importate" value={s?.tx_total ?? '–'} foot={`${s?.tx_matched ?? 0} riconciliate`} bar={s?.tx_total ? (s.tx_matched / s.tx_total) * 100 : 0} />
          <Kpi label="Transazioni senza scontrino" value={s ? s.tx_total - s.tx_matched : '–'} foot={eur(s?.tx_unmatched_amount)} />
          <Kpi label="Scontrini senza transazione" value={s?.receipts_unmatched ?? '–'} foot={eur(s?.receipts_unmatched_amount)} />
          <Card title="Importa CSV">
            <label className="btn ghost" style={{ width: '100%' }}>Carica estratto acquirer<input type="file" accept=".csv,text/csv" hidden onChange={(e) => upload(e, 'transactions')} /></label>
            <button className="btn link small" style={{ marginTop: 8 }} onClick={run}>Riesegui riconciliazione</button>
            <div className="help" style={{ marginTop: 6 }}>Colonne: data; importo; circuito; terminale; riferimento; sede (codice). Separatore ; o virgola.</div>
          </Card>
        </div>
        <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Transazioni acquirer" flush>
            {!rec.data ? <Loading /> : !rec.data.transactions.length ? <Empty>Nessuna transazione importata nel periodo</Empty> : (
              <div className="table-wrap" style={{ maxHeight: 520 }}><table className="t">
                <thead><tr><th>Data</th><th>Sede</th><th>Circuito</th><th>TID</th><th className="num">Importo</th><th>Stato</th></tr></thead>
                <tbody>{rec.data.transactions.map((t) => <tr key={t.id}><td>{itDate(t.tx_date)}</td><td>{t.site_name || <span className="red small">sede?</span>}</td><td>{CIRCUITS[t.circuit] || t.circuit || '–'}</td><td className="mono small">{t.terminal_id || '–'}</td><td className="num">{eur(t.amount)}</td>
                  <td>{t.matched_receipt_id ? <Link to={`/rendiconti/${t.report_id}`}><Badge tone="green">ok</Badge></Link> : <Badge tone="red">manca</Badge>}</td></tr>)}</tbody>
              </table></div>
            )}
          </Card>
          <Card title="Scontrini registrati senza riscontro" flush>
            {!rec.data ? <Loading /> : !rec.data.unmatched_receipts.length ? <Empty>Tutti gli scontrini del periodo hanno riscontro</Empty> : (
              <div className="table-wrap" style={{ maxHeight: 520 }}><table className="t">
                <thead><tr><th>Data</th><th>Sede</th><th>Circuito</th><th>N.</th><th className="num">Importo</th></tr></thead>
                <tbody>{rec.data.unmatched_receipts.map((p) => <tr key={p.id} className="click" onClick={() => window.open(`/rendiconti/${p.report_id}`, '_self')}><td>{itDate(p.report_date)}</td><td>{p.site_name}</td><td>{CIRCUITS[p.circuit]}</td><td className="mono small">{p.receipt_number || '–'}</td><td className="num">{eur(p.amount)}</td></tr>)}</tbody>
              </table></div>
            )}
          </Card>
        </div>
      </>}

      {tab === 'ch' && <div className="grid" style={{ gridTemplateColumns: '1fr 300px', alignItems: 'start' }}>
        <Card title="Incassi da canali digitali" flush>
          {!ch.data ? <Loading /> : !ch.data.length ? <Empty>Nessun incasso digitale nel periodo</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Data</th><th>Canale</th><th>Sede</th><th className="num">Lordo</th><th className="num">Trattenuto (split)</th><th className="num">Netto affiliato</th><th /></tr></thead>
              <tbody>{ch.data.map((r) => <tr key={r.id}><td>{itDate(r.rev_date)}</td><td>{r.channel}</td><td>{r.site_name || '–'}</td><td className="num">{eur(r.gross_amount)}</td><td className="num">{eur(r.franchisor_share)}</td><td className="num">{eur(r.gross_amount - r.franchisor_share)}</td>
                <td className="num"><button className="iconbtn" onClick={async () => { if (window.confirm('Eliminare la riga?')) { await api.del(`/imports/channels/${r.id}`); ch.reload(); } }}>✕</button></td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}>Totale</td><td className="num">{eur(ch.data.reduce((a, r) => a + Number(r.gross_amount), 0))}</td><td className="num">{eur(ch.data.reduce((a, r) => a + Number(r.franchisor_share), 0))}</td><td colSpan={2} /></tr></tfoot>
            </table></div>
          )}
        </Card>
        <Card title="Importa CSV">
          <label className="btn ghost" style={{ width: '100%' }}>Carica incassi digitali<input type="file" accept=".csv,text/csv" hidden onChange={(e) => upload(e, 'channels')} /></label>
          <div className="help" style={{ marginTop: 8 }}>Colonne: data; canale; importo_lordo; quota_franchisor; sede; riferimento. La quota trattenuta alla fonte viene dedotta dall'estratto royalty del periodo.</div>
        </Card>
      </div>}
    </div>
  );
}
