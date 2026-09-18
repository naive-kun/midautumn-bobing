import './style.css';
import { RoomClient } from '../shared/client.js';
import { createScene } from './scene.js';
import { COLLISION_SAMPLES, impactVolume } from '../shared/audio.js';
import { CULTURE_STORY, renderRulesGuide, renderCultureStory } from './rules-guide.js';
import { assetUrl, resolveRoomServer } from './runtime-config.js';
import { SoloClient } from './solo-client.js';

const isSolo = import.meta.env.VITE_PLAY_MODE === 'solo';
const publicAsset = path => assetUrl(path, import.meta.env.BASE_URL);
const roomServer = isSolo ? { url: null, error: null } : resolveRoomServer({
  configuredUrl: import.meta.env.VITE_ROOM_SERVER_URL,
  isProduction: import.meta.env.PROD,
  location,
});

const icons = {
  dice: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="1.4"/><g fill="currentColor"><circle cx="8" cy="8" r="1.6"/><circle cx="16" cy="8" r="1.6"/><circle cx="8" cy="16" r="1.6"/><circle cx="16" cy="16" r="1.6"/></g></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>',
  muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4zM16 9l6 6m0-6-6 6"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M20 14.5A9 9 0 0 1 9.5 4 9 9 0 1 0 20 14.5Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
};

