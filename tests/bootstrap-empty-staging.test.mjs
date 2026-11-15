import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalInputs, deriveBaseline, describeSql, digest, inspectEmptyDisposableTarget, plan, repository, splitSql, validateSelection, verifyPreparation } from '../scripts/bootstrap-empty-staging.mjs';

const target = () => ({ environment: 'staging', disposable: true, host: 'staging-fixture.invalid', port: 5432, database: 'salo_staging_disposable_fixture01', user: 'salo_staging_bootstrap_fixture01', schema: 'public', systemIdentifier: '1234567890123456789', databaseOid: 16384 });
const identity = () => ({ ...target(), serverVersionNum: 160006, ownsDatabase: true, superuser: false });
const catalog = () => ({ userSchemas: ['public'], extensions: ['plpgsql'], relations: [], types: [], routines: [], eventTriggers: [], publications: [], subscriptions: [], foreignServers: [], defaultPrivileges: [], largeObjectCount: 0, prismaHistoryTablePresent: false, prismaHistoryRows: 0 });
const args = () => ['--disposable-staging', '--host', target().host, '--port', '5432', '--database', target().database, '--user', target().user, '--cluster-id', target().systemIdentifier, '--database-oid', '16384'];
function inspector(actual = identity(), state = catalog()) {
  const reads = [];
  return { reads, readIdentity: async () => { reads.push('identity'); return actual; }, readCatalog: async () => { reads.push('catalog'); return state; } };
}
function copyPreparation() {
  const base = path.join(repository, '.verification-test-build'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'bootstrap-offline-'));
  const files = [...canonicalInputs().map(value => value.filename), 'backend/prisma/schema.prisma', 'backend/prisma/migrations/migration_lock.toml', 'release/clean-install/baseline.sql', 'release/clean-install/profile.json'];
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.copyFileSync(path.join(repository, file), path.join(root, file)); }
  return root;
}

