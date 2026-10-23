// Character geometry checks (needs `three` from devDependencies; skipped when it is not installed).
import test from 'node:test';
import assert from 'node:assert/strict';

let looks = null;
try { looks = await import('../src/render/charlooks.js'); } catch { looks = null; }
const opts = looks ? {} : { skip: 'three is not installed (npm install)' };

test('every look builds valid skinned geometry within budget', opts, () => {
  const { LOOKS, buildLook } = looks;
  for (let i = 0; i < LOOKS.length; i++) {
    for (const armed of [true, false]) {
      const { geo, height } = buildLook(i, armed);
      const n = geo.attributes.position.count;
      assert.ok(n / 3 < 3000, `${LOOKS[i].name}: ${n / 3} triangles`);
      assert.ok(height > 1.7 && height < 2.3, `${LOOKS[i].name}: height ${height}`);
      const p = geo.attributes.position.array, nr = geo.attributes.normal.array;
      for (let k = 0; k < p.length; k++) assert.ok(Number.isFinite(p[k]) && Number.isFinite(nr[k]), `${LOOKS[i].name}: NaN`);
      const si = geo.attributes.skinIndex.array, sw = geo.attributes.skinWeight.array;
      for (let v = 0; v < n; v++) {
        const s = sw[v * 4] + sw[v * 4 + 1] + sw[v * 4 + 2] + sw[v * 4 + 3];
        assert.ok(Math.abs(s - 1) < 1e-3, `${LOOKS[i].name}: weights sum ${s}`);
        for (let c = 0; c < 4; c++) assert.ok(si[v * 4 + c] < 15, `${LOOKS[i].name}: bone ${si[v * 4 + c]}`);
      }
    }
  }
});

test('player looks are adult-proportioned (head ≤ 1/6 of the body, hats aside)', opts, () => {
  const { LOOKS, buildLook } = looks;
  for (let i = 0; i < 5; i++) {
    const { J, R } = buildLook(i, false);
    const head = 0.3 * R.head, body = J.head[1] + head;
    assert.ok(head / body <= 1 / 6, `${LOOKS[i].name}: head ${head.toFixed(2)} of ${body.toFixed(2)}`);
  }
});
