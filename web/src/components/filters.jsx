import React from 'react';
import { useApi, Field } from './ui.jsx';
import { useAuth } from '../auth.jsx';
import { today, addDays, monthStart } from '../format.js';

// Selettori azienda/sede coerenti con i permessi dell'utente
export function ScopeFilter({ value, onChange, allowAll = true }) {
  const { user } = useAuth();
  const companies = useApi(user.role === 'SUPERADMIN' ? '/companies' : null);
  const sites = useApi('/sites');
  const siteList = (sites.data || []).filter((s) => !value.company_id || s.company_id === Number(value.company_id));
  return (
    <>
      {user.role === 'SUPERADMIN' && (
        <Field label="Azienda">
          <select value={value.company_id || ''} onChange={(e) => onChange({ ...value, company_id: e.target.value, site_id: '' })}>
            {allowAll && <option value="">Tutte le aziende</option>}
            {(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Sede">
        <select value={value.site_id || ''} onChange={(e) => onChange({ ...value, site_id: e.target.value })}>
          {(allowAll || siteList.length > 1) && <option value="">{user.role === 'OPERATOR' ? 'Tutte le mie sedi' : 'Tutte le sedi'}</option>}
          {siteList.map((s) => <option key={s.id} value={s.id}>{s.name}{user.role === 'SUPERADMIN' && !value.company_id ? ` · ${s.company_name}` : ''}</option>)}
        </select>
      </Field>
    </>
  );
}

export const PRESETS = {
  oggi: () => ({ from: today(), to: today() }),
  '7g': () => ({ from: addDays(today(), -6), to: today() }),
  '30g': () => ({ from: addDays(today(), -29), to: today() }),
  mese: () => ({ from: monthStart(), to: today() }),
  anno: () => ({ from: `${today().slice(0, 4)}-01-01`, to: today() }),
};
const LABELS = { oggi: 'Oggi', '7g': '7 giorni', '30g': '30 giorni', mese: 'Mese', anno: 'Anno' };

export function PeriodFilter({ value, onChange }) {
  return (
    <>
      <Field label="Dal"><input type="date" value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} /></Field>
      <Field label="Al"><input type="date" value={value.to} min={value.from} onChange={(e) => onChange({ ...value, to: e.target.value })} /></Field>
      <div className="row" style={{ gap: 4, paddingBottom: 2 }}>
        {Object.keys(PRESETS).map((k) => {
          const p = PRESETS[k]();
          const on = p.from === value.from && p.to === value.to;
          return <button key={k} className={`btn sm ${on ? '' : 'ghost'}`} onClick={() => onChange({ ...value, ...p })}>{LABELS[k]}</button>;
        })}
      </div>
    </>
  );
}
