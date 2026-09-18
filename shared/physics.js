import AmmoFactory from 'ammojs-typed';
import { DICE_COUNT, DICE_HALF, BOWL_RADIUS, BOWL_PROFILE, createBowlTriangles, readUpwardFace } from './geometry.js';

export const PHYSICS_CONFIG = Object.freeze({
  step: 1 / 240,
  sampleEvery: 8, // 30 Hz visual samples; the server resolves contacts at 240 Hz.
  maxDuration: 10,
  minDuration: 2,
  stableDuration: 0.55,
  linearThreshold: 0.035,
  angularThreshold: 0.08,
  minimumFaceAlignment: 0.90, // A clearly upward face: at most 25.8 degrees tilt.
  releaseHeight: 4.65,
  releaseHeightSpread: 0.35,
  wallRestitution: 0.30,
  floorRestitution: 0.80,
  diceRestitution: 0.58,
});

let ammoPromise;
// This legacy Ammo factory assigns this.Ammo; module workers run in strict mode.
function getAmmo() { return ammoPromise ??= AmmoFactory.call(globalThis); }

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function randomQuaternion(random) {
  // Uniform SO(3) orientation, rather than uniformly sampled Euler angles.
  const u = random();
  const a = random() * 2 * Math.PI;
  const b = random() * 2 * Math.PI;
  return [Math.sqrt(1 - u) * Math.sin(a), Math.sqrt(1 - u) * Math.cos(a), Math.sqrt(u) * Math.sin(b), Math.sqrt(u) * Math.cos(b)];
}

const rounded = value => Math.round(value * 1e6) / 1e6;

function randomSeed() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前运行环境不支持安全随机数');
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}

