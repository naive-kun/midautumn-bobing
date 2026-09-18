export function socketFactory(url) {
  const socket = { readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null };
  let task;
  const fail = error => { socket.onerror?.(error); if (socket.readyState !== 3) { socket.readyState = 3; socket.onclose?.({}); } };
  task = tt.connectSocket({ url, success() {}, fail });
  const timeout = setTimeout(() => { if (socket.readyState === 0) { task.close({}); fail(new Error('连接超时')); } }, 12000);
  task.onOpen(() => { clearTimeout(timeout); socket.readyState = 1; socket.onopen?.({}); });
  task.onMessage(data => socket.onmessage?.(data));
  task.onError(fail);
  task.onClose(event => { clearTimeout(timeout); const wasClosed = socket.readyState === 3; socket.readyState = 3; if (!wasClosed) socket.onclose?.(event); });
  socket.send = data => { if (socket.readyState !== 1) throw new Error('连接未就绪'); task.send({ data, fail }); };
  socket.close = () => { clearTimeout(timeout); socket.readyState = 2; task.close({}); };
  return socket;
}
export const storage = {
  getItem: key => tt.getStorageSync(key) || null,
  setItem: (key, value) => tt.setStorageSync(key, value)
};
export function readBinary(path) {
  return new Promise((resolve, reject) => tt.getFileSystemManager().readFile({ filePath: path, success: result => resolve(result.data), fail: reject }));
}
export function prepareCanvas(canvas) {
  canvas.style ||= {};
  canvas.addEventListener ||= () => {};
  canvas.removeEventListener ||= () => {};
  canvas.setAttribute ||= () => {};
  return canvas;
}
export function installPolyfills() {
  if (!globalThis.TextDecoder) globalThis.TextDecoder = class {
    decode(bytes) {
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      let s = ''; for (const byte of data) s += `%${byte.toString(16).padStart(2, '0')}`;
      return decodeURIComponent(s);
    }
  };
}
