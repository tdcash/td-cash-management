import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api.js';
import { STATUS } from '../format.js';

// ---------- Toast ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Indicatore di attività ----------
export function BusyBar() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = (e) => setN(e.detail);
    window.addEventListener('td:busy', h);
    return () => window.removeEventListener('td:busy', h);
  }, []);
  return <div className={`busybar ${n > 0 ? 'on' : ''}`} role="progressbar" aria-hidden={n === 0}><i /></div>;
}

// ---------- Data loading ----------
export function useApi(url, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!url) return setState({ data: null, error: null, loading: false });
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await api.get(url), error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export function Loading({ text = 'Caricamento…' }) { return <div className="empty">{text}</div>; }
export function ErrorBox({ error }) { return error ? <div className="alert err">{error.message || String(error)}</div> : null; }
export function Empty({ children }) { return <div className="empty">{children}</div>; }

// ---------- Primitives ----------
export function Badge({ tone = 'grey', children }) { return <span className={`badge b-${tone}`}>{children}</span>; }
export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: 'grey' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
export function Field({ label, help, children, className = '' }) {
  return (
    <label className={`f ${className}`}>
      {label}
      {children}
      {help && <span className="help">{help}</span>}
    </label>
  );
}
export function Card({ title, actions, children, flush, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && <div className="hd"><h2>{title}</h2><div className="spacer" />{actions}</div>}
      <div className={`bd ${flush ? 'flush' : ''}`}>{children}</div>
    </div>
  );
}
export function Kpi({ label, value, foot, accent, bar }) {
  return (
    <div className={`card kpi ${accent ? 'accent' : ''}`}>
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      {foot && <div className="foot">{foot}</div>}
      {bar != null && <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, bar))}%` }} /></div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="mh"><h2>{title}</h2><div className="spacer" /><button className="iconbtn" onClick={onClose} aria-label="Chiudi">✕</button></div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>
  );
}

// Modale con campo di testo obbligatorio (motivazioni, risposte)
export function PromptModal({ title, label, placeholder, confirmText = 'Conferma', onConfirm, onClose, minLength = 3, danger }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await onConfirm(v.trim()); onClose(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annulla</button>
      <button className={`btn ${danger ? 'danger' : ''}`} disabled={busy || v.trim().length < minLength} onClick={go}>{confirmText}</button>
    </>}>
      <ErrorBox error={err} />
      <Field label={label}><textarea autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} /></Field>
    </Modal>
  );
}

export function MoneyInput({ value, onChange, disabled, ...rest }) {
  // mostra il valore in formato italiano, accetta virgola o punto
  const [txt, setTxt] = useState(value == null || value === '' ? '' : String(value).replace('.', ','));
  useEffect(() => {
    const cur = Number(String(txt).replace(/\./g, '').replace(',', '.'));
    if (value !== '' && value != null && Number(value) !== cur) setTxt(String(value).replace('.', ','));
    if ((value === '' || value == null) && txt !== '') setTxt('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input className="money" inputMode="decimal" disabled={disabled} value={txt} {...rest}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,-]/g, '');
        setTxt(t);
        if (t === '') return onChange('');
        const n = Number(t.replace(/\./g, '').replace(',', '.'));
        if (Number.isFinite(n)) onChange(Math.round(n * 100) / 100);
      }} />
  );
}

// ---------- Icone (tratto 1.8, 24px) ----------
const P = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10',
  cash: 'M3 7h18v10H3zM7 12h.01M17 12h.01M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  plus: 'M12 5v14M5 12h14',
  alert: 'M12 4 2.5 20h19L12 4zM12 10v4.5M12 17.2v.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  percent: 'M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  building: 'M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20',
  pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  shield: 'M12 3 4 6v6c0 5 3.5 8.3 8 9 4.5-.7 8-4 8-9V6l-8-3z',
  user: 'M20 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-7A4.5 4.5 0 0 0 4 19.5V21M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M4 12.5l5 5L20 6.5',
  upload: 'M12 16V5M7 10l5-5 5 5M4 20h16',
  truck: 'M2 7h11v9H2zM13 10h4l3 3v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bank: 'M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 18h18M2 21h20',
};
export function Icon({ name, size }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={size ? { width: size, height: size } : undefined} aria-hidden="true">
      <path d={P[name] || ''} />
    </svg>
  );
}
