// Reviewed tooling tests: builtins, YAML parser and tooling-only imports.
// No application modules, databases, .env reads, listening servers or network.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { prismaEnvironment, prepareSchema, prismaTooling } from '../scripts/prisma-tooling.mjs';
import { validateSkills, validateCI, validateDisabledWorkflow, scanText, cleanEnv, main } from '../scripts/salo-checks.mjs';
import { browserOptions } from '../scripts/test-browser-mock.mjs';
import { main as scopedGate } from '../scripts/quality-gate.mjs';

test('all four supported skills have names, descriptions and source documentation', () => {
  const result = validateSkills();
  assert.equal(result.skills.length, 4);
  assert.equal(result.metadataValid, true);
});

test('explicit browser modes preserve legacy default and never silently fall back', () => {
  const options = { channel: 'msedge', headless: true };
  assert.deepEqual(browserOptions('msedge', options), options);
  assert.deepEqual(browserOptions('chromium', options), { headless: true });
  assert.deepEqual(browserOptions('system-chromium', options), { headless: true, executablePath: '/usr/bin/chromium' });
  assert.throws(() => browserOptions('auto'), /BLOCKED/);
});

test('child checks never inherit application credentials or Node preloads', () => {
  assert.ok(Object.keys(cleanEnv()).every(key => ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR'].includes(key)));
  assert.equal(cleanEnv().NODE_OPTIONS, undefined);
  assert.equal(cleanEnv().DATABASE_URL, undefined);
});

test('scanner detects synthetic patterns and returns only location and rule', () => {
  const marker = 'gh' + 'p_' + 'X'.repeat(36);
  const findings = scanText('ordinary text\n' + marker);
  assert.deepEqual(findings, [{ line: 2, rule: 'github-token' }]);
  assert.equal(JSON.stringify(findings).includes(marker), false);
  assert.deepEqual(scanText('process.env.JWT_ACCESS_SECRET'), []);
});

test('workflow parses and has safe triggers, commands and least-privilege checkout', async () => {
  const source = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.equal((await validateCI(source)).deployment, false);
  for (const bad of [source.replace('pull_request:', 'pull_request_target:'), source.replace('contents: read', 'contents: write'), source.replace('persist-credentials: false', 'persist-credentials: true'), source.replace('node scripts/salo-checks.mjs config', 'node backend/src/server.ts'), source + '\njobs: {}\n']) {
    await assert.rejects(validateCI(bad));
  }
  await assert.rejects(validateCI(source.replace("github.event_name == 'workflow_dispatch'", 'always()')));
});

test('scoped gate accepts explicit Cloud browser mode and refuses unknown modes', () => {
  assert.equal(scopedGate(['--mode', 'review', '--browser', 'system-chromium', '--files', 'package.json']).plan.browserMode, 'system-chromium');
  assert.throws(() => scopedGate(['--browser', 'auto', '--files', 'package.json']), /BLOCKED/);
});

test('both release workflows are valid manual placeholders with permanently skipped jobs', async () => {
  for (const file of ['release-production.yml', 'staging-release.yml']) {
    const source = fs.readFileSync(new URL('../.github/workflows/' + file, import.meta.url), 'utf8');
    assert.equal((await validateDisabledWorkflow(source)).deploymentEnabled, false);
    await assert.rejects(validateDisabledWorkflow(source.replace('${{ false }}', '${{ true }}')));
    await assert.rejects(validateDisabledWorkflow(source.replace('contents: read', 'contents: write')));
  }
});

test('unknown test groups and scan arguments refuse execution', async () => {
  await assert.rejects(main(['live']), /Choose/);
  await assert.rejects(main(['test', 'backend/test/verify-real.ts']), /Unexpected/);
  await assert.rejects(main(['scan', '--base', 'HEAD;invalid']), /full commit SHA/);
  await assert.rejects(main(['browser', '--browser', 'auto']), /Invalid/);
});

test('Prisma copies change only isolated generator output and reject unexpected generators', () => {
  const source = fs.readFileSync(new URL('../backend/prisma/schema.prisma', import.meta.url), 'utf8');
  const prepared = prepareSchema(source);
  assert.equal(prepared.replace('\n  output = "./client"', ''), source);
  assert.throws(() => prepareSchema(prepared), /Unexpected/);
  assert.throws(() => prepareSchema(source + '\ngenerator other { provider = "unsafe" }'), /Unexpected/);
});

test('Prisma environment is synthetic and cannot inherit credentials or preloads', () => {
  const env = prismaEnvironment('/guard', '/receipt');
  assert.equal(env.NODE_OPTIONS, '--require="/guard"');
  assert.equal(env.JWT_ACCESS_SECRET, undefined);
  assert.ok(env.DATABASE_URL.endsWith('/offline_never_connect'));
  assert.equal(env.PRISMA_GENERATE_SKIP_AUTOINSTALL, '1');
});

test('offline preload denies environment reads, network connections and native shell execution', () => {
  const guard = fileURLToPath(new URL('../scripts/offline-tool-guard.cjs', import.meta.url));
  const code = `const assert=require('node:assert/strict');
    assert.throws(()=>require('node:fs').readFileSync('/never-open/.env.synthetic'),/OFFLINE_ENV_READ_DENIED/);
    assert.throws(()=>require('node:fs').createReadStream('/never-open/.env.synthetic'),/OFFLINE_ENV_READ_DENIED/);
    assert.throws(()=>require('node:net').connect({port:1}),/OFFLINE_NETWORK_DENIED/);
    assert.throws(()=>require('node:child_process').execSync('never-run'),/OFFLINE_SHELL_DENIED/);`;
  const child = spawnSync(process.execPath, ['--require', guard, '-e', code], { env: cleanEnv(), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('real Prisma Client generation works offline with no native engine or environment files', () => {
  assert.equal(prismaTooling(false), 0);
});

// Isolation review: these eight existing queue tests import only test/assert
// and the dependency-free transition helper. Evaluate selected source only;
// never import the route, Prisma, application bootstrap or other tests.
const queueHelper = fs.readFileSync(new URL('../backend/src/lib/queue-entry.ts', import.meta.url), 'utf8');
const queueTests = fs.readFileSync(new URL('../backend/src/lib/queue-entry.test.ts', import.meta.url), 'utf8');
assert.doesNotMatch(queueHelper, /\bimport\s/);
assert.deepEqual([...queueTests.matchAll(/import[\s\S]*?from "([^"]+)";/g)].map(match => match[1]), ['node:assert/strict', 'node:test', './queue-entry.js']);
vm.runInNewContext(stripTypeScriptTypes(queueHelper).replace(/^export /gm, '') + '\n' + stripTypeScriptTypes(queueTests.replace(/import[\s\S]*?from "[^"]+";/g, '')), { assert, test }, { timeout: 1000 });
