import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Field, Loading, ErrorBox, Empty, Badge, Modal, useToast } from '../components/ui.jsx';
import { itDateTime, ROLE, ROLE_HELP } from '../format.js';
import { ImportButtons } from '../components/importxlsx.jsx';

const empty = { email: '', full_name: '', role: 'OPERATOR', company_id: '', auth_provider: 'BOTH', site_ids: [], active: true };
const PROVIDER = { LOCAL: 'Email e password', ENTRA: 'Solo Microsoft 365', BOTH: 'Microsoft 365 o password' };

export default function Users() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const { data, reload } = useApi('/users');
  const companies = useApi(sup ? '/companies' : null);
  const sites = useApi('/sites');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [cred, setCred] = useState(null);

  const save = async () => {
    setErr(null);
    const b = { ...edit, company_id: edit.role === 'SUPERADMIN' ? null : Number(edit.company_id || user.company_id), site_ids: ['OPERATOR', 'CASSIERE', 'PARTNER'].includes(edit.role) ? edit.site_ids : [] };
    delete b.id; delete b.company_name; delete b.totp_enabled; delete b.must_change_password; delete b.last_login_at; delete b.locked_until;
    try {
      const r = edit.id ? await api.put(`/users/${edit.id}`, b) : await api.post('/users', b);
      toast('Utente salvato'); setEdit(null); reload();
      if (r.temporaryPassword) setCred({ email: b.email, pwd: r.temporaryPassword });
    } catch (e) { setErr(e); }
  };
  const reset = async (u, what) => {
    if (!window.confirm(what === 'pwd' ? `Generare una nuova password temporanea per ${u.email}?` : `Disattivare la verifica in due passaggi di ${u.email}? Dovrà riconfigurarla al prossimo accesso.`)) return;
    try {
      const r = await api.post(`/users/${u.id}/${what === 'pwd' ? 'reset-password' : 'reset-totp'}`);
      if (r.temporaryPassword) setCred({ email: u.email, pwd: r.temporaryPassword }); else toast('2FA azzerata'); reload();
    } catch (e) { setErr(e); }
  };
  const compSites = (sites.data || []).filter((s) => !edit || s.company_id === Number(edit.company_id || user.company_id));

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Utenti</h1><div className="sub">Credenziali, ruolo e sedi su cui ciascuno può operare</div></div>
        <div className="row"><ImportButtons kind="users" onDone={reload} /><button className="btn" onClick={() => setEdit({ ...empty, company_id: user.company_id || companies.data?.[0]?.id || '' })}>+ Nuovo utente</button></div>
      </div>
      <ErrorBox error={err} />
      <div className="alert info" style={{ marginBottom: 14 }}>Super amministratore: crea aziende e vede tutto. Amministratore: gestisce sedi, utenti, fondi cassa, segnalazioni, operazioni logistiche, riconteggi e versamenti della sua azienda. Operatore: compila e consulta i rendiconti delle sedi assegnate. Partner: struttura ospitante, vede solo statistiche incassi e royalty di sede confermate delle sue sedi.</div>
      {!data ? <Loading /> : !data.length ? <div className="card"><Empty>Nessun utente</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="t">
          <thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th>{sup && <th>Azienda</th>}<th>Sedi</th><th>Accesso</th><th>Ultimo accesso</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.map((u) => (
            <tr key={u.id}>
              <td className="strong">{u.full_name}</td><td>{u.email}</td><td>{ROLE[u.role]}</td>
              {sup && <td>{u.company_name || <span className="muted">tutte</span>}</td>}
              <td>{['OPERATOR', 'CASSIERE', 'PARTNER'].includes(u.role) ? (u.site_ids || []).map((id) => <span key={id} className="chip">{sites.data?.find((s) => s.id === id)?.name || id}</span>) : <span className="muted small">tutte dell'azienda</span>}</td>
              <td className="small">{PROVIDER[u.auth_provider]}{u.auth_provider !== 'ENTRA' && <div>{u.totp_enabled ? <Badge tone="green">2FA attiva</Badge> : <Badge>2FA no</Badge>} {u.must_change_password && <Badge tone="mauve">password temporanea</Badge>}</div>}</td>
              <td className="small muted">{u.last_login_at ? itDateTime(u.last_login_at) : 'mai'}{u.locked_until && new Date(u.locked_until) > new Date() && <div className="red">bloccato</div>}</td>
              <td>{u.active ? <Badge tone="green">Attivo</Badge> : <Badge tone="red">Disattivo</Badge>}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm ghost" onClick={() => setEdit({ ...u, company_id: u.company_id || '', site_ids: u.site_ids || [] })}>Modifica</button>
                {u.auth_provider !== 'ENTRA' && <>{' '}<button className="btn sm ghost" onClick={() => reset(u, 'pwd')}>Reset pwd</button></>}
                {u.totp_enabled && <>{' '}<button className="btn sm ghost" onClick={() => reset(u, 'totp')}>Reset 2FA</button></>}
              </td>
            </tr>))}</tbody>
        </table></div></div>
      )}
      {edit && (
        <Modal title={edit.id ? `Modifica ${edit.full_name}` : 'Nuovo utente'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.email || !edit.full_name} onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="form-grid">
            <Field label="Nome e cognome"><input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="Email" help="Per l'accesso Microsoft deve coincidere con l'account Office 365"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Ruolo"><select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>{sup && <option value="SUPERADMIN">Super amministratore</option>}<option value="ADMIN">Amministratore di sede</option><option value="CASSIERE">Cassiere</option><option value="FINANCE">Finance Specialist</option><option value="OPERATOR">Operatore</option><option value="PARTNER">Partner (struttura ospitante)</option></select>{ROLE_HELP[edit.role] && <span className="help">{ROLE_HELP[edit.role]}</span>}</Field>
            {sup && edit.role !== 'SUPERADMIN' && <Field label="Azienda"><select value={edit.company_id} onChange={(e) => setEdit({ ...edit, company_id: e.target.value, site_ids: [] })}>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            <Field label="Metodo di accesso"><select value={edit.auth_provider} onChange={(e) => setEdit({ ...edit, auth_provider: e.target.value })}>{Object.entries(PROVIDER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </div>
          {['OPERATOR', 'CASSIERE', 'PARTNER'].includes(edit.role) && (
            <div style={{ marginTop: 12 }}>
              <div className="small strong muted" style={{ marginBottom: 6 }}>Sedi su cui può operare</div>
              {compSites.length ? <div className="row">{compSites.map((s) => <label key={s.id} className="f inline"><input type="checkbox" checked={edit.site_ids.includes(s.id)} onChange={(e) => setEdit({ ...edit, site_ids: e.target.checked ? [...edit.site_ids, s.id] : edit.site_ids.filter((x) => x !== s.id) })} />{s.name}</label>)}</div> : <div className="small red">Nessuna sede per questa azienda: creala prima.</div>}
            </div>
          )}
          {edit.id && <label className="f inline" style={{ marginTop: 12 }}><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Utente attivo</label>}
          {!edit.id && edit.auth_provider !== 'ENTRA' && <div className="small muted" style={{ marginTop: 12 }}>Alla creazione viene generata una password temporanea da consegnare all'utente, che dovrà cambiarla al primo accesso.</div>}
        </Modal>
      )}
      {cred && (
        <Modal title="Password temporanea" onClose={() => setCred(null)} footer={<button className="btn" onClick={() => setCred(null)}>Ho copiato la password</button>}>
          <p>Comunica queste credenziali a <b>{cred.email}</b> per un canale sicuro. La password non sarà più visibile.</p>
          <div className="mono" style={{ fontSize: 22, padding: 14, background: 'var(--silk)', borderRadius: 10, textAlign: 'center', userSelect: 'all' }}>{cred.pwd}</div>
        </Modal>
      )}
    </div>
  );
}
