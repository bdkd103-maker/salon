// Step 04 preparation only: no database driver, Prisma client, dotenv, subprocess,
// network transport, apply implementation, or migration-history writer is loaded.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const cutoff = '20261114010000_staff_onboarding_foundation';
const queue = '20260909231832_queue_entry_foundation';
const visit = '20260910130000_service_visit_foundation';
export const digest = value => createHash('sha256').update(value).digest('hex');
const refuse = code => { throw Object.assign(new Error(code), { code }); };
const stable = value => JSON.stringify(value);

function read(root, relative) {
  if (!/^(?:backend\/prisma\/(?:schema\.prisma|migrations\/migration_lock\.toml|migrations\/[a-zA-Z0-9_]+\/migration\.sql)|release\/clean-install\/(?:baseline\.sql|profile\.json))$/.test(relative)) refuse('UNSAFE_PREPARATION_PATH');
  let target = root;
  for (const part of relative.split('/')) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink()) refuse('PREPARATION_LINK_REFUSED');
  }
  return fs.readFileSync(target);
}

export function canonicalInputs(root = repository) {
  const base = path.join(root, 'backend/prisma/migrations');
  if (fs.lstatSync(base).isSymbolicLink()) refuse('PREPARATION_LINK_REFUSED');
  const names = fs.readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (names.length !== 25 || names.at(-1) !== cutoff) refuse('CANONICAL_CUTOFF_REVIEW_REQUIRED');
  return names.map(name => {
    const filename = `backend/prisma/migrations/${name}/migration.sql`;
    const bytes = read(root, filename);
    return { filename, sha256: digest(bytes), sql: bytes.toString('utf8').replace(/\r\n/g, '\n') };
  });
}

export function deriveBaseline(inputs) {
  const fk = /ALTER TABLE "QueueEntry"\s+ADD CONSTRAINT "QueueEntry_serviceVisitId_fkey"\s+FOREIGN KEY \("serviceVisitId"\)\s+REFERENCES "ServiceVisit"\("id"\)\s+ON DELETE RESTRICT\s+ON UPDATE CASCADE;/g;
  const source = inputs.find(input => input.filename.includes(`/${queue}/`));
  const matches = source?.sql.match(fk);
  if (matches?.length !== 1 || !inputs.some(input => input.filename.includes(`/${visit}/`))) refuse('BASELINE_DERIVATION_REVIEW_REQUIRED');
  const blocks = inputs.map(input => {
    let sql = input.sql;
    if (input === source) sql = sql.replace(fk, '-- ServiceVisit FK deferred below; all other canonical SQL is retained.');
    if (input.filename.includes(`/${visit}/`)) sql += `\n-- Deferred FK: target and its primary key now exist.\n${matches[0]}\n`;
    return `-- Canonical source: ${input.filename}\n${sql.trimEnd()}\n`;
  });
  return '-- SALO Step 04: reviewed empty-database baseline PREPARATION ONLY.\n'
    + '-- Never apply manually or to an existing database. Canonical history is unchanged.\n'
    + '-- Derivation: preserve every canonical statement, moving only the premature QueueEntry FK.\n'
    + 'BEGIN;\nSET LOCAL search_path TO public;\n\n' + blocks.join('\n') + '\nCOMMIT;\n';
}

// Quote/comment-aware statement and comma splitting for the reviewed SQL subset.
// This inventories source DDL; it is not a PostgreSQL SQL parser or executor.
export function splitSql(source, separator = ';') {
  const pieces = []; let buffer = '', quote = '', depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      buffer += char;
      if (char === quote) { if (source[i + 1] === quote) buffer += source[++i]; else quote = ''; }
      continue;
    }
    if (char === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') i++;
      buffer += '\n'; continue;
    }
    if (char === "'" || char === '"') { quote = char; buffer += char; continue; }
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === separator && (separator === ';' || depth === 0)) { if (buffer.trim()) pieces.push(buffer.trim()); buffer = ''; }
    else buffer += char;
  }
  if (quote || depth !== 0) refuse('SQL_INVENTORY_PARSE_REFUSED');
  if (buffer.trim()) pieces.push(buffer.trim());
  return pieces;
}
const normal = value => value.replace(/\s+/g, ' ').trim();
const identifier = name => Buffer.from(name).subarray(0, 63).toString('utf8');
const columns = value => [...value.matchAll(/"([^"]+)"/g)].map(match => match[1]);

