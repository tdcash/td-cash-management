# Toscana Diagnostica · Cash Management

Webapp per la rendicontazione giornaliera degli incassi, il controllo del flusso contante fino alla banca, il calcolo delle royalty e gli addebiti SEPA della rete. Destinata a cash.toscanadiagnostica.it.

## Cosa fa

Ciclo del rendiconto (v4): l'operatore di sede conta il contante per taglio (banconote e monete), registra POS e bonifici, carica il PDF di chiusura cassa del gestionale (importi letti in automatico e confermati), registra la busta Mondialpol e stampa la distinta a sua firma. L'amministratore di sede registra l'Operazione logistica (riceve la busta dalla logistica e la mette in cassaforte, con nome dell'operatore), poi il Riconteggio e verifica, che chiude il ciclo: le differenze aprono in automatico una segnalazione. Il modulo Catena di custodia accompagna la busta fino all'Area Finance. Il contante verificato è versabile al portavalori a livello azienda, anche in parte: il versamento raccoglie N rendiconti verificati, ha le sue buste Mondialpol, distinta e catena di custodia, ritiro del portavalori e conferma dell'accredito. Ogni passaggio si può annullare dall'amministratore con motivazione tracciata.

Sezioni per fase (v6): Rendicontazione (Nuovo rendiconto, Rendiconti), Revisione e approvazione (ricezione buste, riconteggio, Errori e NC, Controllo giornaliero), Finance (Cassaforte, Versamento al portavalori, Conferma dell'accredito). Ogni sezione è visibile solo ai profili che la eseguono.

Profili: super amministratore; amministratore di sede (tutto il processo della propria azienda); cassiere (revisione e approvazione dei rendiconti delle sedi assegnate: operazione logistica, riconteggio e verifica, segnalazioni; non compila rendiconti né entra in cassaforte); Finance Specialist (cassaforte, versamenti e accrediti su tutta l'azienda; rendiconti in sola lettura; non elimina versamenti); operatore (compila i rendiconti delle sedi assegnate); partner (struttura ospitante: statistiche incassi e royalty confermate delle sue sedi). L'anagrafica Azienda censisce uno o più conti correnti: se presenti, la conferma dell'accredito richiede il conto su cui è arrivato il bonifico, con riferimento contabile facoltativo. Le royalty di sede si confermano dall'amministratore a inizio del mese successivo; da quel momento i valori sono congelati e il partner stampa il report per fatturare.

Rendicontazione per sede e per giorno: conteggio del contante per taglio, registrazione degli scontrini POS per circuito e dei bonifici con CRO, sottrazione del fondo cassa, quadratura con il gestionale. Registrazione della busta Mondialpol con codice a barre inserito due volte (lettore o fotocamera), elaborazione della distinta in PDF su carta intestata con il codice a barre e i due riquadri firma (chi elabora, operatore di logistica che ritira), stampata in doppia copia. Il flusso prosegue con ritiro e conferma dell'accredito in banca; una differenza tra distinta e accredito apre in automatico un errore.

Cruscotto e statistiche su contanti, POS e bonifici per sede, per azienda e per periodo, con rendiconti mancanti e flussi in ritardo. Segnalazione di errori e non conformità da parte degli amministratori, con risposta tracciata dell'utente e chiusura.

Aziende con più sedi e più utenti. Tre ruoli: super amministratore (crea le aziende, vede tutto, gestisce contratti e SEPA), amministratore (tutto sulla propria azienda), operatore (rendiconta e consulta le sedi assegnate). Accesso con Microsoft 365 (Entra ID) o con email e password, con verifica in due passaggi obbligatoria per gli amministratori locali.

Royalty di sede: ogni sede ospitata in una struttura terza (farmacia, poliambulatorio) riconosce alla struttura una quota fissa mensile e/o una percentuale sui ricavi, più IVA. Le condizioni sono nell'anagrafica della sede con storico delle variazioni; il report mensile per sede (PDF su carta intestata, con dettaglio giornaliero) è consultabile anche dall'operatore della sede.

Royalty verso partner esterni (modulo riservato al super amministratore): contratti per azienda con base lorda o netta, fee marketing, scaglioni per fascia o marginali, su base mensile o progressiva annua, minimo mensile. Estratti mensili in PDF, generazione del file SEPA Direct Debit pain.008 per il remote banking, deduzione delle quote già trattenute alla fonte sui canali digitali (split payment). Import CSV delle transazioni acquirer con riconciliazione automatica degli scontrini.

## Architettura

- server/: Node.js 22, Express, PostgreSQL 16. API REST con sessioni su database, protezione CSRF, rate limit sul login, audit log. PDF con pdfkit, codici a barre Code128 con bwip-js.
- web/: React 18, Vite, Recharts. Interfaccia in italiano, palette aziendale, responsive.
- Docker Compose: app, PostgreSQL, Caddy (HTTPS automatico con Let's Encrypt), backup giornaliero del database in ./backup con ritenzione 30 giorni.

## Come provarla prima di pubblicarla

Netlify non va bene: ospita solo siti statici, mentre qui servono Node.js e PostgreSQL. Tre strade, in ordine di consiglio.

1. Render (consigliata per la prova): account su render.com, repository Git con questo codice, New > Blueprint. Il file render.yaml crea database e applicazione. Nel pannello si inserisce SEED_SUPERADMIN_PASSWORD e dopo pochi minuti l'app risponde su https://td-cash.onrender.com. Piano indicativo: circa 7 $/mese web più 6 $/mese database (verificare i listini correnti). Quando la prova convince, si aggiunge il dominio cash.toscanadiagnostica.it nelle impostazioni di Render e un record CNAME sul DNS: il certificato HTTPS è automatico. Stessa strada valida per Railway o Fly.io.
2. Docker sul proprio PC: con Docker Desktop installato, `cp .env.example .env`, compilare, `docker compose up -d --build` e aprire http://localhost (Caddy in locale non emette certificati: usare `DOMAIN=localhost` in .env). Prova gratuita, visibile solo dal PC.
3. VPS (Aruba Cloud, Hetzner, Azure VM) con Docker: la stessa procedura della sezione seguente, è già la produzione.

## Installazione in produzione

Requisiti: un server Linux con Docker e Docker Compose, il record DNS `cash.toscanadiagnostica.it` che punta al server, porte 80 e 443 aperte.

```bash
git clone <repo> cash-td && cd cash-td
cp .env.example .env
# compila .env: DB_PASSWORD, SESSION_SECRET (openssl rand -base64 48), SEED_SUPERADMIN_*
docker compose up -d --build
docker compose logs -f app   # attendi "TD Cash in ascolto su :3000"
```

Al primo avvio vengono creati lo schema, l'azienda capofila Toscana Diagnostica (codice TD, carta intestata precaricata) e il super amministratore indicato in .env, che al primo accesso deve cambiare password e attivare la verifica in due passaggi.

Aggiornamento: `git pull && docker compose up -d --build`. Le migrazioni si applicano da sole all'avvio.

Ripristino di un backup: `docker compose exec -T db pg_restore -U cash -d cash --clean /backup/<file>.dump`.

## Comunicazioni (v5)

Controllo giornaliero: pagina dedicata per gli amministratori con lo stato di ogni sede per il giorno scelto (rendiconto inserito, in bozza, mancante, sede chiusa per calendario). Ogni mattina all'ora impostata (default 10:00) il sistema verifica il giorno precedente, invia un sollecito all'email di sede delle sedi mancanti e un riepilogo agli amministratori dell'azienda. Solleciti manuali per singola sede o per tutte le mancanti, comunicazioni libere a sede, struttura ospitante e operatori, con registro di tutti gli invii (esito, destinatari, allegato). Le segnalazioni aperte e le note notificano la sede; la conferma mensile delle royalty invia in automatico il report PDF all'email della struttura ospitante. Se l'invio non è configurato, tutto resta comunque registrato nel registro invii.

Anagrafica sedi (v6.2): elenco ordinabile per codice, denominazione e azienda cliccando l'intestazione; tipo di sede (di proprietà, senza royalty né struttura ospitante, oppure ospitata con royalty); eliminazione dall'amministratore con motivazione, solo per sedi senza rendiconti (altrimenti si disattiva). Sedi e utenti si possono caricare in blocco da un modello Excel scaricabile dall'app (Modello Excel, Importa da Excel): il file viene controllato riga per riga in anteprima e importato solo se privo di errori; il codice sede o l'email esistenti aggiornano l'anagrafica, gli altri creano; per i nuovi utenti con password l'app mostra le password temporanee al termine.

Orari di sede (v6.3): apertura e chiusura per giorno della settimana in anagrafica sede (anche da Excel, colonne orario_apertura e orario_chiusura). Se il rendiconto del giorno manca, la sede riceve il sollecito automatico 60 minuti dopo il suo orario di chiusura (minuti impostabili in Impostazioni); il riepilogo del mattino agli amministratori resta, e sollecita solo le sedi senza orario. PDF del gestionale: il tracciato "Stampa cassa" (chiusura per operatore) viene letto dal riepilogo finale "Totali per modalità di pagamento" e da "Totale incassato"; contanti, POS e bonifici del gestionale vengono compilati in automatico nel rendiconto se la data della stampa coincide con il giorno, altrimenti proposti; modalità non classificate (es. assegni) vengono segnalate. Tracciati diversi: lettura euristica per parole chiave, valori solo proposti. Dalla sezione POS è stato tolto il codice autorizzazione.

Le email di sede e della struttura ospitante si impostano nell'anagrafica sede, insieme alla data di avvio: primo giorno di lavoro da cui il sistema attende il rendiconto (obbligatoria; prima di quella data nessuna mancanza viene segnalata e nessun rendiconto è accettato). Il controllo automatico richiede un'istanza sempre attiva (su Render: piano a pagamento, non il piano gratuito che dorme).

## Microsoft 365: accesso e invio email

Una sola registrazione app in Entra ID serve per entrambe le cose. Occorre un Global Administrator del tenant.

Accesso (login con account Office 365):

1. Microsoft Entra ID > App registrations > New registration: nome "TD Cash Management", account solo di questa organizzazione (single tenant), piattaforma Web, redirect URI `https://cash.toscanadiagnostica.it/api/auth/entra/callback` (aggiungere anche l'URL temporaneo, es. `https://td-cash.onrender.com/api/auth/entra/callback`, finché il dominio non è attivo).
2. Certificates & secrets > New client secret (durata 24 mesi): copiare subito il valore, non si rivede più.
3. Token configuration > Add optional claim > ID token > `email`.
4. Overview: copiare Directory (tenant) ID e Application (client) ID.
5. Variabili d'ambiente dell'app (Render > Environment, oppure .env): `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, e `BASE_URL` uguale all'indirizzo pubblico. Riavviare.
6. Ogni utente va censito nell'app (Utenti) con la stessa email dell'account Office 365 e metodo di accesso "Microsoft 365" o "Microsoft 365 o password". Gli esterni all'organizzazione (partner, strutture ospitanti) usano email e password.

Invio email dalla casella amministrazione@toscanadiagnostica.it (Microsoft Graph, nessuna password SMTP):

1. Nella stessa registrazione app: API permissions > Add a permission > Microsoft Graph > Application permissions > `Mail.Send` > Grant admin consent.
2. Limitare l'app alla sola casella mittente (consigliato, PowerShell Exchange Online):
   `New-DistributionGroup -Name "TD Cash Mittenti" -Type Security -Members amministrazione@toscanadiagnostica.it`
   `New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId "TD Cash Mittenti" -AccessRight RestrictAccess -Description "TD Cash Management: solo casella amministrazione"`
   `Test-ApplicationAccessPolicy -Identity amministrazione@toscanadiagnostica.it -AppId <client id>` deve rispondere AccessCheckResult: Granted.
3. Variabile `GRAPH_SENDER=amministrazione@toscanadiagnostica.it` (già in render.yaml). Nessun'altra configurazione: l'app usa lo stesso tenant, client id e secret del login.
4. Verifica: Impostazioni > Comunicazioni email > "Invia una email di prova". Lo stato "attivo · Microsoft 365" conferma la configurazione; l'esito di ogni invio è nel registro.

Alternativa SMTP (per un provider diverso da Microsoft 365, che ha dismesso l'autenticazione SMTP di base): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. Se sono presenti sia Graph sia SMTP prevale Graph.

## Sviluppo locale

```bash
# database
docker run -d --name cashdb -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=cash postgres:16-alpine
# server
cd server && npm install
DATABASE_URL=postgres://postgres:dev@localhost:5432/cash SEED_SUPERADMIN_EMAIL=tu@esempio.it SEED_SUPERADMIN_PASSWORD=Password-Temporanea-1 npm start
# frontend (proxy su :3000)
cd web && npm install && npm run dev
# test end-to-end delle API (server avviato su database vuoto)
cd server && npm test
```

## Formati CSV di import

Transazioni POS/gateway: colonne `data; importo; circuito; terminale; riferimento; sede`. La sede si riconosce dal codice sede o dal TID del terminale configurato in anagrafica. Il `riferimento` evita i doppi import. Esempio in server/src/assets/sample_pos.csv.

Canali digitali: `data; canale; importo_lordo; quota_franchisor; sede; riferimento`. La quota franchisor è la parte già trattenuta alla fonte e viene dedotta dall'estratto royalty del periodo.

## Struttura delle API

Tutte sotto /api, autenticazione via cookie di sessione, header `X-Requested-With: td-cash` obbligatorio sulle richieste che modificano dati.

- auth: login, totp, logout, me, change-password, totp/setup, totp/enable, entra/login, entra/callback
- companies, companies/:id/bank-accounts, sites (DELETE con motivazione), users, settings, audit
- anagrafica: template/sites.xlsx, template/users.xlsx, sites (import, ?dry=1 anteprima), users (import)
- reports: CRUD bozza, envelope, unlock, process, pdf, pickup, deposit, reopen
- nc: elenco, dettaglio, creazione, messages, close, reopen
- stats: summary, today, export.csv
- imports: transactions, reconcile, reconciliation, channels
- royalty: contracts, preview, statements, statements/:id/pdf, statements/:id/status, sepa/batches, sepa/batches/:id/xml
- canoni (royalty di sede): summary, sites/:id, sites/:id/pdf, sites/:id/confirm, sites/:id/unconfirm
- deposits: safe, elenco (filtro status), creazione, pdf, pickup, bank (conto corrente e riferimento), undo, delete (solo amministratori)
- comms: daily, daily/alert, daily/run, message, log, test

## Cose da decidere prima del go-live

- IVA su royalty e fee marketing e regime IVA della base di calcolo (le prestazioni sanitarie sono per lo più esenti art. 10): da validare con il commercialista. Il sistema produce l'estratto di calcolo; la fattura elettronica resta al gestionale contabile.
- Creditor Identifier SEPA e mandati SDD firmati dagli affiliati: senza mandato non si genera l'addebito.
- Tempi di presentazione dei flussi SDD richiesti dal Banco Fiorentino (il sistema impone un minimo di 2 giorni).
- Integrazione API con registratori telematici e gateway: predisposta via import CSV, da attivare quando i fornitori rendono disponibili le specifiche.
