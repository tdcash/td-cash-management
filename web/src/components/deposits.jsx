import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Field, Loading, ErrorBox, Badge, Modal, MoneyInput, PromptModal, Icon, useToast } from './ui.jsx';
import { ScanButton } from './scan.jsx';
import { eur, itDate, itDateTime, today, DEPOSIT_STATUS } from '../format.js';

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function CreateModal({ company, reports, onClose, onDone }) {
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

export function DepositDetail({ id, onClose, onChanged, canDelete = true }) {
  const toast = useToast();
  const { data: d, error, reload } = useApi(`/deposits/${id}`);
  const accounts = useApi(d ? `/companies/${d.company_id}/bank-accounts` : null);
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState(null);
  if (error) return <Modal title="Versamento" onClose={onClose}><ErrorBox error={error} /></Modal>;
  if (!d) return <Modal title="Versamento" onClose={onClose}><Loading /></Modal>;
  const act = async (fn, msg) => { setErr(null); try { await fn(); toast(msg); reload(); onChanged(); } catch (e) { setErr(e); } };
  return (
    <Modal wide title={`Versamento ${d.number}`} onClose={onClose} footer={<>
      <a className="btn ghost" href={`/api/deposits/${d.id}/pdf`} target="_blank" rel="noopener"><Icon name="print" size={16} />Distinta e catena di custodia</a>
      <div className="spacer" />
      {canDelete && <button className="btn danger" onClick={() => setModal('delete')}>Elimina versamento</button>}
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
        {d.bank_amount != null && <div><div className="small muted">Accredito</div><b>{eur(d.bank_amount)}</b> · {itDate(d.bank_date)}{d.bank_account_label && <div className="small">{d.bank_account_label} <span className="mono muted">{d.bank_account_iban}</span></div>}{d.bank_reference && <div className="small muted">rif. {d.bank_reference}</div>}</div>}
      </div>
      <table className="t"><thead><tr><th>Data</th><th>Sede</th><th>Busta sede</th><th className="num">Distinta</th><th className="num">Verificato</th></tr></thead>
        <tbody>{d.reports.map((r) => <tr key={r.id}><td><Link to={`/rendiconti/${r.id}`} onClick={onClose}>{itDate(r.report_date)}</Link></td><td>{r.site_name}</td><td className="mono small">{r.envelope_code || '–'}</td><td className="num">{eur(r.cash_to_deposit)}</td><td className="num">{eur(r.verified_amount)}</td></tr>)}</tbody></table>
      <div className="subhead">Tracciamento</div>
      <ul className="timeline">{d.events.map((e) => <li key={e.id}><div className="ev">{e.event}</div>{e.detail && <div className="small">{e.detail}</div>}<div className="small muted">{itDateTime(e.at)} · {e.full_name}</div></li>)}</ul>

      {modal === 'pickup' && <PickupModal onClose={() => setModal(null)} onConfirm={(b) => act(() => api.post(`/deposits/${d.id}/pickup`, b), 'Ritiro registrato').then(() => setModal(null))} />}
      {modal === 'bank' && <BankModal total={d.total_amount} accounts={(accounts.data || []).filter((a) => a.active)} onClose={() => setModal(null)} onConfirm={(b) => act(() => api.post(`/deposits/${d.id}/bank`, b), 'Accredito confermato').then(() => setModal(null))} />}
      {modal === 'undo' && <PromptModal title="Annulla ultimo passaggio" label="Motivazione" confirmText="Annulla passaggio" danger onClose={() => setModal(null)} onConfirm={(reason) => act(() => api.post(`/deposits/${d.id}/undo`, { reason }), 'Passaggio annullato')} />}
      {modal === 'delete' && <PromptModal title="Elimina versamento" label={`${d.status === 'ACCREDITATO' ? 'Versamento già accreditato in banca. ' : ''}I rendiconti tornano in cassaforte. Motivazione (resta nel registro attività)`} confirmText="Elimina" danger onClose={() => setModal(null)} onConfirm={async (reason) => { await api.del(`/deposits/${d.id}`, { reason }); toast('Versamento eliminato'); onChanged(); onClose(); }} />}
    </Modal>
  );
}

export function PickupModal({ onClose, onConfirm }) {
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

export function BankModal({ total, accounts = [], onClose, onConfirm }) {
  const [amount, setAmount] = useState(total);
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState(String(accounts.find((a) => a.is_default)?.id || accounts[0]?.id || ''));
  const [ref, setRef] = useState('');
  const diff = r2(Number(amount || 0) - Number(total));
  const needAccount = accounts.length > 0 && !account;
  return (
    <Modal title="Conferma accredito in banca" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={amount === '' || needAccount} onClick={() => onConfirm({ amount: Number(amount), date, bank_account_id: account ? Number(account) : null, reference: ref || null })}>Conferma</button></>}>
      <div className="form-grid">
        {accounts.length ? (
          <Field label="Conto corrente di accredito" className="span2"><select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Seleziona</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label} · {a.iban}{a.bank_name ? ` · ${a.bank_name}` : ''}</option>)}</select></Field>
        ) : <div className="alert warn span2">Nessun conto corrente censito in Azienda: l'accredito viene registrato senza conto. Inserisci i conti nell'anagrafica Azienda per tracciarli.</div>}
        <Field label="Importo accreditato"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Data accredito"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Riferimento contabile (facoltativo)" className="span2"><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Numero movimento o causale in estratto conto" maxLength={120} /></Field>
      </div>
      {diff !== 0 && <div className="alert warn" style={{ marginTop: 12 }}>Differenza di {eur(diff)} rispetto al versato: si apre in automatico una segnalazione.</div>}
    </Modal>
  );
}
