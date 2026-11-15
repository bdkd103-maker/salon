import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

// Evaluate only the dependency-free scheduling helpers. No app bootstrap,
// browser, Prisma, environment files, network or application imports are used.
const root = new URL('../', import.meta.url);
const backend = readFileSync(new URL('backend/src/lib/salon-hours.ts', root), 'utf8');
assert.doesNotMatch(backend, /\bimport\s/);
const implementations = [['backend', stripTypeScriptTypes(backend).replace(/^export /gm, '')]];
for (const file of ['index.html', 'www/index.html']) {
  const html = readFileSync(new URL(file, root), 'utf8');
  const constants = html.slice(html.indexOf('    const salonWeekDayKeys ='), html.indexOf('    function normalizeWorkingDays'));
  const helpers = html.slice(html.indexOf('    function isValidSalonTimeZone('), html.indexOf('    function formatSalonIntervals('));
  assert.ok(constants.startsWith('    const salonWeekDayKeys ='));
  assert.ok(helpers.startsWith('    function isValidSalonTimeZone('));
  implementations.push([file, constants + helpers]);
}

for (const [name, source] of implementations) {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(source, context, { timeout: 1000 });
  const state = (salon, now) => context.getSalonOperatingState(salon, { now: new Date(now), logInvalid: false });
  const salon = { timeZone: 'Europe/Berlin', openingTime: '18:00', closingTime: '02:00', workingDays: ['sat'] };

  test(`${name}: overnight hours belong to their configured start day`, () => {
    for (const now of ['2026-09-11T23:00:00Z', '2026-09-12T00:00:00Z', '2026-09-12T15:59:00Z']) {
      assert.equal(state(salon, now).isOpen, false, now);
    }
    for (const now of ['2026-09-12T16:00:00Z', '2026-09-12T22:00:00Z', '2026-09-12T23:59:00Z']) {
      assert.equal(state(salon, now).isOpen, true, now);
    }
    assert.equal(state(salon, '2026-09-13T00:00:00Z').isOpen, false, 'closing is exclusive');
  });

  test(`${name}: Sunday overnight hours carry into Monday, not Sunday morning`, () => {
    const sunday = { ...salon, workingDays: ['sun'] };
    assert.equal(state(sunday, '2026-09-12T23:00:00Z').isOpen, false);
    assert.equal(state(sunday, '2026-09-13T23:00:00Z').isOpen, true);
    assert.equal(state(sunday, '2026-09-14T00:00:00Z').isOpen, false);
  });

  test(`${name}: ordinary hours and inactive salons retain their behavior`, () => {
    const daytime = { ...salon, openingTime: '09:00', closingTime: '18:00' };
    assert.equal(state(daytime, '2026-09-12T06:59:00Z').isOpen, false);
    assert.equal(state(daytime, '2026-09-12T07:00:00Z').isOpen, true);
    assert.equal(state(daytime, '2026-09-12T16:00:00Z').isOpen, false);
    assert.equal(state({ ...salon, isActive: false }, '2026-09-12T17:00:00Z').isOpen, false);
  });
}
