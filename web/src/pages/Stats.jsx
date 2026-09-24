import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Loading, ErrorBox, Empty, Icon } from '../components/ui.jsx';
import { ScopeFilter, PeriodFilter, PRESETS } from '../components/filters.jsx';
import { DailyStacked, Legend, SitesBars, MixDonut, SERIES } from '../components/charts.jsx';
import { eur, num, itDate, CIRCUITS } from '../format.js';
import { qs } from '../api.js';

export default function Stats() {
  const { user } = useAuth();
  const [f, setF] = useState({ company_id: '', site_id: '', ...PRESETS.mese() });
  const s = useApi(`/stats/summary${qs(f)}`);
  const d = s.data;
  const share = (v) => (d?.totals.total ? `${((Number(v) / d.totals.total) * 100).toFixed(1)}%` : '–');
  const days = d?.by_day.length || 0;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Statistiche dei flussi di cassa</h1><div className="sub">Contanti, POS e bonifici per sede e per azienda</div></div>
        <a className="btn ghost" href={`/api/stats/export.csv${qs({ company_id: f.company_id, site_id: f.site_id, from: f.from, to: f.to })}`}><Icon name="download" size={17} />Esporta CSV</a>
      </div>
      <div className="filters"><ScopeFilter value={f} onChange={setF} /><PeriodFilter value={f} onChange={setF} /></div>
      <ErrorBox error={s.error} />
      {!d ? <Loading /> : <>
        <div className="grid g5">
          <Kpi accent label="Totale incassi" value={eur(d.totals.total)} foot={`${d.totals.reports} rendiconti su ${days} giorni`} />
          <Kpi label="Contanti" value={eur(d.totals.cash)} foot={share(d.totals.cash)} />
          <Kpi label="POS" value={eur(d.totals.pos)} foot={share(d.totals.pos)} />
          <Kpi label="Bonifici" value={eur(d.totals.transfer)} foot={share(d.totals.transfer)} />
          <Kpi label="Media giornaliera" value={eur(days ? d.totals.total / days : 0)} foot={d.reports_with_diff ? `${d.totals.reports_with_diff} rendiconti con differenza` : `differenze di cassa: ${eur(d.totals.differences)}`} />
        </div>
        <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', marginTop: 16 }}>
          <Card title="Andamento giornaliero" actions={<Legend />}>{d.by_day.length ? <DailyStacked data={d.by_day} height={300} /> : <Empty>Nessun dato</Empty>}</Card>
          <Card title="Composizione">
            <MixDonut totals={d.totals} />
            <table className="t" style={{ marginTop: 8 }}><tbody>
              {SERIES.map((x) => <tr key={x.key}><td><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: x.color, marginRight: 8 }} />{x.label}</td><td className="num">{eur(d.totals[x.key])}</td><td className="num muted">{share(d.totals[x.key])}</td></tr>)}
            </tbody></table>
          </Card>
        </div>
        <div className="grid" style={{ marginTop: 16, gridTemplateColumns: '3fr 2fr' }}>
          <Card title="Per sede" flush>
            {d.by_site.length ? <>
              <div style={{ padding: '12px 18px 0' }}><SitesBars data={d.by_site} /></div>
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Sede</th><th className="num">Rend.</th><th className="num">Contanti</th><th className="num">POS</th><th className="num">Bonifici</th><th className="num">Totale</th><th className="num">Media/g</th></tr></thead>
                <tbody>{d.by_site.map((r) => <tr key={r.site_id}><td style={{ minWidth: 160 }}><b>{r.site_name}</b>{user.role === 'SUPERADMIN' && <div className="small muted">{r.company_name}</div>}</td><td className="num">{r.reports}</td><td className="num">{eur(r.cash)}</td><td className="num">{eur(r.pos)}</td><td className="num">{eur(r.transfer)}</td><td className="num strong">{eur(r.total)}</td><td className="num">{eur(r.total / r.reports)}</td></tr>)}</tbody>
              </table></div>
            </> : <Empty>Nessun dato</Empty>}
          </Card>
          <div className="grid">
            {user.role === 'SUPERADMIN' && (
              <Card title="Per azienda" flush>
                <table className="t">
                  <thead><tr><th>Azienda</th><th className="num">Rend.</th><th className="num">Totale</th><th className="num">Quota</th></tr></thead>
                  <tbody>{d.by_company.map((r) => <tr key={r.company_id}><td className="strong">{r.company_name}</td><td className="num">{r.reports}</td><td className="num">{eur(r.total)}</td><td className="num muted">{share(r.total)}</td></tr>)}</tbody>
                </table>
              </Card>
            )}
            <Card title="POS per circuito" flush>
              {d.by_circuit.length ? (
                <table className="t">
                  <thead><tr><th>Circuito</th><th className="num">Scontrini</th><th className="num">Importo</th><th className="num">Medio</th></tr></thead>
                  <tbody>{d.by_circuit.map((r) => <tr key={r.circuit}><td>{CIRCUITS[r.circuit] || r.circuit}</td><td className="num">{num(r.count)}</td><td className="num">{eur(r.amount)}</td><td className="num">{eur(r.amount / r.count)}</td></tr>)}</tbody>
                </table>
              ) : <Empty>Nessuno scontrino</Empty>}
            </Card>
            {Number(d.totals.channels_gross) > 0 && (
              <Card title="Canali digitali">
                <div className="row"><div><div className="small muted">Incasso lordo</div><b>{eur(d.totals.channels_gross)}</b></div><div><div className="small muted">Trattenuto alla fonte</div><b>{eur(d.totals.channels_withheld)}</b></div></div>
              </Card>
            )}
          </div>
        </div>
        <div className="small muted" style={{ marginTop: 14 }}>Periodo {itDate(d.from)} – {itDate(d.to)}. I contanti sono al netto del fondo cassa. La media giornaliera è calcolata sui giorni con almeno un rendiconto.</div>
      </>}
    </div>
  );
}
