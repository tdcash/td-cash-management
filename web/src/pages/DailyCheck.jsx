import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Field, Loading, ErrorBox, Empty, Badge, StatusBadge, Modal, useToast } from '../components/ui.jsx';
import { eur, itDate, itDateTime, weekday, today, addDays } from '../format.js';

export default function DailyCheck() {
  const { user } = useAuth();
  const toast = useToast();
  const companies = useApi(user.role === 'SUPERADMIN' ? '/companies' : null);
  const [f, setF] = useState({ date: addDays(today(), -1), company_id: '' });
  const { data: d, error, reload } = useApi(`/comms/daily${qs(f)}`);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const log = useApi(`/comms/log?kind=COMUNICAZIONE`);
  const alert = async (site_id) => {
    setErr(null);
    try {
      const r = await api.post('/comms/daily/alert', { date: f.date, site_id, company_id: f.company_id ? Number(f.company_id) : undefined });
      const ok = r.filter((x) => x.status === 'INVIATA').length;
      toast(ok ? `Sollecito inviato (${ok})` : r[0]?.status === 'NON_CONFIGURATA' ? 'Email non configurata: sollecito registrato' : r[0]?.status === 'DUPLICATA' ? 'Sollecito già inviato per questa data' : `Non inviato: ${r[0]?.error || 'nessun destinatario'}`, ok ? 'ok' : 'err');
      reload();
    } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Controllo giornaliero rendiconti</h1><div className="sub">Quali sedi hanno rendicontato e quali no. Il controllo automatico gira ogni mattina e sollecita via email le sedi mancanti.</div></div>
        <button className="btn" onClick={() => setMsg({ site_id: '' })}>Invia comunicazione a una sede</button>
      </div>
      <div className="filters">
        {user.role === 'SUPERADMIN' && <Field label="Azienda"><select value={f.company_id} onChange={(e) => setF({ ...f, company_id: e.target.value })}><option value="">Tutte</option>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Giorno"><input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <div className="row" style={{ paddingBottom: 2 }}>
          <button className="btn sm ghost" onClick={() => setF({ ...f, date: addDays(f.date, -1) })}>← giorno prima</button>
          <button className="btn sm ghost" onClick={() => setF({ ...f, date: addDays(today(), -1) })}>Ieri</button>
          <button className="btn sm ghost" onClick={() => setF({ ...f, date: today() })}>Oggi</button>
        </div>
      </div>
      <ErrorBox error={error || err} />
      {!d ? <Loading /> : <>
        {!d.mail.configured && <div className="alert warn" style={{ marginBottom: 14 }}>Invio email non configurato: i solleciti vengono registrati ma non partono. Configura Office 365 nelle Impostazioni.</div>}
        <div className="grid g4">
          <Kpi accent label={`${weekday(d.date)} ${itDate(d.date)}`} value={`${d.summary.done} / ${d.summary.operating}`} foot="rendiconti inseriti su sedi operative" />
          <Kpi label="Sedi mancanti" value={d.summary.missing} foot={d.summary.missing ? 'da sollecitare' : 'tutto regolare'} />
          <Kpi label="Ancora in bozza" value={d.summary.drafts} foot="inseriti ma non chiusi" />
          <div className="card kpi" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <button className="btn" disabled={!d.summary.missing} onClick={() => alert(undefined)}>Sollecita tutte le mancanti ({d.summary.missing})</button>
          </div>
        </div>
        <div style={{ marginTop: 16 }}><Card flush>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Sede</th>{user.role === 'SUPERADMIN' && <th>Azienda</th>}<th>Email sede</th><th>Rendiconto</th><th className="num">Totale</th><th>Inserito da</th><th>Sollecito</th><th /></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.site_id} style={{ background: r.operating && !r.report_id ? 'var(--red-100)' : undefined }}>
                <td><b>{r.site_name}</b><div className="small muted">{r.site_code}</div></td>
                {user.role === 'SUPERADMIN' && <td>{r.company_name}</td>}
                <td className="small">{r.site_email || <span className="red">mancante</span>}{r.closing_time && <div className="muted">chiude alle {r.closing_time}</div>}</td>
                <td>{r.report_id ? <Link to={`/rendiconti/${r.report_id}`}><StatusBadge status={r.status} /></Link> : r.operating ? <Badge tone="red">Non inserito</Badge> : <Badge>Sede chiusa</Badge>}</td>
                <td className="num">{r.report_id && r.status !== 'DRAFT' ? eur(Number(r.cash_to_deposit) + Number(r.pos_total) + Number(r.transfer_total)) : '–'}</td>
                <td className="small muted">{r.created_by_name || ''}{r.updated_at && <div>{itDateTime(r.updated_at)}</div>}</td>
                <td className="small">{r.alert_status ? <><Badge tone={r.alert_status === 'INVIATA' ? 'green' : 'mauve'}>{r.alert_status === 'INVIATA' ? 'Inviato' : r.alert_status === 'NON_CONFIGURATA' ? 'Registrato' : 'Fallito'}</Badge><div className="muted">{itDateTime(r.alert_at)}</div></> : '–'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {r.operating && !r.report_id && <button className="btn sm ghost" onClick={() => alert(r.site_id)}>Sollecita</button>}
                  {' '}<button className="btn sm ghost" onClick={() => setMsg({ site_id: r.site_id, site_name: r.site_name })}>Scrivi</button>
                </td>
              </tr>))}</tbody>
          </table></div>
        </Card></div>
        <div style={{ marginTop: 16 }}><Card title="Ultime comunicazioni inviate" flush>
          {!log.data ? <Loading /> : !log.data.length ? <Empty>Nessuna comunicazione</Empty> : (
            <div className="table-wrap" style={{ maxHeight: 320 }}><table className="t">
              <thead><tr><th>Quando</th><th>Sede</th><th>Oggetto</th><th>A</th><th>Esito</th><th>Da</th></tr></thead>
              <tbody>{log.data.slice(0, 50).map((e) => <tr key={e.id}><td className="small">{itDateTime(e.created_at)}</td><td>{e.site_name || '–'}</td><td>{e.subject}</td><td className="small">{e.to_addr}</td><td><Badge tone={e.status === 'INVIATA' ? 'green' : e.status === 'FALLITA' ? 'red' : 'mauve'}>{e.status.replace('_', ' ').toLowerCase()}</Badge></td><td className="small muted">{e.sent_by_name || 'automatico'}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card></div>
      </>}
      {msg && <MessageModal init={msg} sites={d?.rows || []} onClose={() => setMsg(null)} onDone={(r) => { setMsg(null); toast(r.status === 'INVIATA' ? 'Comunicazione inviata' : r.status === 'NON_CONFIGURATA' ? 'Email non configurata: comunicazione registrata' : `Non inviata: ${r.error}`, r.status === 'INVIATA' ? 'ok' : 'err'); log.reload(); }} />}
    </div>
  );
}

function MessageModal({ init, sites, onClose, onDone }) {
  const [f, setF] = useState({ site_id: init.site_id || '', subject: '', body: '', to_site: true, to_host: false, to_operators: false });
  const [err, setErr] = useState(null);
  const site = sites.find((s) => String(s.site_id) === String(f.site_id));
  const go = async () => { setErr(null); try { onDone(await api.post('/comms/message', { ...f, site_id: Number(f.site_id) })); } catch (e) { setErr(e); } };
  return (
    <Modal title="Comunicazione alla sede" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!f.site_id || f.subject.length < 3 || f.body.length < 5} onClick={go}>Invia</button></>}>
      <ErrorBox error={err} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Sede"><select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}><option value="">Seleziona</option>{sites.map((s) => <option key={s.site_id} value={s.site_id}>{s.site_name}</option>)}</select></Field>
        <div className="row">
          <label className="f inline"><input type="checkbox" checked={f.to_site} onChange={(e) => setF({ ...f, to_site: e.target.checked })} />Email sede {site && <span className="muted small">({site.site_email || 'mancante'})</span>}</label>
          <label className="f inline"><input type="checkbox" checked={f.to_operators} onChange={(e) => setF({ ...f, to_operators: e.target.checked })} />Operatori della sede</label>
          <label className="f inline"><input type="checkbox" checked={f.to_host} onChange={(e) => setF({ ...f, to_host: e.target.checked })} />Struttura ospitante {site && <span className="muted small">({site.host_email || 'mancante'})</span>}</label>
        </div>
        <Field label="Oggetto"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Messaggio"><textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ minHeight: 120 }} /></Field>
        <p className="small muted">Riceverai una copia in conoscenza. Il messaggio resta nel registro invii.</p>
      </div>
    </Modal>
  );
}
