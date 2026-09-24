import * as THREE from 'three/webgpu';

/** One board cell is 2 m (200 UU in the Unreal build). The board is 24 x 24 cells centred on the origin, tile tops at y = 0. */
export const CellSize = 2;
export const BoardCells = 24;
export const BoardHalf = (BoardCells * CellSize) / 2;
export const NumEras = 3;
/** Regular foods required before each optional transition collectible appears. */
export const EraThresholds = [0, 8, 10] as const;
/** The phone's LCD backlight: the colour we dive through, in and out of the arena. */
export const BacklightGreen = '#B8D86A';
export const IntroSeconds = 3.2;

/** Board cell (col, row) to world. Right = +x, Down (+row) = +z, like the UE build (web z = UE Y). */
export function cellX(col: number): number {
  return (col - (BoardCells - 1) * 0.5) * CellSize;
}
export function cellZ(row: number): number {
  return (row - (BoardCells - 1) * 0.5) * CellSize;
}

export const EraYear = ['2001', 'PRESENT', 'FUTURE'] as const;
export const EraName = ['monochrome dreams', 'the world, rendered', 'the future is chrome'] as const;

const c = (hex: string) => new THREE.Color(hex);

/** Palette (sRGB hex -> linear THREE.Color). */
export const Palette = {
  lcd: c('#B8D86A'),
  lcdDark: c('#7C9848'),
  olive: c('#1C2612'),
  cyan: c('#2BF0FF'),
  magenta: c('#FF2EC8'),
  gold: c('#FFC050'),
};

/**
 * How the world is lit and graded in one era (FArenaEraLook + the per-era PostProcessVolume), in web units.
 * Blended continuously while the era shifts.
 */
export interface EraLook {
  sunColor: THREE.Color;
  sunIntensity: number;
  /** Direction *towards* the sun (normalised). */
  sunDir: THREE.Vector3;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  envIntensity: number;
  fogColor: THREE.Color;
  fogDensity: number;
  exposure: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  foodLightColor: THREE.Color;
  foodLightIntensity: number;
  /** Accent for the food ring, seam glow and popups. */
  accent: THREE.Color;
}

/** UE light rotation (pitch, yaw in degrees; the light travels along it) to a web direction towards the sun. */
function sunFromUE(pitch: number, yaw: number): THREE.Vector3 {
  const p = THREE.MathUtils.degToRad(pitch);
  const y = THREE.MathUtils.degToRad(yaw);
  // travel = (cosP cosY, cosP sinY, sinP) in UE (X, Y, Z); web = (X, Z, Y); towards the sun = -travel
  return new THREE.Vector3(-Math.cos(p) * Math.cos(y), -Math.sin(p), -Math.cos(p) * Math.sin(y)).normalize();
}

export const EraLooks: EraLook[] = [
  {
    // 2001: the LCD's backlight is the light. High soft sun, bright green haze.
    sunColor: c('#E6FFC0'),
    sunIntensity: 1.3,
    sunDir: sunFromUE(-58, 30),
    hemiSky: c('#D8F0A0'),
    hemiGround: c('#5A7A30'),
    hemiIntensity: 0.9,
    envIntensity: 0.4,
    fogColor: c('#A9CB63'),
    fogDensity: 0.0018,
    exposure: 1.0,
    bloomStrength: 0.5,
    bloomRadius: 0.75,
    bloomThreshold: 0.12,
    foodLightColor: c('#B8D86A'),
    foodLightIntensity: 0,
    accent: c('#2E3C1E'),
  },
  {
    // Present: golden hour above a sea of clouds. Low warm sun, long shadows.
    sunColor: c('#FFC98F'),
    sunIntensity: 4.4,
    sunDir: sunFromUE(-11, 65),
    hemiSky: c('#C4CCDC'),
    hemiGround: c('#7A5A38'),
    hemiIntensity: 0.5,
    envIntensity: 0.55,
    fogColor: c('#F2C290'),
    fogDensity: 0.0011,
    exposure: 0.95,
    bloomStrength: 0.5,
    bloomRadius: 0.5,
    bloomThreshold: 0.3,
    foodLightColor: c('#FFC050'),
    foodLightIntensity: 40,
    accent: c('#FFC86A'),
  },
  {
    // Future: night synthwave. Dim violet key, everything else is neon.
    sunColor: c('#9A7BFF'),
    sunIntensity: 0.45,
    sunDir: sunFromUE(-24, 200),
    hemiSky: c('#5A2AA0'),
    hemiGround: c('#12051E'),
    hemiIntensity: 0.55,
    envIntensity: 0.9,
    fogColor: c('#3A125C'),
    fogDensity: 0.005,
    exposure: 1.0,
    bloomStrength: 0.6,
    bloomRadius: 0.55,
    bloomThreshold: 0.15,
    foodLightColor: c('#FF2EC8'),
    foodLightIntensity: 60,
    accent: c('#FF2EC8'),
  },
];

export function smoothstep01(x: number): number {
  x = Math.min(1, Math.max(0, x));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function easeOutBack(x: number): number {
  x = Math.min(1, Math.max(0, x));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Exponential approach, like FMath::FInterpTo. */
export function damp(current: number, target: number, speed: number, dt: number): number {
  return current + (target - current) * Math.min(1, dt * speed);
}
