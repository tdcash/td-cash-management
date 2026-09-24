import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth, can } from '../auth.jsx';
import { api } from '../api.js';
import { useApi, Loading, ErrorBox, StatusBadge, Empty, Field, Badge, Icon, PromptModal, useToast } from '../components/ui.jsx';
import { ScopeFilter, PeriodFilter, PRESETS } from '../components/filters.jsx';
import { eur, itDate, weekday, STATUS } from '../format.js';
import { qs } from '../api.js';

export default function Reports() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [f, setF] = useState({ company_id: '', site_id: '', status: '', ...PRESETS['30g']() });
  const { data, error, reload } = useApi(`/reports${qs(f)}`);
  const toast = useToast();
  const admin = can(user, 'SUPERADMIN', 'ADMIN');
  const [del, setDel] = useState(null);
  const canDelete = (r) => admin || (r.status === 'DRAFT' && r.created_by === user.id);
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
            <option value="DRAFT,CLOSED,PROCESSED,PICKED_UP">Non ancora verificati</option><option value="VERIFIED">In cassaforte</option>
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
                  <td className="num strong">{r.status === 'DRAFT' ? <span className="muted">bozza</span> : eur(r.day_total)}</td>
                  <td className={`num ${diff ? 'red' : 'muted'}`}>{diff == null ? '–' : eur(diff)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{r.open_nc > 0 && <Badge tone="red">{r.open_nc} NC</Badge>}
                    {canDelete(r) && <button className="iconbtn" title="Elimina rendiconto" aria-label="Elimina rendiconto" onClick={(e) => { e.stopPropagation(); setDel(r); }}><Icon name="trash" size={16} /></button>}
                  </td>
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
      {del && (del.status === 'DRAFT' && !admin
        ? <PromptModal title={`Elimina bozza ${del.site_name} del ${itDate(del.report_date)}`} label="Conferma scrivendo ELIMINA" confirmText="Elimina" danger minLength={7} onClose={() => setDel(null)}
          onConfirm={async (v) => { if (v.toUpperCase() !== 'ELIMINA') throw new Error('Scrivi ELIMINA per confermare'); await api.del(`/reports/${del.id}`); toast('Bozza eliminata'); reload(); }} />
        : <PromptModal title={`Elimina rendiconto ${del.site_name} del ${itDate(del.report_date)}`} label={`Stato: ${STATUS[del.status]?.label}${del.envelope_code ? `, busta ${del.envelope_code}` : ''}. Motivazione (resta nel registro attività)`}
          placeholder="es. rendiconto duplicato, inserito sulla sede sbagliata" confirmText="Elimina definitivamente" danger minLength={5} onClose={() => setDel(null)}
          onConfirm={async (reason) => { await api.del(`/reports/${del.id}`, { reason }); toast('Rendiconto eliminato'); reload(); }} />)}
    </div>
  );
}
