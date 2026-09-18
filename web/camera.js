import { MathUtils } from 'three';

// Make room for the high release, then recover the close view of the bowl.
export function throwCameraLift(highestDie) {
  return MathUtils.clamp((highestDie - 2.2) / 2.45, 0, 1);
}

export function frameBowlCamera(camera, aspect, lift = 0) {
  camera.aspect = aspect;
  camera.position.set(0, 11.6, 8.7);
  camera.lookAt(0, .35 + 1.4 * lift, 0);
  const span = Math.max(7.7 + 2.8 * lift, (8.25 + .35 * lift) / aspect);
  camera.fov = MathUtils.radToDeg(2 * Math.atan(span / (2 * 14.3)));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
