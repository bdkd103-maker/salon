import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function prismaEnvironment(guard, receipt) {
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[name]) env[name] = process.env[name];
  return { ...env, NODE_OPTIONS: `--require=${JSON.stringify(guard)}`,
    SALO_OFFLINE_GUARD_LOG: receipt, PRISMA_GENERATE_SKIP_AUTOINSTALL: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1',
    DATABASE_URL: ['postgresql:', '', 'unused:unused@127.0.0.1:1/offline_never_connect'].join('/'),
  };
}
export function prepareSchema(source) {
  if (!/generator client\s*\{[^}]*provider\s*=\s*"prisma-client-js"/.test(source)
    || (source.match(/^generator /gm) || []).length !== 1
    || /generator client\s*\{[^}]*\boutput\s*=/.test(source)) throw new Error('Unexpected Prisma generator');
  return source.replace(/(generator client\s*\{)/, '$1\n  output = "./client"');
}
export function prismaTooling(typecheck = true) {
  const backend = path.join(root, 'backend');
  const cli = path.join(backend, 'node_modules/prisma/build/index.js');
  const tsc = path.join(backend, 'node_modules/typescript/bin/tsc');
  if (!fs.existsSync(cli) || !fs.existsSync(tsc)) throw new Error('BLOCKED: install locked backend dependencies with ignore-scripts first');
  const versions = ['backend/node_modules/prisma/package.json', 'backend/node_modules/@prisma/client/package.json', 'node_modules/@prisma/internals/package.json']
    .map(file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).version);
  if (new Set(versions).size !== 1) throw new Error('BLOCKED: Prisma CLI, Client and isolated SDK versions must match');
  const base = path.join(backend, '.verification-test-build');
  fs.mkdirSync(base, { recursive: true });
  const isolated = fs.mkdtempSync(path.join(base, 'offline-prisma-'));
  const schema = path.join(isolated, 'schema.prisma');
  // Stop package-root discovery before ancestor environment files.
  fs.writeFileSync(path.join(isolated, 'package.json'), '{"private":true}', { flag: 'wx' });
  fs.writeFileSync(schema, prepareSchema(fs.readFileSync(path.join(backend, 'prisma/schema.prisma'), 'utf8')), { flag: 'wx' });
  const guard = path.join(root, 'scripts/offline-tool-guard.cjs');
  const receipt = path.join(isolated, 'guard.jsonl');
  const env = prismaEnvironment(guard, receipt);
  const generate = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--generate-isolated', schema], { cwd: isolated, env, encoding: 'utf8', timeout: 120000 });
  const output = String(generate.stdout || '') + String(generate.stderr || '');
  fs.writeFileSync(path.join(isolated, 'generate.log'), output.replaceAll(env.DATABASE_URL, '[synthetic URL redacted]'));
  if (generate.status !== 0) throw new Error('BLOCKED: offline Prisma generation failed; inspect isolated generate.log');
  const events = fs.readFileSync(receipt, 'utf8').trim().split('\n').map(line => JSON.parse(line).event);
  if (!events.includes('installed') || events.includes('network-denied') || events.includes('env-read-denied')) throw new Error('Offline generation guard refused an operation');
  if (!fs.existsSync(path.join(isolated, 'client/index.d.ts'))) throw new Error('Missing generated client types');
  console.log(JSON.stringify({ generation: 'PASS', engine: 'none', databaseAccess: false, environmentFileReads: false, artifacts: path.relative(root, isolated) }));
  if (!typecheck) return 0;
  const config = { extends: path.join(backend, 'tsconfig.json'), compilerOptions: {
    baseUrl: backend, paths: { '@prisma/client': [path.join(isolated, 'client/index.d.ts')] },
  } };
  fs.writeFileSync(path.join(isolated, 'tsconfig.json'), JSON.stringify(config, null, 2));
  const checked = spawnSync(process.execPath, [tsc, '-p', path.join(isolated, 'tsconfig.json'), '--noEmit', '--pretty', 'false'], { cwd: isolated, env, encoding: 'utf8', timeout: 120000 });
  const diagnostics = String(checked.stdout || '') + String(checked.stderr || '');
  fs.writeFileSync(path.join(isolated, 'typecheck.log'), diagnostics);
  const finalEvents = fs.readFileSync(receipt, 'utf8');
  if (/network-denied|env-read-denied/.test(finalEvents)) throw new Error('Offline type-check guard refused an operation');
  process.stdout.write(diagnostics);
  return checked.status ?? 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const schema = process.argv[3];
  if (process.argv[2] !== '--generate-isolated' || !schema || !path.resolve(schema).startsWith(path.join(root, 'backend/.verification-test-build/offline-prisma-')) || !process.env.SALO_OFFLINE_GUARD_LOG) {
    throw new Error('Isolated guarded worker only');
  }
  const sdk = await import('@prisma/internals');
  const { Generator, getConfig, getDMMF } = sdk.default || sdk;
  const datamodel = fs.readFileSync(schema, 'utf8');
  const config = await getConfig({ datamodel, ignoreEnvVarErrors: false });
  const dmmf = await getDMMF({ datamodel });
  const generatorConfig = config.generators[0];
  generatorConfig.output = { fromEnvVar: null, value: path.join(path.dirname(schema), 'client') };
  generatorConfig.isCustomOutput = true;
  const generator = new Generator(path.join(root, 'backend/node_modules/@prisma/client/generator-build/index.js'), generatorConfig, true);
  try {
    await generator.init();
    generator.setOptions({ generator: generatorConfig, otherGenerators: [], schemaPath: schema,
      datamodel, datasources: config.datasources, dmmf, binaryPaths: { libqueryEngine: {} }, noEngine: true,
      version: generator.manifest.requiresEngineVersion, envPaths: { rootEnvPath: null, schemaEnvPath: undefined },
    });
    await generator.generate();
  } finally { generator.stop(); }
}
