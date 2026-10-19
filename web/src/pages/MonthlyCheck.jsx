import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApi, Kpi, Card, Field, Loading, ErrorBox, Empty, Badge, Modal, PromptModal, Icon, useToast } from '../components/ui.jsx';
import { eur, itDate, itDateTime, currentMonth } from '../format.js';

const OUTCOME = {
  QUADRA: ['Quadra', 'green'], AMMANCO: ['Ammanco', 'red'], ECCEDENZA: ['Eccedenza', 'mauve'], RENDICONTO_MANCANTE: ['Rendiconto mancante', 'red'],
  BOZZA: ['Rendiconto in bozza', 'mauve'], SENZA_GIPO: ['Senza incasso GIPO', 'mauve'], NON_RICONOSCIUTO: ['Non riconosciuto', 'red'],
};
const prevMonth = () => { const [y, m] = currentMonth().split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };

export default function MonthlyCheck() {
  const toast = useToast();
  const list = useApi('/controllo-mensile');
  const [period, setPeriod] = useState(prevMonth());
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [del, setDel] = useState(null);
  const run = async () => {
    setErr(null); setBusy(true);
    try {
      const fd = new FormData(); fd.append('period', period); for (const f of files) fd.append('files', f);
      const r = await api.upload('/controllo-mensile/run', fd);
      toast(`Controllo eseguito: ${r.summary.rows} righe, ${r.summary.ammanco} ammanchi, ${r.summary.mancanti} rendiconti mancanti`, r.summary.ammanco || r.summary.mancanti ? 'err' : 'ok');
      setFiles([]); list.reload(); setOpen(r.id);
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Controllo mensile casse</h1><div className="sub">Confronto a fine mese tra la Stampa cassa per utente di GIPO e le chiusure di cassa inserite, per sede, giorno e operatore. Riservato ai super amministratori.</div></div>
        <Link className="btn ghost" to="/impostazioni#sezionali">Sezionali GIPO</Link>
      </div>
      <Card title="Nuovo controllo">
        <ErrorBox error={err} />
        <div className="row" style={{ alignItems: 'flex-end', gap: 14 }}>
          <Field label="Mese"><input type="month" value={period} max={currentMonth()} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <Field label="Stampa cassa per utente (PDF, anche più file)"><input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => setFiles([...e.target.files])} /></Field>
          <button className="btn" disabled={busy || !files.length || !period} onClick={run}>Esegui controllo</button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>Da GIPO: Stampa cassa, periodo dal primo all'ultimo giorno del mese, raggruppata per utente, tutte le sedi. L'abbinamento alla sede avviene dal sezionale (numero dopo la barra), all'operatore dall'email dell'utente GIPO, che deve coincidere con quella censita in Utenti.</p>
      </Card>
      <div style={{ marginTop: 16 }}><Card title="Controlli eseguiti" flush>
        {!list.data ? <Loading /> : !list.data.length ? <Empty>Nessun controllo</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Mese</th><th>Eseguito</th><th className="num">Righe</th><th className="num">Incasso GIPO</th><th className="num">Dichiarato</th><th className="num">Ammanchi</th><th className="num">Mancanti</th><th className="num">Altre anomalie</th><th /></tr></thead>
            <tbody>{list.data.map((c) => { const S = c.summary; const other = S.eccedenza + S.bozze + S.senza_gipo + S.non_riconosciuti; return (
              <tr key={c.id} className="click" onClick={() => setOpen(c.id)}>
                <td className="strong">{c.period}</td><td className="small">{itDateTime(c.created_at)}<div className="muted">{c.created_by_name}</div></td>
                <td className="num">{S.rows}</td><td className="num">{eur(S.gipo_total)}</td><td className="num">{eur(S.declared_total)}</td>
                <td className={`num ${S.ammanco ? 'red strong' : ''}`}>{S.ammanco}{S.ammanco ? <div className="small">{eur(S.ammanco_total)}</div> : null}</td>
                <td className={`num ${S.mancanti ? 'red strong' : ''}`}>{S.mancanti}</td><td className="num">{other}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  <a className="btn sm ghost" href={`/api/controllo-mensile/${c.id}/pdf`} target="_blank" rel="noopener"><Icon name="print" size={14} />PDF</a>{' '}
                  <a className="btn sm ghost" href={`/api/controllo-mensile/${c.id}/xlsx`}><Icon name="download" size={14} />XLSX</a>{' '}
                  <button className="iconbtn" title="Elimina" onClick={() => setDel(c)}><Icon name="trash" size={15} /></button>
                </td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </Card></div>
      {open && <CheckDetail id={open} onClose={() => setOpen(null)} />}
      {del && <PromptModal title={`Elimina controllo ${del.period}`} label="Motivazione" confirmText="Elimina" danger onClose={() => setDel(null)} onConfirm={async () => { await api.del(`/controllo-mensile/${del.id}`); toast('Controllo eliminato'); list.reload(); }} />}
    </div>
  );
}

function CheckDetail({ id, onClose }) {
  const { data: c, error } = useApi(`/controllo-mensile/${id}`);
  const [filter, setFilter] = useState('ANOMALIE');
  if (error) return <Modal title="Controllo" onClose={onClose}><ErrorBox error={error} /></Modal>;
  if (!c) return <Modal title="Controllo" onClose={onClose}><Loading /></Modal>;
  const S = c.summary;
  const rows = c.rows.filter((x) => filter === 'TUTTE' ? true : filter === 'ANOMALIE' ? x.outcome !== 'QUADRA' : x.outcome === filter);
  return (
    <Modal wide title={`Controllo mensile ${c.period}`} onClose={onClose} footer={<>
      <a className="btn ghost" href={`/api/controllo-mensile/${c.id}/pdf`} target="_blank" rel="noopener"><Icon name="print" size={16} />PDF</a>
      <a className="btn ghost" href={`/api/controllo-mensile/${c.id}/xlsx`}><Icon name="download" size={16} />XLSX</a>
      <div className="spacer" /><button className="btn" onClick={onClose}>Chiudi</button></>}>
      <div className="grid g4">
        <Kpi accent label="Incasso GIPO" value={eur(S.gipo_total)} foot={`${S.rows} righe sede · giorno · operatore`} />
        <Kpi label="Dichiarato" value={eur(S.declared_total)} foot={`differenza ${eur(S.declared_total - S.gipo_total)}`} />
        <Kpi label="Ammanchi" value={S.ammanco} foot={eur(S.ammanco_total)} />
        <Kpi label="Rendiconti mancanti" value={S.mancanti} foot={`${S.bozze} in bozza · ${S.senza_gipo} senza GIPO · ${S.non_riconosciuti} non riconosciuti`} />
      </div>
      <div className="subhead">Modalità di pagamento (totale del mese)</div>
      <table className="t"><thead><tr><th>Modalità</th><th className="num">GIPO</th><th className="num">Dichiarato</th><th className="num">Differenza</th></tr></thead><tbody>
        {[['Contanti', S.modes_gipo.cash, S.modes_declared.cash], ['POS e carte', S.modes_gipo.pos, S.modes_declared.pos], ['Bonifici', S.modes_gipo.transfer, S.modes_declared.transfer]].map(([l, g, d]) => <tr key={l}><td>{l}</td><td className="num">{eur(g)}</td><td className="num">{eur(d)}</td><td className={`num ${Math.round((d - g) * 100) ? 'red strong' : 'muted'}`}>{eur(d - g)}</td></tr>)}
        {S.modes_gipo.other > 0 && <tr><td>Altre modalità GIPO</td><td className="num">{eur(S.modes_gipo.other)}</td><td className="num muted">–</td><td className="num muted">–</td></tr>}
      </tbody></table>
      <div className="subhead">Per sede</div>
      <div className="table-wrap" style={{ maxHeight: 220 }}><table className="t"><thead><tr><th>Sede</th><th className="num">GIPO</th><th className="num">Dichiarato</th><th className="num">Differenza</th><th className="num">Righe</th><th className="num">Anomalie</th></tr></thead><tbody>
        {S.by_site.map((x) => <tr key={x.site_name} style={{ background: x.issues ? 'var(--red-100)' : undefined }}><td>{x.site_name}</td><td className="num">{eur(x.gipo)}</td><td className="num">{eur(x.declared)}</td><td className={`num ${x.diff ? 'strong' : 'muted'}`}>{eur(x.diff)}</td><td className="num">{x.rows}</td><td className="num">{x.issues}</td></tr>)}
      </tbody></table></div>
      <div className="row" style={{ margin: '14px 0 6px', alignItems: 'center' }}>
        <div className="subhead" style={{ margin: 0 }}>Dettaglio</div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto', minHeight: 32 }}>
          <option value="ANOMALIE">Solo anomalie</option><option value="TUTTE">Tutte le righe</option>{Object.entries(OUTCOME).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="table-wrap" style={{ maxHeight: 360 }}><table className="t" style={{ minWidth: 980 }}>
        <thead><tr><th>Sede</th><th>Data</th><th>Operatore</th><th className="num">GIPO</th><th className="num">Dichiarato</th><th className="num">Verificato</th><th className="num">Diff.</th><th>Esito</th></tr></thead>
        <tbody>{!rows.length ? <tr><td colSpan={8} className="muted">Nessuna riga</td></tr> : rows.map((x, i) => (
          <tr key={i}>
            <td>{x.site_name}{x.sezionale && <div className="small muted">sez. /{x.sezionale}</div>}</td><td>{itDate(x.date)}</td><td>{x.operator_name}<div className="small muted">{x.operator_email}</div></td>
            <td className="num">{eur(x.gipo_amount)}<div className="small muted">{x.gipo_count} mov.</div></td>
            <td className="num">{x.report_id ? <Link to={`/rendiconti/${x.report_id}`} onClick={onClose}>{eur(x.declared)}</Link> : '–'}</td>
            <td className="num">{x.verified != null ? eur(x.verified) : '–'}</td>
            <td className={`num ${x.diff ? (x.diff < 0 ? 'red strong' : 'strong') : 'muted'}`}>{x.diff == null ? '–' : eur(x.diff)}</td>
            <td style={{ whiteSpace: 'nowrap' }}><Badge tone={OUTCOME[x.outcome]?.[1] || 'grey'}>{OUTCOME[x.outcome]?.[0] || x.outcome}</Badge></td>
          </tr>))}</tbody>
      </table></div>
      {S.problems?.length > 0 && <><div className="subhead">Segnalazioni di lettura</div><ul className="small">{S.problems.map((p, i) => <li key={i}>{p.detail}</li>)}</ul></>}
    </Modal>
  );
}
