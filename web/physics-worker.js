import { simulateRoll } from '../shared/physics.js';

// The standalone preview uses the same Bullet simulation as the room server.
// Only the worker owns its physics world; the page receives recorded poses.
self.addEventListener('message', async ({ data }) => {
  if (!data || data.type !== 'roll') return;
  const { id } = data;
  try {
    const result = await simulateRoll();
    self.postMessage({ type: 'result', id, result });
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error?.message || '骰子物理计算失败，请重试' });
  }
});
