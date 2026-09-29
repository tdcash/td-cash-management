import { many, one, q } from '../db.js';
import { sendMail, adminEmails } from './mailer.js';
import { getSetting, itDate, eur, todayRome } from './util.js';

// Sedi operative in una data senza rendiconto (per azienda o tutte)
export async function missingReports(date, companyId = null) {
  return many(`SELECT s.id AS site_id, s.name AS site_name, s.code AS site_code, s.site_email, s.company_id, c.name AS company_name
    FROM sites s JOIN companies c ON c.id=s.company_id
    WHERE s.active AND ($2::int IS NULL OR s.company_id=$2)
      AND substr(s.operating_days, extract(isodow FROM $1::date)::int, 1) = '1'
      AND s.start_date <= $1::date
      AND NOT EXISTS (SELECT 1 FROM cash_reports r WHERE r.site_id=s.id AND r.report_date=$1::date)
    ORDER BY c.name, s.name`, [date, companyId]);
}

// Sollecito alla sede per un giorno mancante (una sola volta per sede/giorno)
export async function sendMissingAlert(site, date, sentBy = null) {
  if (!site.site_email) return { status: 'FALLITA', error: 'Email di sede non impostata' };
  return sendMail({
    kind: 'SOLLECITO', refKey: `SOLLECITO:${site.site_id}:${date}`, to: site.site_email, companyId: site.company_id, siteId: site.site_id, sentBy,
    subject: `Rendiconto di cassa mancante · ${site.site_name} · ${itDate(date)}`,
    title: 'Rendiconto di cassa mancante',
    body: `Per la sede ${site.site_name} (${site.site_code}) non risulta inserito il rendiconto di cassa del ${itDate(date)}.\n\nVi chiediamo di compilarlo oggi stesso su Cash Management: conteggio del contante, scontrini POS, bonifici, busta Mondialpol e distinta.\n\nSe la sede è rimasta chiusa in quella data, segnalatelo all'amministratore di sede in risposta a questa email.`,
  });
}

// Controllo giornaliero automatico: gira una volta al giorno all'ora impostata (Europe/Rome)
export async function runDailyCheck({ force = false } = {}) {
  const enabled = (await getSetting('daily_alert_enabled', 'true')) === 'true';
  const hour = Number(await getSetting('daily_alert_hour', '10'));
  const today = todayRome();
  const nowHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date()));
  const last = await getSetting('daily_alert_last_run', '');
  if (!force && (!enabled || nowHour < hour || last === today)) return null;
  const date = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10); // ieri
  const missing = await missingReports(date);
  const results = [];
  for (const m of missing) results.push({ site: m.site_name, ...(await sendMissingAlert(m, date)) });
  // riepilogo agli amministratori di ciascuna azienda
  if ((await getSetting('daily_summary_admins', 'true')) === 'true') {
    const byCompany = new Map();
    for (const m of missing) byCompany.set(m.company_id, [...(byCompany.get(m.company_id) || []), m]);
    const companies = await many('SELECT id, name FROM companies WHERE active');
    for (const c of companies) {
      const list = byCompany.get(c.id) || [];
      const admins = await adminEmails(c.id);
      if (!admins.length) continue;
      await sendMail({
        kind: 'RIEPILOGO', refKey: `RIEPILOGO:${c.id}:${date}`, to: admins, companyId: c.id,
        subject: `Controllo rendiconti del ${itDate(date)} · ${c.name}: ${list.length ? `${list.length} sedi mancanti` : 'tutto regolare'}`,
        title: `Controllo giornaliero rendiconti · ${itDate(date)}`,
        body: list.length
          ? `Sedi senza rendiconto del ${itDate(date)}:\n${list.map((m) => `• ${m.site_name} (${m.site_code})${m.site_email ? ', sollecito inviato a ' + m.site_email : ', nessuna email di sede impostata'}`).join('\n')}\n\nApri la pagina Controllo giornaliero per i dettagli e per inviare solleciti manuali.`
          : `Tutte le sedi operative hanno inserito il rendiconto del ${itDate(date)}.`,
      });
    }
  }
  await q("INSERT INTO app_settings (key, value) VALUES ('daily_alert_last_run', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [today]);
  return { date, missing: missing.length, results };
}

export function startScheduler() {
  const tick = () => runDailyCheck().then((r) => r && console.log(`[alert] controllo giornaliero ${r.date}: ${r.missing} sedi mancanti`)).catch((e) => console.error('[alert]', e.message));
  setTimeout(tick, 15_000);
  setInterval(tick, 5 * 60 * 1000);
}

// Notifiche su non conformità
export async function notifyNcOpened(nc, site, creatorName) {
  if (!site?.site_email) return;
  return sendMail({ kind: 'NC', refKey: `NC:${nc.id}:aperta`, to: site.site_email, companyId: nc.company_id, siteId: site.id,
    subject: `${nc.kind === 'ERRORE' ? 'Errore' : 'Non conformità'} #${nc.id} · ${site.name}: ${nc.title}`,
    title: `${nc.kind === 'ERRORE' ? 'Errore' : 'Non conformità'} #${nc.id} aperta da ${creatorName}`,
    body: `${nc.description}\n\nGravità: ${nc.severity.toLowerCase()}.${nc.due_date ? ` Risposta attesa entro il ${itDate(nc.due_date)}.` : ''}\n\nRispondete dalla sezione Errori e NC di Cash Management.` });
}
export async function notifyNcReply(nc, site, replierName, body, toEmail) {
  if (!toEmail) return;
  return sendMail({ kind: 'NC_RISPOSTA', to: toEmail, companyId: nc.company_id, siteId: site?.id || null,
    subject: `Risposta a #${nc.id} · ${site?.name || ''}: ${nc.title}`,
    title: `Risposta di ${replierName} alla segnalazione #${nc.id}`,
    body: `${body}\n\nValuta la risposta e chiudi la segnalazione dalla sezione Errori e NC.` });
}

// Report royalty confermato: invio automatico alla struttura ospitante
export async function notifyRoyaltyConfirmed({ site, period, statement, pdf, confirmedBy }) {
  if (!site.host_email) return { status: 'FALLITA', error: 'Email della struttura ospitante non impostata' };
  const [y, m] = period.split('-');
  const label = `${['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'][Number(m) - 1]} ${y}`;
  return sendMail({ kind: 'ROYALTY', refKey: `ROYALTY:${site.id}:${period}:${statement.id}`, to: site.host_email, companyId: site.company_id, siteId: site.id,
    subject: `Report royalty ${label} · ${site.name}`,
    title: `Report royalty di ${label} confermato`,
    body: `Gentile ${site.host_name || 'struttura ospitante'},\n\nl'amministratore di sede (${confirmedBy}) ha confermato il report royalty di ${label} per la sede ${site.name}.\n\nImponibile ${eur(statement.taxable)}, IVA ${eur(statement.vat)}, totale ${eur(statement.total)}.\n\nIl report in allegato riporta il dettaglio del calcolo: su questi valori potete emettere la fattura.`,
    attachment: { filename: `Royalty_${site.code}_${period}.pdf`, content: pdf } });
}