document.querySelector('#app').innerHTML = `
  <header class="site-header">
    <a class="brand" href="${escape(publicAsset(''))}" aria-label="中秋博饼首页"><span class="brand-mark">${icons.dice}</span><span>中秋博饼<small>一碗团圆 · 一掷好运</small></span></a>
    <nav class="header-actions" aria-label="设置"><span id="connection" class="connection"><i></i>连接中</span><button class="icon-button" id="sound-button" aria-label="关闭碰撞音效" title="关闭碰撞音效">${icons.sound}</button><button class="text-button" id="rules-button">博饼规则 <span>↗</span></button></nav>
  </header>
  <main class="page">
    <section class="page-intro"><div><p class="eyebrow"><span></span> MID-AUTUMN, TOGETHER</p><h1>月满人团圆，<em>一掷好时节。</em></h1><p class="intro-description">${isSolo ? '六骰落碗，亲手试试中秋好手气。' : '把朋友聚在一碗里，让好运碰个满怀。'}</p></div><div class="festival-seal"><span>中秋</span><small>团圆局</small></div></section>
    <div class="game-layout">
      <aside class="left-column">
        <section class="panel lobby-panel" id="join-panel"><div class="panel-heading"><span class="section-icon">${icons.people}</span><h2>${isSolo ? '试试手气' : '好友相聚'}</h2><span class="pill">${isSolo ? '单人试玩' : '1—12 人'}</span></div><p class="panel-description" id="lobby-description" role="status">${isSolo ? '选好轮数，亲手博一碗好运。' : '开一桌，邀好友一起博个好彩头。'}</p>
          <label class="field-label" for="nickname">你的称呼</label><input id="nickname" maxlength="12" placeholder="给自己取个名字" autocomplete="nickname" value="" />
          <div class="field-row"><label class="field-label" for="rounds">${isSolo ? '试玩轮数' : '每人轮数'}</label><select id="rounds" aria-label="每人轮数"><option value="1">1 轮 · 小试手气</option><option value="3" selected>3 轮 · 热闹一场</option><option value="5">5 轮 · 尽兴团圆</option><option value="10">10 轮 · 好事连连</option></select></div>
          <button id="create-button" class="button button-primary wide">${isSolo ? '开始试玩' : '创建房间'} ${icons.arrow}</button>
          <div class="divider ${isSolo ? 'hidden' : ''}"><span>已有朋友开桌？</span></div>
          <label class="field-label ${isSolo ? 'hidden' : ''}" for="room-code-input">输入 6 位房间码</label><div class="join-row ${isSolo ? 'hidden' : ''}"><input id="room-code-input" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" aria-label="六位房间码"/><button class="button button-outline" id="join-button">加入</button></div>
          <p class="small-note" id="lobby-note">${isSolo ? '本次试玩仅你一人，无需创建联机房间。' : '一个人也能先开桌，试试手气。'}</p>
        </section>
        <section class="panel room-panel hidden" id="room-panel"><div class="panel-heading"><span class="section-icon">${icons.people}</span><h2>${isSolo ? '本次试玩' : '团圆房间'}</h2><button class="quiet-button" id="leave-button">${isSolo ? '结束试玩' : '离开'}</button></div><div class="room-code-line ${isSolo ? 'hidden' : ''}"><div><span class="field-label">邀请好友 · 房间码</span><strong id="room-code">------</strong></div><button class="icon-button" id="copy-button" aria-label="复制房间码" title="复制房间码">${icons.copy}</button></div><div class="seats-heading ${isSolo ? 'hidden' : ''}"><span>入席 <b id="player-count">0</b> / 12</span><span id="room-phase">等候开桌</span></div><div id="seats" class="seats ${isSolo ? 'hidden' : ''}"></div><div id="room-action-note" class="room-action-note"></div><button id="ready-button" class="button button-outline wide">准备好了</button><button id="start-button" class="button button-primary wide hidden">全员就绪，开桌 ${icons.arrow}</button></section>
        <button id="story-button" class="culture-entry" aria-haspopup="dialog"><span class="culture-entry-mark" aria-hidden="true">${icons.moon}</span><span><small>一碗骰声里的中秋</small><strong>博饼故事</strong><span>点开读读这份团圆习俗</span></span><span class="culture-entry-arrow" aria-hidden="true">↗</span></button>
        <div class="gather-note"><span>${icons.moon}</span><p>${isSolo ? '举杯邀明月，<br/>博个好彩头。' : '不论相隔多远，<br/>今夜，共享一碗月光。'}</p><div class="note-line"></div></div>
      </aside>
      <section class="stage-panel" aria-label="三维博饼桌">
        <div class="stage-topline"><div><span class="live-dot"></span><span id="stage-tag">团圆桌 · 等你入席</span></div><span class="stage-material" id="model-label">青瓷 · 六骰</span></div>
        <div class="scene-wrap" id="scene-wrap"><div class="moon-circle"></div><div class="stage-watermark" aria-hidden="true">团<br/>圆</div><canvas id="game-canvas" aria-label="六颗骰子在青瓷碗中滚动的三维画面"></canvas><div id="scene-error" class="scene-error hidden"></div><div class="scene-caption"><span class="caption-line"></span><span id="scene-caption">一只青瓷碗，盛下满桌好运</span><span class="caption-line"></span></div></div>
        <div class="play-zone"><div class="play-copy"><span class="turn-eyebrow" id="turn-eyebrow">好彩头，从这一掷开始</span><h2 id="turn-title">落座，等一场好运。</h2><p id="turn-description">创建或加入房间，和朋友一起博饼。</p></div><button id="roll-button" class="button throw-button">${icons.dice}<span id="roll-label">入席博好运</span><span class="throw-arrow">↗</span></button><div class="round-info"><span id="round-label">六骰一碗 · 同屏相聚</span><span id="countdown"></span></div></div>
      </section>
      <aside class="right-column"><section class="panel awards-panel"><div class="panel-heading"><h2 id="awards-title">每轮所得</h2><span class="tiny-stamp">博</span></div><div id="round-controls" class="round-controls hidden"><label class="field-label" for="award-round">查看轮次</label><select id="award-round" aria-label="查看所得轮次"></select><button id="follow-round-button" class="follow-round-button hidden">返回当前轮</button></div><p id="round-summary" class="round-summary"></p><div id="round-awards" class="round-awards"></div><button class="rules-link" id="detail-rules-button">查看完整判奖规则 <span>↗</span></button></section>
        <section class="panel history-panel"><div class="panel-heading"><h2>${isSolo ? '本次喜报' : '本桌喜报'}</h2><span class="history-count" id="history-count">0 掷</span></div><div id="history" class="history-list"><div class="empty-state">${icons.dice}<p>好事，值得等一等。</p><span>${isSolo ? '投掷后，每一轮好彩头都记在这里。' : '开桌后，每一掷都会记在这里。'}</span></div></div></section>
        <div class="fair-note"><span>◇</span><p>${isSolo ? '真实物理碰撞，停稳后揭晓奖项。' : '同桌同画面，点数由服务器判定。'}</p></div>
      </aside>
    </div>
    <footer class="page-footer"><span>花好月圆，掷得团圆。</span><span class="dev-note">${isSolo ? '单人试玩 · 本页暂存，刷新后清空' : `${import.meta.env.PROD ? '联机体验版' : '本地体验版'} · 临时房间，服务重启后清空`}</span></footer>
  </main>
  <div id="toast" class="toast hidden" role="status" aria-live="polite"></div>
  <dialog id="rules-dialog" class="guide-dialog" aria-labelledby="rules-title">
    <div class="dialog-heading"><div><p class="eyebrow">THE ART OF BOBING</p><h2 id="rules-title">骰子图解 · 一眼识好彩</h2><p class="guide-edition">本游戏娱乐版，各地习俗可能不同</p></div><button class="icon-button close-dialog" aria-label="关闭规则" autofocus>×</button></div>
    <div class="guide-scroll">
      <p class="rules-intro">${isSolo ? '每次投掷六颗骰子' : '每人轮流投掷六颗骰子'}，全部停稳后读取朝上的点数。下面按奖项从高到低排列，同时命中多个组合时只取最高。奖项仅供娱乐，不对应现金或实物。</p>
      <div class="dice-legend"><span><i aria-hidden="true"></i>构成奖项的组合</span><span><i class="variable-key" aria-hidden="true"></i>可变化的示例位</span><p>每张图都是能命中该奖项的一组六骰。虚线骰可以变化，但必须遵守卡片下的条件；不是任意点数都可以。</p></div>
      <div class="rules-table" id="rules-table">${renderRulesGuide()}</div>
      <div class="rules-fineprint"><b>${isSolo ? '试玩须知' : '同桌须知'}</b><p>${isSolo ? '当前为单人试玩。选择轮数后即可开始，点“博一下”投掷骰子，右侧按轮保存本次试玩的奖项。' : '每房最多 12 人，单人也能体验。所有在线玩家准备后由房主开桌，依次投掷。右侧按轮记录每个人博得的奖项，结束后可切换轮次回看。'}</p><p>斜立、出碗或未停稳会判定为无效投掷，最多尝试三次，仍无效则跳过本轮；${isSolo ? '每次投掷在本机执行物理计算，全部停稳后揭晓，不预设点数。' : '等待投掷超时也会跳过，并保留记录。点数、轮次与判奖均由服务器统一计算。'}</p><p>${isSolo ? '试玩记录只在当前页面暂存，刷新页面或结束试玩后清空。' : '临时断线会保留席位；返回当前浏览器标签页可尝试重连。服务重启后，临时房间和记录清空。'}</p></div>
    </div>
    <div class="guide-footer"><button id="rules-story-button" class="guide-switch">读读博饼故事 <span aria-hidden="true">↗</span></button><button class="button button-primary close-dialog">知道了，博个好运</button></div>
  </dialog>
  <dialog id="story-dialog" class="guide-dialog story-dialog" aria-labelledby="story-title">
    <div class="dialog-heading"><div><p class="eyebrow">A MID-AUTUMN TRADITION</p><h2 id="story-title">${escape(CULTURE_STORY.title)}</h2><p class="guide-edition">从一场游戏，读到一份乡情</p></div><button class="icon-button close-dialog" aria-label="关闭博饼故事" autofocus>×</button></div>
    <div class="guide-scroll story-body">${renderCultureStory()}</div>
    <div class="guide-footer"><button id="story-rules-button" class="guide-switch">看骰子图解 <span aria-hidden="true">↗</span></button><button class="button button-primary close-dialog">回去博个好运</button></div>
  </dialog>
`;

