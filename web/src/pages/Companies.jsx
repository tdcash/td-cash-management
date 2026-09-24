import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, Modal, useToast } from '../components/ui.jsx';
import { itDate } from '../format.js';

const empty = { code: '', name: '', vat_number: '', tax_code: '', address: '', zip: '', city: '', province: '', phone: '', email: '', pec: '', website: '', letterhead_footer: '', iban: '', bic: '', sepa_mandate_id: '', sepa_mandate_date: '', active: true };

export default function Companies() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const { data, reload } = useApi('/companies');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [logo, setLogo] = useState(null);

  const save = async () => {
    setErr(null);
    const b = Object.fromEntries(Object.entries(edit).filter(([k]) => k in empty));
    if (!sup) for (const k of ['iban', 'bic', 'sepa_mandate_id', 'sepa_mandate_date', 'active']) delete b[k];
    for (const k of Object.keys(b)) if (b[k] === '') b[k] = null;
    b.name = edit.name;
    try {
      let id = edit.id;
      if (id) { delete b.code; await api.put(`/companies/${id}`, b); } else { b.code = edit.code.toUpperCase(); id = (await api.post('/companies', b)).id; }
      if (logo) { const fd = new FormData(); fd.append('logo', logo); await api.upload(`/companies/${id}/logo`, fd); }
      toast('Azienda salvata'); setEdit(null); setLogo(null); reload();
    } catch (e) { setErr(e); }
  };
  const f = (k, label, extra = {}) => <Field label={label}><input value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} {...extra} /></Field>;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{sup ? 'Aziende della rete' : 'La tua azienda'}</h1><div className="sub">Anagrafica, carta intestata della distinta e dati per l'addebito SEPA</div></div>
        {sup && <button className="btn" onClick={() => setEdit({ ...empty })}>+ Nuova azienda</button>}
      </div>
      {!data ? <Loading /> : !data.length ? <div className="card"><Empty>Nessuna azienda</Empty></div> : (
        <div className="grid g2">
          {data.map((c) => (
            <Card key={c.id} title={<span>{c.name} <span className="mono muted small">{c.code}</span></span>} actions={<>{c.is_franchisor && <Badge tone="teal">Capofila</Badge>}{!c.active && <Badge tone="red">Disattiva</Badge>}<button className="btn sm ghost" onClick={() => setEdit({ ...empty, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])) })}>Modifica</button></>}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ width: 150, height: 56, display: 'grid', placeItems: 'center', background: '#fafcfc', border: '1px solid var(--line)', borderRadius: 8 }}>
                  {c.has_logo ? <img src={`/api/companies/${c.id}/logo?v=${c.id}`} alt="" style={{ maxWidth: 140, maxHeight: 48 }} /> : <span className="small muted">nessun logo</span>}
                </div>
                <div className="small" style={{ flex: 1 }}>
                  <div>{[c.address, c.zip, c.city, c.province && `(${c.province})`].filter(Boolean).join(' ')}</div>
                  <div>P.IVA {c.vat_number || '–'} · {c.email || ''}</div>
                  <div className="muted">{c.sites_count} sedi · {c.users_count} utenti</div>
                  {sup && !c.is_franchisor && <div style={{ marginTop: 4 }}>{c.iban && c.sepa_mandate_id ? <Badge tone="green">Mandato SEPA {c.sepa_mandate_id}</Badge> : <Badge tone="red">Mandato SEPA mancante</Badge>}</div>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && (
        <Modal wide title={edit.id ? `Modifica ${edit.name}` : 'Nuova azienda'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.name || (!edit.id && !edit.code)} onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <h3 style={{ marginBottom: 8 }}>Anagrafica</h3>
          <div className="form-grid">
            {!edit.id && f('code', 'Codice (2-12 car., es. BIOSC)', { style: { textTransform: 'uppercase' }, maxLength: 12 })}
            {f('name', 'Ragione sociale')}{f('vat_number', 'Partita IVA')}{f('tax_code', 'Codice fiscale')}
            {f('address', 'Indirizzo')}{f('zip', 'CAP')}{f('city', 'Città')}{f('province', 'Provincia', { maxLength: 4 })}
            {f('phone', 'Telefono')}{f('email', 'Email')}{f('pec', 'PEC')}{f('website', 'Sito web')}
          </div>
          <h3 style={{ margin: '16px 0 8px' }}>Carta intestata della distinta</h3>
          <div className="form-grid">
            <Field label="Logo (PNG o JPEG, sfondo trasparente)"><input type="file" accept="image/png,image/jpeg" onChange={(e) => setLogo(e.target.files[0] || null)} /></Field>
            <Field label="Riga legale a piè di pagina" className="span2"><textarea value={edit.letterhead_footer ?? ''} onChange={(e) => setEdit({ ...edit, letterhead_footer: e.target.value })} placeholder="Indirizzo, telefono, P.IVA, REA, capitale sociale" style={{ minHeight: 60 }} /></Field>
          </div>
          {sup && <>
            <h3 style={{ margin: '16px 0 8px' }}>Addebito SEPA (debitore)</h3>
            <div className="form-grid">
              {f('iban', 'IBAN', { className: 'mono' })}{f('bic', 'BIC (facoltativo)')}{f('sepa_mandate_id', 'Identificativo mandato SDD')}
              <Field label="Data firma mandato"><input type="date" value={edit.sepa_mandate_date ? String(edit.sepa_mandate_date).slice(0, 10) : ''} onChange={(e) => setEdit({ ...edit, sepa_mandate_date: e.target.value })} /></Field>
              {edit.id && <Field label="Stato" className="inline" style={{ marginTop: 22 }}><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Azienda attiva</Field>}
            </div>
            {edit.sepa_first_done && <div className="small muted" style={{ marginTop: 6 }}>Primo addebito già eseguito: i prossimi saranno RCUR.</div>}
          </>}
          {edit.created_at && <div className="small muted" style={{ marginTop: 12 }}>Creata il {itDate(String(edit.created_at))}</div>}
        </Modal>
      )}
    </div>
  );
}
