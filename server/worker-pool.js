import { Worker } from 'node:worker_threads';

/** Bound CPU work and queued requests so a busy room cannot block WebSockets. */
export function createPhysicsPool({ concurrency = 2, maxQueue = 32, timeoutMs = 45000 } = {}) {
  const active = new Map();
  const queue = [];
  let closed = false;

  function drain() {
    while (!closed && active.size < concurrency && queue.length) {
      const job = queue.shift();
      let worker;
      try {
        worker = new Worker(new URL('./physics-worker.js', import.meta.url), { workerData: job.input });
      } catch (error) {
        job.reject(error);
        continue;
      }
      let completed = false;
      const timer = setTimeout(() => finish(new Error('物理计算超时，请重试')), timeoutMs);
      active.set(worker, { finish });
      function finish(error, result) {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        active.delete(worker);
        worker.terminate().catch(() => {});
        if (error) job.reject(error);
        else job.resolve(result);
        drain();
      }
      worker.once('message', (message) => finish(message.error ? new Error(message.error) : null, message.result));
      worker.once('error', (error) => finish(error));
      worker.once('exit', (code) => {
        if (!completed) finish(new Error(`物理进程提前结束 (${code})`));
      });
    }
  }

  return {
    simulate(input) {
      if (closed) return Promise.reject(new Error('物理服务已关闭'));
      if (active.size >= concurrency && queue.length >= maxQueue) {
        return Promise.reject(new Error('当前投掷较多，请稍后重试'));
      }
      return new Promise((resolve, reject) => {
        queue.push({ input, resolve, reject });
        drain();
      });
    },
    stats: () => ({ active: active.size, queued: queue.length, concurrency }),
    close() {
      closed = true;
      for (const job of queue.splice(0)) job.reject(new Error('物理服务已关闭'));
      for (const { finish } of [...active.values()]) finish(new Error('物理服务已关闭'));
    },
  };
}
