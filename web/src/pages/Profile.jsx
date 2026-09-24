import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, ErrorBox, Card, useToast } from '../components/ui.jsx';
import { ROLE } from '../format.js';

export function PasswordForm({ onDone }) {
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (f.newPassword !== f.confirm) return setErr(new Error('Le due password non coincidono'));
    setBusy(true);
    try { await api.post('/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword }); onDone?.(); }
    catch (e2) { setErr(e2); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ErrorBox error={err} />
      <Field label="Password attuale"><input type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} required /></Field>
      <Field label="Nuova password" help="Minimo 12 caratteri, almeno una maiuscola, una minuscola e un numero"><input type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} required /></Field>
      <Field label="Ripeti la nuova password"><input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required /></Field>
      <button className="btn" disabled={busy}>Salva password</button>
    </form>
  );
}

export function TotpSetup({ onDone }) {
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const start = async () => { setErr(null); try { setSetup(await api.post('/auth/totp/setup')); } catch (e) { setErr(e); } };
  const enable = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api.post('/auth/totp/enable', { code }); onDone?.(); } catch (e2) { setErr(e2); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ErrorBox error={err} />
      {!setup ? <button className="btn" onClick={start}>Genera codice QR</button> : (
        <form onSubmit={enable} style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <img src={setup.qr} alt="QR code" width={200} height={200} style={{ border: '1px solid var(--line)', borderRadius: 10 }} />
          <div className="small muted">Chiave manuale: <span className="mono">{setup.secret}</span></div>
          <Field label="Codice a 6 cifre generato dall'app" className="" >
            <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus style={{ fontSize: 20, letterSpacing: '.3em', textAlign: 'center', width: 200 }} />
          </Field>
          <button className="btn">Attiva</button>
        </form>
      )}
    </div>
  );
}

export default function Profile() {
  const { user, authMethod, refresh } = useAuth();
  const toast = useToast();
  const local = user.auth_provider !== 'ENTRA';
  return (
    <div className="page">
      <div className="page-head"><div><h1>Profilo</h1><div className="sub">{user.full_name} · {user.email} · {ROLE[user.role]}</div></div></div>
      <div className="grid g2">
        <Card title="Accesso">
          <p>Metodo di questa sessione: <b>{authMethod === 'ENTRA' ? 'Microsoft 365' : 'Email e password'}</b></p>
          <p>Verifica in due passaggi: <b>{user.totp_enabled ? 'attiva' : 'non attiva'}</b></p>
          {authMethod === 'ENTRA' && <p className="muted small">Con l'accesso Microsoft la sicurezza (password, MFA) è gestita dal tenant Office 365 aziendale.</p>}
        </Card>
        {local && <Card title="Cambia password"><PasswordForm onDone={() => toast('Password aggiornata')} /></Card>}
        {local && !user.totp_enabled && <Card title="Attiva verifica in due passaggi"><TotpSetup onDone={() => { toast('Verifica in due passaggi attivata'); refresh(); }} /></Card>}
      </div>
    </div>
  );
}
