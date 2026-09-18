import http from 'node:http';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { evaluateRoll } from '../shared/rules.js';
import { createPersistence } from './persistence.js';
import { createPhysicsPool } from './worker-pool.js';

const emptyAward = (name) => ({ name, points: 0, rank: 0 });
const fail = (code, message) => Object.assign(new Error(message), { code });

export async function createServer(options = {}) {
  const config = {
    reconnectGraceMs: 60000,
    turnTimeoutMs: 30000,
    roomIdleMs: 2 * 60 * 60 * 1000,
    sessionIdleMs: 24 * 60 * 60 * 1000,
    cleanupIntervalMs: 30000,
    playbackLeadMs: 250,
    maxPlayers: 12,
    maxRooms: 1000,
    maxConnections: 12000,
    rateLimit: 40,
    rateWindowMs: 10000,
    ...options.timings,
  };
  const persistence = options.persistence || await createPersistence(options.mysqlUrl);
  const pool = options.simulator ? null : createPhysicsPool(options.physicsPool);
  const simulate = options.simulator || ((input) => pool.simulate(input));
  const rooms = new Map();
  const sessions = new Map();
  const tokens = new Map();
  const sockets = new Set();
  const pendingWrites = new Set();
  let closing = false;
  let persistenceFailed = false;

  function send(socket, value) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    // A client that stops reading must not accumulate unlimited trajectories.
    if (socket.bufferedAmount > 4 * 1024 * 1024) {
      socket.close(1013, '连接过慢，请重新连接');
      return;
    }
    socket.send(JSON.stringify(value));
  }

  function sendError(socket, requestId, error) {
    send(socket, { type: 'error', requestId, code: error.code || 'INTERNAL_ERROR',
      message: error.code ? error.message : '服务器处理失败，请稍后重试' });
  }

  function publicRoom(room) {
    return {
      code: room.code, hostId: room.hostId, phase: room.phase,
      players: room.players.map((player) => ({ ...player })),
      round: room.round, totalRounds: room.totalRounds,
      turnPlayerId: room.turnPlayerId, turnDeadline: room.turnDeadline,
      history: room.history,
      activeRoll: room.activeRoll ? {
        id: room.activeRoll.id, playerId: room.activeRoll.playerId,
        startTime: room.activeRoll.startTime, duration: room.activeRoll.duration,
      } : null,
    };
  }

  function snapshot(session, room) {
    send(session.socket, { type: 'room', selfId: session.id, serverTime: Date.now(), room: publicRoom(room) });
  }

  function broadcast(room, message) {
    for (const player of room.players) send(sessions.get(player.id)?.socket, message);
  }

  function broadcastRoom(room) {
    for (const player of room.players) {
      const session = sessions.get(player.id);
      if (session?.socket) snapshot(session, room);
    }
  }

  function clearTurn(room) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnDeadline = null;
  }

  function destroyRoom(room, reason) {
    clearTurn(room);
    clearTimeout(room.settleTimer);
    room.generation += 1;
    rooms.delete(room.code);
    for (const player of room.players) {
      const session = sessions.get(player.id);
      if (!session) continue;
      session.roomCode = null;
      if (reason) sendError(session.socket, undefined, fail('ROOM_EXPIRED', reason));
      send(session.socket, { type: 'left' });
    }
  }

  function chooseHost(room) {
    const host = room.players.find((player) => player.id === room.hostId);
    if (host?.connected) return;
    room.hostId = room.players.find((player) => player.connected)?.id || room.players[0]?.id || null;
  }

  function persist(room, result) {
    const metadata = { code: room.code, gameId: room.gameId };
    const write = Promise.resolve().then(() => persistence.saveRoll(metadata, result)).catch(() => {
      persistenceFailed = true;
      broadcast(room, { type: 'error', code: 'PERSISTENCE_FAILED', message: '本局已结算，但历史记录暂未保存到数据库。' });
    }).finally(() => pendingWrites.delete(write));
    pendingWrites.add(write);
  }

  function addHistory(room, result) {
    if (room.settledIds.has(result.id)) return false;
    room.settledIds.add(result.id);
    room.history.push(result);
    persist(room, result);
    return true;
  }

  function beginTurn(room) {
    clearTurn(room);
    if (!room.players.length) {
      destroyRoom(room);
      return;
    }
    // The order remains fixed for the game. Empty seats are skipped, not recycled.
    while (room.round <= room.totalRounds) {
      if (room.turnIndex >= room.turnOrder.length) {
        room.turnIndex = 0;
        room.round += 1;
        continue;
      }
      const playerId = room.turnOrder[room.turnIndex];
      if (!room.players.some((player) => player.id === playerId)) {
        room.turnIndex += 1;
        continue;
      }
      room.phase = 'waiting';
      room.turnPlayerId = playerId;
      room.turnDeadline = Date.now() + config.turnTimeoutMs;
      const generation = room.generation;
      room.turnTimer = setTimeout(() => {
        if (closing || room.generation !== generation || room.phase !== 'waiting' || room.turnPlayerId !== playerId) return;
        const player = room.players.find((item) => item.id === playerId);
        addHistory(room, {
          id: randomUUID(), playerId, playerName: player?.name || '已离开玩家', round: room.round,
          values: [], award: emptyAward('超时跳过'), invalid: '等待投掷超时，已跳过本轮',
        });
        room.lastActivity = Date.now();
        advanceTurn(room);
      }, config.turnTimeoutMs);
      broadcastRoom(room);
      return;
    }
    room.round = room.totalRounds;
    room.phase = 'finished';
    room.turnPlayerId = null;
    broadcastRoom(room);
  }

  function advanceTurn(room) {
    room.invalidAttempts = 0;
    room.turnIndex += 1;
    beginTurn(room);
  }

  function removePlayer(session) {
    const room = rooms.get(session.roomCode);
    session.roomCode = null;
    if (!room) return;
    room.players = room.players.filter((player) => player.id !== session.id);
    room.lastActivity = Date.now();
    chooseHost(room);
    if (!room.players.length && room.phase !== 'rolling') {
      destroyRoom(room);
    } else if (room.phase === 'waiting' && room.turnPlayerId === session.id) {
      advanceTurn(room);
    } else {
      broadcastRoom(room);
    }
  }

  function roomFor(session) {
    const room = rooms.get(session.roomCode);
    if (!room) throw fail('NOT_IN_ROOM', '请先创建或加入房间');
    return room;
  }

  function requireHost(session, room) {
    if (room.hostId !== session.id) throw fail('HOST_ONLY', '只有房主可以操作');
  }

  function readName(value) {
    if (typeof value !== 'string') throw fail('INVALID_NAME', '请输入昵称');
    const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
    if (!name) throw fail('INVALID_NAME', '请输入昵称');
    return name;
  }

  function addPlayer(session, room, name) {
    if (session.roomCode) throw fail('ALREADY_IN_ROOM', '请先离开当前房间');
    if (room.phase !== 'lobby') throw fail('GAME_STARTED', '本房间已经开始，请等待下一场');
    if (room.players.length >= config.maxPlayers) throw fail('ROOM_FULL', '房间已满，最多 12 人（包含断线保留席）');
    const seats = new Set(room.players.map((player) => player.seat));
    let seat = 0;
    while (seats.has(seat)) seat += 1;
    room.players.push({ id: session.id, name, seat, ready: false, connected: true, score: 0 });
    session.roomCode = room.code;
    room.lastActivity = Date.now();
    broadcastRoom(room);
  }

  function finishRoll(room, active, result) {
    if (closing || rooms.get(room.code) !== room || room.activeRoll !== active) return;
    room.activeRoll = null;
    room.settleTimer = null;
    room.lastActivity = Date.now();
    let invalid = result.invalid || null;
    if (invalid && room.invalidAttempts >= 2) invalid += '（连续 3 次无效，跳过本轮）';
    const award = invalid ? emptyAward('本次无效') : evaluateRoll(result.values);
    const item = { id: active.id, playerId: active.playerId, playerName: active.playerName,
      round: active.round, values: result.values, award, ...(invalid ? { invalid } : {}) };
    if (!addHistory(room, item)) return;
    const player = room.players.find((value) => value.id === active.playerId);
    if (player) player.score += award.points;
    if (invalid && player && ++room.invalidAttempts < 3) {
      beginTurn(room);
    } else {
      advanceTurn(room);
    }
  }

  function startRoll(session, room) {
    if (room.phase !== 'waiting') throw fail('NOT_WAITING', '当前不能投掷，请等待本次结算');
    if (room.turnPlayerId !== session.id) throw fail('NOT_YOUR_TURN', '还没轮到你，请等待');
    const player = room.players.find((value) => value.id === session.id);
    if (!player?.connected) throw fail('DISCONNECTED', '请重新连接后投掷');
    clearTurn(room);
    const active = {
      id: randomUUID(), playerId: session.id, playerName: player.name, round: room.round,
      startTime: Date.now(), duration: 0,
    };
    room.phase = 'rolling';
    room.activeRoll = active;
    room.lastRoll = null;
    room.lastActivity = Date.now();
    broadcastRoom(room);
    Promise.resolve().then(() => simulate({ seed: randomBytes(4).readUInt32LE() })).then((result) => {
      if (closing || room.activeRoll !== active || rooms.get(room.code) !== room) return;
      if (!Array.isArray(result.frames) || !result.frames.length || !Number.isFinite(result.duration)
          || result.duration < 0 || result.duration > 30000 || !Array.isArray(result.values)
          || (!result.invalid && (result.values.length !== 6 || result.values.some((v) => !Number.isInteger(v) || v < 1 || v > 6)))) {
        throw new Error('物理结果不完整');
      }
      active.startTime = Date.now() + config.playbackLeadMs;
      active.duration = result.duration;
      room.lastRoll = {
        id: active.id, playerId: active.playerId, startTime: active.startTime,
        duration: result.duration, frames: result.frames, impacts: result.impacts || [],
      };
      broadcast(room, { type: 'trajectory', serverTime: Date.now(), roll: room.lastRoll });
      broadcastRoom(room);
      room.settleTimer = setTimeout(() => finishRoll(room, active, result), config.playbackLeadMs + result.duration);
    }).catch(() => {
      if (closing || room.activeRoll !== active || rooms.get(room.code) !== room) return;
      room.activeRoll = null;
      broadcast(room, { type: 'error', code: 'PHYSICS_FAILED', message: '物理计算暂时失败，请重新投掷。本次不计入投掷次数。' });
      if (room.players.some((value) => value.id === active.playerId)) beginTurn(room);
      else advanceTurn(room);
    });
  }

  function command(session, type, payload) {
    if (type === 'create') {
      if (session.roomCode) throw fail('ALREADY_IN_ROOM', '请先离开当前房间');
      if (rooms.size >= config.maxRooms) throw fail('SERVER_BUSY', '当前房间较多，请稍后再试');
      const name = readName(payload.name);
      const rounds = payload.rounds === undefined ? 3 : payload.rounds;
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw fail('INVALID_ROUNDS', '游戏轮数应为 1–10 轮');
      let code;
      do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
      const room = {
        code, gameId: randomUUID(), hostId: session.id, phase: 'lobby', players: [], round: 1,
        totalRounds: rounds, turnPlayerId: null, turnDeadline: null, history: [], activeRoll: null,
        lastRoll: null, turnOrder: [], turnIndex: 0, invalidAttempts: 0, settledIds: new Set(),
        generation: 0, lastActivity: Date.now(), turnTimer: null, settleTimer: null,
      };
      rooms.set(code, room);
      addPlayer(session, room, name);
      return;
    }
    if (type === 'join') {
      const name = readName(payload.name);
      const roomCode = typeof payload.roomCode === 'string' ? payload.roomCode.trim() : '';
      if (!/^\d{6}$/.test(roomCode)) throw fail('INVALID_ROOM_CODE', '请输入 6 位数字房间码');
      const room = rooms.get(roomCode);
      if (!room) throw fail('ROOM_NOT_FOUND', '没有找到这个房间，请检查房间码');
      addPlayer(session, room, name);
      return;
    }
    if (type === 'ping') {
      send(session.socket, { type: 'pong', clientTime: Number.isFinite(payload.clientTime) ? payload.clientTime : null, serverTime: Date.now() });
      return;
    }
    if (type === 'leave') {
      removePlayer(session);
      send(session.socket, { type: 'left' });
      return;
    }
    const room = roomFor(session);
    room.lastActivity = Date.now();
    if (type === 'ready') {
      if (room.phase !== 'lobby') throw fail('GAME_STARTED', '对局已开始，不能修改准备状态');
      if (typeof payload.ready !== 'boolean') throw fail('INVALID_READY', '准备状态必须为布尔值');
      room.players.find((player) => player.id === session.id).ready = payload.ready;
      broadcastRoom(room);
    } else if (type === 'start') {
      requireHost(session, room);
      if (room.phase !== 'lobby') throw fail('GAME_STARTED', '对局已经开始');
      if (room.players.some((player) => player.connected && !player.ready)) throw fail('NOT_ALL_READY', '请等待所有在线玩家准备');
      room.turnOrder = room.players.map((player) => player.id);
      room.turnIndex = 0;
      room.round = 1;
      beginTurn(room);
    } else if (type === 'roll') {
      startRoll(session, room);
    } else if (type === 'reset') {
      requireHost(session, room);
      if (room.phase !== 'finished') throw fail('NOT_FINISHED', '请等待本场结束后再开新局');
      room.gameId = randomUUID();
      room.phase = 'lobby';
      room.round = 1;
      room.history = [];
      room.lastRoll = null;
      room.settledIds.clear();
      room.players.forEach((player) => { player.score = 0; player.ready = false; });
      broadcastRoom(room);
    } else {
      throw fail('UNKNOWN_COMMAND', '不支持的操作');
    }
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' || request.url?.split('?')[0] !== '/api/health') {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }
    let storage;
    let healthy = !closing && !persistenceFailed;
    try { storage = await persistence.health(); }
    catch { healthy = false; storage = { mode: persistence.mode, status: 'unavailable', durable: false }; }
    response.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', service: 'midautumn-bobing',
      maxPlayers: config.maxPlayers, rooms: rooms.size, connections: sockets.size,
      storage: { ...storage, writeFailure: persistenceFailed }, physics: pool?.stats() || { mode: 'injected' } }));
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (closing || request.url?.split('?')[0] !== '/ws' || sockets.size >= config.maxConnections) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (socket) => {
    sockets.add(socket);
    let session = null;
    let count = 0;
    let windowStart = Date.now();
    const helloTimeout = setTimeout(() => socket.close(1008, '请先登录'), 10000);
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('error', () => {});
    socket.on('message', (raw, isBinary) => {
      let requestId;
      try {
        const now = Date.now();
        if (now - windowStart >= config.rateWindowMs) { count = 0; windowStart = now; }
        const rateLimited = ++count > config.rateLimit;
        if (isBinary) throw fail('INVALID_MESSAGE', '只接受 JSON 文本消息');
        let message;
        try { message = JSON.parse(raw.toString()); }
        catch { throw fail('INVALID_JSON', '消息格式不正确'); }
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw fail('INVALID_MESSAGE', '消息格式不正确');
        requestId = message.requestId;
        if (rateLimited) throw fail('RATE_LIMITED', '操作太快了，请稍等片刻');
        const { type, payload = {} } = message;
        if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 80) throw fail('INVALID_REQUEST_ID', '请提供唯一的操作编号');
        if (typeof type !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw fail('INVALID_MESSAGE', '消息格式不正确');
        if (type === 'hello') {
          if (session) throw fail('ALREADY_AUTHENTICATED', '连接已经完成认证');
          if (payload.token !== undefined && (typeof payload.token !== 'string' || !/^[a-f0-9]{64}$/.test(payload.token))) throw fail('INVALID_TOKEN', '重连凭证不正确，请重新进入');
          session = payload.token ? tokens.get(payload.token) : null;
          if (payload.token && !session) throw fail('INVALID_TOKEN', '重连凭证已失效，请重新进入');
          if (!session) {
            session = { id: randomUUID(), token: randomBytes(32).toString('hex'), roomCode: null,
              socket: null, lastSeen: now, disconnectTimer: null, requests: new Map(), acceptedRollRequests: new Map() };
            sessions.set(session.id, session);
            tokens.set(session.token, session);
          }
          const oldSocket = session.socket;
          session.socket = socket;
          if (oldSocket && oldSocket !== socket) oldSocket.close(4001, '已在其他连接恢复');
          clearTimeout(helloTimeout);
          clearTimeout(session.disconnectTimer);
          session.disconnectTimer = null;
          session.lastSeen = now;
          send(socket, { type: 'welcome', playerId: session.id, token: session.token, serverTime: now });
          const room = rooms.get(session.roomCode);
          const player = room?.players.find((item) => item.id === session.id);
          if (player) {
            player.connected = true;
            room.lastActivity = now;
            chooseHost(room);
            broadcastRoom(room);
            if (room.lastRoll) send(socket, { type: 'trajectory', serverTime: now, roll: room.lastRoll });
          } else {
            session.roomCode = null;
            send(socket, { type: 'left' });
          }
          send(socket, { type: 'ack', requestId });
          return;
        }
        if (!session || session.socket !== socket) throw fail('UNAUTHENTICATED', '请先建立连接');
        session.lastSeen = now;
        const signature = JSON.stringify({ type, payload });
        // Successful throws survive the general response cache: heartbeat traffic
        // must never evict a throw and let a delayed retry award points twice.
        const previous = session.acceptedRollRequests.get(requestId) || session.requests.get(requestId);
        if (previous) {
          if (previous.signature !== signature) throw fail('REQUEST_ID_CONFLICT', '操作编号已经被其他请求使用');
          send(socket, previous.reply);
          return;
        }
        let reply;
        try {
          if (type === 'roll' && session.acceptedRollRequests.size >= 10000) throw fail('SESSION_ACTION_LIMIT', '本次会话投掷次数达到上限，请重新开始游戏会话');
          command(session, type, payload);
          reply = { type: 'ack', requestId };
        } catch (error) {
          reply = { type: 'error', requestId, code: error.code || 'INTERNAL_ERROR',
            message: error.code ? error.message : '服务器处理失败，请稍后重试' };
        }
        session.requests.set(requestId, { signature, reply });
        if (type === 'roll' && reply.type === 'ack') session.acceptedRollRequests.set(requestId, { signature, reply });
        if (session.requests.size > 1024) session.requests.delete(session.requests.keys().next().value);
        send(socket, reply);
      } catch (error) { sendError(socket, requestId, error); }
    });
    socket.on('close', () => {
      clearTimeout(helloTimeout);
      sockets.delete(socket);
      if (!session || session.socket !== socket) return;
      session.socket = null;
      session.lastSeen = Date.now();
      if (closing) return;
      const room = rooms.get(session.roomCode);
      const player = room?.players.find((value) => value.id === session.id);
      if (player) {
        player.connected = false;
        chooseHost(room);
        broadcastRoom(room);
        session.disconnectTimer = setTimeout(() => {
          if (!session.socket && !closing) removePlayer(session);
          session.disconnectTimer = null;
        }, config.reconnectGraceMs);
      }
    });
  });

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.phase !== 'rolling' && now - room.lastActivity > config.roomIdleMs) destroyRoom(room, '房间长时间无人操作，已自动关闭');
    }
    for (const session of sessions.values()) {
      if (!session.socket && !session.roomCode && now - session.lastSeen > config.sessionIdleMs) {
        sessions.delete(session.id);
        tokens.delete(session.token);
      }
    }
    for (const socket of sockets) {
      if (!socket.isAlive) socket.terminate();
      else { socket.isAlive = false; socket.ping(); }
    }
  }, config.cleanupIntervalMs);
  cleanup.unref();

  return {
    server, wss, rooms,
    async listen(port = Number(process.env.PORT) || 8796, host = process.env.HOST || '127.0.0.1') {
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => { server.off('error', onError); resolve(); });
      });
      return server.address();
    },
    async close() {
      if (closing) return;
      closing = true;
      clearInterval(cleanup);
      for (const session of sessions.values()) clearTimeout(session.disconnectTimer);
      for (const room of rooms.values()) { clearTurn(room); clearTimeout(room.settleTimer); }
      pool?.close();
      for (const socket of sockets) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      await Promise.allSettled([...pendingWrites]);
      await persistence.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const app = await createServer();
    const address = await app.listen();
    console.log(`博饼房间服务 http://127.0.0.1:${address.port}，WebSocket /ws`);
    console.log(process.env.MYSQL_URL ? '历史存储：MySQL；房间在线状态仍在内存，重启会结束在线房间。' : '历史存储：临时内存（未配置 MYSQL_URL，重启后房间与历史会清空）。');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
