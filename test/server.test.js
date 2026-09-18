import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { createServer } from '../server/index.js';

const values = [4, 4, 1, 2, 3, 5];
const rollResult = (duration = 90, invalid = null) => ({
  frames: [0, duration / 1000].map((t) => ({ t, dice: Array.from({ length: 6 }, (_, i) => [i, 0.5, 0, 0, 0, 0, 1]) })),
  duration, values, impacts: [{ t: 0, strength: 0.5 }], invalid,
});

async function fixture(t, options = {}) {
  const app = await createServer({ simulator: async () => rollResult(), ...options,
    timings: { turnTimeoutMs: 5000, reconnectGraceMs: 1000, playbackLeadMs: 5, ...options.timings } });
  const address = await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return { app, url: `ws://127.0.0.1:${address.port}/ws`, httpUrl: `http://127.0.0.1:${address.port}` };
}

async function client(url, token, socketOptions) {
  const socket = new WebSocket(url, socketOptions);
  const messages = [];
  const listeners = new Set();
  const prefix = randomUUID();
  let seq = 0;
  socket.on('error', () => {});
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (const listener of [...listeners]) listener();
  });
  const wait = (predicate, { after = 0, timeout = 2000 } = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Timed out waiting for WebSocket message')); }, timeout);
    function check() {
      const value = messages.slice(after).find(predicate);
      if (value) { clearTimeout(timer); listeners.delete(check); resolve(value); }
    }
    listeners.add(check);
    check();
  });
  await once(socket, 'open');
  const send = (type, payload = {}, requestId = `${prefix}-${++seq}`) => {
    const after = messages.length;
    socket.send(JSON.stringify({ type, payload, requestId }));
    return wait((message) => message.requestId === requestId && ['ack', 'error'].includes(message.type), { after });
  };
  const hello = await send('hello', token ? { token } : {});
  assert.equal(hello.type, 'ack');
  const welcome = messages.find((message) => message.type === 'welcome');
  return {
    socket, messages, wait, send, ...welcome,
    get room() { return messages.filter((message) => message.type === 'room').at(-1)?.room; },
    async disconnect() {
      const closed = once(socket, 'close');
      socket.close();
      await closed;
    },
  };
}

async function createAndStart(players, rounds = 1) {
  assert.equal((await players[0].send('create', { name: '房主', rounds })).type, 'ack');
  const code = players[0].room.code;
  for (const [index, player] of players.slice(1).entries()) {
    assert.equal((await player.send('join', { name: `玩家${index + 1}`, roomCode: code })).type, 'ack');
  }
  for (const player of players) assert.equal((await player.send('ready', { ready: true })).type, 'ack');
  assert.equal((await players[0].send('start')).type, 'ack');
  return code;
}

test('并发加入只保留12席；断线保留席计入上限，过期后可加入', async (t) => {
  const { url } = await fixture(t, { timings: { reconnectGraceMs: 300 } });
  const players = await Promise.all(Array.from({ length: 14 }, () => client(url)));
  const host = players[0];
  await host.send('create', { name: '房主' });
  const roomCode = host.room.code;
  for (const [index, player] of players.slice(1, 11).entries()) await player.send('join', { name: `玩家${index}`, roomCode });
  const results = await Promise.all(players.slice(11, 13).map((player) => player.send('join', { name: '并发加入', roomCode })));
  assert.equal(results.filter((result) => result.type === 'ack').length, 1);
  assert.equal(results.filter((result) => result.code === 'ROOM_FULL').length, 1);
  await host.wait((message) => message.type === 'room' && message.room.players.length === 12);
  assert.equal(host.room.players.length, 12);
  await players[1].disconnect();
  assert.equal((await players[13].send('join', { name: '等待空位', roomCode })).code, 'ROOM_FULL');
  await delay(340);
  assert.equal((await players[13].send('join', { name: '新玩家', roomCode })).type, 'ack');
  assert.equal(players[13].room.players.length, 12);
  assert.equal(new Set(players[13].room.players.map((player) => player.seat)).size, 12);
  assert.equal(JSON.stringify(players[13].room).includes(host.token), false);
});