export function describeSql(sql) {
  const tables = {}, enums = {}, indexes = {}, constraints = [], dataStatements = [], orderingIssues = [];
  function constraint(table, part) {
    const match = part.match(/^CONSTRAINT "([^"]+)"\s+([\s\S]+)$/);
    if (!match) refuse('UNRECOGNIZED_CONSTRAINT');
    const definition = normal(match[2]);
    const kind = ['PRIMARY KEY', 'FOREIGN KEY', 'CHECK', 'UNIQUE'].find(value => definition.startsWith(value));
    if (!kind || constraints.some(value => value.table === table && value.name === identifier(match[1]))) refuse('CONSTRAINT_INVENTORY_REVIEW_REQUIRED');
    constraints.push({ table, name: identifier(match[1]), kind, definition });
    const reference = definition.match(/REFERENCES "([^"]+)"\s*\(([^)]+)\)/);
    if (reference) {
      if (!tables[reference[1]]) orderingIssues.push(`Table not yet created: ${reference[1]}`);
      else for (const column of columns(reference[2])) if (!(column in tables[reference[1]])) orderingIssues.push(`Reference column missing: ${reference[1]}.${column}`);
    }
  }
  for (const statement of splitSql(sql)) {
    let match;
    if (/^(?:BEGIN|COMMIT|SET LOCAL search_path TO public)$/.test(statement)) continue;
    if ((match = statement.match(/^CREATE TYPE "([^"]+)" AS ENUM\s*\(([\s\S]+)\)$/))) {
      if (enums[match[1]]) refuse('DUPLICATE_ENUM');
      enums[match[1]] = [...match[2].matchAll(/'((?:''|[^'])*)'/g)].map(value => value[1].replace(/''/g, "'"));
    } else if ((match = statement.match(/^ALTER TYPE "([^"]+)" ADD VALUE '([^']+)' AFTER '([^']+)'$/))) {
      const values = enums[match[1]]; const at = values?.indexOf(match[3]);
      if (at === undefined || at < 0 || values.includes(match[2])) refuse('ENUM_ORDER_REFUSED');
      values.splice(at + 1, 0, match[2]);
    } else if ((match = statement.match(/^CREATE TABLE "([^"]+)"\s*\(([\s\S]*)\)$/))) {
      const table = match[1]; if (tables[table]) refuse('DUPLICATE_TABLE'); tables[table] = {};
      for (const part of splitSql(match[2], ',')) {
        const field = part.match(/^"([^"]+)"\s+([\s\S]+)$/);
        if (field) tables[table][field[1]] = normal(field[2]); else constraint(table, part);
      }
    } else if ((match = statement.match(/^ALTER TABLE "([^"]+)"\s+([\s\S]+)$/))) {
      const table = match[1]; if (!tables[table]) refuse('ALTER_BEFORE_TABLE');
      for (const part of splitSql(match[2], ',')) {
        const field = part.match(/^ADD COLUMN\s+"([^"]+)"\s+([\s\S]+)$/);
        if (field) { if (field[1] in tables[table]) refuse('DUPLICATE_COLUMN'); tables[table][field[1]] = normal(field[2]); }
        else if (part.startsWith('ADD CONSTRAINT ')) constraint(table, part.slice(4));
        else refuse('UNRECOGNIZED_ALTER');
      }
    } else if ((match = statement.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+"([^"]+)"\s*\(([^)]+)\)([\s\S]*)$/))) {
      const name = identifier(match[2]), table = match[3];
      if (!tables[table] || indexes[name]) refuse('INDEX_INVENTORY_REVIEW_REQUIRED');
      for (const column of columns(match[4])) if (!(column in tables[table])) refuse('INDEX_COLUMN_MISSING');
      indexes[name] = { table, unique: Boolean(match[1]), columns: columns(match[4]), predicate: normal(match[5]), definition: normal(statement.replace(`"${match[2]}"`, `"${name}"`)) };
    } else if ((match = statement.match(/^ALTER INDEX\s+"([^"]+)"\s+RENAME TO\s+"([^"]+)"$/))) {
      const oldName = identifier(match[1]), newName = identifier(match[2]);
      if (!indexes[oldName] || indexes[newName]) refuse('INDEX_RENAME_REFUSED');
      indexes[newName] = { ...indexes[oldName], definition: indexes[oldName].definition.replace(`"${oldName}"`, `"${newName}"`) }; delete indexes[oldName];
    } else if (/^(?:UPDATE|INSERT INTO) /.test(statement)) dataStatements.push(normal(statement));
    else refuse('UNRECOGNIZED_BASELINE_STATEMENT');
  }
  return { tables, enums, constraints, indexes, dataStatements, orderingIssues };
}

