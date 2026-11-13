import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, FAIL_LIMITS } from '../server/ratelimit.js';
import { issueToken, verifyToken } from '../server/auth.js';

test('token bucket refills over time', () => {
  let t = 0;
  const rl = new RateLimiter({ x: { capacity: 3, perSecond: 1 } }, () => t);
  assert.equal(rl.take('x', 'a').ok, true);
  assert.equal(rl.take('x', 'a').ok, true);
  assert.equal(rl.take('x', 'a').ok, true);
  const r = rl.take('x', 'a');
  assert.equal(r.ok, false);
  assert.ok(r.retryAfter >= 1);
  assert.equal(rl.take('x', 'b').ok, true, 'buckets are per key');
  t += 1000;
  assert.equal(rl.take('x', 'a').ok, true);
  rl.stop();
});

test('too many wrong codes block an address for a while', () => {
  let t = 0;
  const rl = new RateLimiter(undefined, () => t);
  for (let i = 0; i < FAIL_LIMITS.staff.max; i++) rl.recordFailure('staff', '1.2.3.4');
  assert.ok(rl.blockedFor('staff', '1.2.3.4') > 0);
  assert.equal(rl.blockedFor('team', '1.2.3.4'), 0, 'team logins are counted apart');
  assert.equal(rl.blockedFor('staff', '5.6.7.8'), 0);
  t += FAIL_LIMITS.staff.blockMs + 1;
  assert.equal(rl.blockedFor('staff', '1.2.3.4'), 0);
  rl.stop();
});

test('tokens: signature, binding, expiry', () => {
  const secret = 'x'.repeat(40);
  const now = 1_800_000_000_000;
  const tok = issueToken(secret, 'team', 'team_01', 'team|ABCD', now);
  const bind = (code) => (role, sub) => (role === 'team' && sub === 'team_01' ? 'team|' + code : null);
  assert.deepEqual(verifyToken(secret, tok, bind('ABCD'), now + 1000)?.subject, 'team_01');
  assert.equal(verifyToken(secret, tok, bind('WXYZ'), now), null, 'a new join code invalidates old sessions');
  assert.equal(verifyToken('y'.repeat(40), tok, bind('ABCD'), now), null, 'wrong secret');
  assert.equal(verifyToken(secret, tok.replace('team_01', 'team_02'), bind('ABCD'), now), null, 'tampered subject');
  assert.equal(verifyToken(secret, tok, bind('ABCD'), now + 40 * 3600e3), null, 'expired');
  assert.equal(verifyToken(secret, 'admin.-.x.y', bind('ABCD'), now), null);
});

import { pickClientIp } from '../server/clientip.js';

test('client address behind proxies', () => {
  // Caddy / nginx: client appended last
  assert.equal(pickClientIp('41.250.1.9', '172.18.0.3', true), '41.250.1.9');
  // platform load balancers with private addresses after the client
  assert.equal(pickClientIp('41.250.1.9, 10.0.3.4, 100.64.2.1', '10.0.0.7', true), '41.250.1.9');
  // a spoofed entry on the left is ignored
  assert.equal(pickClientIp('1.2.3.4, 41.250.1.9', '10.0.0.7', true), '41.250.1.9');
  // no proxy trust: socket address only
  assert.equal(pickClientIp('1.2.3.4', '::ffff:41.250.1.9', false), '41.250.1.9');
  // nothing public: fall back
  assert.equal(pickClientIp('', '10.0.0.7', true), '10.0.0.7');
});
