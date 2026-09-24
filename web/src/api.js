// Client API: sessione via cookie httpOnly, header anti-CSRF su ogni richiesta
export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

// Indicatore globale di attività: ogni richiesta in corso accende la barra e blocca i doppi clic
let pending = 0;
const setBusy = (delta) => {
  pending = Math.max(0, pending + delta);
  document.documentElement.classList.toggle('is-busy', pending > 0);
  window.dispatchEvent(new CustomEvent('td:busy', { detail: pending }));
};

async function request(method, url, body) {
  const isForm = body instanceof FormData;
  setBusy(1);
  try {
    return await doRequest(method, url, body, isForm);
  } finally {
    setBusy(-1);
  }
}

async function doRequest(method, url, body, isForm) {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'td-cash', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || `Errore ${res.status}`, data?.code);
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('td:unauthorized'));
    if (err.code === 'PASSWORD_CHANGE_REQUIRED' || err.code === 'TOTP_SETUP_REQUIRED') window.dispatchEvent(new Event('td:onboarding'));
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b || {}),
  put: (u, b) => request('PUT', u, b),
  del: (u, b) => request('DELETE', u, b),
  upload: (u, formData) => request('POST', u, formData),
};

export const qs = (o) => {
  const p = Object.entries(o).filter(([, v]) => v !== '' && v != null);
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};
