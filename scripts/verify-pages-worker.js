import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { readUpwardFace } from '../shared/geometry.js';

const assetsDirectory = new URL('../dist/web/assets/', import.meta.url);
const responseTimeoutMs = 15000;
const nodeGlobals = ['process', 'require', 'module', 'exports', '__dirname', '__filename', 'Buffer'];

function validateResult(message, id) {
  assert.equal(message.id, id, 'Worker must preserve the request id');
  assert.equal(message.type, 'result', `Worker returned an error: ${message.message || message.type}`);
  const result = message.result;
  assert.ok(result && Array.isArray(result.frames) && result.frames.length >= 2, 'Missing physical trajectory');
  assert.ok(Number.isFinite(result.duration) && result.duration > 0 && result.duration <= 10000, 'Invalid simulation duration');
  assert.ok(Array.isArray(result.impacts) && result.impacts.length > 0, 'Missing real collision events');
  assert.ok(Array.isArray(result.values), 'Missing dice values');
  assert.ok(result.invalid === null || (typeof result.invalid === 'string' && result.invalid.trim()), 'Invalid throw status');

  let previousTime = -1;
  for (const frame of result.frames) {
    assert.ok(Number.isFinite(frame.t) && frame.t > previousTime, 'Trajectory times must be strictly increasing');
    assert.ok(Array.isArray(frame.dice) && frame.dice.length === 6, 'Each frame must contain six dice');
    for (const pose of frame.dice) {
      assert.ok(Array.isArray(pose) && pose.length === 7 && pose.every(Number.isFinite), 'Invalid physical pose');
      assert.ok(Math.abs(Math.hypot(...pose.slice(3)) - 1) < 1e-4, 'Rotation must be normalized');
    }
    previousTime = frame.t;
  }
  assert.equal(result.frames[0].t, 0, 'Trajectory must start at zero');
  assert.ok(Math.abs(previousTime * 1000 - result.duration) <= 1, 'Duration must match the final frame');
  for (const impact of result.impacts) {
    assert.ok(Number.isFinite(impact.t) && impact.t > 0 && impact.t <= previousTime + 1e-6, 'Impact is outside the trajectory');
    assert.ok(Number.isFinite(impact.strength) && impact.strength > 0 && impact.strength <= 1, 'Impact strength must be normalized');
  }

  const first = result.frames[0].dice;
  const final = result.frames.at(-1).dice;
  assert.ok(final.every((pose, index) => Math.hypot(...pose.slice(0, 3).map((value, axis) => value - first[index][axis])) > 0.1), 'All six dice must physically move');
  if (result.invalid) {
    assert.deepEqual(result.values, [], 'An invalid throw must not invent values');
  } else {
    assert.equal(result.values.length, 6, 'A valid throw needs six values');
    const faces = final.map(pose => readUpwardFace(pose.slice(3)));
    assert.ok(faces.every(face => face.valid), 'A valid throw contains an ambiguous upward face');
    assert.deepEqual(result.values, faces.map(face => face.value), 'Result does not match the physical upward faces');
  }
  return { id, frames: result.frames.length, impacts: result.impacts.length, durationMs: result.duration, values: result.values, invalid: result.invalid };
}

