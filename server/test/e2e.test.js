// Test end-to-end delle API (richiede server avviato su BASE e database vuoto o di test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticator } from 'otplib';

const BASE = process.env.BASE || 'http://localhost:3000';
const SUPER = { email: 'francesco.epifani@toscanadiagnostica.it', password: process.env.SUPER_PWD || 'Prova-Sicura-2026' };
const NEWPWD = 'NuovaPassword-2026';

function client() {
  let cookie = '';
  const call = async (method, url, body, raw = false) => {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + url, {
      method, redirect: 'manual',
      headers: { 'X-Requested-With': 'td-cash', ...(cookie ? { cookie } : {}), ...(body && !isForm ? { 'content-type': 'application/json' } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = txt; }
    return { status: res.status, data };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), raw: (u) => call('GET', u, null, true) };
}

const S = client(); const A = client(); const O = client(); const O2 = client();
const ctx = {};

async function loginWithOnboarding(c, email, password, newPwd, needTotp) {
  let r = await c.post('/api/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (r.data.totpRequired) {
    r = await c.post('/api/auth/totp', { code: authenticator.generate(ctx.secrets[email]) });
    assert.equal(r.status, 200);
  }
  if (r.data.onboarding === 'PASSWORD_CHANGE_REQUIRED') {
    const blocked = await c.get('/api/sites');
    assert.equal(blocked.status, 403);
    r = await c.post('/api/auth/change-password', { currentPassword: password, newPassword: newPwd });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const me = await c.get('/api/auth/me');
  if (needTotp && me.data.onboarding === 'TOTP_SETUP_REQUIRED') {
    const s = await c.post('/api/auth/totp/setup');
    ctx.secrets[email] = s.data.secret;
    r = await c.post('/api/auth/totp/enable', { code: authenticator.generate(s.data.secret) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  return (await c.get('/api/auth/me')).data;
}

test('flusso completo', async (t) => {
  ctx.secrets = {};
  await t.test('CSRF: POST senza header rifiutata', async () => {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
  });
  await t.test('login errato', async () => {
    const r = await S.post('/api/auth/login', { email: SUPER.email, password: 'sbagliata' });
    assert.equal(r.status, 401);
  });
  await t.test('super amministratore: cambio password e 2FA obbligatori', async () => {
    const me = await loginWithOnboarding(S, SUPER.email, SUPER.password, NEWPWD, true);
    assert.equal(me.user.role, 'SUPERADMIN');
    assert.equal(me.onboarding, null);
  });
  await t.test('crea azienda affiliata, sedi, utenti', async () => {
    let r = await S.post('/api/companies', { code: 'BIOSC', name: 'Bio Scienze S.r.l.', vat_number: '01234567890', city: 'Borgo San Lorenzo',
      email: 'info@bioscienze.it', iban: 'IT60X0542811101000000123456', sepa_mandate_id: 'TD-BIOSC-001', sepa_mandate_date: '2026-09-01' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    ctx.company = r.data.id;
    r = await S.post('/api/sites', { company_id: ctx.company, code: 'BSL01', name: 'Borgo San Lorenzo centro', city: 'Borgo San Lorenzo', cash_float: 150, pos_terminals: 'T100,T101' });
    assert.equal(r.status, 201); ctx.site = r.data.id;
    r = await S.post('/api/sites', { company_id: ctx.company, code: 'BSL02', name: 'Punto prelievo Vicchio', cash_float: 100 });
    ctx.site2 = r.data.id;
    r = await S.post('/api/users', { email: 'admin@bioscienze.it', full_name: 'Maria Rossi', role: 'ADMIN', company_id: ctx.company, auth_provider: 'LOCAL' });
    assert.equal(r.status, 201); ctx.adminPwd = r.data.temporaryPassword;
    r = await S.post('/api/users', { email: 'op@bioscienze.it', full_name: 'Luca Bianchi', role: 'OPERATOR', company_id: ctx.company, auth_provider: 'LOCAL', site_ids: [ctx.site] });
    assert.equal(r.status, 201); ctx.opPwd = r.data.temporaryPassword;
    r = await S.post('/api/users', { email: 'op2@bioscienze.it', full_name: 'Anna Verdi', role: 'OPERATOR', company_id: ctx.company, auth_provider: 'LOCAL', site_ids: [ctx.site2] });
    ctx.op2Pwd = r.data.temporaryPassword;
  });
  await t.test('admin e operatori accedono', async () => {
    const a = await loginWithOnboarding(A, 'admin@bioscienze.it', ctx.adminPwd, NEWPWD, true);
    assert.equal(a.user.role, 'ADMIN');
    const o = await loginWithOnboarding(O, 'op@bioscienze.it', ctx.opPwd, NEWPWD, false);
    assert.equal(o.onboarding, null);
    await loginWithOnboarding(O2, 'op2@bioscienze.it', ctx.op2Pwd, NEWPWD, false);
  });
  await t.test("l'operatore non può creare sedi, utenti o cambiare il fondo cassa", async () => {
    assert.equal((await O.post('/api/sites', { company_id: ctx.company, code: 'X1', name: 'X', cash_float: 1 })).status, 403);
    assert.equal((await O.post('/api/users', {})).status, 403);
    assert.equal((await O.put(`/api/sites/${ctx.site}`, { cash_float: 10, float_reason: 'x' })).status, 403);
    const sites = await O.get('/api/sites');
    assert.deepEqual(sites.data.map((s) => s.id), [ctx.site]);
  });
  await t.test('rendiconto: bozza, conteggio, POS, bonifici', async () => {
    let r = await O.post('/api/reports', { site_id: ctx.site, report_date: '2026-09-22' });
    assert.equal(r.status, 201); ctx.rep = r.data.id;
    assert.equal((await O2.get(`/api/reports/${ctx.rep}`)).status, 403, "un operatore di un'altra sede non vede il rendiconto");
    r = await O.put(`/api/reports/${ctx.rep}`, {
      denominations: { 50: 4, 20: 10, 10: 5, 5: 6 }, coins_total: 12.4, expected_total: 1052.4, notes: 'Giornata regolare',
      receipts: [{ circuit: 'BANCOMAT', amount: 120, terminal_id: 'T100', receipt_number: '0012' }, { circuit: 'CARTA_CREDITO', amount: 250.5, terminal_id: 'T100', receipt_number: '0013' }],
      transfers: [{ cro: 'CRO123456789', amount: 300, payer: 'Azienda Alfa' }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // contante: 200+200+50+30+12.4 = 492.4, fondo 150 -> 342.4
    assert.equal(r.data.cash_counted, 492.4);
    assert.equal(r.data.cash_to_deposit, 342.4);
    assert.equal(r.data.pos_total, 370.5);
    assert.equal(r.data.day_total, 1012.9);
    assert.equal(r.data.difference, -39.5);
  });
  await t.test('elaborazione bloccata senza busta; busta con doppio codice', async () => {
    assert.equal((await O.post(`/api/reports/${ctx.rep}/process`)).status, 400);
    assert.equal((await O.post(`/api/reports/${ctx.rep}/envelope`, { code: 'MP00012345', confirm: 'MP00012346' })).status, 400);
    const r = await O.post(`/api/reports/${ctx.rep}/envelope`, { code: 'MP00012345', confirm: 'mp00012345' });
    assert.equal(r.status, 200); assert.equal(r.data.status, 'CLOSED');
    assert.equal((await O.put(`/api/reports/${ctx.rep}`, {})).status, 400, 'non modificabile dopo la busta');
  });
  await t.test('distinta PDF', async () => {
    const r = await O.post(`/api/reports/${ctx.rep}/process`);
    assert.equal(r.status, 200); assert.equal(r.data.status, 'PROCESSED');
    assert.equal(r.data.slip_number, 'BIOSC-BSL01-20260922');
    const pdf = await O.raw(`/api/reports/${ctx.rep}/pdf`);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await pdf.arrayBuffer());
    assert.ok(buf.length > 10000);
    (await import('node:fs')).writeFileSync(process.env.PDF_OUT || '/tmp/distinta_test.pdf', buf);
  });
  await t.test('riapertura admin e rielaborazione (rev. 2)', async () => {
    assert.equal((await O.post(`/api/reports/${ctx.rep}/reopen`, { reason: 'Errore conteggio' })).status, 403);
    let r = await A.post(`/api/reports/${ctx.rep}/reopen`, { reason: 'Correzione banconote da 5' });
    assert.equal(r.data.status, 'DRAFT');
    await O.post(`/api/reports/${ctx.rep}/envelope`, { code: 'MP00012399', confirm: 'MP00012399' });
    r = await O.post(`/api/reports/${ctx.rep}/process`);
    assert.equal(r.data.slip_revision, 2);
  });
  await t.test('ritiro logistica e accredito con differenza -> NC automatica', async () => {
    let r = await O.post(`/api/reports/${ctx.rep}/pickup`, { operator_name: 'Giorgio Neri (Mondialpol)' });
    assert.equal(r.data.status, 'PICKED_UP');
    assert.equal((await O.post(`/api/reports/${ctx.rep}/deposit`, { amount: 342.4, date: '2026-09-23' })).status, 403);
    r = await A.post(`/api/reports/${ctx.rep}/deposit`, { amount: 332.4, date: '2026-09-23' });
    assert.equal(r.data.status, 'DEPOSITED');
    assert.equal(r.data.nonconformities.length, 1);
    ctx.nc = r.data.nonconformities[0].id;
  });
  await t.test('non conformità: risposta operatore, chiusura admin', async () => {
    let r = await O.post(`/api/nc/${ctx.nc}/messages`, { body: 'Verificato: banconota da 10 rimasta nel cassetto, reintegrata oggi.' });
    assert.equal(r.status, 201);
    r = await O.get(`/api/nc/${ctx.nc}`);
    assert.equal(r.data.status, 'RISPOSTA');
    assert.equal((await O.post(`/api/nc/${ctx.nc}/close`, { body: 'ok' })).status, 403);
    assert.equal((await A.post(`/api/nc/${ctx.nc}/close`, { body: 'Risposta accettata' })).status, 200);
    assert.equal((await O2.get(`/api/nc/${ctx.nc}`)).status, 403);
  });
  await t.test('CRO duplicato rifiutato', async () => {
    const r = await O.post('/api/reports', { site_id: ctx.site, report_date: '2026-09-23' });
    const u = await O.put(`/api/reports/${r.data.id}`, { transfers: [{ cro: 'cro123456789', amount: 10 }] });
    assert.equal(u.status, 400);
  });
  await t.test('fondo cassa: variazione con motivazione tracciata', async () => {
    assert.equal((await A.put(`/api/sites/${ctx.site}`, { cash_float: 200 })).status, 400);
    assert.equal((await A.put(`/api/sites/${ctx.site}`, { cash_float: 200, float_reason: 'Aumento per periodo check-up' })).status, 200);
    const h = await A.get(`/api/sites/${ctx.site}/float-history`);
    assert.equal(h.data.length, 2);
  });
  await t.test('statistiche e dashboard', async () => {
    const r = await A.get('/api/stats/summary?from=2026-09-01&to=2026-09-24');
    assert.equal(r.status, 200);
    assert.ok(r.data.totals.total > 0);
    assert.ok(Array.isArray(r.data.missing));
    const csv = await A.raw('/api/stats/export.csv?from=2026-09-01&to=2026-09-24');
    assert.match(await csv.text(), /BSL01/);
  });
  await t.test('import transazioni POS e riconciliazione', async () => {
    const fd = new FormData();
    fd.append('company_id', String(ctx.company));
    fd.append('file', new Blob(['data;importo;circuito;terminale;riferimento\n22/09/2026;120,00;Bancomat;T100;TX1\n22/09/2026;250,50;VISA;T100;TX2\n22/09/2026;99,00;VISA;T100;TX3\n'], { type: 'text/csv' }), 'pos.csv');
    const r = await A.post('/api/imports/transactions', fd);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.matched, 2);
  });
  await t.test('royalty a scaglioni e SEPA', async () => {
    // rendiconto di agosto per avere un periodo chiuso
    let r = await O.post('/api/reports', { site_id: ctx.site, report_date: '2026-08-10' });
    const id = r.data.id;
    await O.put(`/api/reports/${id}`, { denominations: { 100: 20 }, receipts: [{ circuit: 'BANCOMAT', amount: 60000 }] });
    await O.post(`/api/reports/${id}/envelope`, { code: 'MP00077777', confirm: 'MP00077777' });
    r = await S.post('/api/royalty/contracts', { company_id: ctx.company, valid_from: '2026-01-01', revenue_base: 'LORDO', marketing_fee_pct: 1,
      tier_mode: 'MARGINALE', tier_basis: 'MENSILE', tiers: [{ from: 0, rate: 6 }, { from: 50000, rate: 4 }], invoice_vat_rate: 22 });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    r = await A.post('/api/royalty/preview', { company_id: ctx.company, period: '2026-08' });
    // fondo cassa 200: base 2000-200+60000 = 61800 -> 50000*6% + 11800*4% = 3000 + 472 = 3472; mkt 618; iva 22% su 4090 = 899.8 -> 4989.8
    assert.equal(r.data.royalty_amount, 3472);
    assert.equal(r.data.total_due, 4989.8);
    r = await S.post('/api/royalty/statements', { period: '2026-08' });
    assert.equal(r.data[0].total_due, 4989.8, JSON.stringify(r.data));
    const sts = await A.get('/api/royalty/statements');
    assert.equal(sts.data.length, 1);
    ctx.st = sts.data[0].id;
    assert.equal((await S.post('/api/royalty/sepa/batches', { statement_ids: [ctx.st], collection_date: '2026-10-05' })).status, 400, 'senza dati creditore');
    await S.put('/api/settings', { creditor_name: 'Toscana Diagnostica S.r.l.', creditor_iban: 'IT60X0542811101000000123456', creditor_id: 'IT98ZZZ0000007528130482' });
    r = await S.post('/api/royalty/sepa/batches', { statement_ids: [ctx.st], collection_date: '2026-10-05' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const xml = await (await S.raw(`/api/royalty/sepa/batches/${r.data.id}/xml`)).text();
    assert.match(xml, /<SeqTp>FRST<\/SeqTp>/);
    assert.match(xml, /<InstdAmt Ccy="EUR">4989.80<\/InstdAmt>/);
    (await import('node:fs')).writeFileSync('/tmp/sepa_test.xml', xml);
    const pdf = await A.raw(`/api/royalty/statements/${ctx.st}/pdf`);
    assert.equal(pdf.status, 200);
    (await import('node:fs')).writeFileSync('/tmp/estratto_test.pdf', Buffer.from(await pdf.arrayBuffer()));
    assert.equal((await O.get('/api/royalty/statements')).data.length, 0, 'operatore non vede gli estratti');
  });
  await t.test('royalty di sede: quota fissa + % + IVA, report PDF', async () => {
    // sede BSL01: fondo 200. Agosto: rendiconto 10/08 con contanti 2000-200=1800 e POS 60000 -> totale 61800
    let r = await A.put(`/api/sites/${ctx.site}`, { host_name: 'Farmacia Comunale 3', royalty_fixed_monthly: 300, royalty_pct: 2.5, royalty_base: 'TOTALE', royalty_vat_rate: 22 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await O.get(`/api/canoni/sites/${ctx.site}?period=2026-08`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // variabile 2.5% di 61800 = 1545; imponibile 1845; iva 405.9; totale 2250.9
    assert.equal(r.data.base, 61800);
    assert.equal(r.data.variable, 1545);
    assert.equal(r.data.taxable, 1845);
    assert.equal(r.data.total, 2250.9);
    r = await O2.get(`/api/canoni/sites/${ctx.site}?period=2026-08`);
    assert.equal(r.status, 403, 'operatore di altra sede non vede il canone');
    r = await A.get('/api/canoni/summary?period=2026-08');
    assert.equal(r.data.totals.total, 2250.9);
    const pdf = await A.raw(`/api/canoni/sites/${ctx.site}/pdf?period=2026-08`);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    (await import('node:fs')).writeFileSync('/tmp/canone_test.pdf', Buffer.from(await pdf.arrayBuffer()));
    // solo contanti come base, senza IVA
    await A.put(`/api/sites/${ctx.site}`, { royalty_base: 'CONTANTI', royalty_vat_rate: 0 });
    r = await A.get(`/api/canoni/sites/${ctx.site}?period=2026-08`);
    assert.equal(r.data.base, 1800);
    assert.equal(r.data.total, 345);
  });
  await t.test('isolamento tra aziende', async () => {
    const r = await A.get('/api/companies');
    assert.equal(r.data.length, 1);
    assert.equal((await A.put('/api/companies/1', { name: 'hack' })).status, 403);
  });
});
