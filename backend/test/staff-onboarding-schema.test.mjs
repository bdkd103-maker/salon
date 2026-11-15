import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname } from 'node:path';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../prisma/migrations/20261114010000_staff_onboarding_foundation/migration.sql', import.meta.url), 'utf8');

function schemaMetadata() {
  // Extract only the installed, self-contained WASM schema-engine wrapper.
  // Do not execute the Prisma CLI bootstrap (which would load environment files).
  const require = createRequire(import.meta.url);
  const cli = require.resolve('prisma');
  const bundle = readFileSync(cli, 'utf8');
  const marker = 'var yI=S((bFt,Tr)=>{';
  const start = bundle.indexOf(marker);
  assert.equal(start >= 0, true, 'Installed Prisma schema-engine wrapper must be recognized');
  const end = bundle.indexOf('});var bI=S', start);
  assert.equal(end > start, true);
  const module = { exports: {} };
  new Function('require', '__dirname', 'Tr', bundle.slice(start + marker.length, end))(require, dirname(cli), module);
  return JSON.parse(module.exports.get_dmmf(JSON.stringify({ prismaSchema: schema, noColor: true })));
}

test('installed Prisma schema engine validates additive schema without CLI, dotenv, network or database', () => {
  const dmmf = schemaMetadata();
  const models = dmmf.datamodel.models;
  const user = models.find(model => model.name === 'User');
  assert.equal(user.fields.find(field => field.name === 'authVersion').default, 0);
  assert.equal(user.fields.find(field => field.name === 'staffPasswordChangeRequired').default, false);
  assert.equal(models.find(model => model.name === 'PasswordReset').fields.find(field => field.name === 'purpose').default, 'CUSTOMER_PASSWORD_RESET');
  const invitation = models.find(model => model.name === 'StaffInvitation');
  for (const name of ['salonId', 'initiatedByUserId', 'destinationEmail', 'intendedUserId', 'secretDigest', 'generation', 'expiresAt', 'status', 'deliveryState', 'providerMessageId', 'acceptedAt', 'revokedAt', 'consumedAt', 'acceptedByUserId', 'resendCount', 'createdAt', 'updatedAt']) assert.equal(invitation.fields.some(field => field.name === name), true, name);
  assert.equal(invitation.fields.some(field => field.name === 'secret' || field.name === 'password'), false);
  assert.equal(models.find(model => model.name === 'StaffMembership').uniqueFields.some(fields => fields.join(',') === 'userId,salonId'), true);
});

test('migration supplies concurrency-safe partial uniqueness, normalization and lifecycle safeguards', () => {
  assert.match(sql, /CREATE UNIQUE INDEX "StaffInvitation_one_pending_per_salon_email_key"\s+ON "StaffInvitation"\("salonId", "destinationEmail"\) WHERE "status" = 'PENDING'/);
  assert.match(sql, /lower\(btrim\("destinationEmail"\)\)/);
  assert.match(sql, /"StaffInvitation_expiry_check" CHECK \("expiresAt" > "createdAt"\)/);
  assert.match(sql, /"generation" >= 1/);
  assert.match(sql, /"status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "consumedAt" IS NOT NULL AND "secretDigest" IS NULL/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.match(sql, /"status" = 'PENDING' AND "secretDigest" IS NOT NULL/);
  const statements = sql.replace(/--[^\n]*/g, '');
  assert.equal(/\b(?:DELETE|UPDATE|INSERT|DROP|TRUNCATE)\s+(?:FROM|INTO|TABLE|"User"|"StaffMembership")/i.test(statements), false);
  assert.equal(/ALTER TABLE "StaffMembership"/.test(statements), false);
  assert.match(sql, /ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'CUSTOMER_PASSWORD_RESET'/);
});

// Optional schema-metadata-only regression harness while the actual client is
// intentionally not regenerated. No delegates, generated files or DB are changed.
if (process.argv.includes('--policy')) {
  registerHooks({ resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      const target = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
      if (existsSync(target)) return next(target.href, context);
    }
    return next(specifier, context);
  } });
  const { Prisma } = await import('@prisma/client');
  Prisma.dmmf.datamodel.models.splice(0, Prisma.dmmf.datamodel.models.length, ...schemaMetadata().datamodel.models);
  await import('../src/lib/salon-deletion-policy.test.ts');
}
