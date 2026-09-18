import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateRoll, PHYSICS_CONFIG } from '../shared/physics.js';
import { BOWL_RADIUS, BOWL_PROFILE, DICE_HALF, createBowlTriangles, readUpwardFace, bowlFloorHeight } from '../shared/geometry.js';

const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subtract = (a, b) => a.map((value, index) => value - b[index]);
function axes(pose) {
  const [x, y, z, w] = pose.slice(3);
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  ];
}
function boxPenetration(poseA, poseB) {
  const axesA = axes(poseA);
  const axesB = axes(poseB);
  const offset = subtract(poseA.slice(0, 3), poseB.slice(0, 3));
  const separatingAxes = [...axesA, ...axesB, ...axesA.flatMap(a => axesB.map(b => cross(a, b)))];
  let penetration = Infinity;
  for (const raw of separatingAxes) {
    const length = Math.hypot(...raw);
    if (length < 1e-6) continue;
    const axis = raw.map(value => value / length);
    const extentA = DICE_HALF * axesA.reduce((sum, basis) => sum + Math.abs(dot(axis, basis)), 0);
    const extentB = DICE_HALF * axesB.reduce((sum, basis) => sum + Math.abs(dot(axis, basis)), 0);
    penetration = Math.min(penetration, extentA + extentB - Math.abs(dot(offset, axis)));
  }
  return penetration;
}

test('upward face follows all six physical orientations and rejects cocked dice', () => {
  const half = Math.SQRT1_2;
  for (const [quaternion, value] of [
    [[0, 0, 0, 1], 1], [[1, 0, 0, 0], 6],
    [[0, 0, half, half], 3], [[0, 0, -half, half], 4],
    [[-half, 0, 0, half], 2], [[half, 0, 0, half], 5],
  ]) {
    const face = readUpwardFace(quaternion);
    assert.equal(face.value, value);
    assert.ok(face.valid);
  }
  assert.equal(readUpwardFace([Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8)]).valid, false);
  assert.throws(() => readUpwardFace([0, 0, 0, 0]));
  assert.throws(() => readUpwardFace(Array(4)));
});

test('bowl mesh contains its hollow floor and inner wall, with inward/upward normals', () => {
  const triangles = createBowlTriangles();
  assert.equal(triangles.length, 64 * 9);
  for (const [a, b, c] of triangles) {
    const normal = cross(subtract(b, a), subtract(c, a));
    assert.ok(normal[1] > 0, 'all bowl triangles must face up into the hollow');
    if (a[1] || b[1] || c[1]) assert.ok(normal[0] * a[0] + normal[2] * a[2] < 0, 'wall normal must face in');
  }
  assert.equal(bowlFloorHeight(0), 0);
  assert.equal(bowlFloorHeight(BOWL_PROFILE[0][0]), 0);
  assert.equal(bowlFloorHeight(BOWL_RADIUS), BOWL_PROFILE.at(-1)[1]);
  assert.equal(bowlFloorHeight(BOWL_RADIUS + 1), Infinity);
});

