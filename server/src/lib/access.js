import { one } from '../db.js';
import { config } from '../config.js';
import { forbidden, notFound, HttpError } from './util.js';

// Costruttore di parametri posizionali per query dinamiche
export class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

export async function loadUser(req, _res, next) {
  try {
    const id = req.session?.userId;
    if (id) {
      const u = await one(
        `SELECT u.id, u.email, u.full_name, u.role, u.company_id, u.auth_provider, u.must_change_password,
                u.totp_enabled, u.active, c.name AS company_name, c.code AS company_code
           FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = $1`, [id]);
      if (u && u.active) {
        const sites = await one('SELECT coalesce(array_agg(site_id), $2::int[]) AS ids FROM user_sites WHERE user_id=$1', [id, '{}']);
        u.site_ids = sites.ids;
        req.user = u;
      } else {
        req.session.userId = null;
      }
    }
    next();
  } catch (e) { next(e); }
}

// Endpoint consentiti quando l'utente deve ancora cambiare password o attivare 2FA
const ONBOARDING_PATHS = ['/api/auth/me', '/api/auth/logout', '/api/auth/change-password', '/api/auth/totp/setup', '/api/auth/totp/enable'];

export function onboardingState(req) {
  const u = req.user;
  if (!u) return null;
  const local = req.session.authMethod === 'LOCAL';
  if (local && u.must_change_password) return 'PASSWORD_CHANGE_REQUIRED';
  if (local && config.requireTotpForAdmins && ['ADMIN', 'SUPERADMIN'].includes(u.role) && !u.totp_enabled) return 'TOTP_SETUP_REQUIRED';
  return null;
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessione scaduta o non autenticata'));
  const st = onboardingState(req);
  if (st && !ONBOARDING_PATHS.includes(req.baseUrl + req.path) && !ONBOARDING_PATHS.includes(req.originalUrl.split('?')[0])) {
    const e = new HttpError(403, st === 'PASSWORD_CHANGE_REQUIRED' ? 'Cambio password obbligatorio' : 'Attivazione verifica in due passaggi obbligatoria');
    e.code = st;
    return next(e);
  }
  next();
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());

export const isSuper = (u) => u.role === 'SUPERADMIN';
export const isAdmin = (u) => u.role === 'ADMIN' || u.role === 'SUPERADMIN';

// Clausola SQL che limita le sedi visibili all'utente (alias della tabella sites)
// OPERATOR e PARTNER vedono solo le sedi assegnate
export function siteScope(user, P, alias = 's') {
  if (user.role === 'SUPERADMIN') return 'TRUE';
  if (user.role === 'ADMIN') return `${alias}.company_id = ${P.add(user.company_id)}`;
  return `${alias}.id = ANY(${P.add(user.site_ids || [])}::int[])`;
}

// Il Partner (struttura ospitante) è in sola lettura su un perimetro ristretto
const PARTNER_ALLOWED = [/^\/api\/auth\//, /^\/api\/stats\/summary/, /^\/api\/stats\/export\.csv/, /^\/api\/sites$/, /^\/api\/canoni\//, /^\/api\/nc$/];
export function partnerGuard(req, _res, next) {
  if (req.user?.role !== 'PARTNER') return next();
  const path = req.originalUrl.split('?')[0];
  if (req.method !== 'GET' && !path.startsWith('/api/auth/')) return next(forbidden('Profilo in sola lettura'));
  if (!PARTNER_ALLOWED.some((re) => re.test(path))) return next(forbidden('Sezione non disponibile per il profilo Partner'));
  next();
}

export function companyScope(user, P, col = 'company_id') {
  if (user.role === 'SUPERADMIN') return 'TRUE';
  return `${col} = ${P.add(user.company_id)}`;
}

export function canSite(user, site) {
  if (!site) return false;
  if (user.role === 'SUPERADMIN') return true;
  if (user.role === 'ADMIN') return site.company_id === user.company_id;
  return (user.site_ids || []).includes(site.id);
}

export async function assertSite(user, siteId) {
  const site = await one('SELECT * FROM sites WHERE id=$1', [siteId]);
  if (!site) throw notFound('Sede non trovata');
  if (!canSite(user, site)) throw forbidden('Sede non autorizzata');
  return site;
}

export function assertCompany(user, companyId) {
  if (user.role === 'SUPERADMIN') return;
  if (Number(companyId) !== user.company_id) throw forbidden('Azienda non autorizzata');
}
