import React, { useEffect, useRef, useState } from 'react';
import { Modal, Icon } from './ui.jsx';

// Lettura codice a barre con fotocamera (BarcodeDetector: Chrome/Edge Android e desktop recenti).
// Con un lettore USB/Bluetooth il codice si digita direttamente nel campo.
export const scanSupported = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;

export function ScanButton({ onCode }) {
  const [open, setOpen] = useState(false);
  if (!scanSupported()) return null;
  return <>
    <button type="button" className="btn ghost" onClick={() => setOpen(true)}><Icon name="scan" size={17} />Scansiona</button>
    {open && <Scanner onClose={() => setOpen(false)} onCode={(c) => { onCode(c); setOpen(false); }} />}
  </>;
}

function Scanner({ onClose, onCode }) {
  const video = useRef(null);
  const [err, setErr] = useState(null);
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    let stream; let stop = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream;
        await video.current.play();
        const det = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code'] });
        const loop = async () => {
          if (stop) return;
          try {
            const codes = await det.detect(video.current);
            if (codes[0]?.rawValue) { cb.current(codes[0].rawValue); return; }
          } catch { /* frame non pronto */ }
          requestAnimationFrame(loop);
        };
        loop();
      } catch (e) { setErr(e.message); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <Modal title="Inquadra il codice a barre della busta" onClose={onClose}>
      {err ? <div className="alert err">Fotocamera non disponibile: {err}</div> : <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 10, background: '#000' }} />}
    </Modal>
  );
}
