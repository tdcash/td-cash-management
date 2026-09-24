import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, Modal, MoneyInput, useToast } from '../components/ui.jsx';
import { eur, itDateTime } from '../format.js';

const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const empty = { company_id: '', code: '', name: '', address: '', city: '', province: '', cash_float: 0, operating_days: '1111110', pos_terminals: '', active: true, float_reason: '', host_name: '', host_vat: '', royalty_fixed_monthly: 0, royalty_pct: 0, royalty_base: 'TOTALE', royalty_vat_rate: 0, royalty_notes: '' };
const BASES = { TOTALE: 'Totale incassi (contanti, POS, bonifici)', CONTANTI_POS: 'Contanti e POS', CONTANTI: 'Solo contanti' };

export default function Sites() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const toast = useToast();
  const { data, reload } = useApi('/sites');
  const companies = useApi(sup ? '/companies' : null);
  const [edit, setEdit] = useState(null);
  const [hist, setHist] = useState(null);
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    const b = { ...edit, company_id: Number(edit.company_id || user.company_id), cash_float: Number(edit.cash_float), address: edit.address || null, city: edit.city || null, province: edit.province || null, pos_terminals: edit.pos_terminals || null,
      host_name: edit.host_name || null, host_vat: edit.host_vat || null, royalty_fixed_monthly: Number(edit.royalty_fixed_monthly) || 0, royalty_pct: Number(edit.royalty_pct) || 0, royalty_vat_rate: Number(edit.royalty_vat_rate) || 0, royalty_notes: edit.royalty_notes || null };
    delete b.company_name; delete b.company_code; delete b.users_count; delete b.created_at; delete b.updated_at;
    try {
      if (edit.id) { const { id, code, company_id, ...rest } = b; if (!rest.float_reason) delete rest.float_reason; await api.put(`/sites/${id}`, rest); }
      else { delete b.float_reason; b.code = b.code.toUpperCase(); await api.post('/sites', b); }
      toast('Sede salvata'); setEdit(null); reload();
    } catch (e) { setErr(e); }
  };
  const orig = edit?.id ? data.find((s) => s.id === edit.id) : null;
  const floatChanged = orig && Number(orig.cash_float) !== Number(edit.cash_float);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Sedi e fondo cassa</h1><div className="sub">Ogni sede ha il suo fondo cassa, i giorni operativi e gli utenti abilitati</div></div>
        <button className="btn" onClick={() => setEdit({ ...empty, company_id: user.company_id || companies.data?.[0]?.id || '' })}>+ Nuova sede</button>
      </div>
      {!data ? <Loading /> : !data.length ? <div className="card"><Empty>Nessuna sede</Empty></div> : (
        <div className="card"><div className="table-wrap"><table className="t">
          <thead><tr><th>Codice</th><th>Sede</th>{sup && <th>Azienda</th>}<th>Giorni operativi</th><th>Struttura ospitante</th><th>Canone</th><th className="num">Fondo cassa</th><th className="num">Utenti</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.code}</td><td><b>{s.name}</b><div className="small muted">{[s.address, s.city, s.province && `(${s.province})`].filter(Boolean).join(' ')}</div></td>
              {sup && <td>{s.company_name}</td>}
              <td>{DAYS.map((d, i) => <span key={d} className="chip" style={{ opacity: s.operating_days[i] === '1' ? 1 : .3 }}>{d}</span>)}</td>
              <td>{s.host_name || <span className="muted">–</span>}</td>
              <td className="small">{Number(s.royalty_fixed_monthly) > 0 && <div>{eur(s.royalty_fixed_monthly)}/mese</div>}{Number(s.royalty_pct) > 0 && <div>{s.royalty_pct}% {s.royalty_base === 'TOTALE' ? 'sul totale' : s.royalty_base === 'CONTANTI_POS' ? 'su contanti e POS' : 'sui contanti'}</div>}{Number(s.royalty_fixed_monthly) > 0 || Number(s.royalty_pct) > 0 ? <div className="muted">IVA {s.royalty_vat_rate}%</div> : <span className="muted">nessuno</span>}</td>
              <td className="num strong">{eur(s.cash_float)} <button className="btn link small" onClick={() => setHist(s)}>storico</button></td>
              <td className="num">{s.users_count}</td>
              <td>{s.active ? <Badge tone="green">Attiva</Badge> : <Badge tone="red">Disattiva</Badge>}</td>
              <td className="num"><button className="btn sm ghost" onClick={() => setEdit({ ...s, pos_terminals: s.pos_terminals || '', address: s.address || '', city: s.city || '', province: s.province || '', float_reason: '', host_name: s.host_name || '', host_vat: s.host_vat || '', royalty_notes: s.royalty_notes || '' })}>Modifica</button></td>
            </tr>))}</tbody>
        </table></div></div>
      )}
      {edit && (
        <Modal title={edit.id ? `Modifica ${edit.name}` : 'Nuova sede'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" disabled={!edit.name || (!edit.id && !edit.code) || (floatChanged && !edit.float_reason)} onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="form-grid">
            {sup && !edit.id && <Field label="Azienda"><select value={edit.company_id} onChange={(e) => setEdit({ ...edit, company_id: e.target.value })}>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            {!edit.id && <Field label="Codice sede (es. SF01)"><input value={edit.code} maxLength={12} style={{ textTransform: 'uppercase' }} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>}
            <Field label="Nome sede"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Indirizzo"><input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="Città"><input value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></Field>
            <Field label="Provincia (sigla)"><input value={edit.province} maxLength={4} style={{ textTransform: 'uppercase' }} onChange={(e) => setEdit({ ...edit, province: e.target.value })} /></Field>
            <Field label="Fondo cassa" help="Somma che resta in sede e viene sottratta dal contante versato"><MoneyInput value={edit.cash_float} onChange={(v) => setEdit({ ...edit, cash_float: v === '' ? 0 : v })} /></Field>
            <Field label="Terminali POS (TID separati da virgola)" help="Servono per riconoscere la sede negli estratti dell'acquirer"><input value={edit.pos_terminals} onChange={(e) => setEdit({ ...edit, pos_terminals: e.target.value })} /></Field>
          </div>
          {floatChanged && <div style={{ marginTop: 12 }}><Field label={`Motivo variazione fondo cassa (${eur(orig.cash_float)} → ${eur(edit.cash_float)})`}><input value={edit.float_reason} onChange={(e) => setEdit({ ...edit, float_reason: e.target.value })} autoFocus /></Field></div>}
          <div style={{ marginTop: 12 }}>
            <div className="small strong muted" style={{ marginBottom: 6 }}>Giorni operativi (attesi in rendicontazione)</div>
            <div className="row">{DAYS.map((d, i) => <label key={d} className="f inline"><input type="checkbox" checked={edit.operating_days[i] === '1'} onChange={(e) => { const a = edit.operating_days.split(''); a[i] = e.target.checked ? '1' : '0'; setEdit({ ...edit, operating_days: a.join('') }); }} />{d}</label>)}</div>
          </div>
          <h3 style={{ margin: '18px 0 8px' }}>Royalty alla struttura ospitante</h3>
          <div className="form-grid">
            <Field label="Struttura ospitante"><input value={edit.host_name} onChange={(e) => setEdit({ ...edit, host_name: e.target.value })} placeholder="es. Farmacia Comunale n. 3" /></Field>
            <Field label="P.IVA struttura"><input value={edit.host_vat} onChange={(e) => setEdit({ ...edit, host_vat: e.target.value })} /></Field>
            <Field label="Quota fissa mensile" help="0 se non prevista"><MoneyInput value={edit.royalty_fixed_monthly} onChange={(v) => setEdit({ ...edit, royalty_fixed_monthly: v === '' ? 0 : v })} /></Field>
            <Field label="Percentuale sui ricavi %" help="0 se non prevista"><input type="number" step="0.01" min="0" max="100" value={edit.royalty_pct} onChange={(e) => setEdit({ ...edit, royalty_pct: e.target.value })} /></Field>
            <Field label="Base della percentuale"><select value={edit.royalty_base} onChange={(e) => setEdit({ ...edit, royalty_base: e.target.value })}>{Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="IVA %" help="0 se il canone non è soggetto a IVA"><input type="number" step="0.01" min="0" max="100" value={edit.royalty_vat_rate} onChange={(e) => setEdit({ ...edit, royalty_vat_rate: e.target.value })} /></Field>
          </div>
          <div style={{ marginTop: 10 }}><Field label="Note contrattuali"><input value={edit.royalty_notes} onChange={(e) => setEdit({ ...edit, royalty_notes: e.target.value })} placeholder="es. contratto del 01/09/2026, pagamento entro il 10 del mese successivo" /></Field></div>
          {edit.id && <label className="f inline" style={{ marginTop: 12 }}><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Sede attiva</label>}
        </Modal>
      )}
      {hist && <FloatHistory site={hist} onClose={() => setHist(null)} />}
    </div>
  );
}

function FloatHistory({ site, onClose }) {
  const { data } = useApi(`/sites/${site.id}/float-history`);
  return (
    <Modal title={`Storico fondo cassa · ${site.name}`} onClose={onClose}>
      {!data ? <Loading /> : <table className="t"><thead><tr><th>Quando</th><th>Chi</th><th className="num">Da</th><th className="num">A</th><th>Motivo</th></tr></thead>
        <tbody>{data.map((h) => <tr key={h.id}><td>{itDateTime(h.changed_at)}</td><td>{h.full_name}</td><td className="num">{h.old_value == null ? '–' : eur(h.old_value)}</td><td className="num strong">{eur(h.new_value)}</td><td>{h.reason}</td></tr>)}</tbody></table>}
    </Modal>
  );
}
