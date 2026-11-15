// Audited mock-only browser suites. No discovery, dev servers, npm subprocesses,
// database clients, migrations, persistent browser profiles, or dependency installs.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// Hashes freeze the reviewed execution paths. Re-audit a changed suite before
// deliberately updating its digest; never refresh this allowlist automatically.
export const suites = Object.freeze([
  ['tests/staff-authorization.spec.js', 'd0d1b60fec360a04d514aebf52fc52cd04529b3021a43616f2bbd460edbfa5b7'],
  ['tests/staff-logout.spec.js', '991c17ba6f772e68ce26e4a2e9e1dae8e96e9230d6625353999e1659e37830b4'],
  ['tests/owner-team-authorization.spec.js', '1c957d814217e58e7fd46fdf2644c4c380249a6c5c4e3bff958808405df82e2a'],
  // Re-audited 2026-11-15: isolated contexts, synthetic credentials, intercepted APIs.
  ['tests/admin-session.spec.js', '1462c5be1293026a2d42abf9eb43a0042a351c188ed0d3b295281778a3cbe7be'],
  ['tests/smart-busy-reminder.spec.js', '45733cc6409cc2bd3d3a2bf177171346cde31135c0ab8a4ca5eb4a18333bf7d4'],
  ['tests/staff-localization.spec.js', '6a3bb2b691e47f5f9d068c026a54f0416136397e18bfac6dfaaa5de67c7d0305'],
].map(([file, sha256]) => Object.freeze({ file, sha256 })));

// Same byte-preserving CRLF normalization as the pure-unit runner.
export function sourceDigest(bytes) {
  const canonical = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    canonical.push(bytes[i]);
  }
  return createHash('sha256').update(Buffer.from(canonical)).digest('hex');
}

function verifySuite(suite) {
  let file = root;
  for (const part of suite.file.split('/')) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Mock suite links are prohibited');
  }
  if (!fs.statSync(file).isFile()) throw new Error(`Missing mock suite: ${suite.file}`);
  const actual = sourceDigest(fs.readFileSync(file));
  if (actual !== suite.sha256) throw new Error(`Mock isolation re-audit required: ${suite.file}`);
  return file;
}

export function check() {
  for (const suite of suites) verifySuite(suite);
  // Resolve an already installed dependency only. Never use npx or install it.
  require.resolve('playwright');
  return { suites: suites.map(suite => suite.file), auditedHashesMatch: true, developmentServerRequired: false, databaseRequired: false };
}

function childEnvironment() {
  // Do not inherit application credentials, database URLs, NODE_OPTIONS,
  // debugging hooks, remote-browser endpoints, or other test-mode overrides.
  const env = { SALO_MOCK_BROWSER_CHILD: '1' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'HOME', 'HOMEDRIVE', 'HOMEPATH']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function installBrowserGuard(suite) {
  verifySuite(suite);
  const { chromium } = require('playwright');
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async options => {
    const browser = await launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext({ ...options, serviceWorkers: 'block' });
      // Registered before the suites' fixtures: the latter take precedence.
      // Any fallthrough is denied, never forwarded to localhost or the internet.
      await context.route('**/*', route => route.abort());
      await context.routeWebSocket('**/*', socket => socket.close());
      return context;
    };
    return browser;
  };
}

export async function run() {
  check(); // Validate every suite before launching any of them.
  const failures = [];
  for (const suite of suites) {
    const file = verifySuite(suite);
    console.log(`\nMOCK ONLY: ${suite.file}`);
    const result = await new Promise(resolve => {
      // Import this same file as a child preload to install the browser guard.
      // Node receives one fixed, audited entrypoint; no shell or user test args.
      const child = spawn(process.execPath, ['--import', pathToFileURL(fileURLToPath(import.meta.url)).href, file], { cwd: root, env: childEnvironment(), shell: false, stdio: 'inherit' });
      child.once('error', () => resolve({ failed: true }));
      child.once('exit', (code, signal) => resolve({ failed: code !== 0 || Boolean(signal) }));
    });
    if (result.failed) failures.push(suite.file);
  }
  console.log(`\nMock browser suites: ${suites.length - failures.length} passed, ${failures.length} failed, 0 skipped.`);
  for (const file of failures) console.error(`FAILED: ${file}`);
  return failures.length ? 1 : 0;
}

const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 2) process.exitCode = await run();
    else if (process.argv.length === 3 && process.argv[2] === '--check') console.log(JSON.stringify(check(), null, 2));
    else throw new Error('Only the fixed allowlist or --check is supported');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
} else if (process.env.SALO_MOCK_BROWSER_CHILD === '1') {
  const suite = suites.find(suite => path.join(root, suite.file) === entry);
  if (!suite) throw new Error('Non-allowlisted mock child refused');
  await installBrowserGuard(suite);
}
