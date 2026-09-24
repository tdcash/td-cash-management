import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading } from '../components/ui.jsx';
import { today, eur } from '../format.js';

export default function NewReport() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const sites = useApi('/sites?active=1');
  const [f, setF] = useState({ site_id: sp.get('site') || '', report_date: sp.get('date') || today() });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!f.site_id && sites.data?.length === 1) setF((x) => ({ ...x, site_id: String(sites.data[0].id) }));
  }, [sites.data, f.site_id]);
  const site = sites.data?.find((s) => String(s.id) === String(f.site_id));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api.post('/reports', { site_id: Number(f.site_id), report_date: f.report_date });
      nav(`/rendiconti/${r.id}`);
    } catch (e2) {
      if (e2.status === 409) {
        const list = await api.get(`/reports?site_id=${f.site_id}&from=${f.report_date}&to=${f.report_date}`);
        if (list[0]) return nav(`/rendiconti/${list[0].id}`);
      }
      setErr(e2);
    }
    setBusy(false);
  };
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div className="page-head"><div><h1>Nuovo rendiconto giornaliero</h1><div className="sub">Un rendiconto per sede per giorno. Se esiste già, lo apro.</div></div></div>
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
            {site && <div className="alert info">Fondo cassa della sede: <b>{eur(site.cash_float)}</b>. Verrà sottratto dal contante contato.</div>}
            <button className="btn lg" disabled={busy || !f.site_id}>Apri rendiconto</button>
          </form>
        </Card>
      )}
    </div>
  );
}
