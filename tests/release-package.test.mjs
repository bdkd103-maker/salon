import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { allowedPath, checkedFile, validate, auditMigrations, repository } from '../scripts/release-package.mjs';

function fixture() {
  const base = path.join(repository, '.verification-test-build');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'release-test-'));
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  const pkg = { dependencies: {}, devDependencies: {} };
  put('www/index.html', '<a href="/">Home</a>'); put('index.html', '<a href="/">Home</a>');
  put('backend/src/server.ts', 'export const fixture = true;');
  put('backend/package.json', JSON.stringify(pkg));
  put('backend/package-lock.json', JSON.stringify({ packages: { '': pkg } }));
  put('backend/prisma/schema.prisma', 'model User {\n  id String @id\n}\n');
  put('backend/prisma/migrations/001_init/migration.sql', 'CREATE TABLE "User" (\n "id" TEXT NOT NULL\n);');
  const manifest = { version: 1, webDocumentRoot: 'www', frontend: ['www/index.html'], backendSource: ['backend/src/server.ts'], backendBuild: ['backend/package.json', 'backend/package-lock.json'], prisma: ['backend/prisma/schema.prisma', 'backend/prisma/migrations/001_init/migration.sql'], packaging: [], runtimeDependencies: {} };
  return { root, put, manifest };
}

test('release paths reject environment files, credentials, traversal and dependency trees before reading', () => {
  for (const file of ['.env', 'backend/.env.example', '../outside', '/absolute', 'C:/absolute', 'www/../backend/src/server.ts', 'www/.git/config', 'backend/node_modules/fastify/index.js', 'www/key.pem', 'local.sqlite', 'www//index.html']) {
    assert.equal(allowedPath(file), false);
    assert.throws(() => checkedFile(repository, file), /Excluded or unsafe/);
  }
  assert.equal(allowedPath('backend/src/lib/credential-proof-purpose.ts'), true);
  assert.equal(allowedPath('backend/prisma/migrations/001_init/migration.sql'), true);
});
test('complete explicit inputs validate, include hashes, and support directory index links', () => {
  const { root, manifest } = fixture();
  const result = validate(root, manifest);
  assert.equal(result.files.length, 6);
  assert.equal(result.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)), true);
  assert.deepEqual(result.migrations.issues, []);
});
test('an unknown frontend or backend file requires explicit review', () => {
  for (const file of ['www/new.js', 'backend/src/new.ts']) {
    const { root, manifest, put } = fixture(); put(file, 'fixture');
    assert.throws(() => validate(root, manifest), /inventory changed/);
  }
});
test('root document roots and root/www drift are rejected', () => {
  const { root, manifest, put } = fixture();
  assert.throws(() => validate(root, { ...manifest, webDocumentRoot: '.' }), /dedicated www/);
  put('index.html', 'changed');
  assert.throws(() => validate(root, manifest), /Root\/www mismatch/);
});
test('missing frontend references and unlisted backend imports fail validation', () => {
  const a = fixture(); a.put('www/index.html', '<script src="missing.js"></script>'); a.put('index.html', '<script src="missing.js"></script>');
  assert.throws(() => validate(a.root, a.manifest), /reference is not packaged/);
  const b = fixture(); b.put('backend/src/server.ts', 'import "./missing.js";');
  assert.throws(() => validate(b.root, b.manifest), /import not packaged/);
  const c = fixture(); c.put('backend/src/server.ts', 'import unsafe from "unlisted-package";');
  assert.throws(() => validate(c.root, c.manifest), /Undeclared runtime import/);
});
test('new migrations and dependency declaration drift require review', () => {
  const a = fixture(); a.put('backend/prisma/migrations/002_new/migration.sql', '-- fixture');
  assert.throws(() => validate(a.root, a.manifest), /Migration inventory changed/);
  const b = fixture(); b.put('backend/package.json', JSON.stringify({ dependencies: { unlisted: '1.0.0' }, devDependencies: {} }));
  assert.throws(() => validate(b.root, b.manifest), /lockfile\/package mismatch/);
});
test('DDL audit detects forward references and accepts whitespace in ADD COLUMN statements', () => {
  const { root, put } = fixture();
  put('backend/prisma/migrations/002_forward/migration.sql', 'ALTER TABLE "User" ADD COLUMN     "laterId" TEXT; ALTER TABLE "User" ADD CONSTRAINT "fk" FOREIGN KEY ("laterId") REFERENCES "Later"("id");');
  put('backend/prisma/migrations/003_later/migration.sql', 'CREATE TABLE "Later" (\n "id" TEXT NOT NULL\n);');
  put('backend/prisma/schema.prisma', 'model User {\n id String @id\n laterId String?\n}\nmodel Later {\n id String @id\n}\n');
  const result = auditMigrations(root, ['backend/prisma/migrations/001_init/migration.sql', 'backend/prisma/migrations/002_forward/migration.sql', 'backend/prisma/migrations/003_later/migration.sql']);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /Reference precedes table creation: Later/);
});
test('data-changing migration reporting never includes SQL values', () => {
  const { root, put } = fixture();
  put('backend/prisma/migrations/002_data/migration.sql', 'UPDATE "User" SET "id" = \'synthetic-marker\';');
  const result = auditMigrations(root, ['backend/prisma/migrations/001_init/migration.sql', 'backend/prisma/migrations/002_data/migration.sql']);
  assert.deepEqual(result.inventory[1].dataChanges, [{ operation: 'UPDATE', table: 'User' }]);
  assert.equal(JSON.stringify(result).includes('synthetic-marker'), false);
});
test('Linux recipe builds fresh dependencies/client and excludes source from runtime image', () => {
  const docker = fs.readFileSync(path.join(repository, 'release/Dockerfile'), 'utf8');
  const runtime = docker.split(' AS runtime')[1];
  assert.match(docker, /npm ci --no-audit --no-fund/);
  assert.match(docker, /npm run db:generate && npm run build/);
  assert.match(docker, /npm prune --omit=dev/);
  assert.match(runtime, /\/opt\/generated-prisma/);
  assert.match(runtime, /\/app\/backend\/dist/);
  assert.match(runtime, /www \/app\/www/);
  assert.match(runtime, /USER node/);
  assert.equal(/COPY[^\n]*(?:\/src|backend\/src)/.test(runtime), false);
  assert.equal(/RUN[^\n]*(?:migrate|db:deploy|db:push)/.test(docker), false);
  assert.equal(/COPY\s+\.\s/.test(docker), false);
});

test('real release integrates disabled, hash-verified clean-install preparation without claiming replay works', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'release/manifest.json'), 'utf8'));
  const result = validate(repository, manifest);
  assert.equal(result.files.length, 137);
  assert.equal(result.cleanInstall.offlinePreparationVerified, true);
  assert.equal(result.cleanInstall.executionEnabled, false);
  assert.equal(result.cleanInstall.postgresqlVerified, false);
  assert.equal(result.migrations.issues.length, 1);
  assert.match(result.migrations.issues[0], /Reference precedes table creation: ServiceVisit/);
  const docker = fs.readFileSync(path.join(repository, 'release/Dockerfile'), 'utf8');
  assert.match(docker, /FROM build AS migration-tools/);
  assert.match(docker, /ENTRYPOINT \["node", "\/app\/scripts\/bootstrap-empty-staging.mjs"\]/);
  assert.equal(/clean-install|bootstrap-empty-staging/.test(docker.split(' AS runtime')[1]), false);
  assert.equal(docker.split(' AS runtime')[1].includes('CMD ["node", "dist/server.js"]'), true);
});
