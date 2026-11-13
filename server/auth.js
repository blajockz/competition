/*
 * Stateless signed session tokens: role.subject.issuedAt.signature
 *   role     admin | host | team
 *   subject  "-" for admin/host, the team id for a team
 * The signature (HMAC-SHA256) also covers a "binding" that is not stored in the
 * token: the access code for admin/host, the team's join code for a team.
 * Changing an access code, or regenerating teams, therefore invalidates every
 * token issued before, with no session table to keep.
 */
import crypto from 'node:crypto';

const MAX_AGE_MS = 36 * 3600 * 1000;

function sign(secret, text) {
  return crypto.createHmac('sha256', secret).update(text).digest('base64url');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) {
    crypto.timingSafeEqual(x, x); // keep timing similar
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

export function issueToken(secret, role, subject, binding, now = Date.now()) {
  const body = `${role}.${subject}.${now.toString(36)}`;
  return `${body}.${sign(secret, body + '|' + binding)}`;
}

/** Returns { role, subject, iat } or null. `bindingFor(role, subject)` returns the binding or null. */
export function verifyToken(secret, token, bindingFor, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [role, subject, iat36, sig] = parts;
  if (!['admin', 'host', 'team'].includes(role)) return null;
  const iat = parseInt(iat36, 36);
  if (!Number.isFinite(iat) || iat > now + 60000 || now - iat > MAX_AGE_MS) return null;
  const binding = bindingFor(role, subject);
  if (binding == null) return null;
  const expected = sign(secret, `${role}.${subject}.${iat36}|${binding}`);
  if (!safeEqual(sig, expected)) return null;
  return { role, subject, iat };
}
