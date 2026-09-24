import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, can } from '../auth.jsx';
import { useApi, Card, Field, ErrorBox, Loading, StatusBadge, Modal, PromptModal, MoneyInput, Badge, Icon, useToast } from '../components/ui.jsx';
import { ScanButton } from '../components/scan.jsx';
import { eur, itDate, itDateTime, weekday, today, CIRCUITS, NC_STATUS, SEVERITY } from '../format.js';

const BANKNOTES = [500, 200, 100, 50, 20, 10, 5];
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const STATUS_LABELS = Object.fromEntries([['DRAFT', 'Bozza'], ['CLOSED', 'Busta registrata'], ['PROCESSED', 'Distinta elaborata'], ['PICKED_UP', 'Ritirata'], ['DEPOSITED', 'Versata']]);
const STEPS = [
  ['DRAFT', 'Conteggio'], ['CLOSED', 'Busta Mondialpol'], ['PROCESSED', 'Distinta'], ['PICKED_UP', 'Ritiro logistica'], ['DEPOSITED', 'Accredito banca'],
];
const EVENT_LABEL = {
  CREATO: 'Rendiconto creato', BUSTA_REGISTRATA: 'Busta registrata', SBLOCCATO: 'Busta annullata', DISTINTA_ELABORATA: 'Distinta elaborata',
  RITIRATA: 'Ritirata dalla logistica', VERSATA: 'Accredito confermato', RIAPERTO: 'Riaperto', NC_APERTA: 'Non conformità aperta', NC_AUTOMATICA: 'Non conformità automatica',
};

function toForm(r) {
  return {
    denominations: { ...r.denominations },
    coins_total: r.coins_total,
    expected_total: r.expected_total ?? '',
    notes: r.notes || '',
    receipts: r.receipts.map(({ terminal_id, receipt_number, circuit, amount, auth_code, note, matched_tx_id }) => ({ terminal_id: terminal_id || '', receipt_number: receipt_number || '', circuit, amount, auth_code: auth_code || '', note: note || '', matched_tx_id })),
    transfers: r.transfers.map(({ cro, amount, payer, value_date, note }) => ({ cro, amount, payer: payer || '', value_date: value_date || '', note: note || '' })),
  };
}

