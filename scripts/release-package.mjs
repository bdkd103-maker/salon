import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPreparation } from './bootstrap-empty-staging.mjs';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
export function allowedPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.includes(':')
    && !value.startsWith('/') && !value.split('/').some(part => !part || part === '..' || part.startsWith('.'))
    && !/(?:^|\/)(?:node_modules|coverage|test-results|dist|build)(?:\/|$)/i.test(value)
    && !/\.(?:pem|key|p12|pfx|crt|sqlite|sqlite3|db|log|tmp|temp)$/i.test(value)
    && !/(?:^|\/)(?:credentials|secrets|id_rsa|id_ed25519)(?:\.|\/|$)/i.test(value);
}
export function checkedFile(root, relative) {
  if (!allowedPath(relative)) fail('Excluded or unsafe manifest path');
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('Links are prohibited in release input');
  }
  if (!fs.statSync(current).isFile()) fail(`Missing release file: ${relative}`);
  return current;
}
export function walk(root, relative) {
  const directory = path.join(root, relative);
  if (fs.lstatSync(directory).isSymbolicLink()) fail('Links are prohibited in release input');
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) fail('Links are prohibited in release input');
    return entry.isDirectory() ? walk(root, name) : [name];
  }).sort();
}
const sourceFiles = root => walk(root, 'backend/src').filter(file => file.endsWith('.ts') && !/\.test(?:-support)?\.ts$/.test(file));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Structural DDL audit only. This is NOT a SQL executor or a migration proof. */
export function auditMigrations(root, files) {
  const tables = new Map();
  const inventory = [];
  const issues = [];
  for (const file of files.filter(file => file.endsWith('/migration.sql')).sort()) {
    const bytes = fs.readFileSync(checkedFile(root, file));
    const sql = bytes.toString('utf8').replace(/--[^\n]*/g, '');
    const dataChanges = [...sql.matchAll(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+"([^"]+)"/g)].map(match => ({ operation: match[1], table: match[2] }));
    for (const statement of sql.split(';')) {
      const create = statement.match(/CREATE TABLE "([^"]+)"\s*\(([\s\S]*)\)/);
      if (create) {
        if (tables.has(create[1])) issues.push(`Duplicate CREATE TABLE in ${file}`);
        tables.set(create[1], new Set([...create[2].matchAll(/^\s*"([^"]+)"\s+/gm)].map(match => match[1])));
      }
      const alter = statement.match(/ALTER TABLE "([^"]+)"/);
      if (alter) {
        if (!tables.has(alter[1])) { issues.push(`ALTER precedes table creation: ${alter[1]} in ${file}`); tables.set(alter[1], new Set()); }
        for (const match of statement.matchAll(/ADD COLUMN\s+"([^"]+)"/g)) {
          if (tables.get(alter[1]).has(match[1])) issues.push(`Duplicate column in ${file}`);
          tables.get(alter[1]).add(match[1]);
        }
      }
      for (const match of statement.matchAll(/REFERENCES "([^"]+)"\s*\(([^)]+)\)/g)) {
        if (!tables.has(match[1])) { issues.push(`Reference precedes table creation: ${match[1]} in ${file}`); continue; }
        for (const column of [...match[2].matchAll(/"([^"]+)"/g)].map(value => value[1])) {
          if (!tables.get(match[1]).has(column)) issues.push(`Referenced column absent in ${file}`);
        }
      }
    }
    inventory.push({ path: file, sha256: hash(bytes), dataChanges, requiresSpecialReview: dataChanges.length > 0 || /\b(?:DROP|TRUNCATE)\b/.test(sql) });
  }
  const schema = fs.readFileSync(checkedFile(root, 'backend/prisma/schema.prisma'), 'utf8');
  const scalars = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', ...[...schema.matchAll(/^enum (\w+)/gm)].map(match => match[1])]);
  for (const model of schema.matchAll(/^model (\w+)\s*\{([\s\S]*?)^\}/gm)) {
    if (!tables.has(model[1])) { issues.push(`Model has no CREATE TABLE: ${model[1]}`); continue; }
    for (const field of model[2].matchAll(/^\s+(\w+)\s+(\w+)[?\[\]]*/gm)) {
      if (scalars.has(field[2]) && !tables.get(model[1]).has(field[1])) issues.push(`Schema column missing from migrations: ${model[1]}.${field[1]}`);
    }
  }
  return { inventory, issues, limitation: 'Static table/column/reference audit only; PostgreSQL execution, type/default/index equivalence and checksums against any existing database are not verified.' };
}

