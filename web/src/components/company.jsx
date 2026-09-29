import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useApi, Field } from './ui.jsx';

// Selettore azienda: il super amministratore sceglie, gli altri lavorano sulla propria
export function useCompany() {
  const { user } = useAuth();
  const companies = useApi(user.role === 'SUPERADMIN' ? '/companies' : null);
  const [cid, setCid] = useState(user.company_id || '');
  const company = cid || companies.data?.[0]?.id || '';
  const Selector = () => user.role === 'SUPERADMIN'
    ? <Field label="Azienda"><select value={company} onChange={(e) => setCid(e.target.value)}>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    : null;
  return { company, Selector, companies: companies.data || [] };
}
