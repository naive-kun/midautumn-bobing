import { parentPort, workerData } from 'node:worker_threads';
import { simulateRoll } from '../shared/physics.js';

try {
  const result = await simulateRoll(workerData);
  parentPort.postMessage({ result });
} catch (error) {
  parentPort.postMessage({ error: error.message || 'Physics simulation failed' });
}