const $ = id => document.getElementById(id);
const nicknameKey = 'bobing.nickname';
try { $('nickname').value = localStorage.getItem(nicknameKey) || ''; } catch {}
const client = isSolo ? new SoloClient() : roomServer.url ? new RoomClient({ url: roomServer.url }) : null;
const clientState = client?.state || { room: null, selfId: null, connected: false, serverOffset: 0 };
let scene;
let audioContext;
let impactBuffers = [];
let loadingAudio;
let impactSample = 0;
let muted = false;
let lastSound = 0;
let toastTimeout;
let lastHistoryId = null;
let initialSnapshot = true;
let busy = false;
let localRoom = null;
let viewedRound = null;
let awardsRoomCode = null;
let previousRoomPhase = null;

function unlockAudio() {
  if (!audioContext && !muted) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio) audioContext = new Audio();
  }
  audioContext?.resume().catch(() => {});
  if (audioContext && !loadingAudio) {
    loadingAudio = Promise.all(COLLISION_SAMPLES.map(async path => {
      const response = await fetch(publicAsset(path));
      if (!response.ok) throw new Error(`碰撞音效加载失败 (${response.status})`);
      return audioContext.decodeAudioData(await response.arrayBuffer());
    })).then(buffers => { impactBuffers = buffers; }).catch(error => {
      loadingAudio = null;
      notify('碰撞音效暂时未加载，请点击音效开关重试。', true);
      console.warn(error.message);
    });
  }
}
function playImpact(strength = 1) {
  if (!audioContext || muted || audioContext.state !== 'running' || !impactBuffers.length) return;
  const now = audioContext.currentTime;
  if (now - lastSound < .026) return;
  lastSound = now;
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = impactBuffers[impactSample++ % impactBuffers.length];
  gain.gain.setValueAtTime(impactVolume(strength), now);
  source.connect(gain).connect(audioContext.destination);
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  source.start(now);
}

