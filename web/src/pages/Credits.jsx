import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, can } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, Empty, Badge, ErrorBox, useToast } from '../components/ui.jsx';
import { useCompany } from '../components/company.jsx';
import { DepositDetail, BankModal } from '../components/deposits.jsx';
import { eur, itDate, itDateTime } from '../format.js';

// Conferma dell'accredito in banca: chiude il versamento sul conto corrente scelto
export default function Credits() {
  const { user } = useAuth();
  const toast = useToast();
  const { company, Selector } = useCompany();
  const waiting = useApi(company ? `/deposits?company_id=${company}&status=RITIRATO` : null);
  const done = useApi(company ? `/deposits?company_id=${company}&status=ACCREDITATO` : null);
  const accounts = useApi(company ? `/companies/${company}/bank-accounts` : null);
  const [bank, setBank] = useState(null);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState(null);
  const reload = () => { waiting.reload(); done.reload(); };
  const activeAccounts = (accounts.data || []).filter((a) => a.active);
  const byAccount = {};
  for (const d of done.data || []) { const k = d.bank_account_label || 'Senza conto'; byAccount[k] = (byAccount[k] || 0) + Number(d.bank_amount); }
  const confirm = async (b) => {
    setErr(null);
    try { await api.post(`/deposits/${bank.id}/bank`, b); toast('Accredito confermato'); setBank(null); reload(); } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Conferma dell'accredito</h1><div className="sub">Versamenti ritirati dal portavalori in attesa dell'accredito sul conto corrente. Una differenza tra versato e accreditato apre una segnalazione.</div></div>
        <Selector />
      </div>
      <ErrorBox error={err} />
      {!waiting.data || !done.data ? <Loading /> : <>
        {accounts.data && !activeAccounts.length && <div className="alert warn" style={{ marginBottom: 14 }}>Nessun conto corrente censito. {can(user, 'SUPERADMIN', 'ADMIN') ? <Link to="/aziende">Inseriscili nell'anagrafica Azienda</Link> : 'Chiedi all\'amministratore di inserirli nell\'anagrafica Azienda'} per confermare gli accrediti sul conto specifico.</div>}
        <div className="grid g3">
          <Kpi accent label="In attesa di accredito" value={eur(waiting.data.reduce((a, d) => a + Number(d.total_amount), 0))} foot={`${waiting.data.length} versamenti ritirati`} />
          <Kpi label="Accreditato" value={eur(done.data.reduce((a, d) => a + Number(d.bank_amount), 0))} foot={`${done.data.length} versamenti chiusi`} />
          <Kpi label="Differenze rilevate" value={done.data.filter((d) => Number(d.bank_amount) !== Number(d.total_amount)).length} foot="versamenti con importo diverso" />
        </div>
        <div style={{ marginTop: 16 }}><Card title="Da confermare" flush>
          {!waiting.data.length ? <Empty>Nessun versamento in attesa di accredito</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Numero</th><th>Data versamento</th><th>Ritirato</th><th>Buste</th><th className="num">Importo</th><th /></tr></thead>
              <tbody>{waiting.data.map((d) => (
                <tr key={d.id}>
                  <td className="mono strong"><a onClick={() => setOpen(d.id)} style={{ cursor: 'pointer' }}>{d.number}</a></td><td>{itDate(d.deposit_date)}</td>
                  <td className="small">{d.operator_name}<div className="muted">{itDateTime(d.picked_at)}</div></td>
                  <td className="mono small">{(d.envelopes || []).map((e) => e.code).join(', ')}</td>
                  <td className="num strong">{eur(d.total_amount)}</td>
                  <td className="num"><button className="btn sm" onClick={() => setBank(d)}>Conferma accredito</button></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card></div>
        <div style={{ marginTop: 16 }}><Card title="Accrediti confermati" actions={Object.keys(byAccount).length > 1 && <span className="small muted">{Object.entries(byAccount).map(([k, v]) => `${k}: ${eur(v)}`).join(' · ')}</span>} flush>
          {!done.data.length ? <Empty>Nessun accredito confermato</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Numero</th><th>Versato il</th><th className="num">Versato</th><th className="num">Accreditato</th><th>Data accredito</th><th>Conto corrente</th><th>Riferimento</th><th>Confermato da</th></tr></thead>
              <tbody>{done.data.map((d) => (
                <tr key={d.id} className="click" onClick={() => setOpen(d.id)}>
                  <td className="mono strong">{d.number}</td><td>{itDate(d.deposit_date)}</td>
                  <td className="num">{eur(d.total_amount)}</td>
                  <td className={`num strong ${Number(d.bank_amount) !== Number(d.total_amount) ? 'red' : ''}`}>{eur(d.bank_amount)}</td>
                  <td>{itDate(d.bank_date)}</td>
                  <td>{d.bank_account_label ? <>{d.bank_account_label}<div className="mono small muted">{d.bank_account_iban}</div></> : <Badge>senza conto</Badge>}</td>
                  <td className="small">{d.bank_reference || '–'}</td>
                  <td className="small muted">{d.bank_confirmed_by_name || '–'}</td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card></div>
      </>}
      {bank && <BankModal total={bank.total_amount} accounts={activeAccounts} onClose={() => setBank(null)} onConfirm={confirm} />}
      {open && <DepositDetail id={open} canDelete={can(user, 'SUPERADMIN', 'ADMIN')} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
