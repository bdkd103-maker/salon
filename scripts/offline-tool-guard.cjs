// Preload only for isolated Prisma generation/type checking; no app execution.
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const cp = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const log = process.env.SALO_OFFLINE_GUARD_LOG;
function record(event) { if (log) fs.appendFileSync(log, JSON.stringify({ event, pid: process.pid }) + '\n'); }
const envPath = file => /(?:^|[\\/])\.env(?:[^\\/]*)(?:$|[\\/])/.test(String(file));
function check(file) { if (envPath(file)) { record('env-read-denied'); throw new Error('OFFLINE_ENV_READ_DENIED'); } }
const exists = fs.existsSync;
fs.existsSync = file => envPath(file) ? false : exists(file);
for (const key of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream']) {
  const original = fs[key];
  fs[key] = function(file, ...args) { check(file); return original.call(this, file, ...args); };
}
for (const key of ['readFile', 'open']) {
  const original = fs.promises[key];
  fs.promises[key] = async function(file, ...args) { check(file); return original.call(this, file, ...args); };
}
function deny() { record('network-denied'); throw new Error('OFFLINE_NETWORK_DENIED'); }
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = deny;
http.request = http.get = https.request = https.get = deny;
dns.lookup = dns.resolve = dns.promises.lookup = dns.promises.resolve = deny;
globalThis.fetch = deny;
globalThis.WebSocket = class { constructor() { deny(); } };
for (const key of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = cp[key];
  cp[key] = function(command, ...args) {
    if (command !== process.execPath) throw new Error('OFFLINE_NON_NODE_PROCESS_DENIED');
    return original.call(this, command, ...args);
  };
}
cp.exec = cp.execSync = () => { throw new Error('OFFLINE_SHELL_DENIED'); };
syncBuiltinESMExports();
record('installed');
