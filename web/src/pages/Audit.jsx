import React, { useState } from 'react';
import { useApi, Loading, Empty, Field } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { qs } from '../api.js';

export default function Audit() {
  const [action, setAction] = useState('');
  const { data } = useApi(`/audit${qs({ action, limit: 300 })}`);
  const actions = [...new Set((data || []).map((a) => a.action))].sort();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Registro attività</h1><div className="sub">Chi ha fatto cosa, quando: accessi, modifiche, elaborazioni</div></div></div>
      <div className="filters"><Field label="Azione"><select value={action} onChange={(e) => setAction(e.target.value)}><option value="">Tutte</option>{actions.map((a) => <option key={a}>{a}</option>)}</select></Field></div>
      <div className="card">
        {!data ? <Loading /> : !data.length ? <Empty>Nessuna attività</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Quando</th><th>Utente</th><th>Azione</th><th>Oggetto</th><th>Dettagli</th><th>IP</th></tr></thead>
            <tbody>{data.map((a) => <tr key={a.id}><td className="small" style={{ whiteSpace: 'nowrap' }}>{itDateTime(a.at)}</td><td>{a.full_name || <span className="muted">–</span>}<div className="small muted">{a.email}</div></td><td className="mono small">{a.action}</td><td className="small">{a.entity} {a.entity_id}</td><td className="small mono" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.data ? JSON.stringify(a.data) : ''}>{a.data ? JSON.stringify(a.data) : ''}</td><td className="small muted">{a.ip}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
