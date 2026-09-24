import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, can } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Empty, Field, Badge, useToast } from '../components/ui.jsx';
import { ScopeFilter } from '../components/filters.jsx';
import { itDate, itDateTime, NC_STATUS, SEVERITY, today } from '../format.js';
import { qs } from '../api.js';
import { NcCreateModal } from './ReportEdit.jsx';

export default function NcList() {
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ company_id: '', site_id: '', status: 'APERTA,RISPOSTA', kind: '' });
  const [create, setCreate] = useState(false);
  const { data, error, reload } = useApi(`/nc${qs(f)}`);
  const admin = can(user, 'SUPERADMIN', 'ADMIN');
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Errori e non conformità</h1><div className="sub">Segnalazioni degli amministratori alle sedi, con risposta tracciata</div></div>
        {admin && <button className="btn" onClick={() => setCreate(true)}>+ Nuova segnalazione</button>}
      </div>
      <div className="filters">
        <ScopeFilter value={f} onChange={setF} />
        <Field label="Stato"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="APERTA,RISPOSTA">Da gestire</option><option value="APERTA">Aperte</option><option value="RISPOSTA">Con risposta</option><option value="CHIUSA">Chiuse</option><option value="">Tutte</option>
        </select></Field>
        <Field label="Tipo"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="">Tutti</option><option value="ERRORE">Errori</option><option value="NON_CONFORMITA">Non conformità</option></select></Field>
      </div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : !data.length ? <div className="card"><Empty>Nessuna segnalazione</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="t">
          <thead><tr><th>#</th><th>Oggetto</th><th>Sede</th><th>Tipo</th><th>Gravità</th><th>Stato</th><th>Scadenza</th><th>Aperta</th><th className="num">Messaggi</th></tr></thead>
          <tbody>{data.map((n) => (
            <tr key={n.id} className="click" onClick={() => nav(`/nc/${n.id}`)}>
              <td className="muted">{n.id}</td>
              <td><div className="strong">{n.title}</div>{n.report_date && <div className="small muted">Rendiconto del {itDate(n.report_date)}</div>}</td>
              <td>{n.site_name || <span className="muted">Azienda</span>}{user.role === 'SUPERADMIN' && <div className="small muted">{n.company_name}</div>}</td>
              <td>{n.kind === 'ERRORE' ? 'Errore' : 'Non conformità'}</td>
              <td><Badge tone={SEVERITY[n.severity]}>{n.severity}</Badge></td>
              <td><Badge tone={NC_STATUS[n.status].tone}>{NC_STATUS[n.status].label}</Badge></td>
              <td className={n.due_date && n.status !== 'CHIUSA' && n.due_date < today() ? 'red strong' : ''}>{n.due_date ? itDate(n.due_date) : '–'}</td>
              <td className="small muted">{itDateTime(n.created_at)}<br />{n.created_by_name}</td>
              <td className="num">{n.messages}</td>
            </tr>))}</tbody>
        </table></div></div>
      )}
      {create && <NcCreateModal siteId={f.site_id} onClose={() => setCreate(false)} onDone={(id) => { setCreate(false); toast(`Aperta segnalazione #${id}`); reload(); nav(`/nc/${id}`); }} />}
    </div>
  );
}
