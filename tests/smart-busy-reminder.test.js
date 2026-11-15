const assert = require('node:assert/strict');
const { test } = require('node:test');
const create = require('../assets/smart-busy-reminder.js');
const MINUTE = 60000, START = Date.parse('2026-01-01T10:00:00Z');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function environment() {
  let clock = START, serial = 0;
  const timers = new Map(), data = new Map(), held = new Set(), writes = [], completions = [];
  let active = 'visit-1', started = START, failure = null, completionFailure = false, gate = null;
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => { writes.push(key); data.set(key, value); } };
  const locks = { request: async (key, options, run) => {
    if (held.has(key)) return run(null);
    held.add(key); try { return await run({ name: key }); } finally { held.delete(key); }
  } };
  const info = () => ({ user: { id: 'staff-1', role: 'STAFF' }, membership: { id: 'member-1', salonId: 'salon-1' }, occupancy: active ? 'BUSY' : 'NOT_AVAILABLE', presenceState: 'STALE', hasActiveVisit: Boolean(active), activeVisitId: active, activeVisitStartedAt: active ? new Date(started).toISOString() : null, serverTime: new Date(clock).toISOString() });
  const tabs = [];
  function tab(options = {}) {
    const t = { eligible: true, view: {}, tones: 0, stops: 0, reads: 0 };
    t.controller = create({
      now: () => clock + (options.skew || 0), storage,
      locks: options.noLocks ? undefined : options.rejectedLocks ? { request: async () => { throw new Error('Locks unavailable'); } } : locks,
      eligible: () => t.eligible,
      setTimer: (fn, delay) => { timers.set(++serial, { fn, at: clock + delay }); return serial; },
      clearTimer: id => timers.delete(id), render: view => { t.view = view; },
      tone: () => { if (!options.blockedAudio) t.tones++; }, stopAudio: () => t.stops++,
      read: async () => { t.reads++; if (failure) throw failure; return info(); },
      complete: async (salonId, visitId) => {
        completions.push({ salonId, visitId });
        if (gate) await gate;
        if (completionFailure) throw Object.assign(new Error('fixture failure'), { status: 500 });
        active = null;
      },
    });
    tabs.push(t); return t;
  }
  async function advance(ms) {
    const target = clock + ms;
    for (let i = 0; i < 2000; i++) {
      const entry = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) { clock = target; await flush(); return; }
      clock = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await flush();
    }
    throw new Error('Timer runaway');
  }
  async function start(t) { await t.controller.sync(info()); await advance(1); }
  return { tab, start, advance, info, tabs, data, writes, completions,
    get clock() { return clock; }, set clock(value) { clock = value; },
    set active(value) { active = value; if (value) started = clock; },
    set failure(value) { failure = value; }, set completionFailure(value) { completionFailure = value; },
    set gate(value) { gate = value; },
  };
}
test('39:59 no reminder; 40:00 first alert; 40:01 visible; 42:00 repeats', async () => {
  const env = environment(), t = env.tab(); await env.start(t);
  await env.advance(40 * MINUTE - 1001); assert.equal(t.view.visible, false); assert.equal(t.tones, 0);
  await env.advance(1000); assert.equal(t.view.visible, true); assert.equal(t.tones, 1);
  await env.advance(1000); assert.equal(t.view.visible, true); assert.equal(t.tones, 1);
  await env.advance(2 * MINUTE - 1000); assert.equal(t.tones, 2); assert.equal(env.completions.length, 0);
});
test('YES preserves BUSY and service timestamps; next reminder in ten minutes', async () => {
  const env = environment(), t = env.tab(); await env.start(t); await env.advance(40 * MINUTE);
  const before = env.info(); await t.controller.acknowledge(); assert.equal(t.view.visible, false);
  assert.deepEqual(env.info(), before); assert.equal(env.completions.length, 0);
  await env.advance(10 * MINUTE - 1); assert.equal(t.view.visible, false);
  await env.advance(1); assert.equal(t.view.visible, true); assert.equal(t.tones, 2);
  assert.ok(env.writes.every(key => key.startsWith('saloBusyReminder:v1:')));
});
test('reload preserves acknowledged deadline and original visit start', async () => {
  const env = environment(), first = env.tab(); await env.start(first); await env.advance(40 * MINUTE);
  await first.controller.acknowledge(); first.controller.stop(); await flush();
  const second = env.tab(); await env.start(second); await env.advance(10 * MINUTE - 2);
  assert.equal(second.view.visible, false); await env.advance(1); assert.equal(second.view.visible, true);
});
test('background suspension reconciles overdue state and ownership', async () => {
  const env = environment(), t = env.tab(); await env.start(t); t.eligible = false; t.controller.pause();
  await env.advance(45 * MINUTE); assert.equal(t.tones, 0);
  t.eligible = true; await t.controller.tick(); await env.advance(1);
  assert.equal(t.view.visible, true); assert.equal(t.tones, 1);
});
test('two tabs have one audible owner and transfer after owner closes', async () => {
  const env = environment(), first = env.tab(), second = env.tab(); await env.start(first); await env.start(second);
  await env.advance(40 * MINUTE); assert.equal(first.tones + second.tones, 1);
  first.eligible = false; first.controller.stop(); await flush(); await env.advance(2 * MINUTE);
  assert.equal(second.tones, 1); assert.equal(second.view.visible, true);
});
test('FINISHED uses scoped completion once, leaves occupancy to server, dismisses reminder', async () => {
  const env = environment(), t = env.tab(); await env.start(t); await env.advance(40 * MINUTE);
  await t.controller.finish(); assert.deepEqual(env.completions, [{ salonId: 'salon-1', visitId: 'visit-1' }]);
  assert.equal(t.view.visible, false); assert.equal(env.info().occupancy, 'NOT_AVAILABLE');
});
test('failed completion retains active service and displays error', async () => {
  const env = environment(), t = env.tab(); await env.start(t); await env.advance(40 * MINUTE);
  env.completionFailure = true; await t.controller.finish();
  assert.equal(env.info().occupancy, 'BUSY'); assert.equal(t.view.visible, true); assert.equal(t.view.error, 'completion'); assert.equal(t.view.busy, false);
});
test('double-click sends only one completion request', async () => {
  const env = environment(), t = env.tab(); await env.start(t); await env.advance(40 * MINUTE);
  let resolve; env.gate = new Promise(done => { resolve = done; });
  const first = t.controller.finish(); const second = t.controller.finish(); await flush();
  assert.equal(env.completions.length, 1); resolve(); await Promise.all([first, second]);
});
test('stale reminder cannot complete a new visit', async () => {
  const env = environment(), t = env.tab(); await env.start(t); await env.advance(40 * MINUTE);
  env.active = 'visit-2'; await t.controller.finish(); assert.equal(env.completions.length, 0);
  await env.advance(1); assert.equal(t.view.visible, false);
});
test('completion elsewhere dismisses on reconciliation without a service write', async () => {
  const env = environment(), t = env.tab(); await env.start(t); await env.advance(40 * MINUTE);
  env.active = null; await t.controller.tick(); assert.equal(t.view.visible, false); assert.equal(env.completions.length, 0);
});
test('no Web Locks degrades to visible reminders with zero audio in both tabs', async () => {
  const env = environment(), a = env.tab({ noLocks: true }), b = env.tab({ noLocks: true }); await env.start(a); await env.start(b);
  await env.advance(42 * MINUTE); assert.equal(a.view.visible, true); assert.equal(b.view.visible, true); assert.equal(a.tones + b.tones, 0);
});
test('blocked audio leaves visible actions usable', async () => {
  const env = environment(), t = env.tab({ blockedAudio: true }); await env.start(t); await env.advance(40 * MINUTE);
  assert.equal(t.view.visible, true); assert.equal(t.tones, 0); await t.controller.acknowledge(); assert.equal(t.view.visible, false);
});
test('offline preserves visible reminder and never completes automatically', async () => {
  const env = environment(), t = env.tab(); await env.start(t); await env.advance(40 * MINUTE);
  env.failure = new Error('offline'); await t.controller.tick(); assert.equal(t.view.error, 'offline');
  await env.advance(5 * MINUTE); assert.equal(t.view.visible, true); assert.equal(env.info().occupancy, 'BUSY'); assert.equal(env.completions.length, 0);
  env.failure = null; await t.controller.tick(); assert.equal(t.view.error, '');
});
test('loss of authorization stops timers, reminder and ownership', async () => {
  const env = environment(), t = env.tab(); await env.start(t); await env.advance(40 * MINUTE);
  env.failure = { status: 403 }; await t.controller.tick(); assert.equal(t.view.visible, false);
  await env.advance(5 * MINUTE); assert.equal(t.tones, 1);
});
test('server timestamp compensates client clock skew', async () => {
  const env = environment(), t = env.tab({ skew: 24 * 60 * MINUTE }); await env.start(t);
  await env.advance(40 * MINUTE - 2); assert.equal(t.view.visible, false);
  await env.advance(1); assert.equal(t.view.visible, true);
});
test('malformed persisted state cannot suppress the initial deadline', async () => {
  const env = environment(), t = env.tab(); env.data.set('saloBusyReminder:v1:staff-1:salon-1:visit-1', '{broken');
  await env.start(t); await env.advance(40 * MINUTE); assert.equal(t.view.visible, true);
});
test('completion action lock survives alert ownership transfer', async () => {
  const env = environment(), first = env.tab(), second = env.tab(); await env.start(first); await env.start(second); await env.advance(40 * MINUTE);
  let resolve; env.gate = new Promise(done => { resolve = done; });
  const finishing = first.controller.finish(); await flush(); assert.equal(env.completions.length, 1);
  first.eligible = false; first.controller.pause(); await flush(); await second.controller.tick(); await env.advance(1);
  await second.controller.finish(); assert.equal(env.completions.length, 1);
  resolve(); await finishing; await second.controller.tick(); assert.equal(second.view.visible, false);
});
test('rejected Web Locks degrades silently and keeps explicit completion usable', async () => {
  const env = environment(), t = env.tab({ rejectedLocks: true }); await env.start(t); await env.advance(40 * MINUTE);
  assert.equal(t.tones, 0); assert.equal(t.view.visible, true); await t.controller.finish(); assert.equal(env.completions.length, 1);
});
