import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

// Isolation review: only installed JWT/Fastify/rate-limit dependencies and Node
// builtins. No app imports, dotenv, Prisma, servers/listen or external requests.
// Fastify inject uses an in-memory fixture, with a randomly generated test key.
const root = new URL('../', import.meta.url);
const require = createRequire(new URL('backend/package.json', root));
const jwt = require('jsonwebtoken');
const Fastify = require('fastify');
const rateLimit = require('@fastify/rate-limit');
const read = file => readFileSync(new URL(file, root), 'utf8');
const server = read('backend/src/server.ts');
const keyStart = server.indexOf('    keyGenerator: ');
const keyEnd = server.indexOf('\n    },', keyStart);
assert.ok(keyStart >= 0 && keyEnd > keyStart, 'rate-limit key source boundaries');
const arrow = server.slice(keyStart + '    keyGenerator: '.length, keyEnd) + '\n    }';
const tokenSource = read('backend/src/lib/jwt.ts');
const verifyStart = tokenSource.indexOf('export function verifyAccessToken(');
const verifyEnd = tokenSource.indexOf('export interface RefreshTokenPayload', verifyStart);
assert.ok(verifyStart >= 0 && verifyEnd > verifyStart, 'access verifier source boundaries');
const versions = read('backend/src/lib/auth-version.ts');
assert.doesNotMatch(versions, /\bimport\s/);
const signingKey = randomBytes(32).toString('hex');
const context = vm.createContext({ jwt, Buffer, process: { env: { JWT_ACCESS_SECRET: signingKey } } });
vm.runInContext(stripTypeScriptTypes(versions + '\n' + tokenSource.slice(verifyStart, verifyEnd))
  .replace(/^export /gm, ''), context, { timeout: 1000 });
const keyGenerator = vm.runInContext(stripTypeScriptTypes('const keyGenerator = ' + arrow + ';\nkeyGenerator;'), context, { timeout: 1000 });
const ip = '192.0.2.10';
const key = authorization => keyGenerator({ ip, headers: { authorization } });
const token = (sub, options = {}) => jwt.sign({ sub, role: 'CUSTOMER' }, signingKey, { expiresIn: 60, ...options });
const forged = sub => jwt.sign({ sub, role: 'CUSTOMER' }, randomBytes(32), { expiresIn: 60 });

test('server wires the shared access-token verifier into rate limiting', () => {
  assert.match(server, /import\s*\{\s*verifyAccessToken\s*\}\s*from\s*["']\.\/lib\/jwt\.js["']/);
  assert.match(arrow, /verifyAccessToken\(/);
});

test('forged subjects cannot rotate anonymous buckets or target a user bucket', () => {
  for (const sub of ['victim-user', 'arbitrary-a', 'arbitrary-b']) {
    assert.equal(key('Bearer ' + forged(sub)), ip);
  }
});

test('expired, future and invalid-claim tokens use the IP bucket', () => {
  assert.equal(key('Bearer ' + token('expired', { expiresIn: -60 })), ip);
  assert.equal(key('Bearer ' + token('future', { notBefore: 60 })), ip);
  assert.equal(key('Bearer ' + jwt.sign({ sub: 'no-role' }, signingKey)), ip);
  assert.equal(key('Bearer ' + jwt.sign({ sub: 'bad-version', role: 'CUSTOMER', av: -1 }, signingKey)), ip);
});

test('missing, malformed and duplicate headers fail safely to the IP bucket', () => {
  for (const header of [undefined, '', 'Basic abc', 'Bearer bad', 'Bearer ', ['Bearer one', 'Bearer two']]) {
    assert.equal(key(header), ip);
  }
});

test('valid access tokens retain one stable bucket per user across sessions and IPs', () => {
  const first = token('customer-a');
  assert.equal(key('Bearer ' + first), 'user:customer-a');
  assert.equal(key('Bearer ' + token('customer-a', { jwtid: 'second-session' })), 'user:customer-a');
  assert.equal(key('Bearer ' + token('customer-b')), 'user:customer-b');
  assert.equal(keyGenerator({ ip: '192.0.2.11', headers: { authorization: 'Bearer ' + first } }), 'user:customer-a');
});

test('in-memory rate limiter returns 429 despite rotating forged JWT subjects', async () => {
  const app = Fastify();
  try {
    await app.register(rateLimit, { global: true, max: 2, timeWindow: 60000, keyGenerator });
    app.get('/probe', async () => ({ ok: true }));
    const statuses = [];
    for (const sub of ['one', 'two', 'three']) {
      const response = await app.inject({ method: 'GET', url: '/probe', remoteAddress: ip, headers: { authorization: 'Bearer ' + forged(sub) } });
      statuses.push(response.statusCode);
    }
    assert.deepEqual(statuses, [200, 200, 429]);
  } finally {
    await app.close();
  }
});
