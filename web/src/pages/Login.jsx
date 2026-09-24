import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, ErrorBox } from '../components/ui.jsx';

export default function Login() {
  const { refresh } = useAuth();
  const [cfg, setCfg] = useState({ entraEnabled: false });
  const [step, setStep] = useState('pwd');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState(() => {
    const e = new URLSearchParams(window.location.search).get('error');
    return e ? new Error(e) : null;
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/auth/config').then(setCfg).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (step === 'pwd') {
        const r = await api.post('/auth/login', { email, password });
        if (r.totpRequired) { setStep('totp'); setBusy(false); return; }
      } else {
        await api.post('/auth/totp', { code });
      }
      window.history.replaceState(null, '', '/');
      await refresh();
    } catch (e2) { setErr(e2); }
    setBusy(false);
  };

  return (
    <div className="login">
      <div className="art">
        <img src="/logo-light.svg" alt="Toscana Diagnostica" />
        <div className="claim">Ogni incasso, ogni sede, <span>sotto controllo</span> ogni giorno.</div>
        <div className="foot">Cash Management della rete Toscana Diagnostica · accesso riservato al personale autorizzato</div>
      </div>
      <div className="pane">
        <form onSubmit={submit}>
          <div>
            <h1>{step === 'pwd' ? 'Accedi' : 'Verifica in due passaggi'}</h1>
            <div className="muted" style={{ marginTop: 4 }}>
              {step === 'pwd' ? 'Personale interno con account Microsoft 365, collaboratori esterni con email e password.' : "Inserisci il codice a 6 cifre dell'app di autenticazione."}
            </div>
          </div>
          <ErrorBox error={err} />
          {step === 'pwd' && cfg.entraEnabled && <>
            <a className="btn ms lg" href="/api/auth/entra/login">
              <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" /></svg>
              Accedi con Microsoft 365
            </a>
            <div className="or">oppure con email e password</div>
          </>}
          {step === 'pwd' ? <>
            <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
            <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          </> : (
            <Field label="Codice"><input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus required style={{ fontSize: 22, letterSpacing: '.3em', textAlign: 'center' }} /></Field>
          )}
          <button className="btn lg" disabled={busy}>{busy ? 'Verifica…' : step === 'pwd' ? 'Accedi' : 'Conferma'}</button>
          {step === 'totp' && <button type="button" className="btn link" onClick={() => { setStep('pwd'); setCode(''); }}>Torna al login</button>}
        </form>
      </div>
    </div>
  );
}
