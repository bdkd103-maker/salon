import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

// Reviewed isolation: TypeScript compiler with one in-memory source and local
// standard libraries; Fastify inject/Zod with a fake store. No app imports,
// Prisma Client, database, listening server, environment files or providers.
const root = new URL('../', import.meta.url);
const require = createRequire(new URL('backend/package.json', root));
const ts = require('typescript');
const Fastify = require('fastify');
const { z } = require('zod');
const read = file => readFileSync(new URL(file, root), 'utf8');
const helper = read('backend/src/lib/service.ts');
assert.doesNotMatch(helper, /\bimport\s/);
const routes = read('backend/src/routes/salons.ts');
const start = routes.indexOf('  app.patch("/api/v1/salons/:salonId/services/:serviceId",');
const end = routes.indexOf('  app.delete("/api/v1/salons/:salonId/services/:serviceId",', start);
assert.ok(start > 0 && end > start);
const patch = routes.slice(start, end);
const merge = patch.slice(patch.indexOf('      const merged ='), patch.indexOf('      const nextService ='));
assert.match(merge, /normalizeServiceInput/);

test('service update adapter accepts persisted Decimal-like prices without widening ServiceInput', () => {
  const text = helper + `
    const service = { name: 'Cut', price: { toString: () => '19.95' } };
    const parsed = { data: {} as Partial<ServiceInput> };
  ` + merge;
  const file = new URL('.verification-test-build/service-price-contract.ts', root).pathname;
  const options = { strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = name => name === file ? text : readFile(name);
  host.fileExists = name => name === file || fileExists(name);
  const program = ts.createProgram([file], options, host);
  const errors = ts.getPreEmitDiagnostics(program).map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  assert.deepEqual(errors, []);
});

for (const [payload, price] of [[{ name: 'Renamed' }, 19.95], [{ price: 0 }, 0], [{ price: '24.50' }, 24.5]]) {
  test(`service PATCH preserves price semantics for ${JSON.stringify(payload)}`, async t => {
    const app = Fastify();
    t.after(() => app.close());
    const persisted = { name: 'Cut', description: null, durationMin: 30, isActive: true,
      salonId: 'salon-a', salon: { ownerId: 'owner-a' },
      price: { toString: () => '19.95' } };
    let saved;
    const schemaStart = routes.indexOf('const servicePriceSchema =');
    const schemaEnd = routes.indexOf('const serviceCreateSchema =', schemaStart);
    assert.ok(schemaStart > 0 && schemaEnd > schemaStart);
    const context = vm.createContext({ app, z, requireUserFromAuthHeader: async () => ({ id: 'owner-a', role: 'OWNER' }),
      prisma: { service: { findUnique: async () => persisted,
        update: async ({ data }) => { saved = data; return { id: 'service-a', ...data }; } } },
      serializeService: row => row,
    });
    vm.runInContext(stripTypeScriptTypes(helper + routes.slice(schemaStart, schemaEnd) + patch).replace(/^export /gm, ''), context);
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/salons/salon-a/services/service-a', payload });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(saved.price, price);
    assert.equal(saved.durationMin, 30);
    assert.equal(response.json().service.name, payload.name || 'Cut');
  });
}