test('越权操作被拒绝；重连收到同一轨迹；相同requestId仅模拟和结算一次', async (t) => {
  let simulations = 0;
  const saved = [];
  const { url } = await fixture(t, {
    simulator: async () => { simulations += 1; return rollResult(250); },
    persistence: { mode: 'memory-temporary', saveRoll: async (_room, result) => saved.push(result.id),
      health: async () => ({ mode: 'memory-temporary', durable: false, status: 'ok' }), close: async () => {} },
  });
  const first = await client(url);
  const second = await client(url);
  await createAndStart([first, second]);
  assert.equal((await second.send('start')).code, 'HOST_ONLY');
  assert.equal((await second.send('roll')).code, 'NOT_YOUR_TURN');
  assert.equal((await first.send('roll', {}, 'stable-roll')).type, 'ack');
  const trajectory = await first.wait((message) => message.type === 'trajectory');
  assert.equal((await first.send('roll', {}, 'stable-roll')).type, 'ack');
  assert.equal((await first.send('roll')).code, 'NOT_WAITING');
  await first.disconnect();
  await second.wait((message) => message.type === 'room' && message.room.hostId === second.playerId);
  const restored = await client(url, first.token);
  assert.equal(restored.playerId, first.playerId);
  const replay = await restored.wait((message) => message.type === 'trajectory');
  assert.deepEqual(replay.roll, trajectory.roll);
  assert.equal((await restored.send('roll', {}, 'stable-roll')).type, 'ack');
  const result = await restored.wait((message) => message.type === 'room' && message.room.history.length === 1);
  assert.equal(result.room.turnPlayerId, second.playerId);
  assert.equal(result.room.history[0].id, trajectory.roll.id);
  assert.equal(result.room.players.find((player) => player.id === first.playerId).score, result.room.history[0].award.points);
  assert.equal((await restored.send('roll', {}, 'stable-roll')).type, 'ack');
  assert.equal((await restored.send('roll')).code, 'NOT_YOUR_TURN');
  assert.equal(simulations, 1);
  assert.equal((await second.send('roll')).type, 'ack');
  const finished = await second.wait((message) => message.type === 'room' && message.room.phase === 'finished');
  assert.equal(finished.room.history.length, 2);
  await delay(10);
  assert.equal(simulations, 2);
  assert.equal(saved.length, 2);
  assert.equal(new Set(saved).size, 2);
  assert.equal((await restored.send('reset')).code, 'HOST_ONLY');
  assert.equal((await second.send('reset')).type, 'ack');
  assert.equal(second.room.phase, 'lobby');
  assert.equal(second.room.history.length, 0);
  assert.ok(second.room.players.every((player) => player.score === 0 && !player.ready));
});

test('投掷已经受理后，玩家断线超出保留时间也会完成结算', async (t) => {
  const { url } = await fixture(t, {
    simulator: async () => { await delay(100); return rollResult(80); },
    timings: { reconnectGraceMs: 40 },
  });
  const first = await client(url);
  const second = await client(url);
  await createAndStart([first, second]);
  assert.equal((await first.send('roll')).type, 'ack');
  await first.disconnect();
  const settled = await second.wait((message) => message.type === 'room' && message.room.history.length === 1);
  assert.equal(settled.room.players.length, 1);
  assert.equal(settled.room.history[0].playerId, first.playerId);
  assert.equal(settled.room.history[0].playerName, '房主');
  assert.equal(settled.room.turnPlayerId, second.playerId);
});

test('无效投掷最多重试三次；超时跳过并结束本场', async (t) => {
  const { url } = await fixture(t, {
    simulator: async () => rollResult(10, '骰子倾斜，无法可靠判点'),
    timings: { turnTimeoutMs: 100 },
  });
  const first = await client(url);
  const second = await client(url);
  await createAndStart([first, second]);
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await first.send('roll')).type, 'ack');
    const settled = await first.wait((message) => message.type === 'room' && message.room.history.length === index + 1);
    assert.equal(settled.room.turnPlayerId, index === 2 ? second.playerId : first.playerId);
  }
  const finished = await first.wait((message) => message.type === 'room' && message.room.phase === 'finished');
  assert.equal(finished.room.history.length, 4);
  assert.equal(finished.room.history[3].award.name, '超时跳过');
  assert.ok(finished.room.players.every((player) => player.score === 0));
});

test('健康接口明确临时存储；凭证不接受玩家自选；超大消息会关闭连接', async (t) => {
  const { httpUrl, url } = await fixture(t);
  const response = await fetch(`${httpUrl}/api/health`);
  const health = await response.json();
  assert.equal(response.status, 200);
  assert.equal(health.storage.mode, 'memory-temporary');
  assert.equal(health.storage.durable, false);
  assert.equal(health.maxPlayers, 12);
  const player = await client(url);
  const pending = once(player.socket, 'close');
  player.socket.send('x'.repeat(5000));
  const [code] = await pending;
  assert.equal(code, 1009);
  const socket = new WebSocket(url);
  socket.on('error', () => {});
  await once(socket, 'open');
  const message = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'hello', requestId: 'bad-token', payload: { token: 'self-selected' } }));
  const [raw] = await message;
  assert.equal(JSON.parse(raw.toString()).code, 'INVALID_TOKEN');
  socket.close();
});

test('12名玩家完整轮流一轮，每个人接收相同轨迹和同一份结果', async (t) => {
  const { url } = await fixture(t, { simulator: async () => rollResult(8) });
  const players = await Promise.all(Array.from({ length: 12 }, () => client(url)));
  await createAndStart(players);
  for (const [index, player] of players.entries()) {
    await player.wait((message) => message.type === 'room' && message.room.phase === 'waiting' && message.room.turnPlayerId === player.playerId);
    assert.equal((await player.send('roll')).type, 'ack');
    await players[0].wait((message) => message.type === 'room' && message.room.history.length === index + 1);
  }
  const summaries = await Promise.all(players.map((player) => player.wait((message) => message.type === 'room' && message.room.phase === 'finished')));
  const expected = summaries[0].room.history;
  assert.equal(expected.length, 12);
  assert.equal(new Set(expected.map((result) => result.playerId)).size, 12);
  const trajectoryIds = players[0].messages.filter((message) => message.type === 'trajectory').map((message) => message.roll.id);
  for (const [index, player] of players.entries()) {
    assert.deepEqual(summaries[index].room.history, expected);
    assert.deepEqual(player.messages.filter((message) => message.type === 'trajectory').map((message) => message.roll.id), trajectoryIds);
  }
});