export default function ReportEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const admin = can(user, 'SUPERADMIN', 'ADMIN');
  const { data: rep, error, reload } = useApi(`/reports/${id}`);
  const sites = useApi('/sites');
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);

  useEffect(() => { if (rep) { setForm(toForm(rep)); setDirty(false); } }, [rep]);
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const site = sites.data?.find((s) => s.id === rep?.site_id);
  const terminals = (site?.pos_terminals || '').split(',').map((t) => t.trim()).filter(Boolean);
  const editable = rep?.status === 'DRAFT';

  const t = useMemo(() => {
    if (!form || !rep) return null;
    const notes = BANKNOTES.reduce((a, d) => a + d * (Number(form.denominations[d]) || 0), 0);
    const counted = r2(notes + Number(form.coins_total || 0));
    const deposit = r2(counted - Number(rep.cash_float));
    const pos = r2(form.receipts.reduce((a, x) => a + Number(x.amount || 0), 0));
    const transfer = r2(form.transfers.reduce((a, x) => a + Number(x.amount || 0), 0));
    const day = r2(deposit + pos + transfer);
    const diff = form.expected_total === '' || form.expected_total == null ? null : r2(day - Number(form.expected_total));
    return { notes, counted, deposit, pos, transfer, day, diff };
  }, [form, rep]);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!rep || !form) return <div className="page"><Loading /></div>;

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const setDen = (d, v) => set({ denominations: { ...form.denominations, [d]: v === '' ? 0 : Math.max(0, parseInt(v, 10) || 0) } });
  const setRow = (key, i, patch) => set({ [key]: form[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const addRow = (key, row) => set({ [key]: [...form[key], row] });
  const delRow = (key, i) => set({ [key]: form[key].filter((_, j) => j !== i) });

  const payload = () => ({
    denominations: Object.fromEntries(Object.entries(form.denominations).map(([k, v]) => [k, Number(v) || 0])),
    coins_total: Number(form.coins_total) || 0,
    expected_total: form.expected_total === '' ? null : Number(form.expected_total),
    notes: form.notes || null,
    receipts: form.receipts.filter((x) => Number(x.amount) > 0).map((x) => ({ ...x, amount: Number(x.amount), terminal_id: x.terminal_id || null, receipt_number: x.receipt_number || null, auth_code: x.auth_code || null, note: x.note || null, matched_tx_id: undefined })),
    transfers: form.transfers.filter((x) => Number(x.amount) > 0 || x.cro).map((x) => ({ ...x, amount: Number(x.amount), payer: x.payer || null, value_date: x.value_date || null, note: x.note || null })),
  });

  const run = async (fn, okMsg) => {
    setBusy(true); setErr(null);
    try { await fn(); if (okMsg) toast(okMsg); await reload(); return true; } catch (e) { setErr(e); window.scrollTo({ top: 0, behavior: 'smooth' }); return false; } finally { setBusy(false); }
  };
  const save = () => run(() => api.put(`/reports/${id}`, payload()), 'Rendiconto salvato');
  const saveThen = async (next) => {
    if (dirty) { const ok = await save(); if (!ok) return; }
    next();
  };
  const openPdf = () => window.open(`/api/reports/${id}/pdf`, '_blank', 'noopener');
  const openCustody = () => window.open(`/api/reports/${id}/custody.pdf`, '_blank', 'noopener');

  const stepIdx = STEPS.findIndex(([s]) => s === rep.status);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/rendiconti">Rendiconti</Link> / {rep.company_name}</div>
          <h1>{rep.site_name} · {weekday(rep.report_date)} {itDate(rep.report_date)}</h1>
          <div className="sub row" style={{ gap: 8 }}><StatusBadge status={rep.status} />{rep.slip_number && <span className="mono">{rep.slip_number} rev. {rep.slip_revision}</span>}</div>
        </div>
        <div className="row">
          {rep.has_pdf && <button className="btn ghost" onClick={openPdf}><Icon name="print" size={17} />Stampa distinta</button>}
          {admin && <button className="btn ghost" onClick={() => setModal('nc')}><Icon name="alert" size={17} />Segnala errore / NC</button>}
          {['PROCESSED', 'PICKED_UP', 'DEPOSITED'].includes(rep.status) && <button className="btn ghost" onClick={openCustody}><Icon name="shield" size={17} />Catena di custodia</button>}
          {(admin || (editable && rep.slip_revision === 0 && rep.created_by === user.id)) && (
            <button className="btn danger" onClick={() => setModal('delete')}><Icon name="trash" size={16} />{editable ? 'Elimina bozza' : 'Elimina rendiconto'}</button>
          )}
        </div>
      </div>

      <div className="steps">
        {STEPS.map(([s, label], i) => (
          <div key={s} className={`s ${i < stepIdx || rep.status === 'DEPOSITED' ? 'done' : i === stepIdx ? 'now' : ''}`}><i>{i < stepIdx || rep.status === 'DEPOSITED' ? '✓' : i + 1}</i>{label}</div>
        ))}
      </div>

      <ErrorBox error={err} />
      {rep.status !== 'DRAFT' && rep.status !== 'DEPOSITED' && <div className="alert info" style={{ marginBottom: 14 }}>
        {rep.status === 'CLOSED' && 'Busta registrata. Elabora la distinta e stampala in doppia copia: firmi entrambe, una va in busta prima di sigillarla, una resta in sede.'}
        {rep.status === 'PROCESSED' && 'Distinta pronta. Stampa il modulo Catena di custodia: al ritiro lo firmate tu e l\'operatore di logistica, poi registra qui il ritiro.'}
        {rep.status === 'PICKED_UP' && (admin ? "Busta consegnata alla logistica. Conferma l'accredito quando lo vedi sul conto." : "Busta consegnata alla logistica. L'amministrazione confermerà l'accredito.")}
      </div>}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
        <div className="grid">
          <Card title="Contante in cassa" actions={<span className="small muted">Conta tutto il contante presente, fondo cassa incluso</span>}>
            <div className="denoms">
              {BANKNOTES.map((d) => (
                <div className="denom" key={d}>
                  <div className="face">{d} €<small>{eur(d * (form.denominations[d] || 0))}</small></div>
                  <input inputMode="numeric" aria-label={`Banconote da ${d} euro`} disabled={!editable} value={form.denominations[d] || ''} placeholder="0"
                    onChange={(e) => setDen(d, e.target.value.replace(/\D/g, ''))} onFocus={(e) => e.target.select()} />
                </div>
              ))}
              <div className="denom" style={{ background: 'var(--silk)' }}>
                <div className="face">Monete<small>totale €</small></div>
                <MoneyInput disabled={!editable} value={form.coins_total} onChange={(v) => set({ coins_total: v === '' ? 0 : v })} aria-label="Totale monete" />
              </div>
            </div>
          </Card>

          <Card title={`Scontrini POS (${form.receipts.length})`} flush actions={editable && <button className="btn sm" onClick={() => addRow('receipts', { circuit: 'BANCOMAT', terminal_id: terminals[0] || '', receipt_number: '', amount: '', auth_code: '' })}>+ Scontrino</button>}>
            {form.receipts.length ? (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Circuito</th><th>Terminale</th><th>N. scontrino</th><th>Autorizz.</th><th className="num">Importo</th><th /></tr></thead>
                <tbody>
                  {form.receipts.map((x, i) => (
                    <tr key={i}>
                      <td style={{ minWidth: 150 }}><select disabled={!editable} value={x.circuit} onChange={(e) => setRow('receipts', i, { circuit: e.target.value })}>{Object.entries(CIRCUITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                      <td><input disabled={!editable} list="tids" value={x.terminal_id} onChange={(e) => setRow('receipts', i, { terminal_id: e.target.value })} placeholder="TID" /></td>
                      <td><input disabled={!editable} value={x.receipt_number} onChange={(e) => setRow('receipts', i, { receipt_number: e.target.value })} /></td>
                      <td><input disabled={!editable} value={x.auth_code} onChange={(e) => setRow('receipts', i, { auth_code: e.target.value })} /></td>
                      <td style={{ width: 130 }}><MoneyInput disabled={!editable} value={x.amount} onChange={(v) => setRow('receipts', i, { amount: v })} autoFocus={i === form.receipts.length - 1 && x.amount === ''} /></td>
                      <td style={{ width: 70 }} className="num">
                        {x.matched_tx_id && <span title="Riconciliato con il gateway"><Badge tone="green">ok</Badge></span>}
                        {editable && <button className="iconbtn" onClick={() => delRow('receipts', i)} aria-label="Rimuovi"><Icon name="trash" size={16} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={4}>Totale POS</td><td className="num">{eur(t.pos)}</td><td /></tr></tfoot>
              </table></div>
            ) : <div className="empty">Nessuno scontrino POS registrato</div>}
            <datalist id="tids">{terminals.map((x) => <option key={x} value={x} />)}</datalist>
          </Card>

          <Card title={`Bonifici (${form.transfers.length})`} flush actions={editable && <button className="btn sm" onClick={() => addRow('transfers', { cro: '', payer: '', value_date: rep.report_date, amount: '' })}>+ Bonifico</button>}>
            {form.transfers.length ? (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>CRO / TRN</th><th>Ordinante</th><th>Data valuta</th><th className="num">Importo</th><th /></tr></thead>
                <tbody>
                  {form.transfers.map((x, i) => (
                    <tr key={i}>
                      <td style={{ minWidth: 220 }}><input className="mono" disabled={!editable} value={x.cro} onChange={(e) => setRow('transfers', i, { cro: e.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="es. 0306909606400001234567" /></td>
                      <td><input disabled={!editable} value={x.payer} onChange={(e) => setRow('transfers', i, { payer: e.target.value })} /></td>
                      <td style={{ width: 160 }}><input type="date" disabled={!editable} value={x.value_date} onChange={(e) => setRow('transfers', i, { value_date: e.target.value })} /></td>
                      <td style={{ width: 130 }}><MoneyInput disabled={!editable} value={x.amount} onChange={(v) => setRow('transfers', i, { amount: v })} /></td>
                      <td style={{ width: 44 }}>{editable && <button className="iconbtn" onClick={() => delRow('transfers', i)} aria-label="Rimuovi"><Icon name="trash" size={16} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3}>Totale bonifici</td><td className="num">{eur(t.transfer)}</td><td /></tr></tfoot>
              </table></div>
            ) : <div className="empty">Nessun bonifico registrato</div>}
          </Card>

          <Card title="Quadratura e note">
            <div className="form-grid">
              <Field label="Incasso da gestionale (facoltativo)" help="Totale giornata dal gestionale di sede: il sistema calcola la differenza di cassa">
                <MoneyInput disabled={!editable} value={form.expected_total} onChange={(v) => set({ expected_total: v })} />
              </Field>
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="Note"><textarea disabled={!editable} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anomalie, resi, eventi della giornata" /></Field>
            </div>
          </Card>

          {rep.nonconformities.length > 0 && (
            <Card title="Errori e non conformità collegati" flush>
              <table className="t"><tbody>{rep.nonconformities.map((n) => (
                <tr key={n.id} className="click" onClick={() => nav(`/nc/${n.id}`)}>
                  <td>#{n.id} <b>{n.title}</b></td><td><Badge tone={SEVERITY[n.severity]}>{n.severity}</Badge></td>
                  <td className="num"><Badge tone={NC_STATUS[n.status].tone}>{NC_STATUS[n.status].label}</Badge></td>
                </tr>))}</tbody></table>
            </Card>
          )}
        </div>

        <div className="grid" style={{ position: 'sticky', top: 18 }}>
          <div className="totals">
            <div className="line"><span>Banconote</span><b>{eur(t.notes)}</b></div>
            <div className="line"><span>Monete</span><b>{eur(form.coins_total)}</b></div>
            <div className="line"><span>Contante contato</span><b>{eur(t.counted)}</b></div>
            <div className="line"><span>Fondo cassa</span><b>– {eur(rep.cash_float)}</b></div>
            <div className="big"><span>Da versare in busta</span><span className={`v ${t.deposit < 0 ? 'red' : ''}`}>{eur(t.deposit)}</span></div>
            <div className="line"><span>POS</span><b>{eur(t.pos)}</b></div>
            <div className="line"><span>Bonifici</span><b>{eur(t.transfer)}</b></div>
            <div className="line" style={{ color: '#fff' }}><span className="strong">Totale giornata</span><b>{eur(t.day)}</b></div>
            {t.diff != null && <div className="line"><span>Differenza vs gestionale</span><b className={t.diff ? 'neg' : ''}>{eur(t.diff)}</b></div>}
            {t.deposit < 0 && <div className="alert err" style={{ marginTop: 10 }}>Il contante è inferiore al fondo cassa. Ricontrolla il conteggio.</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              {editable && <>
                <button className="btn ghost" disabled={busy || !dirty} onClick={save}>{dirty ? 'Salva bozza' : 'Bozza salvata'}</button>
                <button className="btn lg" style={{ background: 'var(--blue)', color: 'var(--jet)' }} disabled={busy || t.deposit < 0} onClick={() => saveThen(() => setModal('envelope'))}>
                  {t.deposit > 0 ? 'Registra busta Mondialpol →' : 'Chiudi senza versamento →'}
                </button>
              </>}
              {rep.status === 'CLOSED' && <>
                <button className="btn lg" style={{ background: 'var(--blue)', color: 'var(--jet)' }} disabled={busy} onClick={() => run(async () => { await api.post(`/reports/${id}/process`); openPdf(); }, 'Distinta elaborata')}>Elabora e stampa distinta →</button>
                <button className="btn ghost" style={{ color: '#fff', background: 'transparent', borderColor: 'rgba(255,255,255,.3)' }} disabled={busy} onClick={() => run(() => api.post(`/reports/${id}/unlock`), 'Rendiconto sbloccato')}>Annulla busta e modifica</button>
              </>}
              {rep.status === 'PROCESSED' && <>
                <button className="btn lg" style={{ background: 'var(--blue)', color: 'var(--jet)' }} onClick={() => setModal('pickup')}>{Number(rep.cash_to_deposit) > 0 ? 'Registra ritiro logistica →' : 'Nessuna busta da ritirare'}</button>
                <button className="btn ghost" style={{ color: '#fff', background: 'transparent', borderColor: 'rgba(255,255,255,.3)' }} onClick={openCustody}>Stampa catena di custodia</button>
                <button className="btn ghost" style={{ color: '#fff', background: 'transparent', borderColor: 'rgba(255,255,255,.3)' }} onClick={openPdf}>Ristampa distinta</button>
              </>}
              {admin && (rep.status === 'PICKED_UP' || (rep.status === 'PROCESSED' && Number(rep.cash_to_deposit) === 0)) && (
                <button className="btn lg" style={{ background: 'var(--silk)', color: 'var(--jet)' }} onClick={() => setModal('deposit')}>Conferma accredito in banca</button>
              )}
              {admin && ['CLOSED', 'PROCESSED'].includes(rep.status) && (
                <button className="btn ghost" style={{ color: '#ffd9d4', background: 'transparent', borderColor: 'rgba(255,180,171,.4)' }} onClick={() => setModal('reopen')}>Riapri rendiconto</button>
              )}
            </div>
          </div>

          {rep.envelope_code && (
            <div className="envelope">
              <h3>Busta Mondialpol</h3>
              <div className="code" style={{ marginTop: 6 }}>{rep.envelope_code}</div>
              <div className="small muted">Registrata il {itDateTime(rep.envelope_at)}</div>
              {rep.pickup_operator && <div className="small" style={{ marginTop: 8 }}>Ritirata da <b>{rep.pickup_operator}</b> il {itDateTime(rep.pickup_at)}</div>}
              {rep.deposit_date && <div className="small" style={{ marginTop: 4 }}>Accreditati <b>{eur(rep.deposit_amount)}</b> il {itDate(rep.deposit_date)}</div>}
            </div>
          )}

          <Card title="Tracciamento">
            <ul className="timeline">
              {rep.events.map((e) => (
                <li key={e.id}>
                  <div className="ev">{EVENT_LABEL[e.event] || e.event}</div>
                  {e.detail && <div className="small">{e.detail}</div>}
                  <div className="small muted">{itDateTime(e.at)} · {e.full_name}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {modal === 'envelope' && <EnvelopeModal rep={{ ...rep, cash_to_deposit: t.deposit }} onClose={() => setModal(null)} onDone={async () => { setModal(null); toast('Busta registrata'); await reload(); }} />}
      {modal === 'pickup' && <PickupModal id={id} needsEnvelope={Number(rep.cash_to_deposit) > 0} onClose={() => setModal(null)} onDone={async () => { setModal(null); toast('Ritiro registrato'); await reload(); }} />}
      {modal === 'deposit' && <DepositModal rep={rep} onClose={() => setModal(null)} onDone={async (diff) => { setModal(null); toast(diff ? 'Accredito confermato: aperta non conformità per la differenza' : 'Accredito confermato'); await reload(); }} />}
      {modal === 'reopen' && <PromptModal title="Riapri rendiconto" label="Motivo della riapertura (resta nel tracciamento)" confirmText="Riapri" danger minLength={5}
        onClose={() => setModal(null)} onConfirm={async (reason) => { await api.post(`/reports/${id}/reopen`, { reason }); toast('Rendiconto riaperto'); await reload(); }} />}
      {modal === 'delete' && (editable && !admin
        ? <PromptModal title="Elimina bozza" label="Conferma scrivendo ELIMINA" confirmText="Elimina" danger minLength={7} onClose={() => setModal(null)}
          onConfirm={async (v) => { if (v.toUpperCase() !== 'ELIMINA') throw new Error('Scrivi ELIMINA per confermare'); await api.del(`/reports/${id}`); toast('Bozza eliminata'); nav('/rendiconti'); }} />
        : <PromptModal title="Elimina rendiconto" label={`Stato: ${STATUS_LABELS[rep.status] || rep.status}${rep.envelope_code ? `, busta ${rep.envelope_code}` : ''}. Motivazione (resta nel registro attività)`}
          placeholder="es. rendiconto duplicato, inserito sulla sede sbagliata" confirmText="Elimina definitivamente" danger minLength={editable ? 1 : 5} onClose={() => setModal(null)}
          onConfirm={async (reason) => { await api.del(`/reports/${id}`, { reason }); toast('Rendiconto eliminato'); nav('/rendiconti'); }} />)}
      {modal === 'nc' && <NcCreateModal report={rep} onClose={() => setModal(null)} onDone={async (ncId) => { setModal(null); toast(`Aperta non conformità #${ncId}`); await reload(); }} />}
    </div>
  );
}

function EnvelopeModal({ rep, onClose, onDone }) {
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const needs = rep.cash_to_deposit > 0;
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api.post(`/reports/${rep.id}/envelope`, needs ? { code, confirm } : {}); onDone(); } catch (e) { setErr(e); }
    setBusy(false);
  };
  return (
    <Modal title={needs ? 'Registra la busta Mondialpol' : 'Chiusura senza versamento'} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annulla</button>
      <button className="btn" disabled={busy || (needs && (!code || !confirm))} onClick={go}>Registra</button>
    </>}>
      <ErrorBox error={err} />
      {needs ? <>
        <div className="alert warn" style={{ marginBottom: 14 }}>Inserisci in busta <b>{eur(rep.cash_to_deposit)}</b>, sigillala e leggi il codice a barre. Il codice va inserito due volte: con il lettore basta una seconda scansione.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Codice busta">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="mono" autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase().trim())} placeholder="Scansiona o digita" style={{ fontSize: 18 }} />
              <ScanButton onCode={(c) => setCode(c.toUpperCase())} />
            </div>
          </Field>
          <Field label="Conferma codice busta">
            <input className="mono" value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase().trim())} onPaste={(e) => e.preventDefault()} placeholder="Seconda lettura" style={{ fontSize: 18 }} />
          </Field>
          {code && confirm && code !== confirm && <div className="small red">I due codici non coincidono</div>}
        </div>
      </> : <div className="alert info">Nessun contante da versare oltre il fondo cassa: il rendiconto si chiude senza busta.</div>}
    </Modal>
  );
}

function PickupModal({ id, needsEnvelope, onClose, onDone }) {
  const [name, setName] = useState('');
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [at, setAt] = useState(now);
  const [err, setErr] = useState(null);
  const go = async () => {
    setErr(null);
    try { await api.post(`/reports/${id}/pickup`, { operator_name: name, picked_at: new Date(at).toISOString() }); onDone(); } catch (e) { setErr(e); }
  };
  return (
    <Modal title="Ritiro busta da parte della logistica" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annulla</button>
      <button className="btn" disabled={name.trim().length < 3} onClick={go}>Registra ritiro</button>
    </>}>
      <ErrorBox error={err} />
      {!needsEnvelope && <div className="alert info" style={{ marginBottom: 12 }}>Nessuna busta: registra comunque il passaggio per chiudere il flusso.</div>}
      <div className="form-grid">
        <Field label="Nome e cognome operatore logistica"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Mario Rossi (Mondialpol)" /></Field>
        <Field label="Data e ora ritiro"><input type="datetime-local" value={at} max={now} onChange={(e) => setAt(e.target.value)} /></Field>
      </div>
      <p className="small muted">L'operatore firma il modulo Catena di custodia insieme a chi consegna la busta. Il modulo firmato resta in sede.</p>
    </Modal>
  );
}

function DepositModal({ rep, onClose, onDone }) {
  const [amount, setAmount] = useState(rep.cash_to_deposit);
  const [date, setDate] = useState(today());
  const [err, setErr] = useState(null);
  const diff = r2(Number(amount || 0) - Number(rep.cash_to_deposit));
  const go = async () => {
    setErr(null);
    try { await api.post(`/reports/${rep.id}/deposit`, { amount: Number(amount), date }); onDone(diff); } catch (e) { setErr(e); }
  };
  return (
    <Modal title="Conferma accredito in banca" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annulla</button>
      <button className="btn" disabled={amount === ''} onClick={go}>Conferma</button>
    </>}>
      <ErrorBox error={err} />
      <p>Busta <span className="mono strong">{rep.envelope_code || '–'}</span>, importo in distinta <b>{eur(rep.cash_to_deposit)}</b>.</p>
      <div className="form-grid">
        <Field label="Importo accreditato"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Data accredito"><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {diff !== 0 && <div className="alert warn" style={{ marginTop: 12 }}>Differenza di {eur(diff)}: alla conferma si apre in automatico un errore da gestire con la sede.</div>}
    </Modal>
  );
}

export function NcCreateModal({ report, siteId, onClose, onDone }) {
  const [f, setF] = useState({ kind: 'ERRORE', severity: 'MEDIA', title: '', description: '', due_date: '' });
  const [err, setErr] = useState(null);
  const go = async () => {
    setErr(null);
    try {
      const r = await api.post('/nc', { ...f, due_date: f.due_date || null, report_id: report?.id || null, site_id: report ? undefined : siteId ? Number(siteId) : null });
      onDone(r.id);
    } catch (e) { setErr(e); }
  };
  return (
    <Modal title={report ? `Segnalazione su ${report.site_name} del ${itDate(report.report_date)}` : 'Nuova segnalazione'} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annulla</button>
      <button className="btn" disabled={f.title.length < 4 || f.description.length < 5} onClick={go}>Apri segnalazione</button>
    </>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Tipo"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="ERRORE">Errore</option><option value="NON_CONFORMITA">Non conformità</option></select></Field>
        <Field label="Gravità"><select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option>BASSA</option><option>MEDIA</option><option>ALTA</option></select></Field>
        <Field label="Risposta entro"><input type="date" value={f.due_date} min={today()} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <Field label="Oggetto"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="es. Scontrino POS non registrato" autoFocus /></Field>
        <Field label="Descrizione"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Cosa è successo, cosa si chiede alla sede" /></Field>
      </div>
    </Modal>
  );
}
