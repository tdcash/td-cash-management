import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, StatusBadge, Empty, Field, Badge, Icon } from '../components/ui.jsx';
import { ScopeFilter, PeriodFilter, PRESETS } from '../components/filters.jsx';
import { eur, itDate, weekday, STATUS } from '../format.js';
import { qs } from '../api.js';

export default function Reports() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [f, setF] = useState({ company_id: '', site_id: '', status: '', ...PRESETS['30g']() });
  const { data, error } = useApi(`/reports${qs(f)}`);
  const tot = (k) => (data || []).reduce((a, r) => a + Number(r[k] || 0), 0);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Rendiconti giornalieri</h1><div className="sub">Un rendiconto per sede per giorno, con il flusso dalla cassa alla banca</div></div>
        <div className="row">
          <a className="btn ghost" href={`/api/stats/export.csv${qs({ company_id: f.company_id, site_id: f.site_id, from: f.from, to: f.to })}`}><Icon name="download" size={17} />Esporta CSV</a>
          <Link className="btn" to="/rendiconti/nuovo">+ Nuovo rendiconto</Link>
        </div>
      </div>
      <div className="filters">
        <ScopeFilter value={f} onChange={setF} />
        <Field label="Stato">
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Tutti</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            <option value="DRAFT,CLOSED,PROCESSED,PICKED_UP">Non ancora versati</option>
          </select>
        </Field>
        <PeriodFilter value={f} onChange={setF} />
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !data.length ? <div className="card"><Empty>Nessun rendiconto nel periodo</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="t">
          <thead><tr>
            <th>Data</th><th>Sede</th>{user.role === 'SUPERADMIN' && <th>Azienda</th>}<th>Stato</th><th>Busta</th>
            <th className="num">Contanti</th><th className="num">POS</th><th className="num">Bonifici</th><th className="num">Totale</th><th className="num">Δ gest.</th><th />
          </tr></thead>
          <tbody>
            {data.map((r) => {
              const diff = r.expected_total == null ? null : Number(r.day_total) - Number(r.expected_total);
              return (
                <tr key={r.id} className="click" onClick={() => nav(`/rendiconti/${r.id}`)}>
                  <td><span className="muted small">{weekday(r.report_date)}</span> {itDate(r.report_date)}</td>
                  <td className="strong">{r.site_name}</td>
                  {user.role === 'SUPERADMIN' && <td className="muted">{r.company_name}</td>}
                  <td><StatusBadge status={r.status} /></td>
                  <td className="mono small">{r.envelope_code || '–'}</td>
                  <td className="num">{eur(r.cash_to_deposit)}</td>
                  <td className="num">{eur(r.pos_total)}</td>
                  <td className="num">{eur(r.transfer_total)}</td>
                  <td className="num strong">{eur(r.day_total)}</td>
                  <td className={`num ${diff ? 'red' : 'muted'}`}>{diff == null ? '–' : eur(diff)}</td>
                  <td>{r.open_nc > 0 && <Badge tone="red">{r.open_nc} NC</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr>
            <td colSpan={user.role === 'SUPERADMIN' ? 5 : 4}>{data.length} rendiconti</td>
            <td className="num">{eur(tot('cash_to_deposit'))}</td><td className="num">{eur(tot('pos_total'))}</td><td className="num">{eur(tot('transfer_total'))}</td>
            <td className="num">{eur(tot('day_total'))}</td><td colSpan={2} />
          </tr></tfoot>
        </table></div></div>
      )}
    </div>
  );
}
