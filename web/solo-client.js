import { evaluateRoll } from '../shared/rules.js';

/** Single-player transport: the physics worker owns every throw's trajectory. */
export class SoloClient {
  constructor({ workerFactory = () => new Worker(new URL('./physics-worker.js', import.meta.url), { type: 'module' }), playbackLeadMs = 120 } = {}) {
    this.workerFactory = workerFactory;
    this.playbackLeadMs = playbackLeadMs;
    this.listeners = new Map();
    this.state = { room: null, selfId: 'solo-player', connected: false, serverOffset: 0 };
    this.sequence = 0;
    this.invalidAttempts = 0;
    this.accepted = new Set();
    this.active = null;
    this.worker = null;
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }
  emit(event, payload) { for (const handler of this.listeners.get(event) || []) handler(payload); }
  snapshot() { this.emit('room', { type: 'room', room: this.state.room, selfId: this.state.selfId, serverTime: Date.now() }); }
  connect() {
    this.state.connected = true;
    this.emit('connection', { connected: true });
    if (this.state.room) this.snapshot();
  }

  async send(type, payload = {}, requestId) {
    if (!this.state.connected) throw new Error('试玩尚未就绪，请刷新后重试。');
    if (requestId && this.accepted.has(requestId)) return { type: 'ack', requestId };
    const room = this.state.room;
    if (type === 'create') {
      if (room) throw new Error('请先结束当前试玩。');
      const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 20) : '';
      if (!name) throw new Error('请先填写你的称呼。');
      const rounds = Number(payload.rounds ?? 3);
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('请选择 1 到 10 轮。');
      this.invalidAttempts = 0;
      this.state.room = { code: 'LOCAL', hostId: this.state.selfId, phase: 'lobby', round: 1, totalRounds: rounds,
        players: [{ id: this.state.selfId, name, seat: 0, ready: false, connected: true }],
        turnPlayerId: null, turnDeadline: null, activeRoll: null, history: [] };
      this.snapshot();
    } else if (type === 'leave') {
      this.cancelRoll();
      this.state.room = null;
      this.accepted.clear();
      this.emit('left', { type: 'left' });
    } else if (!room) {
      throw new Error('请先开始试玩。');
    } else if (type === 'ready') {
      if (room.phase !== 'lobby') throw new Error('试玩已开始。');
      room.players[0].ready = !!payload.ready;
      this.snapshot();
    } else if (type === 'start') {
      if (room.phase !== 'lobby' || !room.players[0].ready) throw new Error('请先准备试玩。');
      room.phase = 'waiting';
      room.turnPlayerId = this.state.selfId;
      this.snapshot();
    } else if (type === 'roll') {
      if (room.phase !== 'waiting' || this.active) throw new Error('请等待这次骰子停稳。');
      this.roll(room);
    } else if (type === 'reset') {
      if (room.phase !== 'finished') throw new Error('请完成当前轮次后再开一局。');
      this.cancelRoll();
      room.phase = 'lobby'; room.round = 1; room.history = []; room.activeRoll = null;
      room.turnPlayerId = null; room.players[0].ready = false; this.invalidAttempts = 0;
      this.accepted.clear();
      this.snapshot();
    } else {
      throw new Error('当前为单人试玩，不支持加入多人房间。');
    }
    if (requestId) { this.accepted.add(requestId); if (this.accepted.size > 150) this.accepted.delete(this.accepted.values().next().value); }
    return { type: 'ack', requestId };
  }

  roll(room) {
    const id = `solo-${Date.now()}-${++this.sequence}`;
    const active = { id, playerId: this.state.selfId, round: room.round, timer: null, timeout: null };
    this.active = active;
    room.phase = 'rolling';
    room.activeRoll = { id, playerId: this.state.selfId, startTime: Date.now(), duration: 0 };
    this.snapshot();
    active.timeout = setTimeout(() => this.failRoll(active, '本次投掷计算超时，请再试一次。'), 30000);
    try {
      if (!this.worker) {
        this.worker = this.workerFactory();
        this.worker.onmessage = ({ data }) => this.receive(data);
        this.worker.onerror = () => this.active && this.failRoll(this.active, '骰子计算暂时失败，请再试一次。');
      }
      this.worker.postMessage({ type: 'roll', id });
    } catch { this.failRoll(active, '无法启动骰子计算，请刷新页面后重试。'); }
  }

  receive(message) {
    const active = this.active;
    if (!active || message?.id !== active.id || active.timer !== null) return;
    if (message.type === 'error') return this.failRoll(active, message.message || '骰子计算暂时失败，请再试一次。');
    if (message.type !== 'result') return;
    const result = message.result;
    if (!result || !Array.isArray(result.frames) || !result.frames.length || !Number.isFinite(result.duration) || result.duration < 0 || result.duration > 30000 || !Array.isArray(result.values)) {
      return this.failRoll(active, '没有收到完整投掷结果，请再试一次。');
    }
    if (!result.invalid && (result.values.length !== 6 || result.values.some(v => !Number.isInteger(v) || v < 1 || v > 6))) {
      return this.failRoll(active, '没有收到完整骰子点数，请再试一次。');
    }
    clearTimeout(active.timeout);
    const startTime = Date.now() + this.playbackLeadMs;
    const room = this.state.room;
    room.activeRoll = { id: active.id, playerId: active.playerId, startTime, duration: result.duration };
    this.emit('trajectory', { type: 'trajectory', serverTime: Date.now(), roll: {
      ...room.activeRoll, frames: result.frames, impacts: result.impacts || [],
    } });
    this.snapshot();
    // Never expose values or awards in room state before all frames have played.
    active.timer = setTimeout(() => this.settle(active, result), this.playbackLeadMs + result.duration);
  }

  settle(active, result) {
    if (this.active !== active || !this.state.room) return;
    const room = this.state.room;
    let invalid = result.invalid || null;
    if (invalid && this.invalidAttempts >= 2) invalid += '（连续 3 次无效，跳过本轮）';
    room.history.push({ id: active.id, playerId: active.playerId, playerName: room.players[0].name,
      round: active.round, values: result.values, award: invalid ? { name: '本次无效' } : evaluateRoll(result.values),
      ...(invalid ? { invalid } : {}) });
    room.activeRoll = null;
    this.active = null;
    if (invalid && ++this.invalidAttempts < 3) room.phase = 'waiting';
    else {
      this.invalidAttempts = 0;
      if (room.round >= room.totalRounds) { room.phase = 'finished'; room.turnPlayerId = null; }
      else { room.round++; room.phase = 'waiting'; }
    }
    this.snapshot();
  }

  failRoll(active, message) {
    if (active !== this.active) return;
    this.cancelRoll();
    if (this.state.room) { this.state.room.phase = 'waiting'; this.state.room.activeRoll = null; this.snapshot(); }
    this.emit('error', { type: 'error', message });
  }
  cancelRoll() {
    clearTimeout(this.active?.timer); clearTimeout(this.active?.timeout);
    this.active = null;
    this.worker?.terminate(); this.worker = null;
  }
  disconnect() {
    this.cancelRoll(); this.state.connected = false;
    if (this.state.room?.phase === 'rolling') { this.state.room.phase = 'waiting'; this.state.room.activeRoll = null; }
    this.emit('connection', { connected: false });
  }
}
