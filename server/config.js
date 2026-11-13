// All settings come from environment variables (see .env.example).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: int(env.PORT, 8080),
  host: env.HOST || '0.0.0.0',

  supabaseUrl: (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '',
  syncSecret: env.APP_SYNC_SECRET || '',

  adminCode: (env.ADMIN_ACCESS_CODE || '').trim(),
  hostCode: (env.HOST_ACCESS_CODE || '').trim(),
  tokenSecret: env.TOKEN_SECRET || '',

  trustProxy: bool(env.TRUST_PROXY, false),
  eventTimeZone: env.EVENT_TIMEZONE || 'Africa/Casablanca',
  eventName: (env.EVENT_NAME || 'N7 Kickoff Cup').trim().slice(0, 60),

  dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
  staticDir: env.STATIC_DIR || path.join(ROOT, 'web', 'dist'),

  // Persistence: "supabase" (default when configured) or "local" (file only, for development)
  storage: env.STORAGE || ((env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL) ? 'supabase' : 'local'),
};

export function checkConfig() {
  const problems = [];
  if (config.adminCode.length < 6) problems.push('ADMIN_ACCESS_CODE must be set (at least 6 characters)');
  if (config.hostCode.length < 6) problems.push('HOST_ACCESS_CODE must be set (at least 6 characters)');
  if (config.adminCode && config.adminCode === config.hostCode) problems.push('ADMIN_ACCESS_CODE and HOST_ACCESS_CODE must differ');
  if (config.tokenSecret.length < 32) problems.push('TOKEN_SECRET must be set (at least 32 characters)');
  if (config.storage === 'supabase') {
    if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(config.supabaseUrl)) problems.push('NEXT_PUBLIC_SUPABASE_URL must be an https URL');
    if (!config.supabaseKey) problems.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set');
    if (config.syncSecret.length < 32) problems.push('APP_SYNC_SECRET must be set (at least 32 characters, same value as in supabase/schema.sql)');
  }
  return problems;
}