async function verify() {
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error('Run with: node --experimental-vm-modules scripts/verify-pages-worker.js');
  }
  const names = (await readdir(assetsDirectory)).filter(name => /^physics-worker-.*\.js$/.test(name));
  assert.equal(names.length, 1, 'Expected exactly one built physics worker; build the Pages site first');
  const file = new URL(names[0], assetsDirectory);
  const source = await readFile(file);
  const workerUrl = `https://naive-kun.github.io/midautumn-bobing/assets/${names[0]}`;
  const timers = new Map();
  const pending = new Map();
  const logs = [];
  let nextTimerId = 0;
  let messageHandler;
  let fatalError;
  let externalRequests = 0;
  let secureRandomCalls = 0;

  function reportFailure(error) {
    fatalError ||= error instanceof Error ? error : new Error(String(error));
    for (const entry of pending.values()) entry.reject(fatalError);
  }
  function scheduleTimer(repeat, callback, delay = 0, ...args) {
    assert.equal(typeof callback, 'function', 'Worker timer callback must be a function');
    const id = ++nextTimerId;
    const invoke = () => {
      if (!repeat) timers.delete(id);
      try { callback(...args); } catch (error) { reportFailure(error); }
    };
    timers.set(id, { repeat, handle: repeat ? setInterval(invoke, delay) : setTimeout(invoke, delay) });
    return id; // Browser timers return numbers, not Node Timeout objects.
  }
  function cancelTimer(id) {
    const timer = timers.get(id);
    if (!timer) return;
    (timer.repeat ? clearInterval : clearTimeout)(timer.handle);
    timers.delete(id);
  }
  function rejectExternal(api) {
    externalRequests++;
    throw new Error(`Unexpected external runtime dependency: ${api}`);
  }
  const sandbox = {
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map(level => [level, (...args) => {
      if (logs.length < 20) logs.push({ level, text: args.map(String).join(' ').slice(0, 400) });
    }])),
    setTimeout: (callback, delay, ...args) => scheduleTimer(false, callback, delay, ...args),
    clearTimeout: cancelTimer,
    setInterval: (callback, delay, ...args) => scheduleTimer(true, callback, delay, ...args),
    clearInterval: cancelTimer,
    performance: { now: () => performance.now(), timeOrigin: performance.timeOrigin },
    crypto: { getRandomValues(values) { secureRandomCalls++; return globalThis.crypto.getRandomValues(values); } },
    location: { href: workerUrl },
    importScripts: () => rejectExternal('importScripts'),
    fetch: () => rejectExternal('fetch'),
    XMLHttpRequest: class { constructor() { rejectExternal('XMLHttpRequest'); } },
    addEventListener(type, listener) { if (type === 'message') messageHandler = listener; },
    postMessage(value) {
      const message = structuredClone(value);
      const entry = pending.get(message.id);
      if (!entry) return reportFailure(new Error(`Worker posted an unexpected response id: ${message.id}`));
      entry.resolve(message);
    },
  };
  sandbox.self = sandbox;
  const injectedGlobals = Object.keys(sandbox);
  const context = vm.createContext(sandbox);
  const rejectImport = specifier => { throw new Error(`Unexpected module import: ${specifier}`); };

  try {
    // ESM itself must supply strict semantics. A vm.Script, even one with a
    // browser-shaped global object, can hide Ammo's unbound-this failure.
    const probe = new vm.SourceTextModule(`
      export const topLevelThisUndefined = this === undefined;
      export const selfIsGlobal = self === globalThis;
      export const nodeGlobals = Object.fromEntries(${JSON.stringify(nodeGlobals)}.map(name => [name, typeof globalThis[name]]));
    `, { context, identifier: `${workerUrl}#environment-probe` });
    await probe.link(rejectImport);
    await probe.evaluate({ timeout: 5000 });
    assert.equal(probe.namespace.topLevelThisUndefined, true, 'Expected real ESM top-level this to be undefined');
    assert.equal(probe.namespace.selfIsGlobal, true, 'self must be the worker global');
    assert.ok(Object.values(probe.namespace.nodeGlobals).every(type => type === 'undefined'), 'Node globals leaked into the worker');

    const worker = new vm.SourceTextModule(source.toString('utf8'), {
      context,
      identifier: workerUrl,
      initializeImportMeta(meta) { meta.url = workerUrl; },
      importModuleDynamically: rejectImport,
    });
    await worker.link(rejectImport);
    await worker.evaluate({ timeout: 5000 });
    assert.equal(typeof messageHandler, 'function', 'Worker did not install its message handler');
    if (fatalError) throw fatalError;

    const rounds = [];
    for (let number = 1; number <= 2; number++) {
      const id = `pages-esm-${number}`;
      let timeout;
      const started = performance.now();
      try {
        const response = new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          timeout = setTimeout(() => reject(new Error(`Worker response timed out after ${responseTimeoutMs} ms`)), responseTimeoutMs);
          try { Promise.resolve(messageHandler({ data: { type: 'roll', id } })).catch(reject); }
          catch (error) { reject(error); }
        });
        rounds.push({ ...validateResult(await response, id), computeMs: Math.round(performance.now() - started) });
        if (fatalError) throw fatalError;
      } finally {
        clearTimeout(timeout);
        pending.delete(id);
      }
    }
    assert.equal(externalRequests, 0, 'Bundled Ammo must not fetch extra runtime files');
    assert.equal(secureRandomCalls, 2, 'Each throw must obtain its own secure random seed');
    console.log(JSON.stringify({
      status: 'passed', runtime: 'vm.SourceTextModule', topLevelThisUndefined: true,
      file: fileURLToPath(file), bytes: source.length, sha256: createHash('sha256').update(source).digest('hex'),
      injectedGlobals, absentNodeGlobals: probe.namespace.nodeGlobals,
      externalRequests, secureRandomCalls, rounds, logs,
      limitation: 'Real ESM semantics in a VM; not a browser rendering or device test.',
    }));
  } finally {
    for (const id of timers.keys()) cancelTimer(id);
    pending.clear();
  }
}

try { await verify(); }
catch (error) {
  console.error(`Pages ESM worker verification failed: ${String(error?.message || error).slice(0, 2000)}`);
  process.exitCode = 1;
}
