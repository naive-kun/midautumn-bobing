import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { RoomClient } from '../shared/client.js';
import { createServer } from '../server/index.js';

const startedAt = new Date();
const deadline = Date.now() + 90000;
const controller = new AbortController();
const budgetTimer = setTimeout(() => controller.abort(new Error('真实多人验证超过 90 秒上限')), 90000);
const evidenceURL = new URL('../artifacts/multiplayer-verification.json', import.meta.url);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const participants = [];
const evidence = {
  schemaVersion: 1,
  startedAt: startedAt.toISOString(),
  passed: false,
  implementation: {
    client: 'shared/client.js RoomClient with ws and isolated in-memory storage',
    server: 'createServer on an independent temporary loopback port',
    physics: 'real shared/physics.js Bullet/Ammo via server worker_threads; no injected simulator',
    storage: 'memory-temporary; MYSQL_URL explicitly disabled for this verification',
    roomSize: 12,
    rounds: 1,
    timeoutMs: 90000,
  },
  checks: {},
  rolls: [],
};
let app;

function checkBudget() {
  if (controller.signal.aborted) throw controller.signal.reason;
  if (Date.now() > deadline) throw new Error('真实多人验证超过 90 秒上限');
}

async function waitFor(predicate, label, timeoutMs = 15000) {
  const until = Math.min(Date.now() + timeoutMs, deadline);
  while (Date.now() < until) {
    checkBudget();
    const value = predicate();
    if (value) return value;
    await delay(20);
  }
  checkBudget();
  throw new Error(`等待超时：${label}`);
}

function bounded(promise) {
  checkBudget();
  return new Promise((resolve, reject) => {
    const abort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
  });
}

function newParticipant(url, index) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const client = new RoomClient({ url, storage, socketFactory: (address) => new WebSocket(address) });
  const participant = { index, client, trajectories: new Map(), errors: [], connections: [] };
  client.on('trajectory', ({ roll }) => {
    const digest = hash(roll);
    const previous = participant.trajectories.get(roll.id);
    participant.trajectories.set(roll.id, {
      hash: digest,
      deliveries: (previous?.deliveries || 0) + 1,
      consistentAcrossRedelivery: (!previous || previous.hash === digest) && previous?.consistentAcrossRedelivery !== false,
      frameCount: roll.frames.length,
      duration: roll.duration,
    });
  });
  client.on('error', ({ code, message }) => participant.errors.push({ code: code || null, message }));
  client.on('connection', ({ connected }) => participant.connections.push({ connected, at: new Date().toISOString() }));
  participants.push(participant);
  client.connect();
  return participant;
}

