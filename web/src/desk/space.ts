import * as THREE from 'three/webgpu';

/**
 * The Unreal desk level is built at 100x real size in centimetres, Z-up. The web desk is real size in metres, Y-up:
 * 1 UU = 0.1 mm and web (x, y, z) = (UE X, UE Z, UE Y) * UU. The phone's pivot (LCD surface centre) is the origin;
 * the phone's top points to +X, its screen faces +Y and the player's right is +Z.
 */
export const UU = 0.0001;

/** UE desk-space point (cm at 100x, Z-up) -> web metres (Y-up). */
export function ue(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x * UU, z * UU, y * UU);
}

/** UE yaw (degrees, X toward Y about Z-up) -> three.js rotation.y (radians). */
export function ueYaw(degrees: number): number {
  return -THREE.MathUtils.degToRad(degrees);
}

/** The desk top surface (UE DESK_Z = -205). */
export const DeskY = -205 * UU;

/** Phone keys in the same order as the C++ EPhoneKey enum. */
export const PhoneKey = {
  Select: 0, Clear: 1, Up: 2, Down: 3,
  Key1: 4, Key2: 5, Key3: 6, Key4: 7, Key5: 8, Key6: 9, Key7: 10, Key8: 11, Key9: 12,
  Star: 13, Key0: 14, Hash: 15,
  Count: 16,
} as const;
export type PhoneKey = (typeof PhoneKey)[keyof typeof PhoneKey];

export function keyName(key: number): string {
  switch (key) {
    case PhoneKey.Select: return 'Select';
    case PhoneKey.Clear: return 'Clear';
    case PhoneKey.Up: return 'Up';
    case PhoneKey.Down: return 'Down';
    case PhoneKey.Star: return 'Star';
    case PhoneKey.Key0: return '0';
    case PhoneKey.Hash: return 'Hash';
    default: return String(key - PhoneKey.Key1 + 1);
  }
}

/** LCD geometry (ArtBible 4): 95x64 pixels, 4 UU pitch, voxels 3.4 x 3.4 x 3 UU. */
export const LcdW = 95;
export const LcdH = 64;
export const PixelPitch = 4 * UU;
export const PixelSize = 3.4 * UU;
export const PixelHeight = 3 * UU;

/** Web position of an LCD pixel coordinate (ARetroPhone::PixelToLocal). */
export function pixelToLocal(px: number, py: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((LcdH * 0.5 - py) * PixelPitch, 0, (px - LcdW * 0.5) * PixelPitch);
}

/** Backlight green (#B8D86A): the colour the dive fades through. */
export const BacklightGreen = 0xb8d86a;

/** Critically-damped exponential approach (FMath::FInterpTo). */
export function interpTo(current: number, target: number, dt: number, speed: number): number {
  if (speed <= 0) return target;
  const delta = target - current;
  if (Math.abs(delta) < 1e-6) return target;
  return current + delta * THREE.MathUtils.clamp(dt * speed, 0, 1);
}

/** Quintic smoothstep used by the director's camera blends. */
export function smoothStep01(x: number): number {
  x = THREE.MathUtils.clamp(x, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Smooth 1D value noise in about [-1, 1] (stands in for FMath::PerlinNoise1D). */
export function noise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
