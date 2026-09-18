import test from 'node:test';
import assert from 'node:assert/strict';
import { SoloClient } from '../web/solo-client.js';

const goodResult = (duration = 0) => ({
  duration, values: [4, 4, 4, 2, 3, 6], invalid: null, impacts: [],
  frames: [{ t: 0, dice: Array.from({ length: 6 }, () => [0, 1, 0, 0, 0, 0, 1]) }],
});

async function setup(t, rounds = 1) {
  let worker;
  const client = new SoloClient({ playbackLeadMs: 0, workerFactory: () => (worker = {
    sent: null, terminated: false,
    postMessage(message) { this.sent = message; },
    terminate() { this.terminated = true; },
    reply(result) { this.onmessage({ data: { type: 'result', id: this.sent.id, result } }); },
  }) });
  t.after(() => client.disconnect());
  client.connect();
  await client.send('create', { name: '单人测试', rounds });
  await client.send('ready', { ready: true });
  await client.send('start');
  return { client, worker: () => worker };
}

function nextSettlement(client) {
  return new Promise(resolve => {
    const off = client.on('room', ({ room }) => { if (room.phase !== 'rolling') { off(); resolve(room); } });
  });
}

test('solo reveals awards only after trajectory playback ends', async t => {
  const { client, worker } = await setup(t);
  let trajectory;
  client.on('trajectory', value => { trajectory = value.roll; });
  await client.send('roll', {}, 'roll-once');
  await assert.rejects(client.send('roll'), /等待/);
  const settled = nextSettlement(client);
  worker().reply(goodResult(40));
  assert.equal(client.state.room.phase, 'rolling');
  assert.equal(client.state.room.history.length, 0);
  assert.equal('values' in trajectory, false);
  assert.equal('award' in trajectory, false);
  assert.equal('values' in client.state.room.activeRoll, false);
  const room = await settled;
  assert.equal(room.phase, 'finished');
  assert.equal(room.history[0].award.name, '三红');
  await client.send('roll', {}, 'roll-once');
  assert.equal(room.history.length, 1);
});

test('solo advances rounds and reset clears previous awards', async t => {
  const { client, worker } = await setup(t, 2);
  for (let round = 1; round <= 2; round++) {
    await client.send('roll');
    const settled = nextSettlement(client); worker().reply(goodResult()); await settled;
    assert.equal(client.state.room.history[round - 1].round, round);
  }
  await client.send('reset');
  assert.equal(client.state.room.round, 1);
  assert.equal(client.state.room.phase, 'lobby');
  assert.deepEqual(client.state.room.history, []);
});

test('three invalid physical throws skip the round and keep all attempts', async t => {
  const { client, worker } = await setup(t);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await client.send('roll');
    const settled = nextSettlement(client);
    worker().reply({ ...goodResult(), values: [], invalid: '骰子斜立，请重新投掷' }); await settled;
    assert.equal(client.state.room.phase, attempt === 3 ? 'finished' : 'waiting');
  }
  assert.equal(client.state.room.history.length, 3);
  assert.match(client.state.room.history[2].invalid, /连续 3 次无效，跳过本轮/);
});

test('leaving cancels pending work and ignores stale results', async t => {
  const { client, worker } = await setup(t);
  let trajectoryCount = 0;
  client.on('trajectory', () => trajectoryCount++);
  await client.send('roll'); const oldWorker = worker();
  await client.send('leave'); oldWorker.reply(goodResult());
  assert.equal(oldWorker.terminated, true);
  assert.equal(client.state.room, null);
  assert.equal(trajectoryCount, 0);
});

test('worker errors release the turn without recording a fabricated award', async t => {
  const { client, worker } = await setup(t);
  let error;
  client.on('error', value => { error = value.message; });
  await client.send('roll');
  const oldWorker = worker();
  oldWorker.onmessage({ data: { type: 'error', id: oldWorker.sent.id, message: '计算失败，请重试' } });
  assert.equal(client.state.room.phase, 'waiting');
  assert.equal(client.state.room.history.length, 0);
  assert.equal(oldWorker.terminated, true);
  assert.match(error, /计算失败/);
  await client.send('roll');
  assert.notEqual(worker(), oldWorker);
});
