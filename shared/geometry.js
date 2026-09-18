// All physics and render assets use Y-up and the same scene units.
export const DICE_SIZE = 0.52;
export const DICE_HALF = DICE_SIZE / 2;
export const DICE_BEVEL = 0.025;
export const DICE_COUNT = 6;
export const BOWL_SEGMENTS = 64;
export const BOWL_PROFILE = Object.freeze([
  Object.freeze([2.35, 0]),
  Object.freeze([2.6, 0.16]),
  Object.freeze([2.85, 0.55]),
  Object.freeze([3.15, 1.15]),
  Object.freeze([3.5, 1.85]),
]);
export const BOWL_RADIUS = 3.5;
export const BOWL_HEIGHT = 1.85;
export const DICE_FACES = Object.freeze([
  Object.freeze({ value: 1, normal: Object.freeze([0, 1, 0]) }),
  Object.freeze({ value: 6, normal: Object.freeze([0, -1, 0]) }),
  Object.freeze({ value: 3, normal: Object.freeze([1, 0, 0]) }),
  Object.freeze({ value: 4, normal: Object.freeze([-1, 0, 0]) }),
  Object.freeze({ value: 2, normal: Object.freeze([0, 0, 1]) }),
  Object.freeze({ value: 5, normal: Object.freeze([0, 0, -1]) }),
]);

// Indexed rings are triangulated with their normals facing the bowl interior.
// This mesh is static and concave: NEVER replace it with one convex hull.
export function createBowlTriangles(segments = BOWL_SEGMENTS) {
  if (!Number.isInteger(segments) || segments < 12) throw new RangeError('Bowl needs at least 12 segments');
  const triangles = [];
  const point = ([radius, y], i) => [radius * Math.cos(i * Math.PI * 2 / segments), y, radius * Math.sin(i * Math.PI * 2 / segments)];
  for (let i = 0; i < segments; i++) {
    triangles.push([[0, 0, 0], point(BOWL_PROFILE[0], i + 1), point(BOWL_PROFILE[0], i)]);
    for (let ring = 0; ring < BOWL_PROFILE.length - 1; ring++) {
      const a = point(BOWL_PROFILE[ring], i);
      const b = point(BOWL_PROFILE[ring], i + 1);
      const c = point(BOWL_PROFILE[ring + 1], i);
      const d = point(BOWL_PROFILE[ring + 1], i + 1);
      triangles.push([a, b, c], [b, d, c]);
    }
  }
  return triangles;
}

export function bowlFloorHeight(radius) {
  if (radius <= BOWL_PROFILE[0][0]) return 0;
  for (let i = 1; i < BOWL_PROFILE.length; i++) {
    const [r0, y0] = BOWL_PROFILE[i - 1];
    const [r1, y1] = BOWL_PROFILE[i];
    if (radius <= r1) return y0 + (y1 - y0) * (radius - r0) / (r1 - r0);
  }
  return Infinity;
}

// Read the highest world-space normal. A low alignment indicates a cocked die.
export function readUpwardFace(quaternion, minimumAlignment = 0.90) {
  if (!quaternion || quaternion.length !== 4 || !Array.from(quaternion).every(Number.isFinite)) throw new TypeError('Invalid quaternion');
  const [x, y, z, w] = quaternion;
  const length = Math.hypot(x, y, z, w);
  if (Math.abs(length - 1) > 0.01) throw new RangeError('Quaternion must be normalized');
  const worldY = [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)];
  let best;
  for (const face of DICE_FACES) {
    const alignment = face.normal.reduce((sum, component, index) => sum + component * worldY[index], 0);
    if (!best || alignment > best.alignment) best = { value: face.value, alignment };
  }
  return { ...best, valid: best.alignment >= minimumAlignment };
}