export function schemaFindings(schema, inventory) {
  const findings = [], scalars = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes']);
  for (const match of schema.matchAll(/^enum (\w+)\s*\{([\s\S]*?)^\}/gm)) {
    scalars.add(match[1]);
    const values = match[2].split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('//')).map(line => line.split(/\s+/)[0]);
    const baselineValues = inventory.enums[match[1]];
    if (!baselineValues || stable([...values].sort()) !== stable([...baselineValues].sort())) refuse('SCHEMA_ENUM_VALUES_DIFFER');
    if (stable(values) !== stable(baselineValues)) findings.push({ kind: 'enum-order', name: match[1], canonicalBaselineOrder: baselineValues, prismaSchemaOrder: values });
  }
  for (const model of schema.matchAll(/^model (\w+)\s*\{([\s\S]*?)^\}/gm)) {
    if (!inventory.tables[model[1]]) refuse('SCHEMA_MODEL_MISSING');
    for (const field of model[2].matchAll(/^\s+(\w+)\s+(\w+)[?\[\]]*/gm)) if (scalars.has(field[2]) && !(field[1] in inventory.tables[model[1]])) refuse('SCHEMA_COLUMN_MISSING');
  }
  return findings;
}

export function verifyPreparation(root = repository) {
  const profile = JSON.parse(read(root, 'release/clean-install/profile.json').toString('utf8'));
  const inputs = canonicalInputs(root);
  if (profile.format !== 1 || profile.cutoff !== cutoff || profile.prismaVersion !== '5.22.0' || profile.databaseEngine !== 'PostgreSQL 16' || profile.canonicalReplayRemainsBroken !== true || profile.executionEnabled !== false || profile.postgresqlVerified !== false) refuse('PROFILE_POLICY_REFUSED');
  const actual = inputs.map(({ filename, sha256 }) => ({ filename, sha256 }));
  if (stable(actual) !== stable(profile.canonicalMigrations)) refuse('CANONICAL_HASH_MISMATCH');
  if (digest(read(root, 'backend/prisma/schema.prisma')) !== profile.prismaSchemaSha256) refuse('SCHEMA_HASH_MISMATCH');
  if (digest(read(root, 'backend/prisma/migrations/migration_lock.toml')) !== profile.migrationLockSha256) refuse('MIGRATION_LOCK_HASH_MISMATCH');
  const baseline = read(root, 'release/clean-install/baseline.sql');
  if (digest(baseline) !== profile.baselineSha256) refuse('BASELINE_HASH_MISMATCH');
  if (baseline.toString('utf8') !== deriveBaseline(inputs)) refuse('BASELINE_DERIVATION_MISMATCH');
  const inventory = describeSql(baseline.toString('utf8'));
  if (inventory.orderingIssues.length || stable(inventory) !== stable(profile.expectedSchemaInventory)) refuse('BASELINE_INVENTORY_MISMATCH');
  if (stable(schemaFindings(read(root, 'backend/prisma/schema.prisma').toString('utf8'), inventory)) !== stable(profile.knownSchemaFindings)) refuse('SCHEMA_FINDINGS_REVIEW_REQUIRED');
  return { profile, inventory, baselineSha256: profile.baselineSha256, canonicalMigrations: actual.length, executionEnabled: false, postgresqlVerified: false };
}

