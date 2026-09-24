import React, { useState } from 'react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, Modal, MoneyInput, useToast, Icon } from '../components/ui.jsx';
import { eur, itDate, itDateTime, prevMonth, ROY_STATUS, today, addDays } from '../format.js';

export default function Royalty() {
  const { user } = useAuth();
  const sup = user.role === 'SUPERADMIN';
  const [tab, setTab] = useState('statements');
  return (
    <div className="page">
      <div className="page-head"><div><h1>{sup ? 'Royalty, fee e addebiti SEPA' : 'Royalty ed estratti'}</h1><div className="sub">Calcolo automatico sul fatturato rendicontato, estratti mensili, addebito diretto SDD</div></div></div>
      <div className="tabs">
        <button className={tab === 'statements' ? 'on' : ''} onClick={() => setTab('statements')}>Estratti</button>
        <button className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>Simulazione</button>
        {sup && <button className={tab === 'contracts' ? 'on' : ''} onClick={() => setTab('contracts')}>Contratti</button>}
        {sup && <button className={tab === 'sepa' ? 'on' : ''} onClick={() => setTab('sepa')}>Flussi SEPA</button>}
      </div>
      {tab === 'statements' && <Statements sup={sup} />}
      {tab === 'preview' && <Preview />}
      {tab === 'contracts' && sup && <Contracts />}
      {tab === 'sepa' && sup && <Sepa />}
    </div>
  );
}

