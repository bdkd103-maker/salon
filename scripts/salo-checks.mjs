// Fixed, reviewed tooling entrypoints. No app bootstrap, dotenv or DB transport.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeSource, syntaxCheck } from './quality-gate.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const skillNames = ['salo-project-expert', 'salo-bug-hunter', 'salo-feature-developer', 'salo-quality-gate'];
export function cleanEnv() {
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
function git(args) {
  const r = spawnSync('git', ['--no-optional-locks', ...args], { cwd: root, env: cleanEnv(), encoding: 'utf8' });
  if (r.status !== 0) throw new Error('BLOCKED: Git inventory unavailable');
  return r.stdout;
}
export function validateSkills() {
  const instructions = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  for (const name of skillNames) {
    const file = path.join(root, '.agents/skills', name, 'SKILL.md');
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Skill link refused');
    const source = fs.readFileSync(file, 'utf8');
    const metadata = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!metadata || !metadata[1].split(/\r?\n/).includes(`name: ${name}`) || !/^description: .{20,1024}$/m.test(metadata[1])) throw new Error('Invalid skill metadata: ' + name);
    if (!source.includes('AGENTS.md') || !source.includes('docs/SALO-AI-TOOLING.md')) throw new Error('Missing skill guidance: ' + name);
    if (!instructions.includes(`.agents/skills/${name}/SKILL.md`)) throw new Error('Missing AGENTS skill reference: ' + name);
  }
  for (const file of ['SALO-AI-TOOLING.md', 'SALO-PROJECT-KNOWLEDGE.md', 'SALO-FEATURE-STATUS.md', 'SALO-ENGINEERING-BACKLOG.md']) {
    if (!fs.statSync(path.join(root, 'docs', file)).isFile()) throw new Error('Missing source documentation');
  }
  return { skills: skillNames, metadataValid: true, clientDiscovery: 'Client reload may be required; metadata validation is not a UI discovery claim.' };
}
export function scanText(text) {
  const patterns = {
    'private-key': /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    'aws-key': /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    'github-token': /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
    'provider-key': /\b(?:sk_live_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{30,}|re_[A-Za-z0-9]{24,})\b/,
    'signed-jwt': /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/,
    'literal-secret': /\b(?:JWT_(?:ACCESS|REFRESH)_SECRET|RESEND_API_KEY|DATABASE_URL|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*["'][^"'\n]{12,}["']/i,
    'database-password-url': /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?)\x3a\/\/[^\s/:]+:[^\s@]+@/i,
  };
  return text.split(/\r?\n/).flatMap((line, index) => Object.entries(patterns).filter(([, re]) => re.test(line)).map(([rule]) => ({ line: index + 1, rule })));
}
function changedFiles(base) {
  if (base && !/^[a-f0-9]{40}$/.test(base)) throw new Error('BLOCKED: base must be a full commit SHA');
  return [...new Set((base ? git(['diff', '--name-only', '--diff-filter=ACMR', '-z', `${base}...HEAD`]) : git(['diff', '--name-only', '--diff-filter=ACMR', '-z', 'HEAD']) + git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean))];
}
function readSource(file) {
  let full = root;
  for (const part of file.split('/')) {
    full = path.join(full, part);
    if (fs.lstatSync(full).isSymbolicLink()) throw new Error('BLOCKED: source link refused');
  }
  return fs.readFileSync(full);
}
export function staticChecks(files) {
  const results = [];
  for (const file of files) {
    if (!safeSource(file)) { results.push({ file, status: 'BLOCKED', reason: 'Sensitive/diagnostic/unsupported path requires manual review; content not read' }); continue; }
    const bytes = readSource(file);
    syntaxCheck(file, bytes);
    const mirror = file.startsWith('www/') ? file.slice(4) : /^(?:assets|admin)\/|^(?:index|women|customer-profile|admin)\.html$/.test(file) ? 'www/' + file : null;
    if (mirror && !bytes.equals(readSource(mirror))) throw new Error('Mirror mismatch: ' + file);
    if (/\.(?:mjs|cjs|js)$/.test(file)) {
      const r = spawnSync(process.execPath, ['--check', path.join(root, file)], { cwd: root, env: cleanEnv(), encoding: 'utf8' });
      if (r.status !== 0) throw new Error('JavaScript syntax failed: ' + file);
    }
    results.push({ file, status: 'PASS', findings: scanText(bytes.toString('utf8')) });
  }
  return results;
}
export async function validateCI(source) {
  const { parseDocument } = await import('yaml');
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error('Invalid workflow YAML');
  const ci = document.toJS();
  if (JSON.stringify(Object.keys(ci.on).sort()) !== JSON.stringify(['pull_request', 'workflow_dispatch'])) throw new Error('Unsafe workflow trigger');
  if (JSON.stringify(ci.permissions) !== JSON.stringify({ contents: 'read' })) throw new Error('Workflow permissions must be read-only');
  const job = ci.jobs?.checks;
  if (ci.env || job?.env || job?.services || job?.environment || job?.permissions) throw new Error('Unexpected workflow capability');
  if (Object.keys(ci.jobs).length !== 2 || job?.['runs-on'] !== 'ubuntu-latest' || JSON.stringify(job.strategy.matrix.check) !== JSON.stringify(['test', 'browser', 'typecheck'])) throw new Error('Unexpected workflow jobs');
  const release = ci.jobs['release-integrity'];
  if (release?.if !== "github.event_name == 'workflow_dispatch'" || release['runs-on'] !== 'ubuntu-latest' || release.env || release.services || release.environment || release.permissions
    || release.steps.at(-1)?.run !== 'node scripts/salo-checks.mjs integrity') throw new Error('Release integrity must remain isolated and enforced');
  const runs = new Set(['npm ci --ignore-scripts --no-audit --no-fund', 'npm ci --prefix backend --ignore-scripts --no-audit --no-fund', 'node scripts/salo-checks.mjs config', 'node scripts/salo-checks.mjs scan --base ${{ github.event.pull_request.base.sha || github.sha }}', 'node node_modules/playwright/cli.js install chromium', 'node scripts/salo-checks.mjs ${{ matrix.check }}', 'node scripts/salo-checks.mjs integrity']);
  for (const step of [...job.steps, ...release.steps]) {
    if (step.run && !runs.has(step.run)) throw new Error('Unreviewed CI command');
    if (step.env || step['working-directory']) throw new Error('Unexpected CI command environment');
    if (step.uses && !/^(?:actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683|actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020)$/.test(step.uses)) throw new Error('Unreviewed CI action');
    if (step.uses?.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) throw new Error('Checkout must not persist credentials');
  }
  if (/secrets\.|pull_request_target|continue-on-error|DATABASE_URL|environment:|services:/.test(source)) throw new Error('Unsafe workflow capability');
  return { yamlValid: true, permissions: 'contents:read', deployment: false };
}
export async function validateDisabledWorkflow(source) {
  const { parseDocument } = await import('yaml');
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error('Invalid disabled workflow YAML');
  const ci = document.toJS();
  const job = ci.jobs?.disabled;
  if (JSON.stringify(Object.keys(ci.on)) !== JSON.stringify(['workflow_dispatch'])
    || JSON.stringify(ci.permissions) !== JSON.stringify({ contents: 'read' })
    || Object.keys(ci.jobs).length !== 1 || job?.if !== '${{ false }}'
    || job['runs-on'] !== 'ubuntu-latest'
    || JSON.stringify(job.steps) !== JSON.stringify([{ run: 'echo "Deployment disabled; separate authorization required."' }])
    || /secrets\.|environment:|services:|pull_request_target/.test(source)) throw new Error('Release workflow must stay disabled');
  return { yamlValid: true, deploymentEnabled: false };
}
function run(args) {
  return spawnSync(process.execPath, args, { cwd: root, env: cleanEnv(), stdio: 'inherit', timeout: 180000 }).status ?? 2;
}
export async function main(args) {
  const [command, ...rest] = args;
  if (['test', 'typecheck', 'prisma', 'integrity', 'skills', 'config'].includes(command) && rest.length) throw new Error('Unexpected arguments');
  if (command === 'skills') { console.log(JSON.stringify(validateSkills(), null, 2)); return 0; }
  if (command === 'config') {
    const results = { ci: await validateCI(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')) };
    for (const file of ['release-production.yml', 'staging-release.yml']) results[file] = await validateDisabledWorkflow(fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8'));
    console.log(JSON.stringify(results)); return 0;
  }
  if (command === 'test') {
    validateSkills();
    const a = run(['--test', 'tests/ai-tooling.test.mjs', 'tests/development-workflow.test.mjs', 'tests/booking-window-regression.test.mjs', 'tests/booking-runtime-regression.test.mjs', 'tests/rate-limit-key-regression.test.mjs', 'tests/salon-hours-regression.test.mjs']);
    const b = run(['scripts/test-backend-unit.mjs']);
    return a || b;
  }
  if (command === 'typecheck' || command === 'prisma') {
    const { prismaTooling } = await import('./prisma-tooling.mjs');
    return prismaTooling(command === 'typecheck');
  }
  if (command === 'integrity') {
    const { verifyPreparation } = await import('./bootstrap-empty-staging.mjs');
    try { verifyPreparation(); console.log('PASS: frozen preparation'); return 0; }
    catch (error) { console.log('BLOCKED: ' + error.code); return 2; }
  }
  if (command === 'browser') {
    if (rest.length && (rest.length !== 2 || rest[0] !== '--browser' || !['msedge', 'chromium', 'system-chromium'].includes(rest[1]))) throw new Error('Invalid browser mode');
    return run(['scripts/test-browser-mock.mjs', '--browser', rest[1] || 'chromium']);
  }
  if (command === 'scan') {
    if (rest.length && (rest.length !== 2 || rest[0] !== '--base')) throw new Error('Invalid scan arguments');
    const results = staticChecks(changedFiles(rest[1]));
    console.log(JSON.stringify({ results, limitation: 'Changed safe source only; no ignored files/history or exhaustive secret detection. BLOCKED paths require manual review.' }, null, 2));
    return results.some(x => x.findings?.length) ? 1 : results.some(x => x.status === 'BLOCKED') ? 2 : 0;
  }
  throw new Error('Choose skills, config, test, browser, prisma, typecheck, integrity or scan');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
