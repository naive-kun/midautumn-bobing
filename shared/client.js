/** Transport-independent client. Room state and results are owned by the server. */
export class RoomClient {
  constructor({ url, storage, socketFactory, autoReconnect = true } = {}) {
    this.url = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.storage = storage || globalThis.sessionStorage;
    this.socketFactory = socketFactory || (address => new WebSocket(address));
    this.autoReconnect = autoReconnect;
    this.listeners = new Map(); this.pending = new Map();
    this.state = { room: null, selfId: null, connected: false, serverOffset: 0 };
    try { this.token = this.storage?.getItem('bobing-token') || ''; } catch { this.token = ''; }
    this.closed = false; this.attempts = 0; this.sequence = 0;
  }
  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }
  emit(event, payload) { for (const fn of this.listeners.get(event) || []) fn(payload); }
  connect() {
    if (this.socket && this.socket.readyState < 2) return;
    this.closed = false; clearTimeout(this.reconnectTimer);
    let socket;
    try { socket = this.socketFactory(this.url); }
    catch (error) { this.emit('error', { message: `无法连接房间服务：${error.message}` }); this.scheduleReconnect(); return; }
    this.socket = socket;
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = setTimeout(() => {
      if (this.socket === socket && !this.state.connected) socket.close();
    }, 12000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({ type: 'hello', requestId: `hello-${Date.now()}`, payload: this.token ? { token: this.token } : {} }));
    };
    socket.onmessage = event => {
      if (this.socket !== socket) return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'error' && message.code === 'INVALID_TOKEN' && !this.state.connected) {
        this.token = ''; this.state.room = null; this.state.selfId = null;
        try { this.storage?.setItem('bobing-token', ''); } catch { /* storage unavailable */ }
        this.emit('left', { type: 'left' });
        this.emit('error', { message: '原房间会话已过期，正在重新连接。' });
        socket.close(); return;
      }
      if (message.serverTime && message.type !== 'pong') this.state.serverOffset = message.serverTime - Date.now();
      if (message.type === 'welcome') {
        clearTimeout(this.handshakeTimer);
        this.token = message.token; this.state.selfId = message.playerId;
        try { this.storage?.setItem('bobing-token', this.token); } catch { /* storage unavailable */ }
        this.state.connected = true; this.attempts = 0;
        this.emit('connection', { connected: true });
        clearInterval(this.pingTimer);
        this.ping(); this.pingTimer = setInterval(() => this.ping(), 15000);
      } else if (message.type === 'pong') {
        this.state.serverOffset = message.serverTime - (Date.now() + message.clientTime) / 2;
      } else if (message.type === 'room') {
        this.state.room = message.room; this.state.selfId = message.selfId || this.state.selfId;
      } else if (message.type === 'left') this.state.room = null;
      if (message.type === 'ack' || message.type === 'error') {
        const pending = this.pending.get(message.requestId);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.requestId); message.type === 'ack' ? pending.resolve(message) : pending.reject(new Error(message.message)); }
      }
      this.emit(message.type, message);
    };
    socket.onerror = () => this.emit('error', { message: '房间服务暂时连接不上，正在尝试重连。' });
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.state.connected = false; clearInterval(this.pingTimer); clearTimeout(this.handshakeTimer);
      if (event?.code === 4001) {
        this.closed = true;
        this.emit('error', { message: '会话已在另一个窗口恢复，请在那个窗口继续。' });
      }
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('连接已断开，请重连后确认当前进度。')); }
      this.pending.clear(); this.emit('connection', { connected: false }); this.scheduleReconnect();
    };
  }
  ping() { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'ping', requestId: `ping-${Date.now()}-${++this.sequence}`, payload: { clientTime: Date.now() } })); }
  scheduleReconnect() {
    if (!this.autoReconnect || this.closed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), Math.min(10000, 700 * 2 ** this.attempts++));
  }
  send(type, payload = {}, requestId) {
    if (!this.state.connected || this.socket?.readyState !== 1) return Promise.reject(new Error('尚未连接房间服务，请稍候。'));
    const id = requestId || `${Date.now().toString(36)}-${++this.sequence}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.pending.has(id)) return this.pending.get(id).promise;
    const pending = {};
    pending.promise = new Promise((resolve, reject) => {
      pending.resolve = resolve; pending.reject = reject;
      pending.timer = setTimeout(() => { this.pending.delete(id); reject(new Error('操作响应超时，请查看房间状态后再操作。')); }, 20000);
    });
    this.pending.set(id, pending);
    try { this.socket.send(JSON.stringify({ type, requestId: id, payload })); }
    catch (error) { clearTimeout(pending.timer); this.pending.delete(id); pending.reject(error); }
    return pending.promise;
  }
  disconnect() {
    this.closed = true; clearTimeout(this.reconnectTimer); clearInterval(this.pingTimer); clearTimeout(this.handshakeTimer);
    this.socket?.close();
  }
}
export default RoomClient;
