/*
 * The visitor's address behind reverse proxies (Caddy, nginx, Koyeb's load
 * balancers). Each proxy appends the address it saw to X-Forwarded-For, so the
 * right end of the list is the most trustworthy. Proxies inside a platform use
 * private addresses: skip them from the right and take the first public one.
 * (The left end can be typed by anyone, so it is only a last resort.)
 */
const PRIVATE = [
  /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT, used inside clouds
  /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i, /^0\./, /^unknown$/i,
];

const clean = (ip) => String(ip || '').trim().replace(/^::ffff:/, '').replace(/^\[|\](:\d+)?$/g, '').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1');
export const isPrivate = (ip) => !ip || PRIVATE.some((re) => re.test(ip));

export function pickClientIp(xffHeader, remoteAddress, trustProxy) {
  const remote = clean(remoteAddress);
  if (!trustProxy) return remote;
  const list = String(xffHeader || '').split(',').map(clean).filter(Boolean);
  for (let i = list.length - 1; i >= 0; i--) {
    if (!isPrivate(list[i])) return list[i];
  }
  return list[0] || remote;
}
