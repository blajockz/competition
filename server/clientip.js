/*
 * The visitor's address behind reverse proxies.
 *
 * 1. CLIENT_IP_HEADER (optional): a header set by a trusted edge that clients
 *    cannot forge. On Render, Cloudflare sits in front of every service and sets
 *    True-Client-IP, so render.yaml sets CLIENT_IP_HEADER=true-client-ip.
 * 2. Otherwise X-Forwarded-For: each proxy appends the address it saw, so the
 *    right end is the most trustworthy. Proxies inside a platform use private
 *    addresses: skip them from the right and take the first public one.
 *    (The left end can be typed by anyone, so it is only a last resort.)
 */
const PRIVATE = [
  /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT, used inside clouds
  /^::1$/, /^f[cd][0-9a-f]{2}:/i, /^fe80:/i, /^0\./, /^unknown$/i,
];

const clean = (ip) => String(ip || '').trim().replace(/^::ffff:/, '').replace(/^\[|\](:\d+)?$/g, '').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1');
export const isPrivate = (ip) => !ip || PRIVATE.some((re) => re.test(ip));

/**
 * @param headers        request headers (lower-case names)
 * @param remoteAddress  socket address
 * @param trustProxy     TRUST_PROXY
 * @param ipHeader       CLIENT_IP_HEADER (lower-case), or ''
 */
export function pickClientIp(headers, remoteAddress, trustProxy, ipHeader = '') {
  const remote = clean(remoteAddress);
  if (!trustProxy) return remote;
  if (ipHeader) {
    const v = clean(String(headers[ipHeader] || '').split(',')[0]);
    if (v) return v;
  }
  const list = String(headers['x-forwarded-for'] || headers['x-real-ip'] || '').split(',').map(clean).filter(Boolean);
  for (let i = list.length - 1; i >= 0; i--) {
    if (!isPrivate(list[i])) return list[i];
  }
  return list[0] || remote;
}