function Statements({ sup }) {
  const toast = useToast();
  const { data, error, reload } = useApi('/royalty/statements');
  const [period, setPeriod] = useState(prevMonth());
  const [sel, setSel] = useState([]);
  const [issue, setIssue] = useState(null);
  const [batch, setBatch] = useState(false);
  const [err, setErr] = useState(null);
  const issueNow = async () => { setErr(null); try { setIssue(await api.post('/royalty/statements', { period })); reload(); } catch (e) { setErr(e); } };
  const setStatus = async (id, status) => { try { await api.post(`/royalty/statements/${id}/status`, { status }); toast('Stato aggiornato'); reload(); } catch (e) { setErr(e); } };
  const eligible = (s) => ['EMESSO', 'INSOLUTO'].includes(s.status) && s.has_mandate && Number(s.total_due) > 0;
  return <>
    <ErrorBox error={err || error} />
    {sup && (
      <Card title="Emissione estratti mensili">
        <div className="row">
          <Field label="Periodo"><input type="month" value={period} max={prevMonth()} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <button className="btn" style={{ marginTop: 18 }} onClick={issueNow}>Emetti estratti per tutte le aziende con contratto</button>
          <div className="spacer" />
          {sel.length > 0 && <button className="btn dark" style={{ marginTop: 18 }} onClick={() => setBatch(true)}>Genera flusso SEPA ({sel.length})</button>}
        </div>
        {issue && <div className="alert info" style={{ marginTop: 12, display: 'block' }}>{issue.map((r, i) => <div key={i}>{r.company}: {r.number ? <>emesso <b>{r.number}</b>, {eur(r.total_due)}{r.drafts_warning ? <span className="red"> · attenzione: {r.drafts_warning} rendiconti ancora in bozza nel periodo</span> : ''}</> : <span className="muted">{r.skipped}</span>}</div>)}</div>}
      </Card>
    )}
    <div className="card" style={{ marginTop: 16 }}>
      {!data ? <Loading /> : !data.length ? <Empty>Nessun estratto emesso</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr>{sup && <th />}<th>Numero</th>{sup && <th>Azienda</th>}<th>Periodo</th><th className="num">Base</th><th className="num">Royalty</th><th className="num">Marketing</th><th className="num">IVA</th><th className="num">Trattenuto</th><th className="num">Dovuto</th><th>Scadenza</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.map((s) => (
            <tr key={s.id}>
              {sup && <td><input type="checkbox" disabled={!eligible(s)} checked={sel.includes(s.id)} onChange={(e) => setSel(e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id))} title={!s.has_mandate ? 'Mandato SEPA mancante' : ''} /></td>}
              <td className="mono strong">{s.number}</td>
              {sup && <td>{s.company_name}{!s.has_mandate && <div className="small red">senza mandato SEPA</div>}</td>}
              <td>{itDate(s.period_start)} – {itDate(s.period_end)}</td>
              <td className="num">{eur(s.base_revenue)}</td><td className="num">{eur(s.royalty_amount)}</td><td className="num">{eur(s.marketing_amount)}</td><td className="num">{eur(s.vat_amount)}</td><td className="num">{eur(s.withheld_amount)}</td>
              <td className="num strong">{eur(s.total_due)}</td><td>{itDate(s.due_date)}</td>
              <td><Badge tone={ROY_STATUS[s.status]}>{s.status.replace('_', ' ')}</Badge>{s.msg_id && <div className="small muted mono">{s.msg_id}</div>}</td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                <a className="btn sm ghost" href={`/api/royalty/statements/${s.id}/pdf`} target="_blank" rel="noopener">PDF</a>
                {sup && s.status !== 'PAGATO' && s.status !== 'ANNULLATO' && <>
                  {' '}<button className="btn sm ghost" onClick={() => setStatus(s.id, 'PAGATO')}>Pagato</button>
                  {s.status === 'IN_ADDEBITO' && <>{' '}<button className="btn sm danger" onClick={() => setStatus(s.id, 'INSOLUTO')}>Insoluto</button></>}
                  {s.status === 'EMESSO' && <>{' '}<button className="btn sm danger" onClick={() => window.confirm('Annullare l\'estratto?') && setStatus(s.id, 'ANNULLATO')}>Annulla</button></>}
                </>}
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
    {batch && <BatchModal ids={sel} statements={data.filter((s) => sel.includes(s.id))} onClose={() => setBatch(false)} onDone={() => { setBatch(false); setSel([]); toast('Flusso SEPA generato'); reload(); }} />}
  </>;
}

function BatchModal({ ids, statements, onClose, onDone }) {
  const [date, setDate] = useState(addDays(today(), 5));
  const [err, setErr] = useState(null);
  const total = statements.reduce((a, s) => a + Number(s.total_due), 0);
  const go = async () => { setErr(null); try { const r = await api.post('/royalty/sepa/batches', { statement_ids: ids, collection_date: date }); window.open(`/api/royalty/sepa/batches/${r.id}/xml`, '_blank'); onDone(); } catch (e) { setErr(e); } };
  return (
    <Modal title="Genera flusso SEPA Direct Debit" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={go}>Genera XML pain.008</button></>}>
      <ErrorBox error={err} />
      <p>{ids.length} estratti, totale <b>{eur(total)}</b>. Il primo addebito di ogni azienda è marcato FRST, i successivi RCUR.</p>
      <Field label="Data di addebito richiesta" help="Rispetta i giorni di preavviso richiesti dalla banca (di norma 2 giorni lavorativi per RCUR, 5 per FRST)"><input type="date" value={date} min={addDays(today(), 2)} onChange={(e) => setDate(e.target.value)} /></Field>
      <p className="small muted">Il file va caricato sul portale di remote banking del Banco Fiorentino. L'esito degli addebiti (pagato o insoluto) si registra manualmente sugli estratti.</p>
    </Modal>
  );
}

function Preview() {
  const { user } = useAuth();
  const companies = useApi(user.role === 'SUPERADMIN' ? '/companies' : null);
  const [cid, setCid] = useState(user.company_id || '');
  const [period, setPeriod] = useState(prevMonth());
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const id = cid || companies.data?.[0]?.id;
  const go = async () => { setErr(null); try { setRes(await api.post('/royalty/preview', { company_id: Number(id), period })); } catch (e) { setErr(e); } };
  const d = res?.details;
  return <>
    <Card title="Simula il calcolo di un periodo">
      <div className="row">
        {user.role === 'SUPERADMIN' && <Field label="Azienda"><select value={id || ''} onChange={(e) => setCid(e.target.value)}>{(companies.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Periodo"><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
        <button className="btn" style={{ marginTop: 18 }} onClick={go} disabled={!id}>Calcola</button>
      </div>
    </Card>
    <ErrorBox error={err} />
    {res && (res.error ? <div className="alert warn" style={{ marginTop: 14 }}>{res.error}</div> : (
      <div className="card" style={{ marginTop: 14 }}><table className="t"><tbody>
        <tr><td>Fatturato da rendiconti</td><td className="num">{eur(d.reports_gross)}</td></tr>
        <tr><td>Incassi canali digitali {res.contract.include_channels ? '' : '(esclusi dal contratto)'}</td><td className="num">{eur(d.channels_gross)}</td></tr>
        <tr><td>Base di calcolo ({res.contract.revenue_base.toLowerCase()})</td><td className="num strong">{eur(res.base_revenue)}</td></tr>
        {res.contract.tier_basis === 'ANNUO_PROGRESSIVO' && <tr><td>Fatturato anno precedente al periodo</td><td className="num">{eur(d.ytd_before)}</td></tr>}
        <tr><td>Royalty ({res.contract.tier_mode === 'FASCIA' ? 'aliquota per fascia' : 'scaglioni marginali'}, aliquota effettiva {d.applied_rate}%){d.min_fee_applied && <span className="red"> · applicato il minimo contrattuale</span>}</td><td className="num">{eur(res.royalty_amount)}</td></tr>
        <tr><td>Fee marketing {res.contract.marketing_fee_pct}%</td><td className="num">{eur(res.marketing_amount)}</td></tr>
        <tr><td>IVA {res.contract.invoice_vat_rate}%</td><td className="num">{eur(res.vat_amount)}</td></tr>
        <tr><td>Già trattenuto alla fonte</td><td className="num">– {eur(res.withheld_amount)}</td></tr>
        <tr><td className="strong">Da addebitare</td><td className="num strong" style={{ fontSize: 18 }}>{eur(res.total_due)}</td></tr>
        {res.drafts > 0 && <tr><td colSpan={2} className="red">Attenzione: {res.drafts} rendiconti del periodo sono ancora in bozza</td></tr>}
      </tbody></table></div>
    ))}
  </>;
}

const emptyContract = { company_id: '', valid_from: `${today().slice(0, 4)}-01-01`, valid_to: '', revenue_base: 'LORDO', vat_rate: 0, marketing_fee_pct: 1, tier_mode: 'FASCIA', tier_basis: 'MENSILE', tiers: [{ from: 0, rate: 5 }], min_monthly_fee: 0, include_channels: true, payment_days: 10, invoice_vat_rate: 22, notes: '' };

function Contracts() {
  const toast = useToast();
  const { data, reload } = useApi('/royalty/contracts');
  const companies = useApi('/companies');
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    const b = { ...edit, company_id: Number(edit.company_id), valid_to: edit.valid_to || null, vat_rate: Number(edit.vat_rate), marketing_fee_pct: Number(edit.marketing_fee_pct), min_monthly_fee: Number(edit.min_monthly_fee), payment_days: Number(edit.payment_days), invoice_vat_rate: Number(edit.invoice_vat_rate), tiers: edit.tiers.map((t) => ({ from: Number(t.from), rate: Number(t.rate) })), notes: edit.notes || null };
    delete b.id; delete b.company_name; delete b.created_at;
    try { if (edit.id) await api.put(`/royalty/contracts/${edit.id}`, b); else await api.post('/royalty/contracts', b); toast('Contratto salvato'); setEdit(null); reload(); } catch (e) { setErr(e); }
  };
  return <>
    <div className="row" style={{ marginBottom: 12 }}><div className="spacer" /><button className="btn" onClick={() => setEdit({ ...emptyContract })}>+ Nuovo contratto</button></div>
    <div className="card">
      {!data ? <Loading /> : !data.length ? <Empty>Nessun contratto royalty configurato</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Azienda</th><th>Validità</th><th>Base</th><th>Scaglioni</th><th className="num">Marketing</th><th className="num">Minimo</th><th className="num">IVA</th><th /></tr></thead>
          <tbody>{data.map((k) => (
            <tr key={k.id}>
              <td className="strong">{k.company_name}</td><td>{itDate(k.valid_from)} – {k.valid_to ? itDate(k.valid_to) : 'aperto'}</td>
              <td>{k.revenue_base}{k.revenue_base === 'NETTO' ? ` (IVA ${k.vat_rate}%)` : ''}<div className="small muted">{k.tier_mode === 'FASCIA' ? 'per fascia' : 'marginale'} · {k.tier_basis === 'MENSILE' ? 'mensile' : 'progressivo annuo'}</div></td>
              <td>{k.tiers.map((t, i) => <span key={i} className="chip">da {eur(t.from)}: {t.rate}%</span>)}</td>
              <td className="num">{k.marketing_fee_pct}%</td><td className="num">{eur(k.min_monthly_fee)}</td><td className="num">{k.invoice_vat_rate}%</td>
              <td className="num"><button className="btn sm ghost" onClick={() => setEdit({ ...k, valid_to: k.valid_to || '', notes: k.notes || '' })}>Modifica</button></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
    {edit && (
      <Modal wide title={edit.id ? 'Modifica contratto' : 'Nuovo contratto royalty'} onClose={() => setEdit(null)} footer={<><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
        <ErrorBox error={err} />
        <div className="form-grid">
          <Field label="Azienda affiliata"><select value={edit.company_id} onChange={(e) => setEdit({ ...edit, company_id: e.target.value })}><option value="">Seleziona</option>{(companies.data || []).filter((c) => !c.is_franchisor).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Valido dal"><input type="date" value={edit.valid_from} onChange={(e) => setEdit({ ...edit, valid_from: e.target.value })} /></Field>
          <Field label="Valido al (vuoto = aperto)"><input type="date" value={edit.valid_to} onChange={(e) => setEdit({ ...edit, valid_to: e.target.value })} /></Field>
          <Field label="Base di calcolo"><select value={edit.revenue_base} onChange={(e) => setEdit({ ...edit, revenue_base: e.target.value })}><option value="LORDO">Fatturato lordo (incassato)</option><option value="NETTO">Netto IVA (scorporo)</option></select></Field>
          {edit.revenue_base === 'NETTO' && <Field label="IVA da scorporare %" help="Le prestazioni sanitarie sono per lo più esenti art. 10: verifica con il commercialista"><input type="number" step="0.01" value={edit.vat_rate} onChange={(e) => setEdit({ ...edit, vat_rate: e.target.value })} /></Field>}
          <Field label="Fee marketing %"><input type="number" step="0.01" value={edit.marketing_fee_pct} onChange={(e) => setEdit({ ...edit, marketing_fee_pct: e.target.value })} /></Field>
          <Field label="Modalità scaglioni"><select value={edit.tier_mode} onChange={(e) => setEdit({ ...edit, tier_mode: e.target.value })}><option value="FASCIA">Per fascia: tutto il fatturato all'aliquota della fascia raggiunta</option><option value="MARGINALE">Marginale: ogni quota alla propria aliquota</option></select></Field>
          <Field label="Base degli scaglioni"><select value={edit.tier_basis} onChange={(e) => setEdit({ ...edit, tier_basis: e.target.value })}><option value="MENSILE">Fatturato del mese</option><option value="ANNUO_PROGRESSIVO">Fatturato progressivo dell'anno</option></select></Field>
          <Field label="Minimo mensile"><MoneyInput value={edit.min_monthly_fee} onChange={(v) => setEdit({ ...edit, min_monthly_fee: v })} /></Field>
          <Field label="Giorni di pagamento"><input type="number" value={edit.payment_days} onChange={(e) => setEdit({ ...edit, payment_days: e.target.value })} /></Field>
          <Field label="IVA su royalty e fee %"><input type="number" step="0.01" value={edit.invoice_vat_rate} onChange={(e) => setEdit({ ...edit, invoice_vat_rate: e.target.value })} /></Field>
          <Field label="Canali digitali" className="inline" style={{ marginTop: 22 }}><input type="checkbox" checked={edit.include_channels} onChange={(e) => setEdit({ ...edit, include_channels: e.target.checked })} />Includi nella base e deduci lo split</Field>
        </div>
        <h3 style={{ margin: '16px 0 8px' }}>Scaglioni (royalty %)</h3>
        <table className="t"><thead><tr><th>Da fatturato (€)</th><th>Aliquota %</th><th /></tr></thead><tbody>
          {edit.tiers.map((t, i) => <tr key={i}><td><MoneyInput value={t.from} disabled={i === 0} onChange={(v) => setEdit({ ...edit, tiers: edit.tiers.map((x, j) => (j === i ? { ...x, from: v } : x)) })} /></td><td><input type="number" step="0.01" value={t.rate} onChange={(e) => setEdit({ ...edit, tiers: edit.tiers.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} /></td><td>{i > 0 && <button className="iconbtn" onClick={() => setEdit({ ...edit, tiers: edit.tiers.filter((_, j) => j !== i) })}>✕</button>}</td></tr>)}
        </tbody></table>
        <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setEdit({ ...edit, tiers: [...edit.tiers, { from: (Number(edit.tiers.at(-1).from) || 0) + 10000, rate: edit.tiers.at(-1).rate }] })}>+ Scaglione</button>
        <div style={{ marginTop: 12 }}><Field label="Note"><textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field></div>
      </Modal>
    )}
  </>;
}

function Sepa() {
  const { data, reload } = useApi('/royalty/sepa/batches');
  const toast = useToast();
  const set = async (id, status) => { await api.post(`/royalty/sepa/batches/${id}/status`, { status }); toast('Aggiornato'); reload(); };
  return (
    <div className="card">
      {!data ? <Loading /> : !data.length ? <Empty>Nessun flusso SEPA generato</Empty> : (
        <table className="t">
          <thead><tr><th>Message ID</th><th>Creato</th><th>Addebito</th><th className="num">Transazioni</th><th className="num">Totale</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.map((b) => <tr key={b.id}><td className="mono">{b.msg_id}</td><td>{itDateTime(b.created_at)}<div className="small muted">{b.created_by_name}</div></td><td>{itDate(b.collection_date)}</td><td className="num">{b.tx_count}</td><td className="num strong">{eur(b.total_amount)}</td><td><Badge tone={b.status === 'ESITATO' ? 'green' : b.status === 'INVIATO' ? 'blue' : 'grey'}>{b.status}</Badge></td>
            <td className="num" style={{ whiteSpace: 'nowrap' }}><a className="btn sm ghost" href={`/api/royalty/sepa/batches/${b.id}/xml`}><Icon name="download" size={14} />XML</a>{' '}{b.status === 'GENERATO' && <button className="btn sm ghost" onClick={() => set(b.id, 'INVIATO')}>Segna inviato</button>}{b.status === 'INVIATO' && <button className="btn sm ghost" onClick={() => set(b.id, 'ESITATO')}>Segna esitato</button>}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}
