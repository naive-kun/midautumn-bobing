import * as THREE from 'three';
import { createScene } from '../web/scene.js';
import { RoomClient } from '../shared/client.js';
import { AWARDS } from '../shared/rules.js';
import { COLLISION_SAMPLES, impactVolume } from '../shared/audio.js';
import { socketFactory, storage, readBinary, prepareCanvas, installPolyfills } from './platform.js';

installPolyfills();
const main = prepareCanvas(tt.createCanvas());
const info = tt.getSystemInfoSync();
let width = info.windowWidth, height = info.windowHeight;
const pixelRatio = Math.min(info.pixelRatio || 1, 2);
const safeTop = Math.max(info.safeArea?.top || 0, 24);
const safeBottom = Math.max(0, height - (info.safeArea?.bottom || height));
let name = storage.getItem('bobing-name') || '月下客';
let roomCode = '', rounds = 3, message = '', messageUntil = 0, rulesVisible = false, busy = false;
let historyVisible = false, historyFilter = 'all', historyPage = 0;
let currentFrame = null, modelError = '', muted = false;
let audioIndex = 0, lastSound = 0;
// Twelve voices let earlier bowl resonances finish beneath fast subsequent hits.
const sounds = Array.from({ length: 12 }, (_, i) => {
  const audio = tt.createInnerAudioContext(); audio.src = COLLISION_SAMPLES[i % COLLISION_SAMPLES.length]; audio.obeyMuteSwitch = true; return audio;
});
const config = __BOBING_CONFIG__;
const client = new RoomClient({ url: config.serverURL, storage, socketFactory });
const offscreen = tt.createCanvas();
offscreen.width = Math.round(width * pixelRatio); offscreen.height = Math.round(height * pixelRatio);
const ctx = offscreen.getContext('2d');
const texture = new THREE.CanvasTexture(offscreen); texture.colorSpace = THREE.SRGBColorSpace;
const hud = new THREE.Scene();
const hudCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2); hudCamera.position.z = 1;
hud.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })));
let scene;
try {
  scene = createScene({ canvas: main, width, height, pixelRatio, canvasFactory: (w, h) => { const c = tt.createCanvas(); c.width = w; c.height = h; return c; }, onImpact: impact => {
    if (!muted && Date.now() - lastSound > 45) {
      lastSound = Date.now(); const audio = sounds[audioIndex++ % sounds.length];
      audio.stop(); audio.volume = impactVolume(impact); audio.play();
    }
  } });
  scene.renderer.setClearColor(0xf3efe3, 1);
} catch (error) {
  tt.showModal({ title: '暂时无法显示3D画面', content: `请更新抖音后重试。${error.message}`, showCancel: false });
  throw error;
}
Promise.all([readBinary('models/bowl.glb'), readBinary('models/die.glb')])
  .then(([bowlData, dieData]) => scene.loadModels({ bowlData, dieData }))
  .catch(error => { modelError = '模型加载失败，请重新进入小游戏'; console.error(error); toast(modelError); });

function toast(text) { message = text; messageUntil = Date.now() + 4500; }
client.on('error', data => toast(data.message));
client.on('trajectory', data => { currentFrame = data.roll; scene.setRoll(data.roll, client.state.serverOffset); });
client.on('connection', data => { if (!data.connected) toast('连接已断开，正在恢复房间…'); });
client.on('left', () => { currentFrame = null; scene.setRoll(null); historyVisible = false; historyPage = 0; });
client.connect();
tt.onShow?.(() => { if (!client.state.connected) client.connect(); else client.ping(); });

