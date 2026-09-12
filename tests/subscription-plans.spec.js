// Deterministic tests of the existing inline subscription functions; no network or browser state.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const names = ['getOwnerSubscriptionPlanLabel', 'getSubscriptionPlanOptions', 'formatPlanPrice', 'renderSubscriptionPlans'];
function functions(html) {
  return names.map(name => {
    const start = html.indexOf(`    function ${name}(`);
    assert.ok(start >= 0, name);
    const end = html.indexOf('\n    }', start) + 6;
    return html.slice(start, end);
  });
}
for (const file of ['index.html', 'www/index.html']) {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const nodes = { ownerSubscriptionPlans: {}, subscriptionPlanGrid: {} };
  const context = vm.createContext({
    ownerText: key => key, formatCurrencyAmount: value => `EUR ${value}`, escapeHtml: String,
    $: id => nodes[id], document: { querySelectorAll: () => [] },
  });
  vm.runInContext(functions(html).join('\n'), context);
  test(`${file}: SMART label and unknown plan label`, () => {
    assert.equal(context.getOwnerSubscriptionPlanLabel('SMART'), 'subscriptionPlanSmart');
    assert.equal(context.getOwnerSubscriptionPlanLabel('UNRECOGNIZED'), 'subscriptionPlanUnknown');
  });
  test(`${file}: four ordered plans and unresolved SMART price`, () => {
    const plans = context.getSubscriptionPlanOptions();
    assert.deepEqual(Array.from(plans, p => p.key), ['FREE', 'SMART', 'PREMIUM', 'PRO']);
    assert.equal(plans[1].price, 'subscriptionPriceUnresolved');
    assert.equal(context.formatPlanPrice(null), 'subscriptionPriceUnresolved');
    context.renderSubscriptionPlans({ plan: 'SMART', status: 'ACTIVE', monthlyPrice: null, meta: { monthlyPrice: null } });
    const rendered = nodes.subscriptionPlanGrid.innerHTML;
    for (const plan of ['FREE', 'SMART', 'PREMIUM', 'PRO']) assert.ok(rendered.includes(`data-subscription-plan="${plan}"`));
    assert.ok(rendered.includes('subscriptionPriceUnresolved'));
    assert.ok(html.includes('planSmartCount'));
    assert.ok(html.includes('planCounts.SMART'));
  });
}
test('packaged subscription functions match the source copy', () => {
  const read = file => functions(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).map(s => s.replace(/\r\n/g, '\n'));
  assert.deepEqual(read('www/index.html'), read('index.html'));
});
