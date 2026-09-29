import React, { useState } from 'react';
import { api } from '../api.js';
import { Modal, ErrorBox, Badge, Icon } from './ui.jsx';

// Import da modello Excel: scarica modello, carica file, anteprima riga per riga, conferma
export function ImportButtons({ kind, onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a className="btn ghost" href={`/api/anagrafica/template/${kind}.xlsx`}><Icon name="download" size={16} />Modello Excel</a>
      <button className="btn ghost" onClick={() => setOpen(true)}><Icon name="upload" size={16} />Importa da Excel</button>
      {open && <ImportModal kind={kind} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone?.(); }} />}
    </>
  );
}

function ImportModal({ kind, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const label = kind === 'sites' ? 'sedi' : 'utenti';
  const send = async (dry) => {
    setErr(null); setBusy(true);
    try { const fd = new FormData(); fd.append('file', file); setRes(await api.upload(`/anagrafica/${kind}${dry ? '?dry=1' : ''}`, fd)); } catch (e) { setErr(e); }
    setBusy(false);
  };
  const errors = res?.rows.filter((r) => r.errors.length).length || 0;
  return (
    <Modal wide title={`Importa ${label} da Excel`} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={res && !res.dry ? onDone : onClose}>{res && !res.dry ? 'Chiudi' : 'Annulla'}</button>
      {!res && <button className="btn" disabled={!file || busy} onClick={() => send(true)}>Controlla il file</button>}
      {res?.dry && <button className="btn" disabled={!res.ok || busy} onClick={() => send(false)}>Importa {res.rows.length} {label}</button>}
    </>}>
      <ErrorBox error={err} />
      {!res && <>
        <p className="small muted">Scarica il modello, compila una riga per {kind === 'sites' ? 'sede' : 'utente'} senza modificare le intestazioni e ricarica il file. Le righe con codice {kind === 'sites' ? 'sede' : 'email'} già presente aggiornano l'anagrafica esistente. Prima dell'importazione vedi un'anteprima con gli eventuali errori: nulla viene scritto finché non confermi.</p>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files[0] || null)} />
      </>}
      {res && <>
        <div className={`alert ${res.dry ? (res.ok ? 'info' : 'err') : 'ok'}`} style={{ marginBottom: 10 }}>
          {res.dry ? (res.ok ? `File corretto: ${res.rows.filter((r) => r.action === 'CREA').length} da creare, ${res.rows.filter((r) => r.action === 'AGGIORNA').length} da aggiornare. Conferma per importare.` : `${errors} righe con errori: correggi il file e ricaricalo. Nessuna riga è stata importata.`) : `Importazione completata: ${res.rows.length} ${label}.`}
        </div>
        <div className="table-wrap" style={{ maxHeight: 380 }}><table className="t">
          <thead><tr><th>Riga</th><th>{kind === 'sites' ? 'Codice' : 'Email'}</th><th>{kind === 'sites' ? 'Sede' : 'Nome'}</th>{kind === 'users' && <th>Ruolo</th>}<th>Azione</th><th>Esito</th></tr></thead>
          <tbody>{res.rows.map((r) => (
            <tr key={r.row} style={{ background: r.errors.length ? 'var(--red-100)' : undefined }}>
              <td className="muted">{r.row}</td><td className="mono">{kind === 'sites' ? r.code : r.email}</td><td>{kind === 'sites' ? r.name : r.full_name}</td>{kind === 'users' && <td>{r.role}</td>}
              <td><Badge tone={r.action === 'CREA' ? 'green' : 'blue'}>{r.action === 'CREA' ? 'Crea' : 'Aggiorna'}</Badge></td>
              <td className="small">{r.errors.length ? <span className="red">{r.errors.join('; ')}</span> : <span className="muted">ok</span>}</td>
            </tr>))}</tbody>
        </table></div>
        {res.credentials?.length > 0 && <div style={{ marginTop: 12 }}>
          <div className="subhead">Password temporanee (visibili solo ora: comunicale agli utenti)</div>
          <table className="t"><tbody>{res.credentials.map((c) => <tr key={c.email}><td>{c.email}</td><td className="mono strong">{c.temporaryPassword}</td></tr>)}</tbody></table>
        </div>}
        {res.dry && !res.ok && <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => { setRes(null); setFile(null); }}>Carica un altro file</button>}
      </>}
    </Modal>
  );
}
