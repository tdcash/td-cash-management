// Client API: sessione via cookie httpOnly, header anti-CSRF su ogni richiesta
export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

async function request(method, url, body) {
  const isForm = body instanceof FormData;
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
