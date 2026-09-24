import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, Loading, ErrorBox, useToast } from '../components/ui.jsx';

export default function Settings() {
  const toast = useToast();
  const { data } = useApi('/settings');
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (data) setF({ creditor_name: '', creditor_iban: '', creditor_bic: '', creditor_id: '', royalty_invoice_prefix: 'RY', pickup_alert_days: '2', ...data }); }, [data]);
  if (!f) return <div className="page"><Loading /></div>;
  const save = async () => { setErr(null); try { await api.put('/settings', f); toast('Impostazioni salvate'); } catch (e) { setErr(e); } };
  const i = (k, label, help, extra = {}) => <Field label={label} help={help}><input value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></Field>;
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head"><div><h1>Impostazioni</h1><div className="sub">Dati del creditore SEPA e parametri di controllo</div></div><button className="btn" onClick={save}>Salva</button></div>
      <ErrorBox error={err} />
      <div className="grid">
        <Card title="Creditore SEPA (Toscana Diagnostica)">
          <div className="form-grid">
            {i('creditor_name', 'Ragione sociale')}
            {i('creditor_iban', 'IBAN di accredito', null, { className: 'mono' })}
            {i('creditor_bic', 'BIC (facoltativo)')}
            {i('creditor_id', 'Creditor Identifier (CI)', 'Rilasciato dalla banca per gli addebiti SDD, formato ITnnZZZ + codice', { className: 'mono' })}
          </div>
        </Card>
        <Card title="Parametri">
          <div className="form-grid">
            {i('royalty_invoice_prefix', 'Prefisso numerazione estratti royalty', 'es. RY → RY2026-0001', { maxLength: 10 })}
            {i('pickup_alert_days', 'Giorni oltre i quali un flusso è in ritardo', 'Rendiconti non versati da più di N giorni compaiono nel cruscotto', { type: 'number', min: 0, max: 60 })}
          </div>
        </Card>
        <Card title="Accesso Microsoft 365">
          <p className="small">L'accesso con account aziendale si attiva registrando l'app in Microsoft Entra ID e impostando sul server le variabili ENTRA_TENANT_ID, ENTRA_CLIENT_ID ed ENTRA_CLIENT_SECRET (redirect URI: <span className="mono">https://cash.toscanadiagnostica.it/api/auth/entra/callback</span>). Gli utenti vanno comunque censiti qui con la stessa email dell'account Office 365.</p>
        </Card>
      </div>
    </div>
  );
}
