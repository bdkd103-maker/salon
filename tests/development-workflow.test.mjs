import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { safeSource, compareScope, selectChecks, syntaxCheck, summarize, main } from '../scripts/quality-gate.mjs';
import { check, resolveUnitImport, sourceDigest as unitDigest } from '../scripts/test-backend-unit.mjs';
import { check as browserCheck, sourceDigest as browserDigest } from '../scripts/test-browser-mock.mjs';

test('audited hashes tolerate checkout line endings but reject other byte changes', () => {
  const lf = Buffer.from('const fixture = 1;\n// reviewed source\n');
  const crlf = Buffer.from(lf.toString().replace(/\n/g, '\r\n'));
  for (const digest of [unitDigest, browserDigest]) {
    assert.equal(digest(lf), digest(crlf));
    for (const changed of [Buffer.from('const fixture = 2;\n// reviewed source\n'), Buffer.concat([lf, Buffer.from(' ')]), Buffer.from('const fixture = 1;\r// reviewed source\n'), Buffer.from([0xff]), Buffer.from([0xfe])]) {
      assert.notEqual(digest(changed), digest(lf));
    }
    assert.notEqual(digest(Buffer.from([0xff])), digest(Buffer.from([0xfe])), 'invalid UTF-8 bytes must not collapse');
  }
});

test('reviewed mock browser allowlist passes without opening a browser', () => {
  const result = browserCheck();
  assert.equal(result.suites.length, 6);
  assert.equal(result.auditedHashesMatch, true);
  assert.equal(result.databaseRequired, false);
  assert.equal(result.developmentServerRequired, false);
});

test('pure unit loader refuses network, database, environment and arbitrary modules', () => {
  const parent = new URL('../backend/src/lib/service-visit.test.ts', import.meta.url).href;
  for (const specifier of ['node:http', 'node:net', 'node:child_process', '@prisma/client', 'dotenv', './auth.js', '../../server.ts']) {
    assert.throws(() => resolveUnitImport(specifier, parent), /BLOCKED/);
  }
  assert.equal(resolveUnitImport('node:assert/strict', parent), 'node:assert/strict');
  assert.match(resolveUnitImport('./service-visit.js', parent), /service-visit\.ts$/);
});

test('local skills have minimal supported metadata and their guide resolves', () => {
  for (const name of ['salo-development', 'salo-review']) {
    const url = new URL(`../.agents/skills/${name}/SKILL.md`, import.meta.url);
    const contents = fs.readFileSync(url, 'utf8');
    const header = contents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    assert.ok(header);
    assert.match(header[1], new RegExp(`^name: ${name}$`, 'm'));
    assert.match(header[1], /^description: .{20,1024}$/m);
    if (name === 'salo-development') assert.ok(fs.existsSync(new URL('../../../docs/development-workflow.md', url)));
  }
});

test('unsafe and sensitive scopes are refused before any execution', () => {
  for (const file of ['.env', '.env.local', 'backend/.env.json', '.aws/config.json', 'keys/private-key.json', 'credentials.json', 'tokens.json', '../index.html', 'C:/index.html', 'www/../index.html', 'scripts/verify-live.js', 'node_modules/example.js']) {
    assert.equal(safeSource(file), false, file);
    assert.throws(() => selectChecks([file]), /BLOCKED/);
  }
  assert.throws(() => main(['--files', '.env']), /BLOCKED/);
  assert.throws(() => main(['--unknown']), /BLOCKED/);
  assert.throws(() => selectChecks([], 'finish'), /BLOCKED/);
});

test('existing dirty work is tolerated, additional unrelated edits are detected', () => {
  const original = [{ file: 'index.html', coverage: 'sha256', sha256: 'already-dirty' }, { file: 'existing-untracked.js', coverage: 'sha256', sha256: 'preserve' }];
  const current = [{ ...original[0], sha256: 'task-edit' }, original[1]];
  assert.deepEqual(compareScope(original, current, ['index.html']).outsideScope, []);
  assert.deepEqual(compareScope(original, [...current, { file: 'unrelated.js' }], ['index.html']).outsideScope, ['unrelated.js']);
  assert.deepEqual(compareScope(original, [current[0]], ['index.html']).outsideScope, ['existing-untracked.js']);
});

test('target selection is explicit and unmapped backend work stays visible', () => {
  assert.equal(selectChecks(['index.html', 'www/index.html'], 'finish').needsBrowser, true);
  assert.equal(selectChecks(['tests/staff-authorization.spec.js'], 'finish').needsBrowser, true);
  assert.equal(selectChecks(['scripts/test-browser-mock.mjs'], 'finish').needsBrowser, true);
  const pure = selectChecks(['backend/src/lib/service-visit.ts', 'backend/src/lib/loyalty.test.ts'], 'finish');
  assert.deepEqual(pure.unitGroups, ['service', 'loyalty']);
  assert.equal(pure.backend, true);
  assert.deepEqual(selectChecks(['backend/src/routes/staff.ts'], 'finish').unverifiedBackend, ['backend/src/routes/staff.ts']);
  assert.equal(selectChecks(['scripts/quality-gate.mjs'], 'finish').needsWorkflow, true);
  assert.deepEqual(selectChecks(['backend/prisma/schema.prisma.json']).highRisk, ['backend/prisma/schema.prisma.json']);
  assert.throws(() => selectChecks(['index.html'], 'live'), /BLOCKED/);
});

test('syntax checks parse without evaluating page code', () => {
  syntaxCheck('index.html', Buffer.from('<script>throw new Error("must never execute")</script>'));
  syntaxCheck('index.html', Buffer.from('<script src="missing.js"></script><script type="application/json">{invalid}</script>'));
  assert.throws(() => syntaxCheck('index.html', Buffer.from('<script>const =</script>')), SyntaxError);
  assert.throws(() => syntaxCheck('index.html', Buffer.from('<script type="module">export {}</script>')), /BLOCKED/);
  assert.throws(() => syntaxCheck('package.json', Buffer.from('{invalid}')), SyntaxError);
});

test('missing baseline blocks validation and review does not execute tests', () => {
  assert.equal(main(['--files', 'package.json']).status, 'BLOCKED');
  const review = main(['--mode', 'review', '--files', 'package.json']);
  assert.equal(review.status, 'BLOCKED');
  assert.equal(review.testsExecuted, false);
  assert.ok(review.manualReviewRequired.includes('authentication and role/salon isolation'));
  assert.equal(summarize([{ status: 'PASS' }, { status: 'BLOCKED' }]), 'BLOCKED');
  assert.equal(summarize([{ status: 'BLOCKED' }, { status: 'FAIL' }]), 'FAIL');
});

test('backend allowlist hashes match; arbitrary groups never run', () => {
  assert.equal(check().length, 3);
  assert.throws(() => check('routes'), /BLOCKED/);
  const result = spawnSync(process.execPath, ['scripts/test-backend-unit.mjs', '--group', 'routes'], { encoding: 'utf8', env: {} });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /BLOCKED/);
  assert.doesNotMatch(result.stdout, /PURE UNIT/);
});