export function validate(root, manifest) {
  if (manifest.version !== 1 || manifest.webDocumentRoot !== 'www') fail('Only the dedicated www document root is permitted');
  const entries = [...manifest.frontend, ...manifest.backendSource, ...manifest.backendBuild, ...manifest.prisma, ...manifest.packaging];
  if (new Set(entries).size !== entries.length) fail('Duplicate manifest entries');
  entries.forEach(file => checkedFile(root, file));
  if (!same(walk(root, 'www'), manifest.frontend)) fail('Frontend inventory changed: explicit manifest review required');
  if (!same(sourceFiles(root), manifest.backendSource)) fail('Backend source inventory changed: explicit manifest review required');
  const migrationFiles = walk(root, 'backend/prisma/migrations');
  if (!same(migrationFiles, manifest.prisma.filter(file => file.startsWith('backend/prisma/migrations/')))) fail('Migration inventory changed: explicit manifest review required');
  for (const file of manifest.frontend) {
    const mirror = file.slice('www/'.length);
    if (!fs.readFileSync(checkedFile(root, file)).equals(fs.readFileSync(checkedFile(root, mirror)))) fail(`Root/www mismatch: ${mirror}`);
    if (!file.endsWith('.html')) continue;
    for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const value = match[1];
      if (/^(?:https?:|data:|mailto:|tel:|javascript:|#)/i.test(value) || value.includes('${')) continue;
      const clean = value.split(/[?#]/)[0];
      if (!clean) continue;
      let target = path.posix.normalize(clean.startsWith('/') ? `www/${clean.slice(1)}` : path.posix.join(path.posix.dirname(file), clean));
      if (!manifest.frontend.includes(target) && manifest.frontend.includes(`${target.replace(/\/$/, '')}/index.html`)) target = `${target.replace(/\/$/, '')}/index.html`;
      if (!manifest.frontend.includes(target)) fail(`Local frontend reference is not packaged: ${target}`);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'backend/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'backend/package-lock.json'), 'utf8'));
  for (const kind of ['dependencies', 'devDependencies']) {
    if (!same(Object.entries(pkg[kind]), Object.entries(lock.packages[''][kind]))) fail('Backend lockfile/package mismatch');
  }
  if (!same(Object.entries(pkg.dependencies), Object.entries(manifest.runtimeDependencies))) fail('Runtime dependencies changed: manifest review required');
  for (const [location, info] of Object.entries(lock.packages)) {
    if (!location) continue;
    if (!location.startsWith('node_modules/') || info.link || (info.resolved && !info.resolved.startsWith('https://registry.npmjs.org/')) || !info.integrity) fail('Unreviewed dependency source in lockfile');
  }
  for (const file of manifest.backendSource) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/(?:from\s*|import\s*\(|import\s*)["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('.')) {
        let target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
        if (!manifest.backendSource.includes(target)) fail(`Local backend import not packaged: ${target}`);
      } else {
        const dependency = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (!(dependency in manifest.runtimeDependencies)) fail(`Undeclared runtime import: ${dependency}`);
      }
    }
  }
  let cleanInstall;
  if (manifest.cleanInstall) {
    const expected = ['release/clean-install/baseline.sql', 'release/clean-install/profile.json', 'scripts/bootstrap-empty-staging.mjs'];
    if (!same(manifest.cleanInstall.files || [], expected) || !expected.every(file => entries.includes(file)) || manifest.cleanInstall.executionEnabled !== false) fail('Clean-install preparation must be explicitly allowlisted and disabled');
    const verified = verifyPreparation(root);
    cleanInstall = { offlinePreparationVerified: true, baselineSha256: verified.baselineSha256, canonicalMigrations: verified.canonicalMigrations, executionEnabled: false, postgresqlVerified: false, canonicalReplayRemainsBroken: true };
  }
  return { files: entries.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })), migrations: auditMigrations(root, manifest.prisma), ...(cleanInstall ? { cleanInstall } : {}) };
}

function gitInventory(root, manifest, files) {
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) fail('Git inventory unavailable');
    return result.stdout;
  };
  const tracked = new Set(git(['ls-files', '-z']).split('\0').filter(Boolean));
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean).map(line => ({ status: line.slice(0, 2), path: line.slice(3) }));
  const candidate = new Set(files.map(file => file.path));
  const companions = new Set(manifest.frontend.map(file => file.slice(4)));
  const category = file => {
    if (/(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx|db|sqlite)$/i.test(file) || /(?:check-admin-password|create-admin)\.ts$/.test(file)) return 'sensitive-or-credential-tooling-excluded';
    if (manifest.prisma.includes(file)) return 'schema-or-migration';
    if (candidate.has(file) || companions.has(file)) return 'application-or-build-input';
    if (/(?:\.test(?:-support)?\.|\.spec\.|^tests\/|^backend\/test\/)/.test(file)) return 'tests-or-verification-tools-excluded';
    if (/\.md$|^(?:docs|backend\/docs)\//.test(file)) return 'documentation-excluded';
    if (/(?:^|\/)\.tmp|^\.header-|\.(?:png|jpg|pid|log)$/.test(file)) return 'temporary-or-diagnostic-review-excluded';
    return 'other-development-or-native-artifact-excluded';
  };
  return {
    changes: status.map(entry => ({ ...entry, category: category(entry.path), inCandidate: candidate.has(entry.path) })),
    requiredAbsentFromCheckout: [...new Set([...candidate, ...companions])].filter(file => !tracked.has(file)).sort(),
    requiredChangedFromCheckout: status.filter(entry => entry.status !== '??' && (candidate.has(entry.path) || companions.has(entry.path))).map(entry => entry.path),
  };
}

