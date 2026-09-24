import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Field, Loading, ErrorBox, Empty, Badge, Modal, MoneyInput, PromptModal, Icon, useToast } from '../components/ui.jsx';
import { ScanButton } from '../components/scan.jsx';
import { eur, itDate, itDateTime, today, DEPOSIT_STATUS } from '../format.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export default function Deposits() {
  const { user } = useAuth();
  const toast = useToast();
  const companies = useApi(user.role === 'SUPERADMIN' ? '/companies' : null);
  const [cid, setCid] = useState(user.company_id || '');
  const company = cid || companies.data?.[0]?.id || '';
  const safe = useApi(company ? `/deposits/safe?company_id=${company}` : null);
  const list = useApi(company ? `/deposits?company_id=${company}` : null);
  const [sel, setSel] = useState([]);
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState(null);
  const reloadAll = () => { safe.reload(); list.reload(); setSel([]); };
  const selTotal = r2((safe.data?.reports || []).filter((r) => sel.includes(r.id)).reduce((a, r) => a + Number(r.verified_amount), 0));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Cassaforte e versamenti al portavalori</h1><div className="sub">Solo i rendiconti riconteggiati e verificati sono versabili. Il versamento è a livello azienda, anche parziale.</div></div>
        {user.role === 'SUPERADMIN' && <Field label="Azienda"><select value={company} onChange={(e) => { setCid(e.target.value); setSel([]); }}>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
      </div>
      {!safe.data ? <Loading /> : <>
        <div className="grid g4">
          <Kpi accent label="In cassaforte, versabile" value={eur(safe.data.total)} foot={`${safe.data.reports.length} rendiconti verificati`} />
          <Kpi label="Selezionato per il versamento" value={eur(selTotal)} foot={`${sel.length} rendiconti`} />
          <Kpi label="In lavorazione nelle sedi" value={eur(safe.data.pending_amount)} foot={`${safe.data.pending_count} rendiconti non ancora verificati`} />
          <div className="card kpi" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <button className="btn lg" disabled={!sel.length} onClick={() => setCreate(true)}>Prepara versamento ({sel.length})</button>
            <button className="btn sm ghost" disabled={!safe.data.reports.length} onClick={() => setSel(sel.length === safe.data.reports.length ? [] : safe.data.reports.map((r) => r.id))}>{sel.length === safe.data.reports.length && sel.length ? 'Deseleziona tutto' : 'Seleziona tutto'}</button>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
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
        </div>

        <div style={{ marginTop: 16 }}>
          <Card title="Versamenti" flush>
            {!list.data ? <Loading /> : !list.data.length ? <Empty>Nessun versamento</Empty> : (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Numero</th><th>Data</th><th className="num">Rendiconti</th><th>Buste</th><th className="num">Importo</th><th>Stato</th><th>Portavalori</th><th className="num">Accredito</th><th /></tr></thead>
                <tbody>{list.data.map((d) => (
                  <tr key={d.id} className="click" onClick={() => setOpen(d.id)}>
                    <td className="mono strong">{d.number}</td><td>{itDate(d.deposit_date)}</td><td className="num">{d.reports_count}</td>
                    <td className="mono small">{(d.envelopes || []).map((e) => e.code).join(', ')}</td>
                    <td className="num strong">{eur(d.total_amount)}</td>
                    <td><Badge tone={DEPOSIT_STATUS[d.status].tone}>{DEPOSIT_STATUS[d.status].label}</Badge></td>
                    <td className="small">{d.operator_name || '–'}{d.picked_at && <div className="muted">{itDateTime(d.picked_at)}</div>}</td>
                    <td className={`num ${d.bank_amount != null && Number(d.bank_amount) !== Number(d.total_amount) ? 'red' : ''}`}>{d.bank_amount != null ? `${eur(d.bank_amount)} · ${itDate(d.bank_date)}` : '–'}</td>
                    <td className="num"><a className="btn sm ghost" href={`/api/deposits/${d.id}/pdf`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}><Icon name="print" size={14} />PDF</a></td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Card>
        </div>
      </>}
      {create && <CreateModal company={company} reports={safe.data.reports.filter((r) => sel.includes(r.id))} onClose={() => setCreate(false)}
        onDone={(d) => { setCreate(false); toast(`Versamento ${d.number} preparato`); reloadAll(); window.open(`/api/deposits/${d.id}/pdf`, '_blank', 'noopener'); }} />}
      {open && <DepositDetail id={open} onClose={() => setOpen(null)} onChanged={reloadAll} />}
    </div>
  );
}

function CreateModal({ company, reports, onClose, onDone }) {
  const total = r2(reports.reduce((a, r) => a + Number(r.verified_amount), 0));
  const [date, setDate] = useState(today());
  const [envs, setEnvs] = useState([{ code: '', amount: total }]);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const envTotal = r2(envs.reduce((a, e) => a + Number(e.amount || 0), 0));
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await api.post('/deposits', { company_id: Number(company), report_ids: reports.map((r) => r.id), deposit_date: date,
        envelopes: envs.filter((e) => e.code).map((e) => ({ code: e.code, amount: e.amount === '' ? null : Number(e.amount) })), notes: notes || null });
      onDone(d);
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  return (
    <Modal wide title="Prepara versamento al portavalori" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annulla</button>
      <button className="btn" disabled={busy || !envs.some((e) => e.code) || envTotal !== total} onClick={go}>Crea versamento e stampa distinta</button>
    </>}>
      <ErrorBox error={err} />
      <div className="alert info" style={{ marginBottom: 12 }}>Versi <b>{eur(total)}</b> da {reports.length} rendiconti verificati. Il contante entra in una o più buste Mondialpol nuove: registra i codici e l'importo di ciascuna. La somma deve coincidere.</div>
      <div className="form-grid">
        <Field label="Data versamento"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Note"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="facoltative" /></Field>
      </div>
      <div className="subhead">Buste del versamento</div>
      <table className="t"><thead><tr><th>Codice busta</th><th className="num" style={{ width: 160 }}>Importo</th><th style={{ width: 44 }} /></tr></thead><tbody>
        {envs.map((e, i) => (
          <tr key={i}>
            <td><div className="row" style={{ flexWrap: 'nowrap' }}><input className="mono" value={e.code} onChange={(ev) => setEnvs(envs.map((x, j) => (j === i ? { ...x, code: ev.target.value.toUpperCase().trim() } : x)))} placeholder="Scansiona o digita" /><ScanButton onCode={(c) => setEnvs(envs.map((x, j) => (j === i ? { ...x, code: c.toUpperCase() } : x)))} /></div></td>
            <td><MoneyInput value={e.amount} onChange={(v) => setEnvs(envs.map((x, j) => (j === i ? { ...x, amount: v } : x)))} /></td>
            <td>{envs.length > 1 && <button className="iconbtn" onClick={() => setEnvs(envs.filter((_, j) => j !== i))}>✕</button>}</td>
          </tr>))}
      </tbody><tfoot><tr><td>Somma buste</td><td className={`num ${envTotal !== total ? 'red strong' : 'green strong'}`}>{eur(envTotal)}</td><td /></tr></tfoot></table>
      <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setEnvs([...envs, { code: '', amount: r2(total - envTotal) > 0 ? r2(total - envTotal) : '' }])}>+ Busta</button>
      <div className="subhead">Rendiconti inclusi</div>
      <table className="t"><tbody>{reports.map((r) => <tr key={r.id}><td>{itDate(r.report_date)}</td><td>{r.site_name}</td><td className="mono small">{r.envelope_code}</td><td className="num">{eur(r.verified_amount)}</td></tr>)}</tbody></table>
    </Modal>
  );
}

function DepositDetail({ id, onClose, onChanged }) {
  const toast = useToast();
  const { data: d, error, reload } = useApi(`/deposits/${id}`);
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState(null);
  if (error) return <Modal title="Versamento" onClose={onClose}><ErrorBox error={error} /></Modal>;
  if (!d) return <Modal title="Versamento" onClose={onClose}><Loading /></Modal>;
  const act = async (fn, msg) => { setErr(null); try { await fn(); toast(msg); reload(); onChanged(); } catch (e) { setErr(e); } };
  return (
    <Modal wide title={`Versamento ${d.number}`} onClose={onClose} footer={<>
      <a className="btn ghost" href={`/api/deposits/${d.id}/pdf`} target="_blank" rel="noopener"><Icon name="print" size={16} />Distinta e catena di custodia</a>
      <div className="spacer" />
      {d.status !== 'ACCREDITATO' && <button className="btn danger" onClick={() => setModal('delete')}>Elimina versamento</button>}
      {d.status !== 'PREPARATO' && <button className="btn ghost" onClick={() => setModal('undo')}>Annulla ultimo passaggio</button>}
      {d.status === 'PREPARATO' && <button className="btn" onClick={() => setModal('pickup')}>Registra ritiro portavalori</button>}
      {d.status === 'RITIRATO' && <button className="btn" onClick={() => setModal('bank')}>Conferma accredito in banca</button>}
    </>}>
      <ErrorBox error={err} />
      <div className="row" style={{ gap: 18, marginBottom: 12 }}>
        <div><div className="small muted">Stato</div><Badge tone={DEPOSIT_STATUS[d.status].tone}>{DEPOSIT_STATUS[d.status].label}</Badge></div>
        <div><div className="small muted">Data</div><b>{itDate(d.deposit_date)}</b></div>
        <div><div className="small muted">Importo</div><b>{eur(d.total_amount)}</b></div>
        <div><div className="small muted">Buste</div><span className="mono">{(d.envelopes || []).map((e) => e.code).join(', ')}</span></div>
        {d.operator_name && <div><div className="small muted">Portavalori</div><b>{d.operator_name}</b> · {itDateTime(d.picked_at)}</div>}
        {d.bank_amount != null && <div><div className="small muted">Accredito</div><b>{eur(d.bank_amount)}</b> · {itDate(d.bank_date)}</div>}
      </div>
      <table className="t"><thead><tr><th>Data</th><th>Sede</th><th>Busta sede</th><th className="num">Distinta</th><th className="num">Verificato</th></tr></thead>
        <tbody>{d.reports.map((r) => <tr key={r.id}><td><Link to={`/rendiconti/${r.id}`} onClick={onClose}>{itDate(r.report_date)}</Link></td><td>{r.site_name}</td><td className="mono small">{r.envelope_code || '–'}</td><td className="num">{eur(r.cash_to_deposit)}</td><td className="num">{eur(r.verified_amount)}</td></tr>)}</tbody></table>
      <div className="subhead">Tracciamento</div>
      <ul className="timeline">{d.events.map((e) => <li key={e.id}><div className="ev">{e.event}</div>{e.detail && <div className="small">{e.detail}</div>}<div className="small muted">{itDateTime(e.at)} · {e.full_name}</div></li>)}</ul>

      {modal === 'pickup' && <PickupModal onClose={() => setModal(null)} onConfirm={(b) => act(() => api.post(`/deposits/${d.id}/pickup`, b), 'Ritiro registrato').then(() => setModal(null))} />}
      {modal === 'bank' && <BankModal total={d.total_amount} onClose={() => setModal(null)} onConfirm={(b) => act(() => api.post(`/deposits/${d.id}/bank`, b), 'Accredito confermato').then(() => setModal(null))} />}
      {modal === 'undo' && <PromptModal title="Annulla ultimo passaggio" label="Motivazione" confirmText="Annulla passaggio" danger onClose={() => setModal(null)} onConfirm={(reason) => act(() => api.post(`/deposits/${d.id}/undo`, { reason }), 'Passaggio annullato')} />}
      {modal === 'delete' && <PromptModal title="Elimina versamento" label="I rendiconti tornano in cassaforte. Motivazione" confirmText="Elimina" danger onClose={() => setModal(null)} onConfirm={async (reason) => { await api.del(`/deposits/${d.id}`, { reason }); toast('Versamento eliminato'); onChanged(); onClose(); }} />}
    </Modal>
  );
}

function PickupModal({ onClose, onConfirm }) {
  const [name, setName] = useState('');
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [at, setAt] = useState(now);
  return (
    <Modal title="Ritiro da parte del portavalori" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={name.trim().length < 3} onClick={() => onConfirm({ operator_name: name, picked_at: new Date(at).toISOString() })}>Registra</button></>}>
      <div className="form-grid">
        <Field label="Operatore portavalori (nome e cognome)"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Data e ora"><input type="datetime-local" value={at} max={now} onChange={(e) => setAt(e.target.value)} /></Field>
      </div>
      <p className="small muted">Firmate entrambi la pagina Catena di custodia della distinta di versamento.</p>
    </Modal>
  );
}

function BankModal({ total, onClose, onConfirm }) {
  const [amount, setAmount] = useState(total);
  const [date, setDate] = useState(today());
  const diff = r2(Number(amount || 0) - Number(total));
  return (
    <Modal title="Conferma accredito in banca" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={amount === ''} onClick={() => onConfirm({ amount: Number(amount), date })}>Conferma</button></>}>
      <div className="form-grid">
        <Field label="Importo accreditato"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Data accredito"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {diff !== 0 && <div className="alert warn" style={{ marginTop: 12 }}>Differenza di {eur(diff)} rispetto al versato: si apre in automatico una segnalazione.</div>}
    </Modal>
  );
}