function notify(message, isError = false) {
  clearTimeout(toastTimeout);
  $('toast').textContent = message;
  $('toast').className = `toast ${isError ? 'error' : ''}`;
  toastTimeout = setTimeout(() => $('toast').classList.add('hidden'), isError ? 6500 : 3600);
}
function escape(text) { return String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function room() { return clientState.room || localRoom; }
function self() { return room()?.players.find(p => p.id === clientState.selfId); }
function name() {
  const value = $('nickname').value.trim();
  if (!value) { $('nickname').focus(); notify('先写下你的称呼，好让朋友找到你。', true); return null; }
  try { localStorage.setItem(nicknameKey, value); } catch {}
  return value;
}

async function send(type, payload = {}) {
  unlockAudio();
  if (!clientState.connected) { notify(roomServer.error || (isSolo ? '试玩尚未就绪，请刷新重试。' : '正在连接房间服务，请稍后再试。'), true); return false; }
  if (busy) return false;
  busy = true;
  updateActions();
  try { await client.send(type, payload); return true; }
  catch (error) { notify(error.message || '操作没有完成，请再试一次。', true); return false; }
  finally { busy = false; updateActions(); }
}

$('create-button').addEventListener('click', async () => {
  const playerName = name();
  if (!playerName || !(await send('create', { name: playerName, rounds: Number($('rounds').value) }))) return;
  if (isSolo && await send('ready', { ready: true })) await send('start');
});
$('join-button').addEventListener('click', () => {
  const playerName = name(); if (!playerName) return;
  const code = $('room-code-input').value.trim();
  if (!/^\d{6}$/.test(code)) { $('room-code-input').focus(); notify('房间码是 6 位数字，请检查后再加入。', true); return; }
  send('join', { name: playerName, roomCode: code });
});
$('room-code-input').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });
$('room-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('join-button').click(); });
$('ready-button').addEventListener('click', () => send('ready', { ready: !self()?.ready }));
$('start-button').addEventListener('click', () => send('start'));
$('leave-button').addEventListener('click', () => send('leave'));
$('award-round').addEventListener('change', event => {
  const r = room();
  if (!r) return;
  const selected = Number(event.target.value);
  viewedRound = selected === currentRound(r) ? null : selected;
  renderAwards(r);
});
$('follow-round-button').addEventListener('click', () => { viewedRound = null; renderAwards(room()); });
$('roll-button').addEventListener('click', async () => {
  const r = room();
  if (!r) { $('nickname').focus(); $('join-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  if (r.phase === 'finished' && r.hostId === clientState.selfId) {
    if (await send('reset') && isSolo && await send('ready', { ready: true })) await send('start');
    return;
  }
  if (r.phase === 'lobby') {
    if (!self()?.ready) return send('ready', { ready: true });
    if (r.hostId === clientState.selfId && r.players.filter(p => p.connected).every(p => p.ready)) return send('start');
    return;
  }
  send('roll');
});
$('copy-button').addEventListener('click', async () => {
  const code = room()?.code; if (!code) return;
  try { await navigator.clipboard.writeText(code); notify(`房间码 ${code} 已复制，发给朋友就能入席。`); }
  catch { notify(`房间码：${code}。请长按或手动复制。`); }
});
$('sound-button').addEventListener('click', () => {
  muted = !muted;
  if (!muted) unlockAudio();
  $('sound-button').innerHTML = muted ? icons.muted : icons.sound;
  $('sound-button').setAttribute('aria-label', muted ? '开启碰撞音效' : '关闭碰撞音效');
  $('sound-button').title = muted ? '开启碰撞音效' : '关闭碰撞音效';
  $('sound-button').classList.toggle('muted', muted);
});
function openGuide(id) {
  for (const dialogId of ['rules-dialog', 'story-dialog']) if ($(dialogId).open) $(dialogId).close();
  $(id).querySelector('.guide-scroll').scrollTop = 0;
  $(id).showModal();
}
for (const id of ['rules-button', 'detail-rules-button', 'story-rules-button']) $(id).addEventListener('click', () => openGuide('rules-dialog'));
for (const id of ['story-button', 'rules-story-button']) $(id).addEventListener('click', () => openGuide('story-dialog'));
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
for (const id of ['rules-dialog', 'story-dialog']) $(id).addEventListener('click', e => { if (e.target === $(id)) { const box = e.target.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) e.target.close(); } });

client?.on('connection', () => {
  const connected = clientState.connected;
  $('connection').className = `connection ${connected ? 'online' : 'offline'}`;
  $('connection').innerHTML = `<i></i>${isSolo ? connected ? '试玩就绪' : '试玩暂停' : connected ? '已连接' : '正在重连'}`;
  updateActions();
});
client?.on('room', snapshot => {
  localRoom = snapshot.room || (snapshot.players ? snapshot : null);
  renderRoom();
});
client?.on('left', () => { const hadRoom = !!localRoom; localRoom = null; lastHistoryId = null; initialSnapshot = true; scene?.setRoll(null); renderRoom(); if (hadRoom) notify(isSolo ? '本次试玩已结束，随时再博个好运。' : '已离开房间，期待下一次团圆。'); });
client?.on('trajectory', payload => {
  const roll = payload.roll || payload;
  scene?.setRoll(roll, clientState.serverOffset || 0);
});
client?.on('error', error => notify(error.message || '连接出现问题，请稍后重试。', true));

function renderRoom() {
  const r = room();
  if (awardsRoomCode !== r?.code || (r?.phase === 'lobby' && previousRoomPhase !== 'lobby')) viewedRound = null;
  awardsRoomCode = r?.code || null;
  previousRoomPhase = r?.phase || null;
  if (r?.phase === 'lobby' && !r.history?.length) scene?.setRoll(null);
  $('join-panel').classList.toggle('hidden', !!r);
  $('room-panel').classList.toggle('hidden', !r);
  if (r) {
    $('room-code').textContent = r.code;
    $('player-count').textContent = r.players.length;
    const phases = { lobby:'等候开桌', waiting:'轮流投掷', rolling:'好运碰撞中', finished:'本局已圆满' };
    $('room-phase').textContent = phases[r.phase] || '';
    $('stage-tag').textContent = isSolo ? `${r.players[0].name} · 单人试玩` : `房间 ${r.code} · ${r.players.length} 人同桌`;
    $('seats').innerHTML = Array.from({ length: isSolo ? 0 : 12 }, (_, i) => {
      const p = r.players.find(p => p.seat === i);
      if (!p) return `<div class="seat empty-seat"><span class="seat-avatar">＋</span><span class="seat-name">虚位以待</span><span class="seat-meta">${String(i + 1).padStart(2,'0')} 席</span></div>`;
      const isSelf = p.id === clientState.selfId;
      const isTurn = r.turnPlayerId === p.id;
      const status = playerRoundStatus(r, p, currentRound(r));
      return `<div class="seat ${isTurn ? 'current-seat' : ''} ${!p.connected ? 'disconnected-seat' : ''}"><span class="seat-avatar avatar-${i % 4}">${escape(p.name.slice(0,1))}${p.id === r.hostId ? '<i class="host-badge" title="房主">主</i>' : ''}</span><span class="seat-name" title="${escape(p.name)}">${escape(p.name)}${isSelf ? '<small>我</small>' : ''}</span><span class="seat-meta ${p.ready ? 'ready-meta' : ''}" title="${escape(status.detail)}">${escape(status.label)}</span></div>`;
    }).join('');
  } else $('stage-tag').textContent = isSolo ? '中秋好手气 · 单人试玩' : '团圆桌 · 等你入席';
  renderAwards(r);
  renderHistory(r);
  updateActions();
}

function currentRound(r) { return Math.min(Math.max(r.round || 1, 1), r.totalRounds || 1); }

function historyStatus(record) {
  if (!record.invalid) return { label: record.award?.name || '等待判奖', kind: 'award', detail: '本轮博得', completed: true };
  if (record.award?.name === '超时跳过' || /超时/.test(record.invalid)) return { label: '超时跳过', kind: 'skipped', detail: record.invalid, completed: true };
  if (/跳过本轮|连续\s*3\s*次/.test(record.invalid)) return { label: '无效跳过', kind: 'skipped', detail: record.invalid, completed: true };
  return { label: '无效投掷', kind: 'retry', detail: record.invalid, completed: false };
}

function playerRoundStatus(r, player, roundNumber) {
  const records = (r.history || []).filter(h => h.playerId === player.id && h.round === roundNumber);
  const last = records[records.length - 1];
  const status = last ? historyStatus(last) : null;
  if (status?.completed) return { ...status, record: last, attempts: records.length };
  const active = roundNumber === currentRound(r) && r.turnPlayerId === player.id && ['waiting', 'rolling'].includes(r.phase);
  if (active) {
    const label = r.phase === 'rolling' ? last ? '重新投掷中' : '投掷中' : last ? '无效待重掷' : player.connected ? '轮到投掷' : '等候重连';
    return { label, kind: 'active', detail: last?.invalid || (r.phase === 'rolling' ? '骰子停稳后揭晓' : '等待本轮投掷'), completed: false, record: last, attempts: records.length };
  }
  if (status) return { ...status, label: '无效未完成', record: last, attempts: records.length };
  if (r.phase === 'lobby') return { label: !player.connected ? '暂时离线' : player.ready ? '已准备' : '待准备', kind: 'pending', detail: '开桌后记录本轮所得', completed: false };
  if (roundNumber < currentRound(r) || r.phase === 'finished') return { label: '无投掷记录', kind: 'pending', detail: '本轮没有可用记录', completed: false };
  return { label: player.connected ? '尚未投掷' : '暂时离线', kind: 'pending', detail: '等待轮到本席', completed: false };
}

function renderAwards(r) {
  $('awards-title').textContent = isSolo ? '试玩记录' : '每轮所得';
  $('round-controls').classList.toggle('hidden', !r);
  if (!r) {
    $('round-summary').textContent = isSolo ? '一轮一记，留下你的中秋好彩头。' : '一轮一记，记下每个人的好彩头。';
    $('round-awards').innerHTML = `<div class="empty-state">${icons.dice}<p>${isSolo ? '这一轮，会博得什么？' : '这一轮，谁会博得状元？'}</p><span>${isSolo ? '开始试玩后，按轮查看博得的奖项。' : '入席后，按轮查看每个人博得的奖项。'}</span></div>`;
    return;
  }
  const latestRound = currentRound(r);
  if (viewedRound !== null) viewedRound = Math.min(viewedRound, latestRound);
  const selected = viewedRound ?? latestRound;
  $('award-round').innerHTML = Array.from({ length: latestRound }, (_, i) => `<option value="${i + 1}" ${i + 1 === selected ? 'selected' : ''}>第 ${i + 1} 轮${i + 1 === latestRound && r.phase !== 'finished' ? ' · 当前' : ''}</option>`).join('');
  $('award-round').disabled = latestRound < 2;
  $('follow-round-button').classList.toggle('hidden', viewedRound === null || selected === latestRound || r.phase === 'finished');
  const players = [...r.players].sort((a,b) => a.seat - b.seat);
  // Preserve a departed player's award when looking back at a completed round.
  for (const h of r.history || []) {
    if (h.round === selected && !players.some(p => p.id === h.playerId)) players.push({ id: h.playerId, name: h.playerName || '已离开玩家', connected: false, departed: true });
  }
  const rows = players.map(player => ({ player, status: playerRoundStatus(r, player, selected) }));
  const completed = rows.filter(({status}) => status.completed).length;
  $('round-summary').textContent = r.phase === 'lobby' ? '准备开始 · 奖项将在投掷后揭晓' : `第 ${selected} 轮 · ${isSolo ? completed ? '已完成' : '等待结果' : `${completed} / ${rows.length} 人已完成`}${viewedRound === null && r.phase !== 'finished' ? ' · 跟随当前' : ''}`;
  $('round-awards').innerHTML = rows.map(({player: p, status}) => `<div class="round-award-row ${p.id === clientState.selfId ? 'self-award' : ''} ${status.kind === 'active' ? 'active-award' : ''}"><span class="award-seat">${isSolo ? '本轮' : Number.isInteger(p.seat) ? `${String(p.seat + 1).padStart(2,'0')} 席` : '离席'}</span><span class="award-player" title="${escape(p.name)}">${escape(p.name)}${p.id === clientState.selfId ? '<small>你</small>' : ''}</span><strong class="award-status ${status.kind}" title="${escape(status.detail)}">${escape(status.label)}</strong>${status.attempts > 1 ? `<small class="award-attempts">本轮第 ${status.attempts} 次尝试</small>` : ''}</div>`).join('');
}

function renderHistory(r) {
  const history = r?.history || [];
  $('history-count').textContent = `${history.length} 掷`;
  if (!history.length) {
    $('history').innerHTML = `<div class="empty-state">${icons.dice}<p>好事，值得等一等。</p><span>${isSolo ? '投掷后，每一轮好彩头都记在这里。' : '开桌后，每一掷都会记在这里。'}</span></div>`;
    lastHistoryId = null;
  } else {
    $('history').innerHTML = [...history].reverse().slice(0, 30).map(h => `<article class="history-item"><div class="history-item-top"><b>${escape(h.playerName)}</b><span>第 ${h.round} 轮</span></div><div class="history-result"><span class="history-dice">${(h.values || []).map(v => `<i class="mini-die ${v === 4 || v === 1 ? 'red-die' : ''}">${['','⚀','⚁','⚂','⚃','⚄','⚅'][v] || '·'}</i>`).join('')}</span><strong class="${h.invalid ? 'invalid-result' : ''}">${escape(historyStatus(h).label)}</strong></div>${h.invalid ? `<p class="invalid-note">${escape(h.invalid)}</p>` : ''}</article>`).join('');
    const last = history[history.length - 1];
    if (!initialSnapshot && last.id !== lastHistoryId) {
      const status = historyStatus(last);
      notify(last.invalid ? `${last.playerName} · ${status.label}${status.completed ? '' : '，请按提示重掷。'}` : `第 ${last.round} 轮 · ${last.playerName} 博得「${last.award?.name || '等待判奖'}」`);
    }
    lastHistoryId = last.id;
  }
  initialSnapshot = false;
}

function updateActions() {
  const r = room();
  const connected = clientState.connected;
  $('create-button').disabled = !connected || busy;
  $('join-button').disabled = !connected || busy;
  $('leave-button').disabled = !connected || busy;
  const rollButton = $('roll-button');
  rollButton.classList.toggle('rolling', r?.phase === 'rolling');
  rollButton.classList.toggle('finished', r?.phase === 'finished');
  let title = '落座，等一场好运。';
  let description = '创建或加入房间，和朋友一起博饼。';
  let eyebrow = '好彩头，从这一掷开始';
  let label = '入席博好运';
  let disabled = false;
  if (isSolo) {
    title = '来，博个中秋好彩头。'; description = '填写称呼、选好轮数，即可开始单人试玩。'; label = '开始试玩';
  }
  if (roomServer.error) {
    title = roomServer.error;
    description = '暂时无法创建或加入房间，请等待联机服务接通。';
    label = '联机暂未开放'; disabled = true;
    $('connection').className = 'connection offline';
    $('connection').innerHTML = '<i></i>联机暂未开放';
    $('lobby-description').textContent = `${roomServer.error}，暂时无法创建或加入房间。`;
    $('lobby-note').textContent = '联机服务接通后，即可邀请好友一起博饼。';
  }
  if (r) {
    const me = self();
    const isHost = r.hostId === clientState.selfId;
    const allReady = r.players.filter(p => p.connected).every(p => p.ready);
    const turn = r.players.find(p => p.id === r.turnPlayerId);
    $('ready-button').classList.toggle('hidden', isSolo || r.phase !== 'lobby');
    $('ready-button').textContent = me?.ready ? '✓ 已准备 · 点击取消' : '准备好了';
    $('ready-button').disabled = !connected || busy;
    $('start-button').classList.toggle('hidden', isSolo || !(r.phase === 'lobby' && isHost));
    $('start-button').disabled = !connected || busy || !allReady;
    $('room-action-note').textContent = isSolo ? `${r.players[0].name} · 共 ${r.totalRounds} 轮${r.phase === 'finished' ? ' · 本次试玩已圆满' : ' · 奖项逐轮记录'}` : r.phase === 'lobby' ? isHost ? '好友凭房间码加入，在线玩家准备后即可开桌。' : '准备好后，等待房主开桌。' : r.phase === 'finished' ? '本局已结束，房主可以再开一局。' : '按座位依次投掷，共享每一次好运。';
    $('round-label').textContent = `第 ${Math.min(r.round, r.totalRounds)} / ${r.totalRounds} 轮 · ${isSolo ? '单人试玩' : `${r.players.length} 人同桌`}`;
    if (r.phase !== 'waiting') $('countdown').textContent = '';
    if (r.phase === 'lobby') {
      title = '人到齐，好戏就开场。';
      description = `${r.players.filter(p => p.ready).length} / ${r.players.length} 人已准备，${isHost ? '由你来开启这桌好运。' : '等房主开启这桌好运。'}`;
      eyebrow = '佳节已至，好友入席';
      label = !me?.ready ? '我准备好了' : isHost && allReady ? '开桌，博个好运' : '等待大家准备';
      disabled = !!me?.ready && !(isHost && allReady);
    } else if (r.phase === 'rolling') {
      title = `${turn?.name || '好友'}的好运，正在碰撞。`;
      description = '六颗骰子自由翻滚，停稳后一起揭晓。';
      eyebrow = '叮叮当当，好运满碗'; label = '好运碰撞中'; disabled = true;
    } else if (r.phase === 'finished') {
      title = '好运同享，团圆圆满。';
      description = isSolo ? `${r.totalRounds} 轮已完成，可在「试玩记录」回看每轮博得的奖项。` : `本局 ${r.totalRounds} 轮已完成，可在「每轮所得」回看大家博得的奖项。`;
      eyebrow = '花好月圆，尽兴而归'; label = isSolo ? '再试玩一局' : isHost ? '再开一桌好运' : '等待房主再开局'; disabled = !isHost;
    } else {
      const isMyTurn = r.turnPlayerId === clientState.selfId;
      title = isMyTurn ? '轮到你了，博个好彩头。' : `静候 ${turn?.name || '好友'} 的好运。`;
      description = isMyTurn ? '轻点下方按钮，六颗骰子为你起舞。' : '大家会看到同一场投掷，结果停稳后揭晓。';
      eyebrow = isMyTurn ? '此刻，好运在你手中' : '一桌欢喜，轮流接好运'; label = isMyTurn ? '博一下' : '等待好友投掷'; disabled = !isMyTurn;
    }
    if (!connected) { description = '连接暂时中断，正在尝试恢复房间…'; disabled = true; }
  } else { $('round-label').textContent = isSolo ? '六骰一碗 · 单人试玩' : '六骰一碗 · 同屏相聚'; $('countdown').textContent = ''; }
  $('turn-title').textContent = title;
  $('turn-description').textContent = description;
  $('turn-eyebrow').textContent = eyebrow;
  $('roll-label').textContent = busy ? '请稍候…' : label;
  rollButton.disabled = disabled || busy || (!!r && !connected);
}

try {
  const box = $('scene-wrap').getBoundingClientRect();
  scene = createScene({ canvas: $('game-canvas'), width: box.width, height: box.height, pixelRatio: devicePixelRatio, onImpact: playImpact });
  scene.loadModels({ bowlUrl: publicAsset('models/bowl.glb'), dieUrl: publicAsset('models/die.glb') }).then(() => { $('model-label').textContent = '青瓷 · 描金'; }).catch(error => { console.warn('Blender model loading failed', error); $('model-label').textContent = '模型加载失败'; notify('精细模型暂未加载，正在显示基础模型。可刷新页面重试。', true); });
  new ResizeObserver(entries => { const box = entries[0].contentRect; scene.resize(box.width, box.height, devicePixelRatio); }).observe($('scene-wrap'));
} catch (error) {
  console.error(error);
  $('scene-error').classList.remove('hidden');
  $('scene-error').textContent = '当前浏览器无法启动 3D 画面，请启用硬件加速，或使用支持 WebGL 的浏览器。';
}

let lastSecond = -1;
function animate() {
  requestAnimationFrame(animate);
  const now = Date.now();
  scene?.update(now); scene?.render();
  if (Math.floor(now / 1000) !== lastSecond) {
    lastSecond = Math.floor(now / 1000);
    const r = room();
    $('countdown').textContent = r?.phase === 'waiting' && r.turnDeadline ? `${Math.max(0, Math.ceil((r.turnDeadline - now - (clientState.serverOffset || 0)) / 1000))} 秒内投掷` : '';
  }
}
renderRoom();
animate();
client?.connect();
// Minimal, read-only diagnostics for local integration tests.
window.__bobing = { client, get scene() { return scene; } };