export function run(command = 'validate') {
  if (!['validate', 'prepare', 'build-local'].includes(command)) fail('Use validate, prepare, or build-local');
  const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'release/manifest.json'), 'utf8'));
  const audited = validate(repository, manifest);
  const report = { format: 1, deploymentReady: false, webDocumentRoot: 'www', ...audited, ...gitInventory(repository, manifest, audited.files) };
  if (command === 'validate') {
    if (audited.migrations.issues.length) process.exitCode = 1;
    return { manifestValid: true, validatedFiles: audited.files.length, migrations: audited.migrations.inventory.length, migrationIssues: audited.migrations.issues, frontendFiles: manifest.frontend.length, requiredAbsentFromCheckout: report.requiredAbsentFromCheckout.length, ...(audited.cleanInstall ? { cleanInstall: audited.cleanInstall } : {}), deploymentReady: false };
  }
  const base = path.join(repository, '.verification-test-build');
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) fail('Workspace links are prohibited');
  fs.mkdirSync(base, { recursive: true });
  const workspace = path.join(base, `release-${randomUUID()}`);
  fs.mkdirSync(workspace); // New unique directory only; never overwrite or remove existing work.
  const context = path.join(workspace, 'context');
  for (const entry of audited.files) {
    const destinationName = entry.path === 'release/Dockerfile' ? 'Dockerfile' : entry.path === 'release/context.dockerignore' ? '.dockerignore' : entry.path;
    const destination = path.join(context, destinationName);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const content = fs.readFileSync(checkedFile(repository, entry.path));
    if (hash(content) !== entry.sha256) fail('Input changed during packaging; prepare again');
    fs.writeFileSync(destination, content, { flag: 'wx' });
  }
  fs.writeFileSync(path.join(workspace, 'inventory.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  const result = { workspace: path.relative(repository, workspace), sourceFiles: audited.files.length, deploymentReady: false };
  if (command === 'build-local') {
    // Compile only. Never start the app, load dotenv, install dependencies, or use Prisma CLI.
    const toolPackage = path.join(repository, 'backend/node_modules/tsup/package.json');
    const tool = JSON.parse(fs.readFileSync(toolPackage, 'utf8'));
    const bin = typeof tool.bin === 'string' ? tool.bin : tool.bin.tsup;
    const env = { NODE_ENV: 'production', TEMP: workspace, TMP: workspace };
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC']) if (process.env[key]) env[key] = process.env[key];
    const build = spawnSync(process.execPath, [path.resolve(path.dirname(toolPackage), bin), path.join(context, 'backend/src/server.ts'), '--tsconfig', path.join(context, 'backend/tsconfig.json'), '--format', 'esm', '--clean'], { cwd: path.join(context, 'backend'), env, encoding: 'utf8', timeout: 120_000 });
    // Logs remain outside the Docker context. No application execution or runtime credentials.
    fs.writeFileSync(path.join(workspace, 'build.log'), (build.stdout || '') + (build.stderr || ''), { flag: 'wx' });
    const output = path.join(context, 'backend/dist/server.js');
    result.build = { status: build.status, outputExists: fs.existsSync(output), platform: process.platform, cleanDependencyInstall: false, linuxVerified: false };
    if (fs.existsSync(output)) result.build.outputSha256 = hash(fs.readFileSync(output));
    fs.writeFileSync(path.join(workspace, 'build-result.json'), JSON.stringify(result.build, null, 2), { flag: 'wx' });
    if (build.status !== 0) process.exitCode = 1;
  }
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(run(process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
