import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const block = message => { throw new Error(`BLOCKED: ${message}`); };
export function safeSource(file) {
  return typeof file === 'string' && !file.includes('\\') && !file.includes(':') && !file.startsWith('/')
    && !file.split('/').some(part => !part || part === '..')
    && !/(?:^|\/)(?:\.env[^/]*|\.git|node_modules|\.aws|\.ssh|\.codex|\.tmp[^/]*|\.verification-test-build)(?:\/|$)/i.test(file)
    && !/(?:check-admin-password|create-admin|verify-|debug-booking|shot-)/i.test(file)
    && !/(?:^|\/)(?:secrets?|credentials?|private[-_]?keys?|tokens?)(?:\/|$)/i.test(file)
    && !/(?:^|\/)[^/]*(?:secret|credential|private[-_]?key|password|token)[^/]*$/i.test(file)
    && /\.(?:mjs|cjs|js|ts|json|html|css|md|sql|toml|yml|yaml|svg|webp|png|jpe?g)$/.test(file);
}
function sourcePath(root, file) {
  if (!safeSource(file)) block('sensitive, diagnostic or unsupported scope path');
  let full = root;
  for (const part of file.split('/')) {
    full = path.join(full, part);
    if (!fs.existsSync(full)) return path.resolve(root, file);
    if (fs.lstatSync(full).isSymbolicLink()) block('scope links are prohibited');
  }
  return full;
}
function childEnv() {
  const env = { GIT_OPTIONAL_LOCKS: '0' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'HOME', 'HOMEDRIVE', 'HOMEPATH']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
function git(root, args) {
  const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '--no-optional-locks', ...args], { cwd: root, env: childEnv(), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) block('Git inventory unavailable');
  return result.stdout;
}
export function inventory(root = repository) {
  const files = [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort();
  return files.map(file => {
    if (!safeSource(file)) return { file, coverage: 'path-only' };
    const full = sourcePath(root, file);
    if (!fs.existsSync(full)) return { file, coverage: 'missing' };
    const stat = fs.lstatSync(full);
    return stat.isFile() ? { file, coverage: 'sha256', sha256: sha(fs.readFileSync(full)) } : { file, coverage: 'metadata-only' };
  });
}
export function compareScope(before, after, files) {
  const old = new Map(before.map(entry => [entry.file, JSON.stringify(entry)]));
  const current = new Map(after.map(entry => [entry.file, JSON.stringify(entry)]));
  const changed = [...new Set([...old.keys(), ...current.keys()])].filter(file => old.get(file) !== current.get(file));
  return { changed, outsideScope: changed.filter(file => !files.includes(file)), limitation: 'Git-listed safe source bytes only; sensitive/diagnostic contents and ignored files are not fingerprinted. This is not a backup.' };
}
export function selectChecks(files, mode = 'fast') {
  if (!['fast', 'finish', 'review'].includes(mode) || !files.length || files.some(file => !safeSource(file))) block('explicit safe file scope required');
  const groups = new Set(); const needsBrowser = files.some(file => /^(?:www\/|assets\/|admin\/)|^(?:index|women|customer-profile|admin)\.html$|^scripts\/test-browser-mock\.mjs$|^tests\/(?:staff-authorization|staff-logout|owner-team-authorization|admin-session|smart-busy-reminder|staff-localization)\.spec\.js$/.test(file));
  const backend = files.filter(file => /^backend\/(?:src\/|typings\/|tsconfig\.json|package(?:-lock)?\.json)/.test(file));
  const unverified = [];
  for (const file of backend) {
    if (/\/service-visit(?:\.test)?\.ts$/.test(file)) groups.add('service');
    else if (/\/staff-presence(?:\.test)?\.ts$/.test(file)) groups.add('presence');
    else if (/\/loyalty(?:\.test)?\.ts$/.test(file)) groups.add('loyalty');
    else unverified.push(file);
  }
  const highRisk = files.filter(file => /^backend\/prisma\/|^\.devcontainer\/|^release\/Dockerfile$|(?:^|\/)(?:dev-up|dev-frontend)\.sh$/.test(file));
  const needsWorkflow = files.some(file => /^(?:scripts\/(?:quality-gate|test-backend-unit)\.mjs|tests\/development-workflow\.test\.mjs|package\.json)$/.test(file));
  return { mode, needsBrowser, needsWorkflow, backend: backend.length > 0, unitGroups: [...groups], unverifiedBackend: unverified, highRisk, disclaimer: 'Checks validate selected evidence only. Current behavior is not a verified functional baseline.' };
}

export function syntaxCheck(file, bytes) {
  if (file.endsWith('.json')) JSON.parse(bytes.toString('utf8'));
  if (file.endsWith('.html')) {
    for (const match of bytes.toString('utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/.test(match[1])) continue;
      const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
      if (type === 'module') block('inline module syntax needs a reviewed parser');
      if (!type || /^(?:text|application)\/(?:java|ecma)script$/i.test(type)) new vm.Script(match[2], { filename: file });
    }
  }
}
function executeNode(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: repository, env: childEnv(), encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  return { check: label, status: result.status === 0 ? 'PASS' : result.error || result.status === 2 || /BLOCKED:|re-audit required|Executable doesn't exist/.test(output) ? 'BLOCKED' : 'FAIL', exitCode: result.status, evidence: output.slice(-14000) };
}
export function summarize(results) {
  return results.some(result => result.status === 'FAIL') ? 'FAIL' : results.some(result => result.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
}
function baselinePath(relative) {
  if (!/^\.verification-test-build\/quality-gate\/[a-f0-9-]{36}\.json$/.test(relative || '')) block('invalid baseline reference');
  let full = repository;
  for (const part of relative.split('/')) { full = path.join(full, part); if (fs.existsSync(full) && fs.lstatSync(full).isSymbolicLink()) block('baseline links are prohibited'); }
  return full;
}
export function main(argv) {
  let mode = 'fast', capture = false, baseline;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--capture' && !capture) capture = true;
    else if (argv[i] === '--mode' && argv[i + 1]) mode = argv[++i];
    else if (argv[i] === '--baseline' && argv[i + 1]) baseline = argv[++i];
    else if (argv[i] === '--files') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) files.push(argv[++i]); }
    else block('unknown command argument');
  }
  const plan = selectChecks([...new Set(files)], mode);
  for (const file of files) sourcePath(repository, file);
  if (capture) {
    if (baseline || mode !== 'fast') block('capture must be separate from validation');
    const relative = `.verification-test-build/quality-gate/${randomUUID()}.json`;
    const full = baselinePath(relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify({ format: 1, files, inventory: inventory() }, null, 2), { flag: 'wx' });
    return { status: 'PASS', action: 'capture', baseline: relative, functionalBaseline: false, limitation: 'Safe source fingerprints, not a backup or proof of correctness.' };
  }
  const results = [];
  if (baseline) {
    const before = JSON.parse(fs.readFileSync(baselinePath(baseline), 'utf8'));
    if (before.format !== 1 || JSON.stringify([...before.files].sort()) !== JSON.stringify([...files].sort())) block('baseline scope mismatch');
    const review = compareScope(before.inventory, inventory(), files);
    results.push({ check: 'working-tree scope', status: review.outsideScope.length ? 'FAIL' : 'PASS', ...review });
  } else results.push({ check: 'working-tree scope', status: 'BLOCKED', evidence: 'Capture before implementation; no evidence to attribute changes to this task.' });
  if (mode === 'review') {
    return { status: summarize(results), plan, results, manualReviewRequired: ['unintended changes', 'frontend/backend contracts', 'authentication and role/salon isolation', 'database/migration impact', 'acceptance criteria and missing regressions', 'unverified behavior'], testsExecuted: false };
  }
  // A scope failure stops execution. Never inspect sensitive file diffs.
  if (summarize(results) !== 'PASS') return { status: summarize(results), plan, results };
  const whitespace = spawnSync('git', ['-c', `safe.directory=${repository.replaceAll('\\', '/')}`, '--no-optional-locks', 'diff', '--check', '--', ...files], { cwd: repository, env: childEnv(), encoding: 'utf8' });
  results.push({ check: 'scoped tracked whitespace', status: whitespace.status === 0 ? 'PASS' : 'FAIL', evidence: whitespace.stdout });
  for (const file of files) {
    const full = sourcePath(repository, file);
    if (!fs.existsSync(full)) { results.push({ check: file, status: 'BLOCKED', evidence: 'Deleted/missing files require explicit review.' }); continue; }
    const bytes = fs.readFileSync(full);
    try {
      syntaxCheck(file, bytes);
      if (/[ \t]+$/m.test(bytes.toString('utf8')) && /\.(?:js|mjs|cjs|ts|css|md|html|json)$/.test(file)) results.push({ check: `${file}: whitespace`, status: 'FAIL', evidence: 'Trailing whitespace in scoped file; includes pre-existing content.' });
      if (/\.(?:mjs|cjs|js)$/.test(file)) results.push(executeNode(['--check', full], `syntax: ${file}`));
      else results.push({ check: `static: ${file}`, status: 'PASS', evidence: /\.(?:json|html)$/.test(file) ? 'Parse only; no application execution.' : 'File inspection only; no linter or behavioral coverage claimed.' });
    } catch (error) { results.push({ check: `syntax: ${file}`, status: error.message.startsWith('BLOCKED:') ? 'BLOCKED' : 'FAIL', evidence: error.message }); }
    const mirror = file.startsWith('www/') ? file.slice(4) : /^(?:assets|admin)\/|^(?:index|women|customer-profile|admin)\.html$/.test(file) ? `www/${file}` : null;
    if (mirror) {
      const other = sourcePath(repository, mirror);
      results.push({ check: `mirror: ${file}`, status: fs.existsSync(other) && bytes.equals(fs.readFileSync(other)) ? 'PASS' : 'FAIL' });
    }
  }
  if (plan.highRisk.length) results.push({ check: 'specialized review', status: 'BLOCKED', evidence: plan.highRisk });
  if (mode === 'finish' && summarize(results) === 'PASS') {
    if (plan.needsWorkflow) results.push(executeNode(['--test', 'tests/development-workflow.test.mjs'], 'workflow regression tests'));
    for (const group of plan.unitGroups) results.push(executeNode(['scripts/test-backend-unit.mjs', '--group', group], `pure backend: ${group}`));
    if (plan.unverifiedBackend.length) results.push({ check: 'backend behavior coverage', status: 'BLOCKED', evidence: plan.unverifiedBackend });
    if (plan.backend) results.push(executeNode(['backend/node_modules/typescript/bin/tsc', '-p', 'backend/tsconfig.json', '--noEmit', '--pretty', 'false'], 'backend TypeScript (full project)'));
    if (plan.needsBrowser) results.push(executeNode(['scripts/test-browser-mock.mjs'], 'six audited mock browser suites'));
  }
  return { status: summarize(results), plan, results, coverage: mode === 'fast' ? 'FAST STATIC ONLY; not task completion or application correctness.' : 'Selected checks only; acceptance criteria and independent review remain required.', unavailable: ['ESLint is not installed/configured; no lint pass claimed.'], deploymentReady: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const report = main(process.argv.slice(2)); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2; }
  catch (error) { console.error(JSON.stringify({ status: 'BLOCKED', evidence: error.message })); process.exitCode = 2; }
}