test('心跳挤出普通响应缓存后，历史投掷requestId仍然不会再次执行', async (t) => {
  let simulations = 0;
  const { url } = await fixture(t, {
    simulator: async () => { simulations += 1; return rollResult(8); },
    timings: { rateLimit: 2000 },
  });
  const player = await client(url);
  await createAndStart([player], 2);
  await player.send('roll', {}, 'persistent-roll-id');
  await player.wait((message) => message.type === 'room' && message.room.history.length === 1);
  for (let i = 0; i < 1030; i += 1) await player.send('ping', { clientTime: Date.now() });
  assert.equal((await player.send('roll', {}, 'persistent-roll-id')).type, 'ack');
  await delay(20);
  assert.equal(simulations, 1);
  assert.equal(player.room.history.length, 1);
  assert.equal(player.room.phase, 'waiting');
  assert.equal((await player.send('roll')).type, 'ack');
  await player.wait((message) => message.type === 'room' && message.room.phase === 'finished');
  assert.equal(simulations, 2);
});

test('物理进程失败不计分、不换人，可使用新操作编号重试', async (t) => {
  let simulations = 0;
  const { url } = await fixture(t, {
    simulator: async () => {
      simulations += 1;
      if (simulations === 1) throw new Error('worker crashed');
      return rollResult(8);
    },
  });
  const player = await client(url);
  await createAndStart([player]);
  const after = player.messages.length;
  assert.equal((await player.send('roll', {}, 'failed-worker-roll')).type, 'ack');
  const failure = await player.wait((message) => message.code === 'PHYSICS_FAILED', { after });
  assert.ok(failure.message.includes('不计入'));
  await player.wait((message) => message.type === 'room' && message.room.phase === 'waiting', { after });
  assert.equal(player.room.turnPlayerId, player.playerId);
  assert.equal(player.room.history.length, 0);
  assert.equal((await player.send('roll', {}, 'failed-worker-roll')).type, 'ack');
  assert.equal(simulations, 1);
  assert.equal((await player.send('roll')).type, 'ack');
  const finished = await player.wait((message) => message.type === 'room' && message.room.phase === 'finished');
  assert.equal(simulations, 2);
  assert.equal(finished.room.history.length, 1);
});

test('无close事件的断网由ping/pong发现，移交房主并保留席位', async (t) => {
  const { url } = await fixture(t, { timings: { cleanupIntervalMs: 40, reconnectGraceMs: 200 } });
  const blackhole = await client(url, undefined, { autoPong: false });
  const observer = await client(url);
  await blackhole.send('create', { name: '断网房主' });
  await observer.send('join', { name: '正常玩家', roomCode: blackhole.room.code });
  const disconnected = await observer.wait((message) => message.type === 'room'
    && message.room.players.some((player) => player.id === blackhole.playerId && !player.connected));
  assert.equal(disconnected.room.hostId, observer.playerId);
  assert.equal(disconnected.room.players.length, 2);
  await observer.wait((message) => message.type === 'room' && message.room.players.length === 1);
});

test('限流错误带原requestId，闲置房间自动清理并通知玩家', async (t) => {
  const { url, app } = await fixture(t, {
    timings: { rateLimit: 3, roomIdleMs: 50, cleanupIntervalMs: 20 },
  });
  const player = await client(url);
  await player.send('create', { name: '限流测试' });
  await player.send('ping');
  const rejection = await player.send('ready', { ready: true }, 'rate-test');
  assert.equal(rejection.code, 'RATE_LIMITED');
  assert.equal(rejection.requestId, 'rate-test');
  await player.wait((message) => message.type === 'error' && message.code === 'ROOM_EXPIRED');
  await player.wait((message) => message.type === 'left');
  assert.equal(app.rooms.size, 0);
});

test('断线席位过期且房间销毁后重连，会主动left清除客户端旧房间', async (t) => {
  const { url, app } = await fixture(t, { timings: { reconnectGraceMs: 40 } });
  const player = await client(url);
  await player.send('create', { name: '过期重连' });
  assert.equal(app.rooms.size, 1);
  await player.disconnect();
  await delay(70);
  assert.equal(app.rooms.size, 0);
  const restored = await client(url, player.token);
  assert.equal(restored.playerId, player.playerId);
  assert.ok(restored.messages.some((message) => message.type === 'left'));
  assert.equal(restored.messages.some((message) => message.type === 'room'), false);
});
