import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { frameBowlCamera, throwCameraLift } from '../web/camera.js';

test('high release and complete bowl fit desktop and portrait views', () => {
  for (const aspect of [.46, .65, .9, 1.15, 1.5, 2]) {
    const camera = new PerspectiveCamera(37, aspect, .1, 60);
    frameBowlCamera(camera, aspect, throwCameraLift(5));
    const points = [];
    // Bound every orientation of a 0.52 die at the six release locations.
    for (const x of [-1.51, 1.51]) for (const z of [-1.51, 1.51]) {
      for (const y of [4.19, 5.46]) points.push(new Vector3(x, y, z));
    }
    for (let i = 0; i < 64; i++) {
      points.push(new Vector3(3.66 * Math.cos(i * Math.PI / 32), 1.9, 3.66 * Math.sin(i * Math.PI / 32)));
    }
    for (const point of points) {
      point.project(camera);
      assert.ok(Math.abs(point.x) < .98 && Math.abs(point.y) < .98, `cropped at aspect ${aspect}: ${point.toArray()}`);
    }
  }
});
