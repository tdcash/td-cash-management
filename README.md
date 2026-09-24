# Toscana Diagnostica · Cash Management

Webapp per la rendicontazione giornaliera degli incassi, il controllo del flusso contante fino alla banca, il calcolo delle royalty e gli addebiti SEPA della rete. Destinata a cash.toscanadiagnostica.it.

## Cosa fa

Ciclo del rendiconto (v4): l'operatore di sede conta il contante per taglio (banconote e monete), registra POS e bonifici, carica il PDF di chiusura cassa del gestionale (importi letti in automatico e confermati), registra la busta Mondialpol e stampa la distinta a sua firma. L'amministratore di sede registra l'Operazione logistica (riceve la busta dalla logistica e la mette in cassaforte, con nome dell'operatore), poi il Riconteggio e verifica, che chiude il ciclo: le differenze aprono in automatico una segnalazione. Il modulo Catena di custodia accompagna la busta fino all'Area Finance. Il contante verificato è versabile al portavalori a livello azienda, anche in parte: il versamento raccoglie N rendiconti verificati, ha le sue buste Mondialpol, distinta e catena di custodia, ritiro del portavalori e conferma dell'accredito. Ogni passaggio si può annullare dall'amministratore con motivazione tracciata.

Profili: super amministratore, amministratore (di azienda/sede), operatore, partner (struttura ospitante: vede solo statistiche incassi e royalty di sede confermate delle sue sedi). Le royalty di sede si confermano dall'amministratore a inizio del mese successivo; da quel momento i valori sono congelati e il partner stampa il report per fatturare.

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

## Accesso Microsoft 365

1. In Microsoft Entra ID, App registrations, New registration: nome "TD Cash Management", account solo di questa organizzazione, redirect URI (Web) `https://cash.toscanadiagnostica.it/api/auth/entra/callback`.
2. Certificates & secrets: crea un client secret e annota il valore.
3. Token configuration: aggiungi il claim opzionale `email` per l'ID token.
4. Copia Tenant ID, Client ID e secret in .env (ENTRA_*), poi `docker compose up -d`.
5. Ogni utente va comunque censito nell'app con la stessa email dell'account Office 365 e metodo di accesso "Microsoft 365" o "Microsoft 365 o password". Gli esterni all'organizzazione usano email e password.

La registrazione dell'app richiede un Global Administrator del tenant.

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
- companies, sites, users, settings, audit
- reports: CRUD bozza, envelope, unlock, process, pdf, pickup, deposit, reopen
- nc: elenco, dettaglio, creazione, messages, close, reopen
- stats: summary, today, export.csv
- imports: transactions, reconcile, reconciliation, channels
- royalty: contracts, preview, statements, statements/:id/pdf, statements/:id/status, sepa/batches, sepa/batches/:id/xml

## Cose da decidere prima del go-live

- IVA su royalty e fee marketing e regime IVA della base di calcolo (le prestazioni sanitarie sono per lo più esenti art. 10): da validare con il commercialista. Il sistema produce l'estratto di calcolo; la fattura elettronica resta al gestionale contabile.
- Creditor Identifier SEPA e mandati SDD firmati dagli affiliati: senza mandato non si genera l'addebito.
- Tempi di presentazione dei flussi SDD richiesti dal Banco Fiorentino (il sistema impone un minimo di 2 giorni).
- Integrazione API con registratori telematici e gateway: predisposta via import CSV, da attivare quando i fornitori rendono disponibili le specifiche.