export function validateSelection(target) {
  if (!target || target.environment !== 'staging' || target.disposable !== true) refuse('EXPLICIT_DISPOSABLE_STAGING_REQUIRED');
  if (typeof target.host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(target.host)
      || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535
      || typeof target.database !== 'string' || !/^salo_staging_disposable_[a-z0-9]{8,24}$/.test(target.database)
      || typeof target.user !== 'string' || !/^salo_staging_bootstrap_[a-z0-9]{8,24}$/.test(target.user)
      || target.schema !== 'public' || !/^[1-9][0-9]{15,19}$/.test(target.systemIdentifier || '')
      || !Number.isInteger(target.databaseOid) || target.databaseOid < 1 || target.databaseOid > 4294967295) refuse('EXPLICIT_TARGET_IDENTITY_REQUIRED');
  return digest(stable(['staging', true, target.host, target.port, target.database, target.user, target.schema, target.systemIdentifier, target.databaseOid]));
}

/** Future read-only inspection boundary. Tests inject mocks only.
 * No connector is implemented or instantiated in this phase.
 * A future executor also needs exclusive access and an in-transaction recheck.
 */
export async function inspectEmptyDisposableTarget(target, inspector) {
  const targetFingerprint = validateSelection(target);
  if (!inspector || typeof inspector.readIdentity !== 'function' || typeof inspector.readCatalog !== 'function') refuse('INSPECTOR_REQUIRED');
  const actual = await inspector.readIdentity();
  for (const key of ['host', 'port', 'database', 'user', 'schema', 'systemIdentifier', 'databaseOid']) if (actual?.[key] !== target[key]) refuse('UNEXPECTED_DATABASE_IDENTITY');
  if (!Number.isInteger(actual.serverVersionNum) || actual.serverVersionNum < 160000 || actual.serverVersionNum >= 170000 || actual.ownsDatabase !== true || actual.superuser !== false) refuse('DATABASE_ROLE_OR_VERSION_REFUSED');
  const catalog = await inspector.readCatalog();
  if (!catalog || stable(catalog.userSchemas) !== stable(['public']) || stable(catalog.extensions) !== stable(['plpgsql'])) refuse('NONEMPTY_OR_UNEXPECTED_SCHEMA');
  for (const key of ['relations', 'types', 'routines', 'eventTriggers', 'publications', 'subscriptions', 'foreignServers', 'defaultPrivileges']) if (!Array.isArray(catalog[key]) || catalog[key].length) refuse('NONEMPTY_OR_UNEXPECTED_SCHEMA');
  if (catalog.largeObjectCount !== 0 || catalog.prismaHistoryTablePresent !== false || catalog.prismaHistoryRows !== 0) refuse('EXISTING_DATABASE_OR_HISTORY_REFUSED');
  return { eligibleForFutureReview: true, targetFingerprint, executionEnabled: false };
}

export function plan(argv = [], root = repository) {
  // Refuse execution before reading any input/target. No flag can enable it.
  if (argv.includes('--apply') || argv.includes('--approve-execution')) refuse('APPLY_DISABLED_STEP04_REQUIRES_SEPARATE_APPROVAL_AND_VALIDATED_EXECUTOR');
  const options = {}; const names = new Set(['--host', '--port', '--database', '--user', '--cluster-id', '--database-oid']);
  let disposable = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--disposable-staging' && !disposable) { disposable = true; continue; }
    if (!names.has(flag) || flag in options || !argv[i + 1] || argv[i + 1].startsWith('--')) refuse('INVALID_OFFLINE_ARGUMENTS');
    options[flag] = argv[++i];
  }
  const target = { environment: 'staging', disposable, host: options['--host'], port: Number(options['--port']), database: options['--database'], user: options['--user'], schema: 'public', systemIdentifier: options['--cluster-id'], databaseOid: Number(options['--database-oid']) };
  const targetFingerprint = validateSelection(target);
  const verified = verifyPreparation(root);
  return { mode: 'dry-run', offlineOnly: true, targetFingerprint, baselineSha256: verified.baselineSha256, canonicalMigrations: verified.canonicalMigrations, databaseInspected: false, databaseEmptinessVerified: false, executionEnabled: false, canonicalReplayRemainsBroken: true, postgresqlVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(plan(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.code || 'OFFLINE_PREPARATION_REFUSED'); process.exitCode = 1; }
}