test('all 25 canonical digests match profile and unchanged Step 02 inventory', () => {
  const verified = verifyPreparation();
  const old = JSON.parse(fs.readFileSync(path.join(repository, 'release/working-tree-inventory.json'), 'utf8'));
  const files = old.files.filter(file => file.path.endsWith('/migration.sql'));
  assert.equal(files.length, 25);
  assert.equal(files.every(file => digest(fs.readFileSync(path.join(repository, file.path))) === file.sha256), true);
  assert.equal(verified.canonicalMigrations, 25);
  assert.equal(verified.executionEnabled, false);
});
test('baseline preserves every canonical SQL statement exactly once, only relocating the FK', () => {
  const inputs = canonicalInputs(); const sql = fs.readFileSync(path.join(repository, 'release/clean-install/baseline.sql'), 'utf8');
  assert.equal(sql === deriveBaseline(inputs), true);
  const original = inputs.flatMap(input => splitSql(input.sql)).sort();
  const prepared = splitSql(sql).filter(statement => !['BEGIN', 'COMMIT', 'SET LOCAL search_path TO public'].includes(statement)).sort();
  assert.equal(JSON.stringify(original) === JSON.stringify(prepared), true);
  assert.equal(sql.indexOf('CREATE TABLE "ServiceVisit"') < sql.indexOf('ADD CONSTRAINT "QueueEntry_serviceVisitId_fkey"'), true);
  assert.equal(describeSql(inputs.map(input => input.sql).join('\n')).orderingIssues.length, 1);
  assert.deepEqual(describeSql(sql).orderingIssues, []);
});
test('required schema inventory includes handwritten constraints, indexes, defaults and settings', () => {
  const { inventory: i } = verifyPreparation();
  assert.equal(Object.keys(i.tables).length, 44); assert.equal(Object.keys(i.enums).length, 22);
  assert.equal(Object.keys(i.indexes).length, 64);
  for (const [kind, count] of [['FOREIGN KEY', 57], ['CHECK', 14], ['PRIMARY KEY', 44]]) assert.equal(i.constraints.filter(c => c.kind === kind).length, count);
  assert.equal(Object.values(i.indexes).filter(index => index.unique && index.predicate).length, 3);
  assert.equal(i.tables.User.authVersion, 'INTEGER NOT NULL DEFAULT 0');
  assert.equal(i.tables.User.staffPasswordChangeRequired, 'BOOLEAN NOT NULL DEFAULT false');
  assert.equal(i.tables.PasswordReset.purpose, "TEXT NOT NULL DEFAULT 'CUSTOMER_PASSWORD_RESET'");
  assert.equal(i.constraints.some(c => c.name === 'StaffInvitation_lifecycle_check'), true);
  assert.equal(i.constraints.some(c => c.name === 'QueueEntry_lifecycle_check'), true);
  assert.equal(i.constraints.some(c => c.name === 'LoyaltyStamp_value_check'), true);
  assert.equal(i.indexes.StaffInvitation_one_pending_per_salon_email_key.predicate, "WHERE \"status\" = 'PENDING'");
  assert.deepEqual(i.enums.SubscriptionPlan, ['FREE', 'SMART', 'PRO', 'PREMIUM']);
  assert.equal(Boolean(i.indexes.StaffPresenceLease_source_key), true);
  assert.equal(i.dataStatements.length, 3);
  assert.equal(i.dataStatements.some(statement => statement.startsWith('INSERT INTO "PlatformSettings"') && statement.includes('ON CONFLICT ("id") DO NOTHING')), true);
});
test('baseline covers Prisma fields/enum values and explicitly records canonical enum ordering', () => {
  const { inventory, profile } = verifyPreparation();
  const schema = fs.readFileSync(path.join(repository, 'backend/prisma/schema.prisma'), 'utf8');
  const scalarTypes = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes']);
  for (const match of schema.matchAll(/^enum (\w+)\s*\{([\s\S]*?)^\}/gm)) {
    scalarTypes.add(match[1]);
    const values = match[2].split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('//')).map(line => line.split(/\s+/)[0]);
    assert.deepEqual([...inventory.enums[match[1]]].sort(), [...values].sort());
  }
  const models = [...schema.matchAll(/^model (\w+)\s*\{([\s\S]*?)^\}/gm)];
  assert.equal(models.length, 44);
  for (const model of models) {
    assert.equal(Boolean(inventory.tables[model[1]]), true, model[1]);
    for (const field of model[2].matchAll(/^\s+(\w+)\s+(\w+)[?\[\]]*/gm)) if (scalarTypes.has(field[2])) assert.equal(field[1] in inventory.tables[model[1]], true, `${model[1]}.${field[1]}`);
  }
  assert.deepEqual(profile.knownSchemaFindings, [{ kind: 'enum-order', name: 'SubscriptionPlan', canonicalBaselineOrder: ['FREE', 'SMART', 'PRO', 'PREMIUM'], prismaSchemaOrder: ['FREE', 'SMART', 'PREMIUM', 'PRO'] }]);
});
test('altered canonical, baseline, schema, lock and inventory files fail closed in isolated copies', () => {
  for (const [file, code] of [
    ['backend/prisma/migrations/20260909231832_queue_entry_foundation/migration.sql', 'CANONICAL_HASH_MISMATCH'],
    ['release/clean-install/baseline.sql', 'BASELINE_HASH_MISMATCH'],
    ['backend/prisma/schema.prisma', 'SCHEMA_HASH_MISMATCH'],
    ['backend/prisma/migrations/migration_lock.toml', 'MIGRATION_LOCK_HASH_MISMATCH'],
  ]) {
    const root = copyPreparation(); fs.appendFileSync(path.join(root, file), '\n-- isolated mutation fixture\n');
    assert.throws(() => verifyPreparation(root), { code });
  }
  const root = copyPreparation(), file = path.join(root, 'release/clean-install/profile.json');
  const profile = JSON.parse(fs.readFileSync(file, 'utf8')); profile.expectedSchemaInventory.tables = {};
  fs.writeFileSync(file, JSON.stringify(profile));
  assert.throws(() => verifyPreparation(root), { code: 'BASELINE_INVENTORY_MISMATCH' });
});
test('selection requires explicit staging/disposable identity; malformed inputs trigger no inspection', async () => {
  for (const change of [null, {}, { environment: 'production' }, { disposable: false }, { database: 'salon' }, { user: 'postgres' }, { host: 'postgres://invalid' }, { systemIdentifier: undefined }, { databaseOid: undefined }, { schema: 'other' }, { port: 0 }]) {
    const mock = inspector();
    await assert.rejects(inspectEmptyDisposableTarget(change === null ? null : Object.keys(change).length ? { ...target(), ...change } : {}, mock));
    assert.deepEqual(mock.reads, []);
  }
  assert.match(validateSelection(target()), /^[a-f0-9]{64}$/);
});
test('unexpected database identity or unsafe role/version is rejected before catalog inspection', async () => {
  for (const change of [{ host: 'other.invalid' }, { port: 5433 }, { database: 'other' }, { user: 'other' }, { schema: 'other' }, { systemIdentifier: '2234567890123456789' }, { databaseOid: 16385 }, { serverVersionNum: 150000 }, { superuser: true }, { ownsDatabase: false }]) {
    const mock = inspector({ ...identity(), ...change });
    await assert.rejects(inspectEmptyDisposableTarget(target(), mock));
    assert.deepEqual(mock.reads, ['identity']);
  }
});
test('any existing schema object, extension, history or large object is refused', async () => {
  const changes = [{ userSchemas: ['public', 'other'] }, { extensions: ['plpgsql', 'other'] }, { largeObjectCount: 1 }, { prismaHistoryTablePresent: true }, { prismaHistoryRows: 1 }];
  for (const key of ['relations', 'types', 'routines', 'eventTriggers', 'publications', 'subscriptions', 'foreignServers', 'defaultPrivileges']) changes.push({ [key]: ['fixture'] }, { [key]: undefined });
  for (const change of changes) await assert.rejects(inspectEmptyDisposableTarget(target(), inspector(identity(), { ...catalog(), ...change })));
});
test('matching empty mocked target is eligible for review but never enables execution', async () => {
  const mock = inspector();
  assert.deepEqual(await inspectEmptyDisposableTarget(target(), mock), { eligibleForFutureReview: true, targetFingerprint: validateSelection(target()), executionEnabled: false });
  assert.deepEqual(mock.reads, ['identity', 'catalog']);
});
test('CLI planning is dry-run, never infers target, and refuses every apply request', () => {
  assert.throws(() => plan(), { code: 'EXPLICIT_DISPOSABLE_STAGING_REQUIRED' });
  const result = plan(args());
  assert.equal(result.mode, 'dry-run'); assert.equal(result.offlineOnly, true);
  assert.equal(result.databaseInspected, false); assert.equal(result.databaseEmptinessVerified, false);
  assert.equal(result.executionEnabled, false); assert.equal(result.postgresqlVerified, false);
  assert.equal(JSON.stringify(result).includes(target().database), false);
  for (const flags of [['--apply'], ['--approve-execution'], [...args(), '--apply', '--approve-execution']]) assert.throws(() => plan(flags), { code: 'APPLY_DISABLED_STEP04_REQUIRES_SEPARATE_APPROVAL_AND_VALIDATED_EXECUTOR' });
  assert.throws(() => plan([...args(), '--connection-string', 'synthetic-value']), { code: 'INVALID_OFFLINE_ARGUMENTS' });
  assert.throws(() => plan([...args(), '--host', 'other.invalid']), { code: 'INVALID_OFFLINE_ARGUMENTS' });
});
test('actual CLI has no environment-file, driver, network or subprocess initialization', () => {
  const script = fs.readFileSync(path.join(repository, 'scripts/bootstrap-empty-staging.mjs'), 'utf8');
  const imports = [...script.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]);
  assert.deepEqual(imports, ['node:fs', 'node:path', 'node:crypto', 'node:url']);
  assert.equal(/process\.env|import\s*\(|fetch\s*\(|spawn\s*\(|exec\s*\(/.test(script), false);
  // Trap all environment-file reads before loading the command. No real secrets.
  const harness = `import fs from 'node:fs'; const old=fs.readFileSync; fs.readFileSync=function(p,...args){if(/(?:^|[\\\\/])\\.env(?:\\.|$)/.test(String(p)))throw Error('ENV_READ_FORBIDDEN');return old.call(this,p,...args)}; const {plan}=await import('./scripts/bootstrap-empty-staging.mjs');console.log(JSON.stringify(plan(${JSON.stringify(args())})));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', harness], { cwd: repository, encoding: 'utf8', env: { DATABASE_URL: 'synthetic-unused-marker', SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, 'dry-run'); assert.equal(output.databaseInspected, false);
  assert.equal((result.stdout + result.stderr).includes('synthetic-unused-marker'), false);
});