export async function simulateRoll({ seed = randomSeed(), includeDiagnostics = false } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('seed must be an unsigned 32-bit integer');
  const Ammo = await getAmmo();
  const owned = [];
  const own = object => { owned.push(object); return object; };
  const bodies = [];
  let world;
  try {
    const configuration = own(new Ammo.btDefaultCollisionConfiguration());
    const dispatcher = own(new Ammo.btCollisionDispatcher(configuration));
    const broadphase = own(new Ammo.btDbvtBroadphase());
    const solver = own(new Ammo.btSequentialImpulseConstraintSolver());
    world = own(new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, configuration));
    world.setGravity(own(new Ammo.btVector3(0, -9.81, 0)));
    world.getSolverInfo().set_m_numIterations(20);
    world.getSolverInfo().set_m_splitImpulse(true);

    const bowlMesh = own(new Ammo.btTriangleMesh(true, true));
    const temporaryVertices = [0, 1, 2].map(() => own(new Ammo.btVector3()));
    for (const triangle of createBowlTriangles()) {
      // One analytic cylinder forms the flat floor. Avoid coplanar triangle seams
      // underneath resting dice, which otherwise cause Bullet contact jitter.
      if (triangle.every(point => point[1] === 0)) continue;
      triangle.forEach((point, index) => temporaryVertices[index].setValue(...point));
      bowlMesh.addTriangle(...temporaryVertices, true);
    }
    const bowlShape = own(new Ammo.btBvhTriangleMeshShape(bowlMesh, true, true));
    const floorShape = own(new Ammo.btCylinderShape(own(new Ammo.btVector3(BOWL_PROFILE[0][0], 0.15, BOWL_PROFILE[0][0]))));
    floorShape.setMargin(0.005);
    const dieShape = own(new Ammo.btBoxShape(own(new Ammo.btVector3(DICE_HALF, DICE_HALF, DICE_HALF))));
    dieShape.setMargin(0.015);

    function addBody(shape, mass, position, quaternion = [0, 0, 0, 1]) {
      const transform = own(new Ammo.btTransform());
      transform.setIdentity();
      transform.setOrigin(own(new Ammo.btVector3(...position)));
      transform.setRotation(own(new Ammo.btQuaternion(...quaternion)));
      const motion = own(new Ammo.btDefaultMotionState(transform));
      const inertia = own(new Ammo.btVector3(0, 0, 0));
      if (mass) shape.calculateLocalInertia(mass, inertia);
      const info = own(new Ammo.btRigidBodyConstructionInfo(mass, motion, shape, inertia));
      const body = own(new Ammo.btRigidBody(info));
      body.setUserIndex(bodies.length); // bowl wall=0, floor=1, dice=2..7.
      world.addRigidBody(body);
      bodies.push(body);
      return body;
    }

    const bowl = addBody(bowlShape, 0, [0, 0, 0]);
    // The smoother inner wall lets tilted dice slide back toward the flat floor.
    // Its lower restitution contains glancing hits from the higher release.
    bowl.setFriction(0.1);
    bowl.setRestitution(PHYSICS_CONFIG.wallRestitution);
    const floor = addBody(floorShape, 0, [0, -0.15, 0]);
    floor.setFriction(0.3);
    floor.setRestitution(PHYSICS_CONFIG.floorRestitution);
    const random = randomGenerator(seed);
    const direction = random() * Math.PI * 2;
    const phase = random() * Math.PI * 2;
    const dice = [];
    for (let i = 0; i < DICE_COUNT; i++) {
      const angle = phase + i * Math.PI / 3;
      const position = [Math.cos(angle) * 1.05, PHYSICS_CONFIG.releaseHeight + random() * PHYSICS_CONFIG.releaseHeightSpread, Math.sin(angle) * 1.05];
      const body = addBody(dieShape, 1, position, randomQuaternion(random));
      body.setFriction(0.6);
      body.setRestitution(PHYSICS_CONFIG.diceRestitution);
      body.setRollingFriction(0.004);
      body.setDamping(0.06, 0.15);
      body.setSleepingThresholds(0.025, 0.06);
      body.setCcdMotionThreshold(0.15);
      body.setCcdSweptSphereRadius(0.18);
      body.setLinearVelocity(own(new Ammo.btVector3(-position[0] * 0.3 + Math.cos(direction) * 0.15 + (random() - 0.5) * 0.7, -0.4 - random() * 1.1, -position[2] * 0.3 + Math.sin(direction) * 0.15 + (random() - 0.5) * 0.7)));
      body.setAngularVelocity(own(new Ammo.btVector3((random() - 0.5) * 14, (random() - 0.5) * 14, (random() - 0.5) * 14)));
      dice.push(body);
    }

    function capture(t) {
      return { t: rounded(t), dice: dice.map(body => {
        const transform = body.getWorldTransform();
        const origin = transform.getOrigin();
        const rotation = transform.getRotation();
        return [origin.x(), origin.y(), origin.z(), rotation.x(), rotation.y(), rotation.z(), rotation.w()].map(rounded);
      }) };
    }

    const frames = [capture(0)];
    const impacts = [];
    const collisionSteps = { dice: 0, wall: 0, floor: 0 };
    let stableSteps = 0;
    let settled = false;
    let invalid = null;
    let steps = 0;
    let lastImpact = -1;
    const maxSteps = Math.ceil(PHYSICS_CONFIG.maxDuration / PHYSICS_CONFIG.step);
    for (steps = 1; steps <= maxSteps; steps++) {
      world.stepSimulation(PHYSICS_CONFIG.step, 0);
      const t = steps * PHYSICS_CONFIG.step;
      if (steps % PHYSICS_CONFIG.sampleEvery === 0) frames.push(capture(t));

      let impulse = 0;
      for (let m = 0; m < dispatcher.getNumManifolds(); m++) {
        const manifold = dispatcher.getManifoldByIndexInternal(m);
        let strongContact = false;
        for (let c = 0; c < manifold.getNumContacts(); c++) {
          const contact = manifold.getContactPoint(c);
          if (contact.getDistance() <= 0) {
            impulse = Math.max(impulse, contact.getAppliedImpulse());
            strongContact ||= contact.getAppliedImpulse() > 0.35;
          }
        }
        if (strongContact) {
          const lowerIndex = Math.min(manifold.getBody0().getUserIndex(), manifold.getBody1().getUserIndex());
          collisionSteps[lowerIndex >= 2 ? 'dice' : lowerIndex === 0 ? 'wall' : 'floor']++;
        }
      }
      if (impulse > 0.35 && t - lastImpact > 0.045) {
        impacts.push({ t: rounded(t), strength: rounded(Math.min(1, impulse / 5)) });
        lastImpact = t;
      }

      const escaped = dice.some(body => {
        const point = body.getWorldTransform().getOrigin();
        return point.y() < -0.1 || Math.hypot(point.x(), point.z()) > BOWL_RADIUS + DICE_HALF;
      });
      if (escaped) { invalid = '骰子飞出碗外，请重新投掷'; break; }
      const slow = dice.every(body => body.getLinearVelocity().length() < PHYSICS_CONFIG.linearThreshold && body.getAngularVelocity().length() < PHYSICS_CONFIG.angularThreshold);
      stableSteps = slow ? stableSteps + 1 : 0;
      if (t >= PHYSICS_CONFIG.minDuration && stableSteps * PHYSICS_CONFIG.step >= PHYSICS_CONFIG.stableDuration) {
        settled = true;
        break;
      }
    }

    const elapsed = Math.min(steps, maxSteps) * PHYSICS_CONFIG.step;
    const finalFrame = capture(elapsed);
    if (frames.at(-1).t !== finalFrame.t) frames.push(finalFrame);
    const faces = finalFrame.dice.map(pose => readUpwardFace(pose.slice(3), PHYSICS_CONFIG.minimumFaceAlignment));
    if (!invalid && !settled) invalid = '骰子长时间未停稳，请重新投掷';
    if (!invalid && faces.some(face => !face.valid)) invalid = '骰子斜立，点数不明确，请重新投掷';
    const result = {
      frames,
      impacts,
      duration: Math.round(elapsed * 1000),
      // Invalid throws expose no invented score. The visible trajectory is kept.
      values: invalid ? [] : faces.map(face => face.value),
      invalid,
    };
    if (includeDiagnostics) result.diagnostics = {
      settled,
      speeds: dice.map(body => ({ linear: body.getLinearVelocity().length(), angular: body.getAngularVelocity().length(), active: body.isActive() })),
      alignments: faces.map(face => face.alignment),
      collisionSteps,
    };
    return result;
  } finally {
    if (world) for (const body of bodies) world.removeRigidBody(body);
    for (let index = owned.length - 1; index >= 0; index--) Ammo.destroy(owned[index]);
  }
}
