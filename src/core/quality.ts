/**
 * Graphics quality tier, picked once at startup from the device. Renderers read it to
 * scale shadows, ground cover and water detail so phones stay smooth.
 * FROZEN contract (integrator-owned).
 */
export type QualityTier = 'low' | 'medium' | 'high';

export interface Quality {
  tier: QualityTier;
  /** Max device pixel ratio for the canvas. */
  pixelRatio: number;
  /** Real-time sun shadows. */
  shadows: boolean;
  /** Shadow map size (square), if shadows are on. */
  shadowMapSize: number;
  /** Grass/flower tufts per square unit near the camera (0 disables ground cover). */
  grassDensity: number;
  /** Radius around the camera focus in which ground cover is drawn. */
  grassRadius: number;
  /** Full water shader (depth tint, foam, ripples, reflections) vs a cheap animated plane. */
  fancyWater: boolean;
}

const TIERS: Record<QualityTier, Quality> = {
  low: { tier: 'low', pixelRatio: 1, shadows: false, shadowMapSize: 0, grassDensity: 0, grassRadius: 0, fancyWater: false },
  medium: { tier: 'medium', pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, grassDensity: 3, grassRadius: 28, fancyWater: true },
  high: { tier: 'high', pixelRatio: 2, shadows: true, shadowMapSize: 2048, grassDensity: 7, grassRadius: 45, fancyWater: true },
};

/** `?quality=low|medium|high` overrides detection (handy for testing). */
export function detectQuality(): Quality {
  if (typeof window === 'undefined') return TIERS.medium;
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced === 'low' || forced === 'medium' || forced === 'high') return TIERS[forced];
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const cores = navigator.hardwareConcurrency ?? 4;
  const small = Math.min(window.screen.width, window.screen.height) < 600;
  if (coarse && (small || cores <= 4)) return TIERS.low;
  if (coarse || cores <= 4) return TIERS.medium;
  return TIERS.high;
}

export function qualityTier(tier: QualityTier): Quality {
  return TIERS[tier];
}
