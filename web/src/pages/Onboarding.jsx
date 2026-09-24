import React from 'react';
import { useAuth } from '../auth.jsx';
import { PasswordForm, TotpSetup } from './Profile.jsx';

export default function Onboarding() {
  const { onboarding, refresh, logout, user } = useAuth();
  return (
    <div className="login">
      <div className="art">
        <img src="/logo-light.svg" alt="Toscana Diagnostica" />
        <div className="claim">Primo accesso: <span>mettiamo in sicurezza</span> il tuo account.</div>
        <div className="foot">{user.email}</div>
      </div>
      <div className="pane">
        <div style={{ width: 'min(400px, 100%)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {onboarding === 'PASSWORD_CHANGE_REQUIRED' ? <>
            <h1>Imposta la tua password</h1>
            <div className="muted">La password temporanea va sostituita. Minimo 12 caratteri, con maiuscole, minuscole e numeri.</div>
            <PasswordForm onDone={refresh} />
          </> : <>
            <h1>Attiva la verifica in due passaggi</h1>
            <div className="muted">Obbligatoria per gli amministratori che accedono con password. Usa Microsoft Authenticator o un'app equivalente.</div>
            <TotpSetup onDone={refresh} />
          </>}
          <button className="btn link" onClick={logout}>Esci</button>
        </div>
      </div>
    </div>
  );
}
