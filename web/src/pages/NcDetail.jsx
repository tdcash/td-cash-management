import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, can } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Card, Badge, Field, PromptModal, useToast } from '../components/ui.jsx';
import { itDate, itDateTime, NC_STATUS, SEVERITY, ROLE } from '../format.js';

const KIND = { RISPOSTA: 'Risposta della sede', NOTA: 'Nota', CHIUSURA: 'Chiusura', RIAPERTURA: 'Riapertura' };

export default function NcDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { data: n, error, reload } = useApi(`/nc/${id}`);
  const [body, setBody] = useState('');
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!n) return <div className="page"><Loading /></div>;
  const admin = can(user, 'SUPERADMIN', 'ADMIN');
  const mine = n.created_by === user.id || user.role === 'SUPERADMIN';
  const send = async () => {
    setErr(null);
    try { await api.post(`/nc/${id}/messages`, { body }); setBody(''); toast(mine ? 'Nota aggiunta' : 'Risposta registrata'); reload(); } catch (e) { setErr(e); }
  };
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/nc">Errori e NC</Link> / #{n.id}</div>
          <h1>{n.title}</h1>
          <div className="sub row" style={{ gap: 8 }}>
            <Badge tone={NC_STATUS[n.status].tone}>{NC_STATUS[n.status].label}</Badge>
            <Badge tone={SEVERITY[n.severity]}>Gravità {n.severity.toLowerCase()}</Badge>
            <span>{n.kind === 'ERRORE' ? 'Errore' : 'Non conformità'} · {n.site_name || n.company_name}</span>
            {n.report_id && <Link to={`/rendiconti/${n.report_id}`}>Rendiconto del {itDate(n.report_date)}</Link>}
          </div>
        </div>
        {admin && (n.status !== 'CHIUSA'
          ? <button className="btn" onClick={() => setModal('close')}>Chiudi segnalazione</button>
          : <button className="btn ghost" onClick={() => setModal('reopen')}>Riapri</button>)}
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px', alignItems: 'start' }}>
        <div className="grid">
          <div className="thread">
            <div className="msg">
              <div className="who"><b>{n.created_by_name}</b> · {itDateTime(n.created_at)} · segnalazione</div>
              <div className="body">{n.description}</div>
            </div>
            {n.messages.map((m) => (
              <div key={m.id} className={`msg ${m.kind}`}>
                <div className="who"><b>{m.full_name}</b> <span className="muted">({ROLE[m.role]})</span> · {itDateTime(m.created_at)} · {KIND[m.kind]}</div>
                <div className="body">{m.body}</div>
              </div>
            ))}
          </div>
          {n.status !== 'CHIUSA' && (
            <Card title={mine ? 'Aggiungi una nota' : 'Rispondi alla segnalazione'}>
              <ErrorBox error={err} />
              <Field label={mine ? 'Nota' : 'Risposta: cosa è successo e cosa è stato fatto'}>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={mine ? 'Indicazioni per la sede' : 'Spiegazione e azione correttiva'} />
              </Field>
              <div className="row end" style={{ marginTop: 10 }}><button className="btn" disabled={body.trim().length < 2} onClick={send}>Invia</button></div>
            </Card>
          )}
        </div>
        <Card title="Dettagli">
          <div className="small" style={{ display: 'grid', gap: 8 }}>
            <div><div className="muted">Azienda</div><b>{n.company_name}</b></div>
            <div><div className="muted">Sede</div><b>{n.site_name || '–'}</b></div>
            <div><div className="muted">Aperta da</div><b>{n.created_by_name}</b> · {itDateTime(n.created_at)}</div>
            <div><div className="muted">Risposta entro</div><b>{n.due_date ? itDate(n.due_date) : 'non indicata'}</b></div>
            {n.closed_at && <div><div className="muted">Chiusa da</div><b>{n.closed_by_name}</b> · {itDateTime(n.closed_at)}</div>}
          </div>
        </Card>
      </div>
      {modal === 'close' && <PromptModal title="Chiudi segnalazione" label="Esito e motivazione della chiusura" confirmText="Chiudi" onClose={() => setModal(null)}
        onConfirm={async (b) => { await api.post(`/nc/${id}/close`, { body: b }); toast('Segnalazione chiusa'); reload(); }} />}
      {modal === 'reopen' && <PromptModal title="Riapri segnalazione" label="Motivo della riapertura" confirmText="Riapri" danger onClose={() => setModal(null)}
        onConfirm={async (b) => { await api.post(`/nc/${id}/reopen`, { body: b }); toast('Segnalazione riaperta'); reload(); }} />}
    </div>
  );
}