let hits = [];
function rounded(x, y, w, h, r = 14) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}
function text(value, x, y, size = 14, color = '#253e35', align = 'left', maxWidth) {
  ctx.font = `${size >= 22 ? '600 ' : ''}${size}px sans-serif`; ctx.fillStyle = color; ctx.textAlign = align;
  if (maxWidth) ctx.fillText(String(value), x, y, maxWidth);
  else ctx.fillText(String(value), x, y);
}
function button(label, x, y, w, h, action, enabled = true, primary = false) {
  rounded(x, y, w, h); ctx.fillStyle = enabled ? (primary ? '#1d4a3e' : '#f9f4e9') : '#e2e2d8'; ctx.fill();
  ctx.strokeStyle = '#d6d5c3'; ctx.lineWidth = .7; ctx.stroke();
  text(label, x + w / 2, y + h / 2 + 5, 14, enabled ? (primary ? '#fffaf0' : '#294638') : '#93978d', 'center');
  if (enabled) hits.push({ x, y, w, h, action });
}
function input(label, value, x, y, w, maxLength, onDone) {
  button(`${label}  ${value || '点击输入'}`, x, y, w, 40, () => {
    const done = e => { tt.offKeyboardConfirm?.(done); tt.offKeyboardComplete?.(complete); onDone(e.value.trim().slice(0, maxLength)); tt.hideKeyboard?.({}); };
    const complete = () => { tt.offKeyboardConfirm?.(done); tt.offKeyboardComplete?.(complete); };
    tt.onKeyboardConfirm(done); tt.onKeyboardComplete?.(complete);
    tt.showKeyboard({ defaultValue: value, maxLength, multiple: false, confirmHold: false, confirmType: 'done', fail: () => { complete(); toast('输入框暂时不可用，请稍后重试'); } });
  });
}
async function action(type, payload = {}) {
  if (busy) return; busy = true;
  try { await client.send(type, payload); } catch (error) { toast(error.message); }
  finally { busy = false; }
}
function drawHistory(room) {
  if (!room) { historyVisible = false; return; }
  hits = []; ctx.fillStyle = 'rgba(20,35,25,.65)'; ctx.fillRect(0, 0, width, height);
  const panelHeight = Math.min(580, height - safeTop - safeBottom - 24);
  const panelY = Math.max(safeTop + 12, (height - panelHeight) / 2);
  const panelX = 16, panelWidth = width - 32;
  rounded(panelX, panelY, panelWidth, panelHeight, 22); ctx.fillStyle = '#fff9ee'; ctx.fill();
  text('开奖记录', panelX + 18, panelY + 35, 23);
  button('关闭', panelX + panelWidth - 67, panelY + 13, 49, 31, () => { historyVisible = false; });
  const tabWidth = (panelWidth - 46) / 2;
  button('本桌记录', panelX + 18, panelY + 53, tabWidth, 34, () => { historyFilter = 'all'; historyPage = 0; }, true, historyFilter === 'all');
  button('我的记录', panelX + 28 + tabWidth, panelY + 53, tabWidth, 34, () => { historyFilter = 'mine'; historyPage = 0; }, true, historyFilter === 'mine');
  const records = [...(room.history || [])].reverse().filter(record => historyFilter === 'all' || record.playerId === client.state.selfId);
  const pageSize = Math.max(1, Math.floor((panelHeight - 181) / 56));
  const pages = Math.max(1, Math.ceil(records.length / pageSize));
  historyPage = Math.max(0, Math.min(historyPage, pages - 1));
  text(`共 ${records.length} 次 · 最近记录在前 · ${historyPage + 1}/${pages} 页`, panelX + 18, panelY + 111, 11, '#71806c');
  if (!records.length) {
    text(historyFilter === 'mine' ? '你还没有投掷记录' : '还没有开奖结果', width / 2, panelY + 171, 16, '#48604b', 'center');
    text('骰子停稳后，本轮奖项会记在这里', width / 2, panelY + 198, 11, '#7a8476', 'center');
  }
  records.slice(historyPage * pageSize, (historyPage + 1) * pageSize).forEach((record, index) => {
    const rowY = panelY + 126 + index * 56;
    rounded(panelX + 12, rowY, panelWidth - 24, 49, 10); ctx.fillStyle = index % 2 ? '#f1efe4' : '#f8f3e7'; ctx.fill();
    text(`第 ${record.round} 轮 · ${record.playerName}`, panelX + 23, rowY + 19, 11, '#48604b', 'left', panelWidth - 130);
    text(record.award?.name || '待开奖', panelX + panelWidth - 23, rowY + 20, 13, record.invalid ? '#82796c' : '#963c2d', 'right', 94);
    text(record.invalid || `骰子  ${record.values?.join(' · ') || '—'}`, panelX + 23, rowY + 38, 10, '#71806c', 'left', panelWidth - 46);
  });
  const footerY = panelY + panelHeight - 48;
  button('上一页', panelX + 18, footerY, tabWidth, 34, () => { historyPage -= 1; }, historyPage > 0);
  button('下一页', panelX + 28 + tabWidth, footerY, tabWidth, 34, () => { historyPage += 1; }, historyPage < pages - 1);
}
function draw() {
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); ctx.clearRect(0, 0, width, height); hits = [];
  const top = safeTop + 16, room = client.state.room, connected = client.state.connected;
  ctx.fillStyle = '#f5f0e5'; ctx.fillRect(0, 0, width, top + 36);
  text('月满 · 博饼', 20, top + 14, 25);
  text(connected ? '● 已连接' : '○ 重连中', width - 18, top + 11, 11, connected ? '#55765f' : '#ad714e', 'right');
  button('规则', width - 73, top + 28, 55, 31, () => { rulesVisible = true; });
  button(muted ? '静音' : '音效', width - 135, top + 28, 55, 31, () => { muted = !muted; });
  const y = top + 67;
  if (!room) {
    text('同一轮明月，共博一碗好彩头', 20, top + 47, 12, '#727d6e');
    input('昵称', name, 20, y, width - 40, 12, value => { name = value || '月下客'; storage.setItem('bobing-name', name); });
    input('房间码', roomCode, 20, y + 49, width - 40, 6, value => { roomCode = value.replace(/\D/g, ''); });
    text('Blender 陶瓷碗 · 六骰真实碰撞', width / 2, height - 196, 11, '#6d786b', 'center');
    const bw = (width - 50) / 2;
    button('创建房间', 20, height - 172, bw, 47, () => action('create', { name, rounds }), connected && !busy, true);
    button('加入房间', 30 + bw, height - 172, bw, 47, () => action('join', { name, roomCode }), connected && roomCode.length === 6 && !busy);
    button(`共 ${rounds} 轮 · 点击切换`, 20, height - 111, width - 40, 35, () => { rounds = rounds >= 5 ? 1 : rounds + 1; });
    text('可单人练习，最多 12 人同桌', width / 2, height - 49, 12, '#7a8476', 'center');
  } else {
    text(`房间 ${room.code}  ·  ${room.players.length}/12 人`, 20, top + 48, 13);
    const gap = 5, cellW = (width - 40 - gap * 5) / 6;
    const latestByPlayer = new Map();
    for (const record of room.history || []) {
      if (record.round === room.round) latestByPlayer.set(record.playerId, record);
    }
    for (let i = 0; i < 12; i++) {
      const p = room.players.find(v => v.seat === i);
      const x = 20 + (i % 6) * (cellW + gap), sy = y + Math.floor(i / 6) * 50;
      rounded(x, sy, cellW, 44, 9); ctx.fillStyle = p?.id === room.turnPlayerId ? '#245543' : '#f4f0e5'; ctx.fill();
      const fg = p?.id === room.turnPlayerId ? '#fff9ee' : '#48604b';
      text(p ? p.name.slice(0, 3) : '待入席', x + cellW / 2, sy + 18, 11, fg, 'center');
      const latest = p && latestByPlayer.get(p.id);
      const resultLabel = latest?.invalid ? (/超时|跳过/.test(latest.invalid) ? '本轮跳过' : '待重掷') : latest?.award?.name;
      const status = !p ? '—' : !p.connected ? '暂离' : room.phase === 'lobby' ? (p.ready ? '已准备' : '待准备')
        : p.id === room.turnPlayerId ? (room.phase === 'rolling' ? '投掷中' : latest?.invalid ? resultLabel : p.id === client.state.selfId ? '轮到你' : '待投掷') : resultLabel || '等候中';
      text(status, x + cellW / 2, sy + 34, 9, fg, 'center', cellW - 6);
    }
    const self = room.players.find(p => p.id === client.state.selfId), isHost = room.hostId === client.state.selfId;
    const turn = room.players.find(p => p.id === room.turnPlayerId);
    text(room.phase === 'lobby' ? '好友入席后，准备开博' : room.phase === 'finished' ? '本场圆满 · 下次再聚' : `第 ${room.round}/${room.totalRounds} 轮 · ${turn?.name || '等待'}的回合`, width / 2, y + 126, 14, '#355140', 'center');
    const bottom = height - Math.max(safeBottom, 16);
    const last = room.history?.at(-1);
    if (last) {
      text(last.invalid ? last.invalid.slice(0, 23) : `${last.playerName} · ${last.award.name}`, width / 2, bottom - 199, last.invalid ? 12 : 20, '#963c2d', 'center', width - 36);
      text(last.invalid?.length > 23 ? last.invalid.slice(23, 46) : `第 ${last.round} 轮  ${last.values?.join('  ·  ') || ''}`, width / 2, bottom - 174, 13, '#45604d', 'center', width - 36);
    }
    const bw = (width - 50) / 2;
    if (room.phase === 'lobby') {
      button(self?.ready ? '取消准备' : '我准备好了', 20, bottom - 144, bw, 48, () => action('ready', { ready: !self?.ready }), connected && !busy);
      button(isHost ? '开始博饼' : '等待房主', 30 + bw, bottom - 144, bw, 48, () => action('start'), connected && isHost && room.players.filter(p => p.connected).every(p => p.ready) && !busy, true);
    } else if (room.phase === 'finished') {
      button(isHost ? '再开一场' : '等待房主开新场', 20, bottom - 144, width - 40, 48, () => action('reset'), connected && isHost && !busy, true);
    } else {
      const mine = room.turnPlayerId === client.state.selfId;
      button(room.phase === 'rolling' ? '骰子正在翻滚…' : mine ? '博一下' : `等${turn?.name || '待'}投掷`, 20, bottom - 144, width - 40, 48, () => action('roll'), connected && mine && room.phase === 'waiting' && !busy, true);
    }
    button('复制房间码', 20, bottom - 80, bw, 34, () => tt.setClipboardData({ data: room.code, success: () => toast('房间码已复制') }));
    button('离开房间', 30 + bw, bottom - 80, bw, 34, () => tt.showModal({ title: '离开房间', content: '确定离开本桌吗？', success: res => { if (res.confirm) action('leave'); } }));
    button(`查看开奖记录 · ${room.history?.length || 0} 次`, 20, bottom - 34, width - 40, 30, () => { historyVisible = true; historyFilter = 'all'; historyPage = 0; });
  }
  if (Date.now() < messageUntil || modelError) {
    rounded(14, height / 2 - 30, width - 28, 60, 14); ctx.fillStyle = 'rgba(25,46,35,.94)'; ctx.fill();
    const val = modelError || message;
    text(val.slice(0, 22), width / 2, height / 2 - 4, 13, '#fff8e6', 'center');
    if (val.length > 22) text(val.slice(22, 44), width / 2, height / 2 + 17, 13, '#fff8e6', 'center');
  }
  if (rulesVisible) {
    hits = []; ctx.fillStyle = 'rgba(20,35,25,.65)'; ctx.fillRect(0, 0, width, height);
    rounded(20, height / 2 - 270, width - 40, 540, 22); ctx.fillStyle = '#fff9ee'; ctx.fill();
    text('本桌玩法', 40, height / 2 - 231, 23);
    text('最多12人轮流投六骰，每轮记录本次奖项。', 40, height / 2 - 199, 11, '#253e35', 'left', width - 80);
    AWARDS.slice(1).forEach((award, i) => {
      text(award.name, 40, height / 2 - 168 + i * 28, 11);
      text(award.description, width - 38, height / 2 - 168 + i * 28, 11, '#566a57', 'right', width - 150);
    });
    text('斜立、出碗可重试；连续3次无效跳过本轮。', 40, height / 2 + 168, 10);
    button('知道了', 40, height / 2 + 199, width - 80, 44, () => { rulesVisible = false; }, true, true);
  }
  if (historyVisible) drawHistory(room);
  texture.needsUpdate = true;
}
tt.onTouchEnd(event => {
  const touch = event.changedTouches?.[0]; if (!touch) return;
  const x = touch.clientX ?? touch.x, y = touch.clientY ?? touch.y;
  const hit = [...hits].reverse().find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
  hit?.action();
});
function frame() {
  scene.update(Date.now()); scene.renderer.autoClear = true; scene.render();
  draw(); scene.renderer.autoClear = false; scene.renderer.clearDepth(); scene.renderer.render(hud, hudCamera); scene.renderer.autoClear = true;
  requestAnimationFrame(frame);
}
frame();
