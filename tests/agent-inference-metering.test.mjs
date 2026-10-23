import assert from 'node:assert/strict';
import test from 'node:test';
import { meteredCost, meteringHash, validMetering } from '../tools/agent/inference-metering.mjs';

const policy = () => ({
  providerId: 'provider.example',
  modelId: 'model-v1',
  unit: 'nano_usd',
  inputNanoUsdPerToken: 3,
  outputNanoUsdPerToken: 7,
  priceRef: 'price-sheet-2026-10',
  priceCheckedAtMs: 1791590400000,
});

test('accepts exact owner-pinned metering policy and permits caller mutation', () => {
  const value = policy();
  assert.equal(validMetering(value), true);
  assert.equal(Object.isFrozen(value), false);
  value.inputNanoUsdPerToken = 4;
  assert.equal(meteredCost(value, 2, 3), 29);
});

test('rejects missing, extra, symbol, accessor, inherited, and non-plain policy fields', () => {
  const missing = policy(); delete missing.priceRef;
  const extra = { ...policy(), currency: 'USD' };
  const symbol = policy(); symbol[Symbol('extra')] = true;
  const accessor = policy(); Object.defineProperty(accessor, 'modelId', { enumerable: true, get: () => 'model-v1' });
  const inherited = Object.assign(Object.create({ inherited: true }), policy());
  for (const invalid of [missing, extra, symbol, accessor, inherited, null, []]) {
    assert.equal(validMetering(invalid), false);
    assert.throws(() => meteringHash(invalid), /invalid_metering_policy/);
  }
});

test('validates provider/model IDs, local price reference, integer rates, checked time, and nonzero rate', () => {
  const invalidValues = [
    ['providerId', 'bad id'], ['providerId', 'x'.repeat(161)], ['modelId', 'bad id'],
    ['unit', 'usd'], ['priceRef', 'https://example.test/price'], ['priceRef', 'x'.repeat(101)],
    ['inputNanoUsdPerToken', -1], ['inputNanoUsdPerToken', 1.5], ['outputNanoUsdPerToken', Number.MAX_SAFE_INTEGER + 1],
    ['priceCheckedAtMs', -1], ['priceCheckedAtMs', 1.2],
  ];
  for (const [key, value] of invalidValues) {
    const invalid = { ...policy(), [key]: value };
    assert.equal(validMetering(invalid), false, `${key}=${String(value)}`);
  }
  assert.equal(validMetering({ ...policy(), inputNanoUsdPerToken: 0, outputNanoUsdPerToken: 0 }), false);
});

test('hash is key-order independent and changes when a pinned policy value changes', () => {
  const original = policy();
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(meteringHash(original), meteringHash(reordered));
  assert.notEqual(meteringHash(original), meteringHash({ ...original, outputNanoUsdPerToken: 8 }));
});

test('uses exact integer arithmetic in nano USD without floating point rounding', () => {
  const value = policy();
  assert.equal(meteredCost(value, 11, 13), 124);
  assert.equal(meteredCost(value, 0, 0), 0);
});

test('returns null for invalid native counts and unsafe computed cost', () => {
  const value = policy();
  for (const [input, output] of [[-1, 1], [1.25, 2], [Number.MAX_SAFE_INTEGER + 1, 0], [null, 1]]) {
    assert.equal(meteredCost(value, input, output), null);
  }
  const huge = { ...value, inputNanoUsdPerToken: Number.MAX_SAFE_INTEGER, outputNanoUsdPerToken: 0 };
  assert.equal(meteredCost(huge, 2, 0), null);
});
