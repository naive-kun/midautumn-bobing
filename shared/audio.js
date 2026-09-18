// Both runtimes use the same original, synthesized ceramic-bowl impact samples.
export const COLLISION_SAMPLES = ['audio/clink.wav', 'audio/clink-soft.wav', 'audio/clink-bright.wav'];

export function impactVolume(strength = 1) {
  const normalized = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
  return 0.10 + 0.30 * Math.sqrt(normalized);
}
