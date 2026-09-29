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
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), del: (u, b) => call('DELETE', u, b), raw: (u) => call('GET', u, null, true) };
}

const S = client(); const A = client(); const O = client(); const O2 = client(); const K = client(); const F = client();
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
    r = await S.post('/api/sites', { company_id: ctx.company, code: 'BSL01', name: 'Borgo San Lorenzo centro', city: 'Borgo San Lorenzo', province: 'fi', cash_float: 150, pos_terminals: 'T100,T101' });
    assert.equal(r.status, 400, 'data di avvio obbligatoria');
    r = await S.post('/api/sites', { company_id: ctx.company, code: 'BSL01', name: 'Borgo San Lorenzo centro', city: 'Borgo San Lorenzo', province: 'fi', cash_float: 150, pos_terminals: 'T100,T101', start_date: '2026-08-01' });
    assert.equal(r.status, 201, JSON.stringify(r.data)); ctx.site = r.data.id;
    r = await S.post('/api/sites', { company_id: ctx.company, code: 'BSL02', name: 'Punto prelievo Vicchio', cash_float: 100, start_date: '2026-09-01' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
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
      denominations: { 50: 4, 20: 10, 10: 5, 5: 6, 2: 5, 1: 2, '0.2': 2 }, expected_total: 1052.4, notes: 'Giornata regolare',
      receipts: [{ circuit: 'BANCOMAT', amount: 120, terminal_id: 'T100', receipt_number: '0012' }, { circuit: 'CARTA_CREDITO', amount: 250.5, terminal_id: 'T100', receipt_number: '0013' }],
      transfers: [{ cro: 'CRO123456789', amount: 300, payer: 'Azienda Alfa' }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // contante: 200+200+50+30 + monete 10+2+0.4 = 492.4, fondo 150 -> 342.4
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
  await t.test('operazione logistica (admin) e riconteggio con differenza -> NC automatica', async () => {
    assert.equal((await O.post(`/api/reports/${ctx.rep}/pickup`, { operator_name: 'Giorgio Neri (Mondialpol)' })).status, 403, 'operatore non registra la logistica');
    let r = await A.post(`/api/reports/${ctx.rep}/pickup`, { operator_name: 'Giorgio Neri (Mondialpol)' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.status, 'PICKED_UP');
    // annulla ultimo passaggio e rifai
    r = await A.post(`/api/reports/${ctx.rep}/undo`, { reason: 'Nome operatore errato' });
    assert.equal(r.data.status, 'PROCESSED');
    r = await A.post(`/api/reports/${ctx.rep}/pickup`, { operator_name: 'Giorgio Neri (Mondialpol)' });
    r = await A.post(`/api/reports/${ctx.rep}/verify`, { amount: 332.4, note: 'manca una banconota da 10' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, 'VERIFIED');
    assert.equal(r.data.verified_difference, -10);
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
    assert.equal((await O.get(`/api/canoni/sites/${ctx.site}?period=2026-08`)).status, 403, 'operatore non vede le royalty di sede');
    r = await A.get(`/api/canoni/sites/${ctx.site}?period=2026-08`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // variabile 2.5% di 61800 = 1545; imponibile 1845; iva 405.9; totale 2250.9
    assert.equal(r.data.base, 61800);
    assert.equal(r.data.variable, 1545);
    assert.equal(r.data.taxable, 1845);
    assert.equal(r.data.total, 2250.9);

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
  await t.test('catena di custodia e distinta a firma singola', async () => {
    const pdf = await O.raw(`/api/reports/${ctx.rep}/custody.pdf`);
    assert.equal(pdf.status, 200);
    const buf = Buffer.from(await pdf.arrayBuffer());
    assert.ok(buf.length > 5000);
    (await import('node:fs')).writeFileSync('/tmp/custodia_test.pdf', buf);
  });
  await t.test('cassaforte e versamento al portavalori (azienda)', async () => {
    // secondo rendiconto verificato sulla sede 2
    let r = await O2.post('/api/reports', { site_id: ctx.site2, report_date: '2026-09-20' });
    const id2 = r.data.id;
    await O2.put(`/api/reports/${id2}`, { denominations: { 50: 6 } }); // 300 - fondo 100 = 200
    await O2.post(`/api/reports/${id2}/envelope`, { code: 'MP00055555', confirm: 'MP00055555' });
    await O2.post(`/api/reports/${id2}/process`);
    await A.post(`/api/reports/${id2}/pickup`, { operator_name: 'Giorgio Neri' });
    await A.post(`/api/reports/${id2}/verify`, { amount: 200 });
    r = await A.get(`/api/deposits/safe?company_id=${ctx.company}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.reports.length, 2);
    assert.equal(r.data.total, 532.4);
    // versamento parziale: solo il secondo rendiconto, busta con importo non coincidente -> errore
    r = await A.post('/api/deposits', { company_id: ctx.company, report_ids: [id2], deposit_date: '2026-09-24', envelopes: [{ code: 'MPV0001', amount: 150 }] });
    assert.equal(r.status, 400);
    r = await A.post('/api/deposits', { company_id: ctx.company, report_ids: [id2], deposit_date: '2026-09-24', envelopes: [{ code: 'MPV0001', amount: 200 }] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    ctx.dep = r.data.id;
    assert.match(r.data.number, /^BIOSC-V2026-0001$/);
    assert.equal((await A.get(`/api/reports/${id2}`)).data.status, 'DEPOSITED');
    r = await A.get(`/api/deposits/safe?company_id=${ctx.company}`);
    assert.equal(r.data.total, 332.4, 'in cassaforte resta il primo');
    // busta già usata
    assert.equal((await A.post('/api/deposits', { company_id: ctx.company, report_ids: [ctx.rep], deposit_date: '2026-09-24', envelopes: [{ code: 'MPV0001' }] })).status, 400);
    // rendiconto versato non si elimina né si annulla
    assert.equal((await A.del(`/api/reports/${id2}`, { reason: 'prova eliminazione' })).status, 400);
    assert.equal((await A.post(`/api/reports/${id2}/undo`, { reason: 'prova annullo' })).status, 400);
    const pdf = await A.raw(`/api/deposits/${ctx.dep}/pdf`);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    (await import('node:fs')).writeFileSync('/tmp/versamento_test.pdf', Buffer.from(await pdf.arrayBuffer()));
    r = await A.post(`/api/deposits/${ctx.dep}/pickup`, { operator_name: 'Paolo Verdi (Mondialpol)' });
    assert.equal(r.data.status, 'RITIRATO');
    r = await A.post(`/api/deposits/${ctx.dep}/bank`, { amount: 200, date: '2026-09-24' });
    assert.equal(r.data.status, 'ACCREDITATO');
    assert.equal((await A.del(`/api/deposits/${ctx.dep}`, { reason: 'x' })).status, 400, 'senza motivazione no');
    r = await A.post(`/api/deposits/${ctx.dep}/undo`, { reason: 'Accredito registrato per errore' });
    assert.equal(r.data.status, 'RITIRATO');
    assert.equal((await O.get('/api/deposits')).status, 403, 'operatore non vede i versamenti');
    // eliminazione di un versamento accreditato: consentita agli amministratori con motivazione, i rendiconti tornano in cassaforte
    await A.post(`/api/deposits/${ctx.dep}/bank`, { amount: 200, date: '2026-09-24' });
    r = await A.del(`/api/deposits/${ctx.dep}`, { reason: 'Versamento registrato due volte' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await A.get(`/api/reports/${id2}`)).data.status, 'VERIFIED');
    r = await A.get(`/api/deposits/safe?company_id=${ctx.company}`);
    assert.equal(r.data.total, 532.4);
  });
  await t.test('PDF del gestionale: caricamento e lettura importi', async () => {
    const r0 = await O.post('/api/reports', { site_id: ctx.site, report_date: '2026-09-19' });
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument(); const chunks = []; doc.on('data', (c) => chunks.push(c));
    const done = new Promise((res) => doc.on('end', res));
    doc.text('CHIUSURA CASSA del 19/09/2026'); doc.text('Contanti 1.234,50'); doc.text('POS Bancomat 456,00'); doc.text('Bonifici 0,00'); doc.text('TOTALE INCASSI 1.690,50'); doc.end(); await done;
    const fd = new FormData(); fd.append('file', new Blob([Buffer.concat(chunks)], { type: 'application/pdf' }), 'chiusura.pdf');
    const r = await O.post(`/api/reports/${r0.data.id}/system-pdf`, fd);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.extracted.total, 1690.5);
    assert.equal(r.data.extracted.cash, 1234.5);
    assert.equal(r.data.report.has_system_pdf, true);
    assert.equal((await O.raw(`/api/reports/${r0.data.id}/system-pdf`)).status, 200);
    await O.del(`/api/reports/${r0.data.id}`);
  });
  await t.test('profilo Partner: solo statistiche e royalty confermate', async () => {
    let r = await S.post('/api/users', { email: 'farmacia@ospitante.it', full_name: 'Farmacia Comunale 3', role: 'PARTNER', company_id: ctx.company, auth_provider: 'LOCAL', site_ids: [ctx.site] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const Pc = client();
    await loginWithOnboarding(Pc, 'farmacia@ospitante.it', r.data.temporaryPassword, NEWPWD, false);
    assert.equal((await Pc.get('/api/reports')).status, 403);
    assert.equal((await Pc.get('/api/users')).status, 403);
    assert.equal((await Pc.post('/api/reports', { site_id: ctx.site, report_date: '2026-09-18' })).status, 403);
    r = await Pc.get('/api/stats/summary?from=2026-08-01&to=2026-08-31');
    assert.equal(r.status, 200);
    r = await Pc.get('/api/canoni/summary?period=2026-08');
    assert.equal(r.status, 200);
    assert.equal(r.data.rows[0].pending, true, 'non confermato: in attesa');
    assert.equal((await Pc.raw(`/api/canoni/sites/${ctx.site}/pdf?period=2026-08`)).status, 403);
    // operatore non vede le royalty di sede
    assert.equal((await O.get('/api/canoni/summary?period=2026-08')).status, 403);
    // conferma admin: mese corrente rifiutato, agosto ok
    assert.equal((await A.post(`/api/canoni/sites/${ctx.site}/confirm`, { period: '2026-09' })).status, 400);
    r = await A.post(`/api/canoni/sites/${ctx.site}/confirm`, { period: '2026-08' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal((await A.post(`/api/canoni/sites/${ctx.site}/confirm`, { period: '2026-08' })).status, 400, 'doppia conferma');
    r = await Pc.get('/api/canoni/summary?period=2026-08');
    assert.equal(r.data.rows[0].confirmed, true);
    assert.equal(r.data.rows[0].total, 345);
    assert.equal((await Pc.raw(`/api/canoni/sites/${ctx.site}/pdf?period=2026-08`)).status, 200);
    // cambio condizioni dopo conferma non altera il confermato
    await A.put(`/api/sites/${ctx.site}`, { royalty_pct: 10 });
    r = await A.get('/api/canoni/summary?period=2026-08');
    assert.equal(r.data.rows[0].total, 345);
    // annullo conferma
    r = await A.post(`/api/canoni/sites/${ctx.site}/unconfirm`, { period: '2026-08', reason: 'Correzione condizioni contrattuali' });
    assert.equal(r.status, 200);
    assert.equal((await Pc.get('/api/canoni/summary?period=2026-08')).data.rows[0].pending, true);
  });
  await t.test('eliminazione: operatore solo bozze proprie, amministratore tutto con motivazione', async () => {
    // rendiconto verificato: l'operatore non può, l'admin senza motivo no, con motivo sì
    assert.equal((await O.del(`/api/reports/${ctx.rep}`)).status, 400);
    assert.equal((await A.del(`/api/reports/${ctx.rep}`)).status, 400);
    const r = await A.del(`/api/reports/${ctx.rep}`, { reason: 'Rendiconto di prova da eliminare' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await A.get(`/api/reports/${ctx.rep}`)).status, 404);
    const audit = await A.get('/api/audit?action=REPORT_DELETE');
    assert.equal(audit.data[0].data.reason, 'Rendiconto di prova da eliminare');
    assert.ok(audit.data[0].data.snapshot.cash_counted != null, 'snapshot salvato');
    // la NC collegata sopravvive senza rendiconto
    assert.equal((await A.get(`/api/nc/${ctx.nc}`)).status, 200);
    // bozza di un altro operatore: O2 non può
    const b = await O.post('/api/reports', { site_id: ctx.site, report_date: '2026-09-21' });
    assert.equal((await O2.del(`/api/reports/${b.data.id}`)).status, 403);
    assert.equal((await O.del(`/api/reports/${b.data.id}`)).status, 200);
  });
  await t.test('fasi separate: cassiere (revisione), finance (cassaforte, versamento, accredito su conto)', async () => {
    // utenti con i nuovi ruoli
    let r = await A.post('/api/users', { email: 'cassiere@bioscienze.it', full_name: 'Carla Cassa', role: 'CASSIERE', auth_provider: 'LOCAL', site_ids: [ctx.site] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const kPwd = r.data.temporaryPassword;
    assert.equal((await A.post('/api/users', { email: 'c2@bioscienze.it', full_name: 'Senza Sede', role: 'CASSIERE', auth_provider: 'LOCAL', site_ids: [] })).status, 400, 'cassiere senza sedi rifiutato');
    r = await A.post('/api/users', { email: 'finance@bioscienze.it', full_name: 'Fabio Finanza', role: 'FINANCE', auth_provider: 'LOCAL' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const fPwd = r.data.temporaryPassword;
    await loginWithOnboarding(K, 'cassiere@bioscienze.it', kPwd, NEWPWD, false);
    await loginWithOnboarding(F, 'finance@bioscienze.it', fPwd, NEWPWD, false);
    // conti correnti dell'azienda (admin)
    r = await A.post(`/api/companies/${ctx.company}/bank-accounts`, { label: 'Conto operativo', bank_name: 'Banco Fiorentino', iban: 'IT60 X054 2811 1010 0000 0123 456', is_default: true });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    ctx.acc1 = r.data.id;
    assert.equal(r.data.iban, 'IT60X0542811101000000123456');
    r = await A.post(`/api/companies/${ctx.company}/bank-accounts`, { label: 'Conto incassi', iban: 'IT12A0300203280123456789012' });
    ctx.acc2 = r.data.id;
    assert.equal((await A.post(`/api/companies/${ctx.company}/bank-accounts`, { label: 'Duplicato', iban: 'IT60X0542811101000000123456' })).status, 400);
    assert.equal((await F.post(`/api/companies/${ctx.company}/bank-accounts`, { label: 'x', iban: 'IT12A0300203280123456789013' })).status, 403, 'finance non crea conti');
    r = await F.get(`/api/companies/${ctx.company}/bank-accounts`);
    assert.equal(r.data.length, 2, 'finance legge i conti');
    // nuovo rendiconto dell'operatore sulla sede 1
    r = await O.post('/api/reports', { site_id: ctx.site, report_date: '2026-09-22' });
    const rid = r.data.id;
    r = await O.put(`/api/reports/${rid}`, { denominations: { 100: 4 } }); // 400 - fondo 200
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await O.post(`/api/reports/${rid}/envelope`, { code: 'MP00088888', confirm: 'MP00088888' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await K.post(`/api/reports/${rid}/process`)).status, 403, 'il cassiere non elabora la distinta');
    assert.equal((await K.post('/api/reports', { site_id: ctx.site, report_date: '2026-09-23' })).status, 403, 'il cassiere non compila');
    r = await O.post(`/api/reports/${rid}/process`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // finance: sola lettura sui rendiconti
    assert.equal((await F.get(`/api/reports/${rid}`)).status, 200);
    assert.equal((await F.post(`/api/reports/${rid}/pickup`, { operator_name: 'x' })).status, 403);
    // cassiere: operazione logistica e riconteggio sulla propria sede; non sulla sede 2
    r = await K.post(`/api/reports/${rid}/pickup`, { operator_name: 'Giorgio Neri' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    r = await K.post(`/api/reports/${rid}/verify`, { amount: 200 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, 'VERIFIED');
    const other = await O2.post('/api/reports', { site_id: ctx.site2, report_date: '2026-09-22' });
    assert.equal((await K.get(`/api/reports/${other.data.id}`)).status, 403, 'cassiere non vede altre sedi');
    assert.equal((await K.get(`/api/deposits/safe?company_id=${ctx.company}`)).status, 403, 'cassiere non entra in cassaforte');
    // cassiere apre e chiude una segnalazione
    r = await K.post('/api/nc', { site_id: ctx.site, kind: 'ERRORE', severity: 'BASSA', title: 'Busta stropicciata', description: 'Sigillo integro, busta danneggiata' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal((await K.post(`/api/nc/${r.data.id}/close`, { body: 'Verificato' })).status, 200);
    // finance: cassaforte, versamento, ritiro, accredito su conto
    r = await F.get(`/api/deposits/safe?company_id=${ctx.company}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.reports.some((x) => x.id === rid));
    r = await F.post('/api/deposits', { company_id: ctx.company, report_ids: [rid], deposit_date: '2026-09-25', envelopes: [{ code: 'MPV0009', amount: 200 }] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const dep = r.data.id;
    assert.equal((await F.post(`/api/deposits/${dep}/bank`, { amount: 200, date: '2026-09-26', bank_account_id: ctx.acc1 })).status, 400, 'accredito prima del ritiro rifiutato');
    await F.post(`/api/deposits/${dep}/pickup`, { operator_name: 'Paolo Verdi' });
    assert.equal((await F.post(`/api/deposits/${dep}/bank`, { amount: 200, date: '2026-09-26' })).status, 400, 'conto obbligatorio se censito');
    r = await F.post(`/api/deposits/${dep}/bank`, { amount: 200, date: '2026-09-26', bank_account_id: ctx.acc2, reference: 'MOV 12345' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, 'ACCREDITATO');
    assert.equal(r.data.bank_account_label, 'Conto incassi');
    assert.equal(r.data.bank_reference, 'MOV 12345');
    r = await F.get(`/api/deposits?company_id=${ctx.company}&status=ACCREDITATO`);
    assert.ok(r.data.every((x) => x.status === 'ACCREDITATO'));
    assert.equal((await F.del(`/api/deposits/${dep}`, { reason: 'Prova eliminazione finance' })).status, 403, 'eliminazione riservata agli amministratori');
    assert.equal((await A.del(`/api/deposits/${dep}`, { reason: 'Prova eliminazione dopo accredito' })).status, 200);
    // finance non vede royalty né anagrafiche utenti
    assert.equal((await F.get('/api/canoni/summary?period=2026-08')).status, 403);
    assert.equal((await F.get('/api/users')).status, 403);
    // conto disattivato non selezionabile
    await A.put(`/api/companies/${ctx.company}/bank-accounts/${ctx.acc2}`, { active: false });
    r = await A.get(`/api/companies/${ctx.company}/bank-accounts`);
    assert.equal(r.data.find((x) => x.id === ctx.acc2).active, false);
    assert.equal(r.data.find((x) => x.id === ctx.acc1).is_default, true, 'il predefinito resta');
  });
  await t.test('comunicazioni: email di sede, controllo giornaliero, solleciti, registro', async () => {
    // email in anagrafica
    let r = await A.put(`/api/sites/${ctx.site}`, { site_email: 'bsl01@bioscienze.it', host_email: 'farmacia3@esempio.it' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const site = (await A.get('/api/sites')).data.find((x) => x.id === ctx.site);
    assert.equal(site.site_email, 'bsl01@bioscienze.it');
    assert.equal(site.host_email, 'farmacia3@esempio.it');
    // giorno di test: oggi (le sedi create oggi contano da oggi); scelgo un giorno operativo
    const iso = (d) => d.toISOString().slice(0, 10);
    let day = new Date(); if (day.getUTCDay() === 0) day = new Date(day.getTime() + 86400000);
    const D = iso(day);
    // prima della data di avvio: nessun rendiconto atteso, né accettato
    assert.equal((await O.post('/api/reports', { site_id: ctx.site, report_date: '2026-07-31' })).status, 400, 'rendiconto prima dell\'avvio rifiutato');
    r = await A.get('/api/comms/daily?date=2026-08-20');
    assert.equal(r.data.rows.find((x) => x.site_id === ctx.site2).operating, false, 'sede 2 non ancora avviata il 20/08');
    assert.equal(r.data.rows.find((x) => x.site_id === ctx.site).operating, true);
    r = await A.get(`/api/comms/daily?date=${D}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.summary.operating, 2);
    assert.equal(r.data.summary.missing, 2);
    assert.equal(r.data.mail.configured, false);
    assert.equal((await O.get(`/api/comms/daily?date=${D}`)).status, 403, 'operatore escluso');
    // sollecito a tutte le mancanti: BSL01 registrato (mail non configurata), BSL02 senza email
    r = await A.post('/api/comms/daily/alert', { date: D });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const s1 = r.data.find((x) => x.site === 'Borgo San Lorenzo centro');
    const s2 = r.data.find((x) => x.site === 'Punto prelievo Vicchio');
    assert.equal(s1.status, 'NON_CONFIGURATA');
    assert.equal(s2.status, 'FALLITA'); assert.match(s2.error, /non impostata/);
    // il sollecito si ripete solo finché non risulta inviato (qui email non configurata: registrato di nuovo)
    r = await A.post('/api/comms/daily/alert', { date: D, site_id: ctx.site });
    assert.equal(r.data[0].status, 'NON_CONFIGURATA');
    r = await A.get(`/api/comms/daily?date=${D}`);
    assert.equal(r.data.rows.find((x) => x.site_id === ctx.site).alert_status, 'NON_CONFIGURATA');
    // comunicazione libera
    r = await A.post('/api/comms/message', { site_id: ctx.site, subject: 'Chiusura anticipata', body: 'Domani la sede chiude alle 13.', to_host: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.status, 200);
    r = await A.post('/api/comms/message', { site_id: ctx.site2, subject: 'Prova', body: 'Nessuna email in anagrafica.' });
    assert.equal(r.status, 400);
    // registro
    r = await A.get('/api/comms/log');
    assert.ok(r.data.length >= 2);
    assert.ok(r.data.some((x) => x.kind === 'COMUNICAZIONE' && x.to_addr.includes('farmacia3@esempio.it')));
    // conferma royalty: invio al gestore ospitante registrato
    r = await A.post(`/api/canoni/sites/${ctx.site}/confirm`, { period: '2026-08' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.mail.status, 'NON_CONFIGURATA');
    r = await A.get('/api/comms/log?kind=ROYALTY');
    assert.equal(r.data[0].to_addr, 'farmacia3@esempio.it');
    assert.ok(r.data[0].attachment_name.endsWith('.pdf'));
    // controllo automatico forzato dal super amministratore
    r = await S.post('/api/comms/daily/run', {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // NC: apertura notifica la sede (registrata)
    r = await A.post('/api/nc', { site_id: ctx.site, kind: 'ERRORE', severity: 'BASSA', title: 'Prova notifica', description: 'Verifica invio email su apertura segnalazione' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    r = await A.get('/api/comms/log?kind=NC');
    assert.ok(r.data.length >= 1);
  });
  await t.test('sede di proprietà, eliminazione sede, import Excel di sedi e utenti', async () => {
    // sede di proprietà: nessuna royalty, esclusa dal riepilogo
    let r = await A.post('/api/sites', { company_id: ctx.company, code: 'PROP01', name: 'Sede propria Firenze', cash_float: 100, start_date: '2026-09-01', ownership: 'PROPRIA', royalty_pct: 5, host_name: 'ignorato' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const prop = r.data.id;
    let site = (await A.get('/api/sites')).data.find((x) => x.id === prop);
    assert.equal(site.ownership, 'PROPRIA'); assert.equal(Number(site.royalty_pct), 0); assert.equal(site.host_name, null);
    r = await A.get('/api/canoni/summary?period=2026-09');
    assert.ok(!r.data.rows.some((x) => x.site_id === prop), 'sede propria fuori dalle royalty');
    assert.equal((await A.post(`/api/canoni/sites/${prop}/confirm`, { period: '2026-08' })).status, 400);
    // eliminazione: senza rendiconti sì, con rendiconti no
    assert.equal((await A.del(`/api/sites/${prop}`, { reason: 'x' })).status, 400, 'motivazione obbligatoria');
    assert.equal((await O.del(`/api/sites/${prop}`, { reason: 'operatore non può' })).status, 403);
    r = await A.del(`/api/sites/${prop}`, { reason: 'Sede creata per errore' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(!(await A.get('/api/sites')).data.some((x) => x.id === prop));
    r = await A.del(`/api/sites/${ctx.site}`, { reason: 'Prova su sede con rendiconti' });
    assert.equal(r.status, 400); assert.match(r.data.error, /rendiconti/);
    // modello Excel sedi: scarico, compilo, importo
    const ExcelJS = (await import('exceljs')).default;
    let raw = await A.raw('/api/anagrafica/template/sites.xlsx');
    assert.equal(raw.status, 200);
    let wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await raw.arrayBuffer()));
    let ws = wb.worksheets[0];
    assert.equal(ws.getCell('A1').value, 'codice');
    const addObj = (w, o) => { const h = w.getRow(1).values.slice(1); w.addRow(h.map((k) => o[k] ?? null)); };
    ws.spliceRows(2, 1); // via la riga di esempio
    addObj(ws, { codice: 'XL01', nome: 'Sede da Excel', citta: 'Prato', provincia: 'po', email_sede: 'xl01@bioscienze.it', fondo_cassa: '200,00', data_avvio: '15/09/2026', giorni_operativi: '1111100', tipo: 'OSPITATA', struttura_ospitante: 'Farmacia Prato', quota_fissa_mensile: 100, percentuale: '1,5', base_percentuale: 'CONTANTI', iva: 22 });
    addObj(ws, { codice: 'BSL02', nome: 'Punto prelievo Vicchio rinominato', fondo_cassa: 100, data_avvio: '01/09/2026', tipo: 'PROPRIA' });
    addObj(ws, { codice: 'BAD', nome: 'Senza data', fondo_cassa: 'abc', tipo: 'X' });
    const fileOf = async (w) => { const fd = new FormData(); fd.append('file', new Blob([Buffer.from(await w.xlsx.writeBuffer())]), 'sedi.xlsx'); return fd; };
    r = await A.post('/api/anagrafica/sites?dry=1', await fileOf(wb));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ok, false);
    assert.equal(r.data.rows.length, 3);
    assert.equal(r.data.rows[0].action, 'CREA'); assert.equal(r.data.rows[1].action, 'AGGIORNA');
    assert.ok(r.data.rows[2].errors.length >= 2, JSON.stringify(r.data.rows[2]));
    // con errori non importa nemmeno senza dry
    r = await A.post('/api/anagrafica/sites', await fileOf(wb));
    assert.equal(r.data.dry, true);
    assert.ok(!(await A.get('/api/sites')).data.some((x) => x.code === 'XL01'), 'nulla scritto');
    ws.spliceRows(r.data.rows[2].row, 1);
    r = await A.post('/api/anagrafica/sites', await fileOf(wb));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ok, true); assert.equal(r.data.dry, false);
    const sites = (await A.get('/api/sites')).data;
    const xl = sites.find((x) => x.code === 'XL01');
    assert.equal(xl.province, 'PO'); assert.equal(Number(xl.cash_float), 200); assert.equal(xl.start_date, '2026-09-15'); assert.equal(Number(xl.royalty_pct), 1.5); assert.equal(xl.royalty_base, 'CONTANTI');
    const v = sites.find((x) => x.id === ctx.site2);
    assert.equal(v.name, 'Punto prelievo Vicchio rinominato'); assert.equal(v.ownership, 'PROPRIA');
    // modello Excel utenti
    raw = await A.raw('/api/anagrafica/template/users.xlsx');
    wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await raw.arrayBuffer()));
    ws = wb.worksheets[0]; ws.spliceRows(2, 1);
    addObj(ws, { email: 'Nuovo.Op@bioscienze.it', nome_cognome: 'Nuovo Operatore', ruolo: 'operator', accesso: 'PASSWORD', sedi: 'XL01, BSL02', attivo: 'SI' });
    addObj(ws, { email: 'op@bioscienze.it', nome_cognome: 'Luca Bianchi Aggiornato', ruolo: 'CASSIERE', accesso: 'ENTRAMBI', sedi: 'BSL01' });
    addObj(ws, { email: 'fin2@bioscienze.it', nome_cognome: 'Finance Due', ruolo: 'FINANCE', accesso: 'MICROSOFT' });
    r = await A.post('/api/anagrafica/users', await fileOf(wb));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ok, true);
    assert.equal(r.data.credentials.length, 1, 'password temporanea solo per il nuovo utente con password');
    assert.equal(r.data.credentials[0].email, 'nuovo.op@bioscienze.it');
    const users = (await A.get('/api/users')).data;
    const nu = users.find((u) => u.email === 'nuovo.op@bioscienze.it');
    assert.equal(nu.role, 'OPERATOR'); assert.equal(nu.site_ids.length, 2);
    const lb = users.find((u) => u.email === 'op@bioscienze.it');
    assert.equal(lb.role, 'CASSIERE'); assert.equal(lb.full_name, 'Luca Bianchi Aggiornato');
    assert.equal(users.find((u) => u.email === 'fin2@bioscienze.it').auth_provider, 'ENTRA');
    // riga con sede inesistente -> errore, nulla scritto
    addObj(ws, { email: 'x@bioscienze.it', nome_cognome: 'Sede Sbagliata', ruolo: 'OPERATOR', accesso: 'PASSWORD', sedi: 'NOPE' });
    r = await A.post('/api/anagrafica/users', await fileOf(wb));
    assert.equal(r.data.ok, false);
    assert.ok(!(await A.get('/api/users')).data.some((u) => u.email === 'x@bioscienze.it'));
    // ripristino ruolo operatore di Luca per i test successivi
    await A.put(`/api/users/${lb.id}`, { email: lb.email, full_name: 'Luca Bianchi', role: 'OPERATOR', company_id: ctx.company, auth_provider: 'LOCAL', site_ids: [ctx.site], active: true });
  });
  await t.test('isolamento tra aziende', async () => {
    const r = await A.get('/api/companies');
    assert.equal(r.data.length, 1);
    assert.equal((await A.put('/api/companies/1', { name: 'hack' })).status, 403);
  });
});
