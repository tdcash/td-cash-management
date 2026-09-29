import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, Empty, Badge, StatusBadge } from '../components/ui.jsx';
import { eur, itDate, itDateTime, weekday, today, addDays } from '../format.js';

// Revisione e approvazione: i rendiconti che attendono il cassiere (ricezione busta, riconteggio) e le segnalazioni aperte
export default function Review() {
  const { user } = useAuth();
  const [tab, setTab] = useState('todo');
  const todo = useApi('/reports?status=PROCESSED,PICKED_UP&limit=500');
  const recent = useApi(tab === 'done' ? `/reports?status=VERIFIED,DEPOSITED&from=${addDays(today(), -30)}&limit=300` : null);
  const nc = useApi('/nc?status=APERTA');
  const ncAns = useApi('/nc?status=RISPOSTA');
  const rows = todo.data || [];
  const toReceive = rows.filter((r) => r.status === 'PROCESSED');
  const toVerify = rows.filter((r) => r.status === 'PICKED_UP');
  const Row = ({ r, action }) => (
    <tr key={r.id} style={{ background: r.open_nc ? 'var(--red-100)' : undefined }}>
      <td><Link to={`/rendiconti/${r.id}`}><b>{weekday(r.report_date)} {itDate(r.report_date)}</b></Link>{user.role === 'SUPERADMIN' && <div className="small muted">{r.company_name}</div>}</td>
      <td>{r.site_name}</td>
      <td className="mono small">{r.envelope_code || '–'}{r.slip_number && <div className="muted">{r.slip_number}</div>}</td>
      <td className="num strong">{eur(r.cash_to_deposit)}</td>
      <td><StatusBadge status={r.status} />{r.open_nc ? <div className="small red">{r.open_nc} segnalazioni aperte</div> : null}</td>
      <td className="small muted">{r.status === 'PICKED_UP' && r.pickup_at ? `Ricevuta ${itDateTime(r.pickup_at)}` : r.status === 'VERIFIED' && r.verified_at ? `${eur(r.verified_amount)} il ${itDateTime(r.verified_at)}` : r.deposit_number ? `Versamento ${r.deposit_number}` : ''}</td>
      <td className="num"><Link className="btn sm" to={`/rendiconti/${r.id}`}>{action}</Link></td>
    </tr>
  );
  const Table = ({ list, action, empty }) => !list.length ? <Empty>{empty}</Empty> : (
    <div className="table-wrap"><table className="t">
      <thead><tr><th>Giorno</th><th>Sede</th><th>Busta · distinta</th><th className="num">Contante</th><th>Stato</th><th /><th /></tr></thead>
      <tbody>{list.map((r) => <Row key={r.id} r={r} action={action} />)}</tbody>
    </table></div>
  );
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Revisione e approvazione</h1><div className="sub">Ricezione delle buste dalla logistica, riconteggio e verifica del contante, gestione delle segnalazioni. Le sedi in evidenza hanno segnalazioni aperte.</div></div>
        <Link className="btn ghost" to="/nc">Errori e NC</Link>
      </div>
      {!todo.data ? <Loading /> : <>
        <div className="grid g4">
          <Kpi accent label="Buste da ricevere" value={toReceive.length} foot={`${eur(toReceive.reduce((a, r) => a + Number(r.cash_to_deposit), 0))} · distinta elaborata in sede`} />
          <Kpi label="Da riconteggiare" value={toVerify.length} foot={`${eur(toVerify.reduce((a, r) => a + Number(r.cash_to_deposit), 0))} · in cassaforte`} />
          <Kpi label="Segnalazioni aperte" value={nc.data?.length ?? '…'} foot={<Link to="/nc?status=APERTA">senza risposta</Link>} />
          <Kpi label="Risposte da valutare" value={ncAns.data?.length ?? '…'} foot={<Link to="/nc?status=RISPOSTA">da chiudere o riaprire</Link>} />
        </div>
        <div className="row" style={{ margin: '16px 0 10px' }}>
          <button className={`btn sm ${tab === 'todo' ? '' : 'ghost'}`} onClick={() => setTab('todo')}>Da fare</button>
          <button className={`btn sm ${tab === 'done' ? '' : 'ghost'}`} onClick={() => setTab('done')}>Approvati (ultimi 30 giorni)</button>
        </div>
        {tab === 'todo' ? <>
          <Card title="1 · Operazione logistica: buste da ricevere e mettere in cassaforte" flush><Table list={toReceive} action="Registra ricezione" empty="Nessuna busta in arrivo" /></Card>
          <div style={{ height: 16 }} />
          <Card title="2 · Riconteggio e verifica: buste in cassaforte" flush><Table list={toVerify} action="Riconteggia e approva" empty="Nessuna busta da riconteggiare" /></Card>
        </> : (
          <Card title="Rendiconti approvati" flush>{!recent.data ? <Loading /> : <Table list={recent.data} action="Apri" empty="Nessun rendiconto approvato negli ultimi 30 giorni" />}</Card>
        )}
      </>}
    </div>
  );
}
