import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading } from '../components/ui.jsx';
import { useAuth, can } from '../auth.jsx';
import { today, eur } from '../format.js';

export default function NewReport() {
  const nav = useNavigate();
  const { user } = useAuth();
  const admin = can(user, 'SUPERADMIN', 'ADMIN');
  const [sp] = useSearchParams();
  const sites = useApi('/sites?active=1');
  const users = useApi(admin ? '/users' : null);
  const [f, setF] = useState({ site_id: sp.get('site') || '', report_date: sp.get('date') || today(), operator_id: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!f.site_id && sites.data?.length === 1) setF((x) => ({ ...x, site_id: String(sites.data[0].id) }));
  }, [sites.data, f.site_id]);
  const site = sites.data?.find((s) => String(s.id) === String(f.site_id));
  const operators = admin && site ? (users.data || []).filter((u) => u.role === 'OPERATOR' && u.active && (u.site_ids || []).includes(site.id)) : [];
  const existing = useApi(f.site_id && f.report_date ? `/reports?site_id=${f.site_id}&from=${f.report_date}&to=${f.report_date}` : null);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api.post('/reports', { site_id: Number(f.site_id), report_date: f.report_date, operator_id: f.operator_id ? Number(f.operator_id) : undefined });
      nav(`/rendiconti/${r.id}`);
    } catch (e2) {
      if (e2.status === 409) {
        if (e2.data?.id) return nav(`/rendiconti/${e2.data.id}`);
      }
      setErr(e2);
    }
    setBusy(false);
  };
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="page-head"><div><h1>Nuovo rendiconto giornaliero</h1><div className="sub">Una chiusura di cassa per operatore, per sede e per giorno. Se la tua cassa di oggi esiste già, la apro.</div></div></div>
      {!sites.data ? <Loading /> : (
        <Card>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ErrorBox error={err} />
            <Field label="Sede">
              <select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })} required>
                <option value="">Seleziona la sede</option>
                {sites.data.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code}){s.company_name ? ` · ${s.company_name}` : ''}</option>)}
              </select>
            </Field>
            <Field label="Data dell'incasso"><input type="date" max={today()} value={f.report_date} onChange={(e) => setF({ ...f, report_date: e.target.value })} required /></Field>
            {admin && site && operators.length > 0 && <Field label="Cassa di" help="Lascia vuoto per aprire la tua cassa"><select value={f.operator_id} onChange={(e) => setF({ ...f, operator_id: e.target.value })}><option value="">La mia cassa ({user.full_name})</option>{operators.map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.cash_float != null ? ` · fondo ${eur(u.cash_float)}` : ''}</option>)}</select></Field>}
            {site && <div className="alert info">Fondo cassa: <b>{eur((f.operator_id ? operators.find((u) => String(u.id) === f.operator_id)?.cash_float : user.cash_float) ?? site.cash_float)}</b>. Verrà sottratto dal contante contato. {site.expected_registers > 1 && <>La sede prevede <b>{site.expected_registers} casse</b> al giorno.</>}</div>}
            {existing.data?.length > 0 && <div className="small muted">Casse già aperte per questo giorno: {existing.data.map((r) => <a key={r.id} onClick={() => nav(`/rendiconti/${r.id}`)} style={{ cursor: 'pointer', marginRight: 8 }}>{r.operator_name || 'operatore'}</a>)}</div>}
            <button className="btn lg" disabled={busy || !f.site_id}>Apri cassa</button>
          </form>
        </Card>
      )}
    </div>
  );
}
