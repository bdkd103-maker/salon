// Audited pure-unit boundary. No Prisma, backend bootstrap, dotenv or network.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const units = Object.freeze([
  { group: 'service', test: 'backend/src/lib/service-visit.test.ts', helper: 'backend/src/lib/service-visit.ts', hash: '1717a39c1cfd04a67f0ac0cc7f1a9bcfb6d6edb2dadf46d06ee54cd94197ee6c' },
  { group: 'presence', test: 'backend/src/lib/staff-presence.test.ts', helper: 'backend/src/lib/staff-presence.ts', hash: '2f2551b8038e7b8c8a577b89ca006a2b8764f401660b24f3eacf4cc6dd3cd9b2' },
  { group: 'loyalty', test: 'backend/src/lib/loyalty.test.ts', helper: 'backend/src/lib/loyalty.ts', hash: '82f207bd27ca217a7574f6897f9ad89428dbe0f29e71015c1996d09b2028e833' },
].map(Object.freeze));
const denied = () => { throw new Error('BLOCKED: pure-unit import/network/environment boundary'); };
const permittedFiles = new Set(units.flatMap(unit => [unit.test, unit.helper]).map(file => path.join(root, file)));
const permittedBuiltins = new Set(['node:assert/strict', 'node:test', 'node:fs']);

export function resolveUnitImport(specifier, parentURL) {
  if (permittedBuiltins.has(specifier)) return specifier;
  let target;
  try { target = fileURLToPath(new URL(specifier, parentURL)); } catch { denied(); }
  if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
  if (!permittedFiles.has(target)) denied();
  return pathToFileURL(target).href;
}

export function check(group = 'all') {
  const selected = units.filter(unit => group === 'all' || unit.group === group);
  if (!selected.length) throw new Error('BLOCKED: unknown pure-unit group');
  for (const unit of selected) {
    for (const file of [unit.test, unit.helper]) {
      let target = root;
      for (const part of file.split('/')) { target = path.join(target, part); if (fs.lstatSync(target).isSymbolicLink()) denied(); }
    }
    const hash = createHash('sha256').update(fs.readFileSync(path.join(root, unit.test))).digest('hex');
    if (hash !== unit.hash) throw new Error(`BLOCKED: re-audit changed unit suite ${unit.test}`);
  }
  return selected;
}

function protectChild() {
  const isSensitive = value => /(?:^|[\\/])(?:\.env(?:\.|$)|\.aws(?:[\\/]|$)|\.ssh(?:[\\/]|$))|\.(?:pem|key|p12|pfx)$/i.test(String(value));
  const read = fs.readFileSync, exists = fs.existsSync, asyncRead = fs.promises.readFile;
  fs.existsSync = file => !isSensitive(file) && exists(file);
  fs.readFileSync = (file, ...args) => { if (isSensitive(file)) denied(); return read(file, ...args); };
  fs.promises.readFile = async (file, ...args) => { if (isSensitive(file)) denied(); return asyncRead(file, ...args); };
  syncBuiltinESMExports();
  globalThis.fetch = denied; globalThis.WebSocket = class { constructor() { denied(); } };
  // Only these audited modules can be imported, including dynamic imports.
  registerHooks({ resolve(specifier, context, next) {
    return next(resolveUnitImport(specifier, context.parentURL), context);
  } });
}

export async function run(group = 'all') {
  const selected = check(group); let failed = false;
  const env = { SALO_PURE_UNIT_CHILD: '1' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME']) if (process.env[key]) env[key] = process.env[key];
  for (const unit of selected) {
    console.log(`PURE UNIT: ${unit.test}`);
    const code = await new Promise(resolve => {
      const child = spawn(process.execPath, ['--experimental-transform-types', '--import', import.meta.url, path.join(root, unit.test)], { cwd: root, env, shell: false, stdio: 'inherit' });
      child.once('error', () => resolve(2)); child.once('exit', code => resolve(code ?? 2));
    });
    failed ||= code !== 0;
  }
  return failed ? 1 : 0;
}
const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--check') console.log(JSON.stringify(check().map(unit => unit.test)));
    else if (!args.length) process.exitCode = await run();
    else if (args.length === 2 && args[0] === '--group') process.exitCode = await run(args[1]);
    else throw new Error('BLOCKED: only audited unit groups are accepted');
  } catch (error) { console.error(error.message); process.exitCode = 2; }
} else if (process.env.SALO_PURE_UNIT_CHILD === '1') {
  const unit = units.find(unit => path.join(root, unit.test) === entry);
  if (!unit) denied(); check(unit.group); protectChild();
}
