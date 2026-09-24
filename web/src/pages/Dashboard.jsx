import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, ErrorBox, StatusBadge, Empty, Badge } from '../components/ui.jsx';
import { ScopeFilter, PeriodFilter, PRESETS } from '../components/filters.jsx';
import { DailyStacked, Legend, SitesBars } from '../components/charts.jsx';
import { eur, itDate, weekday } from '../format.js';
import { qs } from '../api.js';

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ company_id: '', site_id: '', ...PRESETS['30g']() });
  const s = useApi(`/stats/summary${qs(f)}`);
  const todayRows = useApi('/stats/today');
  const d = s.data;
  const pct = (v) => (d?.totals.total ? (Number(v) / d.totals.total) * 100 : 0);
  const pending = (d?.by_status?.CLOSED || 0) + (d?.by_status?.DRAFT || 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Buongiorno, {user.full_name.split(' ')[0]}</h1>
          <div className="sub">{user.role === 'SUPERADMIN' ? 'Vista di rete: tutte le aziende e le sedi' : user.role === 'ADMIN' ? `Vista azienda: ${user.company_name}` : 'Le tue sedi'}</div>
        </div>
        <Link className="btn" to="/rendiconti/nuovo">+ Nuovo rendiconto</Link>
      </div>

      <div className="filters">
        <ScopeFilter value={f} onChange={setF} />
        <PeriodFilter value={f} onChange={setF} />
      </div>
      <ErrorBox error={s.error} />
      {!d ? <Loading /> : <>
        <div className="grid g4">
          <Kpi accent label="Incasso del periodo" value={eur(d.totals.total)} foot={`${d.totals.reports} rendiconti · ${itDate(d.from)} – ${itDate(d.to)}`} />
          <Kpi label="Contanti versati" value={eur(d.totals.cash)} foot={`${pct(d.totals.cash).toFixed(1)}% del totale`} bar={pct(d.totals.cash)} />
          <Kpi label="POS" value={eur(d.totals.pos)} foot={`${pct(d.totals.pos).toFixed(1)}% del totale`} bar={pct(d.totals.pos)} />
          <Kpi label="Bonifici" value={eur(d.totals.transfer)} foot={`${pct(d.totals.transfer).toFixed(1)}% del totale`} bar={pct(d.totals.transfer)} />
        </div>
        <div className="grid g4" style={{ marginTop: 16 }}>
          <Kpi label="Rendiconti mancanti" value={d.missing.length} foot="giorni operativi senza rendiconto" />
          <Kpi label="Flussi in ritardo" value={d.late.length} foot={`fermi da oltre ${d.alert_days} giorni`} />
          <Kpi label="In lavorazione" value={pending} foot="bozze e buste da elaborare" />
          <Kpi label="Errori e NC aperte" value={d.nc.open + d.nc.answered} foot={`${d.nc.answered} con risposta da valutare${d.nc.overdue ? ` · ${d.nc.overdue} scadute` : ''}`} />
        </div>

        <div className="grid g3" style={{ marginTop: 16, gridTemplateColumns: '2fr 1fr' }}>
          <Card title="Incassi giornalieri" actions={<Legend />}>
            {d.by_day.length ? <DailyStacked data={d.by_day} /> : <Empty>Nessun rendiconto nel periodo</Empty>}
          </Card>
          <Card title="Oggi nelle sedi" flush>
            {todayRows.data ? (
              <table className="t"><tbody>
                {todayRows.data.map((r) => (
                  <tr key={r.site_id} className="click" onClick={() => nav(r.report_id ? `/rendiconti/${r.report_id}` : `/rendiconti/nuovo?site=${r.site_id}`)}>
                    <td><div className="strong">{r.site_name}</div>{user.role === 'SUPERADMIN' && <div className="small muted">{r.company_name}</div>}</td>
                    <td className="num">{r.report_id ? <StatusBadge status={r.status} /> : r.operating ? <Badge tone="red">Da fare</Badge> : <Badge>Chiusa</Badge>}</td>
                  </tr>
                ))}
                {!todayRows.data.length && <tr><td className="muted">Nessuna sede</td></tr>}
              </tbody></table>
            ) : <Loading />}
          </Card>
        </div>

        {d.by_site.length > 1 && (
          <div style={{ marginTop: 16 }}>
            <Card title="Confronto sedi" actions={<Legend />}><SitesBars data={d.by_site.slice(0, 15)} /></Card>
          </div>
        )}

        <div className="grid g2" style={{ marginTop: 16 }}>
          <Card title="Flussi da sbloccare" flush>
            {d.late.length ? (
              <div className="table-wrap" style={{ maxHeight: 360 }}><table className="t">
                <thead><tr><th>Data</th><th>Sede</th><th>Problema</th><th className="num">Contanti</th></tr></thead>
                <tbody>{d.late.map((r) => (
                  <tr key={r.id} className="click" onClick={() => nav(`/rendiconti/${r.id}`)}>
                    <td>{itDate(r.report_date)}</td><td>{r.site_name}</td><td><StatusBadge status={r.status} /> <span className="small muted">{r.issue}</span></td>
                    <td className="num">{eur(r.cash_to_deposit)}</td>
                  </tr>))}</tbody>
              </table></div>
            ) : <Empty>Nessun flusso in ritardo</Empty>}
          </Card>
          <Card title="Rendiconti mancanti" flush>
            {d.missing.length ? (
              <div className="table-wrap" style={{ maxHeight: 360 }}><table className="t">
                <thead><tr><th>Data</th><th>Sede</th><th /></tr></thead>
                <tbody>{d.missing.map((m) => (
                  <tr key={`${m.site_id}-${m.date}`}>
                    <td>{weekday(m.date)} {itDate(m.date)}</td><td>{m.site_name}{user.role === 'SUPERADMIN' && <span className="small muted"> · {m.company_name}</span>}</td>
                    <td className="num"><Link className="btn sm ghost" to={`/rendiconti/nuovo${qs({ site: m.site_id, date: m.date })}`}>Compila</Link></td>
                  </tr>))}</tbody>
              </table></div>
            ) : <Empty>Tutti i giorni operativi sono rendicontati</Empty>}
          </Card>
        </div>
      </>}
    </div>
  );
}
