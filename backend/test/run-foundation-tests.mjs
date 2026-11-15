// Mocked foundation/regression tests must not load developer environment files.
// Keep this guard process-local; never change Prisma's generated files or config.
import fs from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';

function isEnvironmentFile(value) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof URL)) return false;
  const name = basename(value instanceof URL ? fileURLToPath(value) : String(value));
  return name === '.env' || name.startsWith('.env.');
}
const exists = fs.existsSync;
const read = fs.readFileSync;
const readAsync = fs.promises.readFile;
fs.existsSync = function (path) { return isEnvironmentFile(path) ? false : exists.call(this, path); };
fs.readFileSync = function (path, ...args) {
  if (isEnvironmentFile(path)) throw new Error('Environment-file access prohibited in isolated foundation tests');
  return read.call(this, path, ...args);
};
fs.promises.readFile = async function (path, ...args) {
  if (isEnvironmentFile(path)) throw new Error('Environment-file access prohibited in isolated foundation tests');
  return readAsync.call(this, path, ...args);
};
syncBuiltinESMExports();
// Even an accidental delegate call must not target a configured developer DB.
process.env.DATABASE_URL = 'postgresql://fixture:fixture@127.0.0.1:1/isolated?connect_timeout=1';
if (process.argv[2] === '--schema-policy') {
  process.argv = [process.execPath, process.argv[1], '--policy'];
  await import('./staff-onboarding-schema.test.mjs');
} else {
  if (process.argv.slice(2).some(file => !file.endsWith('.test.ts') || !resolve(file).startsWith(resolve('src') + sep))) {
    throw new Error('Only backend source test suites are allowed');
  }
  // Existing runner installs .js-to-.ts resolution and mocked platform policy.
  await import(pathToFileURL(resolve('test/run-typescript.mjs')).href);
}
