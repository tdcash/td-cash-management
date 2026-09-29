import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, Kpi, Card, Loading, Empty, useToast } from '../components/ui.jsx';
import { useCompany } from '../components/company.jsx';
import { CreateModal, r2 } from '../components/deposits.jsx';
import { eur, itDate, itDateTime } from '../format.js';

export default function Safe() {
  const toast = useToast();
  const { company, Selector } = useCompany();
  const safe = useApi(company ? `/deposits/safe?company_id=${company}` : null);
  const open = useApi(company ? `/deposits?company_id=${company}&status=PREPARATO,RITIRATO` : null);
  const [sel, setSel] = useState([]);
  const [create, setCreate] = useState(false);
  const selTotal = r2((safe.data?.reports || []).filter((r) => sel.includes(r.id)).reduce((a, r) => a + Number(r.verified_amount), 0));
  const inTransit = (open.data || []).reduce((a, d) => a + Number(d.total_amount), 0);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Cassaforte</h1><div className="sub">Contante verificato in attesa di versamento. Da qui si prepara il versamento al portavalori, anche parziale.</div></div>
        <Selector />
      </div>
      {!safe.data ? <Loading /> : <>
        <div className="grid g4">
          <Kpi accent label="In cassaforte, versabile" value={eur(safe.data.total)} foot={`${safe.data.reports.length} rendiconti verificati`} />
          <Kpi label="Selezionato per il versamento" value={eur(selTotal)} foot={`${sel.length} rendiconti`} />
          <Kpi label="In lavorazione nelle sedi" value={eur(safe.data.pending_amount)} foot={`${safe.data.pending_count} rendiconti non ancora verificati`} />
          <Kpi label="Versato, non ancora accreditato" value={eur(inTransit)} foot={<Link to="/versamenti">{(open.data || []).length} versamenti aperti</Link>} />
        </div>
        <div className="row" style={{ margin: '16px 0 10px', justifyContent: 'flex-end' }}>
          <button className="btn sm ghost" disabled={!safe.data.reports.length} onClick={() => setSel(sel.length === safe.data.reports.length ? [] : safe.data.reports.map((r) => r.id))}>{sel.length === safe.data.reports.length && sel.length ? 'Deseleziona tutto' : 'Seleziona tutto'}</button>
          <button className="btn" disabled={!sel.length} onClick={() => setCreate(true)}>Prepara versamento ({sel.length}) · {eur(selTotal)}</button>
        </div>
        <Card title="Contante in cassaforte" flush>
          {!safe.data.reports.length ? <Empty>Nessun rendiconto verificato in attesa di versamento</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th /><th>Data</th><th>Sede</th><th>Busta sede</th><th className="num">Distinta</th><th className="num">Verificato</th><th>Verificato da</th></tr></thead>
              <tbody>{safe.data.reports.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} /></td>
                  <td><Link to={`/rendiconti/${r.id}`}>{itDate(r.report_date)}</Link></td><td className="strong">{r.site_name}</td><td className="mono small">{r.envelope_code || '–'}</td>
                  <td className="num">{eur(r.cash_to_deposit)}</td><td className={`num strong ${Number(r.verified_amount) !== Number(r.cash_to_deposit) ? 'red' : ''}`}>{eur(r.verified_amount)}</td>
                  <td className="small muted">{r.verified_by_name}<br />{itDateTime(r.verified_at)}</td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={5}>Totale in cassaforte</td><td className="num">{eur(safe.data.total)}</td><td /></tr></tfoot>
            </table></div>
          )}
        </Card>
      </>}
      {create && <CreateModal company={company} reports={safe.data.reports.filter((r) => sel.includes(r.id))} onClose={() => setCreate(false)}
        onDone={(d) => { setCreate(false); setSel([]); toast(`Versamento ${d.number} preparato`); safe.reload(); open.reload(); window.open(`/api/deposits/${d.id}/pdf`, '_blank', 'noopener'); }} />}
    </div>
  );
}