try {
  // An explicit empty URL isolates this run even if the caller has MYSQL_URL set.
  app = await bounded(createServer({ mysqlUrl: '' }));
  const address = await bounded(app.listen(0, '127.0.0.1'));
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const players = Array.from({ length: 12 }, (_, index) => newParticipant(url, index));
  await waitFor(() => players.every(({ client }) => client.state.connected), '12 个 RoomClient 连接');
  const host = players[0].client;
  await bounded(host.send('create', { name: '验证玩家01', rounds: 1 }));
  const roomCode = host.state.room.code;
  await bounded(Promise.all(players.slice(1).map(({ client }, index) => client.send('join', {
    name: `验证玩家${String(index + 2).padStart(2, '0')}`, roomCode,
  }))));
  await waitFor(() => players.every(({ client }) => client.state.room?.players.length === 12), '所有客户端收到 12 席快照');
  evidence.checks.twelveDistinctPlayers = new Set(players.map(({ client }) => client.state.selfId)).size === 12;
  assert.equal(evidence.checks.twelveDistinctPlayers, true);

  const extra = newParticipant(url, 12);
  await waitFor(() => extra.client.state.connected, '第 13 个客户端连接');
  let rejected = false;
  try { await bounded(extra.client.send('join', { name: '第十三人', roomCode })); }
  catch { rejected = extra.errors.some((error) => error.code === 'ROOM_FULL'); }
  assert.equal(rejected, true, '第 13 人必须收到 ROOM_FULL');
  assert.equal(extra.client.state.room, null);
  evidence.checks.thirteenthRejected = rejected;
  extra.client.disconnect();

  await bounded(Promise.all(players.map(({ client }) => client.send('ready', { ready: true }))));
  await waitFor(() => host.state.room.players.every((player) => player.ready), '全员准备');
  await bounded(host.send('start'));
  const observer = players[1].client;
  let reconnectEvidence = null;
  let acceptedThrows = 0;

  while (observer.state.room.phase !== 'finished') {
    checkBudget();
    const waiting = await waitFor(() => observer.state.room?.phase === 'waiting' && observer.state.room, '下一个投掷回合');
    assert.equal(waiting.players.length, 12, '断线重连不得丢失席位');
    const actor = players.find(({ client }) => client.state.selfId === waiting.turnPlayerId);
    assert.ok(actor, '当前玩家必须来自本次 12 人名单');
    await waitFor(() => actor.client.state.connected, '当前玩家在线');
    const previousCount = waiting.history.length;
    await bounded(actor.client.send('roll'));
    acceptedThrows += 1;
    assert.ok(acceptedThrows <= 36, '一轮最多每人 3 次有效性尝试');
    const activeRoll = await waitFor(() => observer.state.room?.activeRoll, '已受理的服务器投掷');
    const rollId = activeRoll.id;
    await waitFor(() => players.every((player) => player.trajectories.has(rollId)), '12 端收到真实物理轨迹', 15000);

    if (!reconnectEvidence) {
      const originalId = actor.client.state.selfId;
      const originalSeat = actor.client.state.room.players.find((player) => player.id === originalId).seat;
      const originalHash = actor.trajectories.get(rollId).hash;
      actor.client.socket.terminate();
      await waitFor(() => !actor.client.state.connected, '强制断线反馈');
      await waitFor(() => actor.client.state.connected && actor.client.state.room
        && actor.trajectories.get(rollId)?.deliveries >= 2, 'RoomClient 自动重连及轨迹补发');
      const recoveredSeat = actor.client.state.room.players.find((player) => player.id === originalId)?.seat;
      reconnectEvidence = {
        duringRollId: rollId,
        samePlayerId: actor.client.state.selfId === originalId,
        sameSeat: recoveredSeat === originalSeat,
        sameTrajectoryHash: actor.trajectories.get(rollId).hash === originalHash,
        trajectoryDeliveries: actor.trajectories.get(rollId).deliveries,
        phaseOnRecovery: actor.client.state.room.phase,
        allTwelveSeatsPreserved: actor.client.state.room.players.length === 12,
        hostTransferred: observer.state.room.hostId !== originalId,
        connectionEvents: actor.connections,
      };
      assert.equal(reconnectEvidence.samePlayerId, true);
      assert.equal(reconnectEvidence.sameSeat, true);
      assert.equal(reconnectEvidence.sameTrajectoryHash, true);
      assert.equal(reconnectEvidence.allTwelveSeatsPreserved, true);
      assert.equal(reconnectEvidence.hostTransferred, true);
    }

    const settled = await waitFor(() => observer.state.room?.history.length > previousCount && observer.state.room, '真实轨迹播放后结算', 15000);
    const result = settled.history.at(-1);
    assert.equal(result.id, rollId, '不能把超时跳过误判为物理投掷成功');
    await waitFor(() => players.every(({ client }) => client.state.room?.history.some((item) => item.id === rollId)), '全员收到同一结算');
    const receipts = players.map((participant) => ({ playerId: participant.client.state.selfId, ...participant.trajectories.get(rollId) }));
    const resultHashes = players.map(({ client }) => hash(client.state.room.history.find((item) => item.id === rollId)));
    assert.equal(new Set(receipts.map((receipt) => receipt.hash)).size, 1, '12 人轨迹哈希应完全一致');
    assert.ok(receipts.every((receipt) => receipt.consistentAcrossRedelivery));
    assert.equal(new Set(resultHashes).size, 1, '12 人结算哈希应完全一致');
    evidence.rolls.push({
      id: rollId, playerId: result.playerId, round: result.round,
      durationMs: receipts[0].duration, frameCount: receipts[0].frameCount,
      trajectoryHash: receipts[0].hash, resultHash: resultHashes[0],
      receivedBy: receipts.length, values: result.values, award: result.award, invalid: result.invalid || null,
      receipts: receipts.map(({ playerId, hash: digest, deliveries }) => ({ playerId, trajectoryHash: digest, deliveries })),
    });
    console.log(`真实投掷 ${acceptedThrows}：${result.playerName}，${result.invalid ? '无效，按规则重试/跳过' : result.award.name}；12 端轨迹与结果一致。`);
  }

  await waitFor(() => players.every(({ client }) => client.state.room?.phase === 'finished'), '12 人完成整场');
  const finalRoom = observer.state.room;
  const historyHashes = players.map(({ client }) => hash(client.state.room.history));
  assert.equal(new Set(historyHashes).size, 1);
  assert.equal(new Set(finalRoom.history.map((result) => result.id)).size, finalRoom.history.length);
  assert.equal(new Set(finalRoom.history.map((result) => result.playerId)).size, 12);
  const scores = finalRoom.players.map((player) => {
    const expectedScore = finalRoom.history.filter((result) => result.playerId === player.id)
      .reduce((total, result) => total + result.award.points, 0);
    for (const { client } of players) {
      assert.equal(client.state.room.players.find((item) => item.id === player.id).score, expectedScore);
    }
    assert.equal(player.score, expectedScore);
    return { playerId: player.id, name: player.name, score: player.score, expectedScore };
  });
  evidence.checks = {
    ...evidence.checks,
    everyTrajectoryIdenticalAcrossTwelveClients: true,
    everyResultIdenticalAcrossTwelveClients: true,
    noDuplicateResults: true,
    allTwelvePlayersCompletedRound: true,
    finalScoresEqualHistorySumForEveryClient: true,
    automaticReconnectRestoredIdentitySeatAndTrajectory: true,
  };
  evidence.reconnect = reconnectEvidence;
  evidence.summary = {
    participants: 12, attemptedThirteenthPlayer: true, acceptedThrows,
    validThrows: evidence.rolls.filter((roll) => !roll.invalid).length,
    invalidThrows: evidence.rolls.filter((roll) => roll.invalid).length,
    totalTrajectoryDurationMs: evidence.rolls.reduce((total, roll) => total + roll.durationMs, 0),
    finalHistoryHash: historyHashes[0],
    finalHistoryHashByClient: players.map(({ client }, index) => ({ playerId: client.state.selfId, hash: historyHashes[index] })),
    scores,
  };
  evidence.passed = true;
} catch (error) {
  evidence.error = { name: error.name, message: error.message };
  process.exitCode = 1;
  console.error(`多人真实物理验证失败：${error.message}`);
} finally {
  clearTimeout(budgetTimer);
  for (const { client } of participants) client.disconnect();
  if (app) await app.close();
  evidence.finishedAt = new Date().toISOString();
  evidence.elapsedMs = Date.now() - startedAt.getTime();
  evidence.cleanup = { clientsDisconnected: true, temporaryServerClosed: true };
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(evidenceURL, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ passed: evidence.passed, elapsedMs: evidence.elapsedMs,
    acceptedThrows: evidence.summary?.acceptedThrows || evidence.rolls.length,
    evidence: evidenceURL.pathname }));
}
