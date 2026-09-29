import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, Loading, ErrorBox, useToast, Badge } from '../components/ui.jsx';

export default function Settings() {
  const toast = useToast();
  const { data } = useApi('/settings');
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const daily = useApi('/comms/daily');
  const [testTo, setTestTo] = useState('');
  const [testRes, setTestRes] = useState(null);
  useEffect(() => { if (data) setF({ creditor_name: '', creditor_iban: '', creditor_bic: '', creditor_id: '', royalty_invoice_prefix: 'RY', pickup_alert_days: '2', daily_alert_hour: '10', daily_alert_enabled: 'true', daily_summary_admins: 'true', ...data }); }, [data]);
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
        <Card title="Comunicazioni email">
          <div className="row" style={{ marginBottom: 12 }}>
            <span>Stato invio:</span>
            {daily.data?.mail?.configured ? <Badge tone="green">attivo · {daily.data.mail.mode === 'microsoft365' ? 'Microsoft 365' : 'SMTP'} · {daily.data.mail.from}</Badge> : <Badge tone="red">non configurato: le email vengono solo registrate</Badge>}
          </div>
          <div className="form-grid">
            {i('daily_alert_hour', 'Ora del controllo giornaliero (0-23)', 'Ogni giorno a quest\'ora il sistema verifica i rendiconti del giorno prima e sollecita le sedi mancanti', { type: 'number', min: 0, max: 23 })}
            <Field label="Controllo automatico"><select value={f.daily_alert_enabled} onChange={(e) => setF({ ...f, daily_alert_enabled: e.target.value })}><option value="true">Attivo</option><option value="false">Disattivo</option></select></Field>
            <Field label="Riepilogo agli amministratori"><select value={f.daily_summary_admins} onChange={(e) => setF({ ...f, daily_summary_admins: e.target.value })}><option value="true">Sì, ogni giorno</option><option value="false">No</option></select></Field>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <Field label="Invia una email di prova a"><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="tuo@indirizzo.it" /></Field>
            <button className="btn ghost" style={{ marginTop: 18 }} disabled={!testTo} onClick={async () => { setTestRes(null); try { setTestRes(await api.post('/comms/test', { to: testTo })); } catch (e) { setErr(e); } }}>Invia prova</button>
          </div>
          {testRes && <div className={`alert ${testRes.status === 'INVIATA' ? 'ok' : 'warn'}`} style={{ marginTop: 10 }}>{testRes.status === 'INVIATA' ? 'Email inviata.' : testRes.status === 'NON_CONFIGURATA' ? 'Invio non configurato: registrata nel registro invii.' : `Invio fallito: ${testRes.error}`}</div>}
          <p className="small muted" style={{ marginTop: 10 }}>Con Office 365 il mittente è la casella indicata in GRAPH_SENDER (amministrazione@toscanadiagnostica.it) tramite la stessa registrazione app del login, con permesso applicativo Mail.Send.</p>
        </Card>
        <Card title="Accesso Microsoft 365">
          <p className="small">L'accesso con account aziendale si attiva registrando l'app in Microsoft Entra ID e impostando sul server le variabili ENTRA_TENANT_ID, ENTRA_CLIENT_ID ed ENTRA_CLIENT_SECRET (redirect URI: <span className="mono">https://cash.toscanadiagnostica.it/api/auth/entra/callback</span>). Gli utenti vanno comunque censiti qui con la stessa email dell'account Office 365.</p>
        </Card>
      </div>
    </div>
  );
}
