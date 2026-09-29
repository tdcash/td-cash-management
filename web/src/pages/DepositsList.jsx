import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, can } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, Empty, Badge, Icon } from '../components/ui.jsx';
import { useCompany } from '../components/company.jsx';
import { DepositDetail } from '../components/deposits.jsx';
import { eur, itDate, itDateTime, DEPOSIT_STATUS } from '../format.js';

// Versamenti al portavalori: preparati e ritirati (l'accredito è nella sezione dedicata)
export default function DepositsList() {
  const { user } = useAuth();
  const { company, Selector } = useCompany();
  const [tab, setTab] = useState('open');
  const list = useApi(company ? `/deposits?company_id=${company}${tab === 'open' ? '&status=PREPARATO,RITIRATO' : ''}` : null);
  const [open, setOpen] = useState(null);
  const rows = list.data || [];
  const prep = rows.filter((d) => d.status === 'PREPARATO');
  const rit = rows.filter((d) => d.status === 'RITIRATO');
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Versamenti al portavalori</h1><div className="sub">Versamenti preparati dalla cassaforte, ritiro del portavalori con firma della catena di custodia. L'accredito si conferma nella sezione Conferma accredito.</div></div>
        <div className="row"><Selector /><Link className="btn" to="/cassaforte">Prepara nuovo versamento</Link></div>
      </div>
      {!list.data ? <Loading /> : <>
        {tab === 'open' && <div className="grid g3">
          <Kpi accent label="Preparati, in attesa del portavalori" value={eur(prep.reduce((a, d) => a + Number(d.total_amount), 0))} foot={`${prep.length} versamenti`} />
          <Kpi label="Ritirati, in attesa di accredito" value={eur(rit.reduce((a, d) => a + Number(d.total_amount), 0))} foot={<Link to="/accrediti">{rit.length} da confermare</Link>} />
          <Kpi label="Buste in transito" value={rows.reduce((a, d) => a + (d.envelopes || []).length, 0)} foot="buste Mondialpol" />
        </div>}
        <div className="row" style={{ margin: '16px 0 10px' }}>
          <button className={`btn sm ${tab === 'open' ? '' : 'ghost'}`} onClick={() => setTab('open')}>Aperti</button>
          <button className={`btn sm ${tab === 'all' ? '' : 'ghost'}`} onClick={() => setTab('all')}>Tutti</button>
        </div>
        <Card flush>
          {!rows.length ? <Empty>Nessun versamento {tab === 'open' ? 'aperto' : ''}</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Numero</th><th>Data</th><th className="num">Rendiconti</th><th>Buste</th><th className="num">Importo</th><th>Stato</th><th>Portavalori</th><th>Accredito</th><th /></tr></thead>
              <tbody>{rows.map((d) => (
                <tr key={d.id} className="click" onClick={() => setOpen(d.id)}>
                  <td className="mono strong">{d.number}</td><td>{itDate(d.deposit_date)}</td><td className="num">{d.reports_count}</td>
                  <td className="mono small">{(d.envelopes || []).map((e) => e.code).join(', ')}</td>
                  <td className="num strong">{eur(d.total_amount)}</td>
                  <td><Badge tone={DEPOSIT_STATUS[d.status].tone}>{DEPOSIT_STATUS[d.status].label}</Badge></td>
                  <td className="small">{d.operator_name || '–'}{d.picked_at && <div className="muted">{itDateTime(d.picked_at)}</div>}</td>
                  <td className="small">{d.bank_amount != null ? <>{eur(d.bank_amount)} · {itDate(d.bank_date)}{d.bank_account_label && <div className="muted">{d.bank_account_label}</div>}</> : '–'}</td>
                  <td className="num"><a className="btn sm ghost" href={`/api/deposits/${d.id}/pdf`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}><Icon name="print" size={14} />PDF</a></td>
                </tr>))}</tbody>
            </table></div>
          )}
        </Card>
      </>}
      {open && <DepositDetail id={open} canDelete={can(user, 'SUPERADMIN', 'ADMIN')} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
}
