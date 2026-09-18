/** Local test harness for the packaged mini-game. This is NOT the Douyin runtime. */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>博饼 · 小游戏适配测试</title><style>html,body{margin:0;background:#f3efe3;overflow:hidden}canvas{display:block}#status{position:fixed;top:0;left:0;font:9px sans-serif;pointer-events:none;color:#788776}</style><div id="status">本地适配测试 · 非抖音真机</div><script>
let firstCanvas=true; let touches; let keyConfirm; let keyComplete;
window.__messages=[];
window.tt={
 createCanvas(){const c=document.createElement('canvas');if(firstCanvas){firstCanvas=false;document.body.append(c);c.id='game'}return c},
 getSystemInfoSync(){return {windowWidth:innerWidth,windowHeight:innerHeight,pixelRatio:devicePixelRatio,safeArea:{top:24}}},
 getStorageSync:k=>sessionStorage.getItem(k),setStorageSync:(k,v)=>sessionStorage.setItem(k,v),
 connectSocket({url,success,fail}){let callbacks={};const s=new WebSocket(url);s.onopen=e=>{success?.({});callbacks.open?.(e)};s.onmessage=e=>{try{const m=JSON.parse(e.data);window.__messages.push(m);if(m.type==='room')window.__room=m.room;if(m.type==='error')document.querySelector('#status').textContent=m.message}catch{} callbacks.message?.({data:e.data})};s.onerror=e=>{fail?.(e);callbacks.error?.(e)};s.onclose=e=>callbacks.close?.(e);return {onOpen:f=>callbacks.open=f,onMessage:f=>callbacks.message=f,onError:f=>callbacks.error=f,onClose:f=>callbacks.close=f,send:({data,fail})=>{try{s.send(data)}catch(e){fail?.(e)}},close:()=>s.close()}},
 getFileSystemManager(){return {readFile:({filePath,success,fail})=>fetch('/'+filePath).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer()}).then(data=>success({data})).catch(fail)}},
 createInnerAudioContext(){const a=new Audio();return {set src(s){a.src='/'+s},set volume(v){a.volume=v},set obeyMuteSwitch(v){},play(){a.play().catch(()=>{})},stop(){a.pause();a.currentTime=0}}},
 onShow(fn){document.addEventListener('visibilitychange',()=>{if(!document.hidden)fn()})},
 onTouchEnd(fn){touches=fn},
 onKeyboardConfirm(fn){keyConfirm=fn},offKeyboardConfirm(){keyConfirm=null},onKeyboardComplete(fn){keyComplete=fn},offKeyboardComplete(){keyComplete=null},
 showKeyboard({defaultValue}){const value=prompt('输入',defaultValue);if(value!==null)keyConfirm?.({value});else keyComplete?.({})},hideKeyboard(){},
 showModal({title,content,showCancel,success}){if(showCancel===false)alert(title+'\\n'+content);else success?.({confirm:confirm(title+'\\n'+content)})},
 setClipboardData({data,success}){navigator.clipboard.writeText(data).then(()=>success?.({}))}
};
document.addEventListener('pointerup',e=>touches?.({changedTouches:[{clientX:e.clientX,clientY:e.clientY}]}));
window.addEventListener('error',e=>{document.querySelector('#status').textContent='ERROR '+e.message});
</script><script src="/game.js"></script></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/' || path === '/index.html') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); return; }
    if (!/^\/(game\.js|models\/[a-zA-Z0-9.-]+|audio\/[a-zA-Z0-9.-]+)$/.test(path)) { res.writeHead(404); res.end(); return; }
    const data = await readFile(resolve('dist/douyin', path.slice(1)));
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(5180, '127.0.0.1', () => console.log('Mini-game adapter harness http://127.0.0.1:5180 (not a real Douyin runtime)'));