test('100 actual Bullet throws stay contained, settle honestly, and read the rendered face', { timeout: 45000 }, async context => {
  const started = performance.now();
  const durations = [];
  const errors = [];
  const outcomes = new Set();
  let impacts = 0;
  let maxPenetration = 0;
  let minCenterY = Infinity;
  let maxCenterY = -Infinity;
  let maxCenterRadius = 0;
  const collisions = { dice: 0, wall: 0, floor: 0 };
  for (let seed = 0; seed < 100; seed++) {
    const result = await simulateRoll({ seed, includeDiagnostics: true });
    durations.push(result.duration);
    impacts += result.impacts.length;
    for (const key of Object.keys(collisions)) collisions[key] += result.diagnostics.collisionSteps[key];
    assert.ok(result.frames.length > 30);
    assert.equal(result.frames[0].t, 0);
    for (const pose of result.frames[0].dice) {
      assert.ok(pose[1] >= 4.5 && pose[1] <= 5.1, 'release must remain visibly above the bowl');
    }
    assert.ok(result.duration <= PHYSICS_CONFIG.maxDuration * 1000);
    assert.ok(Math.abs(result.frames.at(-1).t * 1000 - result.duration) <= 0.6);
    for (let f = 0; f < result.frames.length; f++) {
      const frame = result.frames[f];
      assert.equal(frame.dice.length, 6);
      if (f) assert.ok(frame.t > result.frames[f - 1].t);
      for (const pose of frame.dice) {
        assert.equal(pose.length, 7);
        assert.ok(pose.every(Number.isFinite));
        assert.ok(Math.abs(Math.hypot(...pose.slice(3)) - 1) < 1e-4);
        assert.ok(pose[1] >= DICE_HALF - 0.02, `seed ${seed}: die penetrated the floor`);
        assert.ok(Math.hypot(pose[0], pose[2]) < BOWL_RADIUS, `seed ${seed}: die escaped`);
        minCenterY = Math.min(minCenterY, pose[1]);
        maxCenterY = Math.max(maxCenterY, pose[1]);
        maxCenterRadius = Math.max(maxCenterRadius, Math.hypot(pose[0], pose[2]));
      }
    }
    const final = result.frames.at(-1).dice;
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        maxPenetration = Math.max(maxPenetration, boxPenetration(final[i], final[j]));
        assert.ok(boxPenetration(final[i], final[j]) < 0.04, `seed ${seed}: resting dice overlap`);
      }
    }
    for (const impact of result.impacts) {
      assert.ok(impact.t > 0 && impact.t <= result.frames.at(-1).t + 1e-6);
      assert.ok(impact.strength > 0 && impact.strength <= 1);
    }
    if (result.invalid) {
      errors.push({ seed, reason: result.invalid });
      assert.deepEqual(result.values, [], 'invalid throw must not invent values');
      assert.match(result.invalid, /斜立/);
      assert.ok(result.diagnostics.alignments.some(alignment => alignment < PHYSICS_CONFIG.minimumFaceAlignment));
    } else {
      assert.ok(result.diagnostics.settled);
      assert.equal(result.values.length, 6);
      assert.deepEqual(result.values, final.map(pose => readUpwardFace(pose.slice(3)).value));
      for (const speed of result.diagnostics.speeds) {
        assert.ok(speed.linear < PHYSICS_CONFIG.linearThreshold);
        assert.ok(speed.angular < PHYSICS_CONFIG.angularThreshold);
      }
      outcomes.add(result.values.join(','));
    }
  }
  assert.ok(errors.length <= 15, `too many invalid throws: ${errors.length}`);
  assert.ok(outcomes.size >= 80, 'throws must produce varied physical outcomes');
  const meanDurationMs = durations.reduce((sum, duration) => sum + duration, 0) / 100;
  assert.ok(meanDurationMs >= 3300 && meanDurationMs < 6000, 'higher throws should sustain a longer but bounded physical sequence');
  assert.ok(impacts >= 1800, 'higher throws should produce more actual impact events than the low-release baseline');
  for (const count of Object.values(collisions)) assert.ok(count > 0, 'must exercise dice/dice, dice/wall and dice/floor collisions');
  context.diagnostic(JSON.stringify({ throws: 100, valid: 100 - errors.length, explicitInvalid: errors.length, meanDurationMs, meanImpacts: impacts / 100, maxDurationMs: Math.max(...durations), minCenterY, maxCenterY, maxCenterRadius, maxRestingPenetration: maxPenetration, collisionSteps: collisions, elapsedMs: Math.round(performance.now() - started), errors }));
});

test('same seed replays on this server build and invalid seeds are rejected', async () => {
  const a = await simulateRoll({ seed: 20260917 });
  const b = await simulateRoll({ seed: 20260917 });
  assert.deepEqual(a, b);
  for (const seed of [-1, NaN, 0.5, 0x100000000, '1']) {
    await assert.rejects(simulateRoll({ seed }), TypeError);
  }
});

test('default seed uses Web Crypto while explicit server seeds remain unchanged', async context => {
  const random = context.mock.method(globalThis.crypto, 'getRandomValues', values => {
    assert.ok(values instanceof Uint32Array);
    assert.equal(values.length, 1);
    values[0] = 20260918;
    return values;
  });
  const generated = await simulateRoll();
  const explicit = await simulateRoll({ seed: 20260918 });
  assert.equal(random.mock.callCount(), 1);
  assert.deepEqual(generated, explicit);
});
