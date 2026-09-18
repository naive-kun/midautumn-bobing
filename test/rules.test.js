import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRoll, AWARDS } from '../shared/rules.js';

test('entertainment rules prioritize special combinations without adding smaller awards', () => {
  const cases = [
    [[1, 2, 2, 3, 5, 6], 0], [[4, 2, 2, 3, 5, 6], 1],
    [[4, 4, 2, 3, 5, 6], 2], [[2, 2, 2, 2, 4, 4], 3],
    [[4, 4, 4, 3, 3, 3], 4], [[1, 2, 3, 4, 5, 6], 5],
    [[4, 4, 4, 4, 1, 2], 6], [[2, 2, 2, 2, 2, 4], 7],
    [[4, 4, 4, 4, 4, 2], 8], [[1, 1, 1, 1, 1, 1], 9],
    [[4, 4, 4, 4, 4, 4], 10], [[4, 4, 4, 4, 1, 1], 11],
  ];
  for (const [values, rank] of cases) {
    const { name, points } = AWARDS[rank];
    assert.deepEqual(evaluateRoll(values), { name, points, rank });
  }
});

test('all 46,656 possible ordered throws match independently counted category totals', () => {
  const histogram = Array(AWARDS.length).fill(0);
  for (let number = 0; number < 6 ** 6; number++) {
    let rest = number;
    const values = Array.from({ length: 6 }, () => { const value = rest % 6 + 1; rest = Math.floor(rest / 6); return value; });
    const award = evaluateRoll(values);
    assert.deepEqual(award, evaluateRoll([...values].reverse()), 'order must not affect the award');
    assert.deepEqual(award, evaluateRoll([...values].sort()), 'permutations must not affect the award');
    histogram[award.rank]++;
  }
  // Combinatorial counts, including overlap removal for 四进/五子/对堂 vs 一秀/二举.
  assert.deepEqual(histogram, [14300, 17400, 9300, 1875, 2500, 720, 360, 150, 30, 5, 1, 15]);
});

test('reject malformed results from any caller', () => {
  for (const values of [null, [], Array(6), [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 7], [1, 2, 3, 4, 5, 0], [1, 2, 3, 4, 5, 1.5], ['1', 2, 3, 4, 5, 6]]) {
    assert.throws(() => evaluateRoll(values), TypeError);
  }
});
