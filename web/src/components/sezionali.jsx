import React, { useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, Loading, ErrorBox, Badge, useToast } from './ui.jsx';

// Tabella di trascodifica sezionali GIPO -> sede (Impostazioni, super amministratore)
export function Sezionali() {
  const toast = useToast();
  const { data, reload } = useApi('/controllo-mensile/sezionali');
  const sites = useApi('/sites');
  const [err, setErr] = useState(null);
  const [nuovo, setNuovo] = useState({ code: '', description: '' });
  const save = async (code, patch) => { setErr(null); try { await api.put(`/controllo-mensile/sezionali/${code}`, patch); toast('Sezionale salvato'); reload(); } catch (e) { setErr(e); } };
  return (
    <Card title="Sezionali GIPO" actions={<span className="small muted">numero dopo la barra nel numero del movimento, es. 1/02 → sezionale 02</span>}>
      <ErrorBox error={err} />
      <p className="small muted">Associa ogni sezionale alla sede di Cash Management. Precaricato dall'export sezionali di GIPO; modificabile quando cambiano le sedi. Le righe senza sede (es. Service di laboratorio, Medicina del lavoro) vengono segnalate nel controllo ma non confrontate.</p>
      {!data || !sites.data ? <Loading /> : (
        <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t">
          <thead><tr><th>Sez.</th><th>Descrizione GIPO</th><th>Sede in Cash Management</th><th>Id sede GIPO</th><th>Attivo</th></tr></thead>
          <tbody>{data.map((s) => (
            <tr key={s.code} style={{ opacity: s.active ? 1 : .5 }}>
              <td className="mono strong">/{s.code}</td>
              <td className="small">{s.description || <span className="muted">–</span>}</td>
              <td><select value={s.site_id || ''} onChange={(e) => save(s.code, { site_id: e.target.value ? Number(e.target.value) : null })} style={{ minHeight: 32 }}><option value="">(nessuna sede)</option>{sites.data.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}</select></td>
              <td className="mono small muted">{s.gipo_site_id || ''}</td>
              <td><input type="checkbox" checked={!!s.active} onChange={(e) => save(s.code, { active: e.target.checked })} /></td>
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
        <Field label="Nuovo sezionale"><input value={nuovo.code} maxLength={3} placeholder="es. 22" onChange={(e) => setNuovo({ ...nuovo, code: e.target.value.replace(/\D/g, '') })} style={{ width: 90 }} /></Field>
        <Field label="Descrizione"><input value={nuovo.description} onChange={(e) => setNuovo({ ...nuovo, description: e.target.value })} /></Field>
        <button className="btn sm ghost" disabled={!nuovo.code} onClick={async () => { await save(nuovo.code.padStart(2, '0'), { description: nuovo.description || null, active: true }); setNuovo({ code: '', description: '' }); }}>Aggiungi</button>
      </div>
    </Card>
  );
}
