import * as THREE from 'three/webgpu';

/**
 * A small tileable fBm value-noise texture made on the CPU at load (R, G, B = three independent noise
 * fields, A = fine grain). Sampling a texture is far cheaper on phones than procedural noise in shaders;
 * it drives the sea of clouds, moss/tint variation and grass wind.
 */
export function createNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const fields = [fbm(size, 4, 1, 5), fbm(size, 8, 2, 4), fbm(size, 16, 3, 3), fbm(size, 64, 4, 2)];
  for (let i = 0; i < size * size; ++i) {
    for (let c = 0; c < 4; ++c) data[i * 4 + c] = Math.round(fields[c][i] * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Tileable fBm: `octaves` of value noise starting at `cells` lattice cells across, normalised to 0..1. */
function fbm(size: number, cells: number, seed: number, octaves: number): Float32Array {
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; ++o) {
    const n = cells << o;
    const lattice = new Float32Array(n * n);
    let s = (seed * 7919 + o * 104729) >>> 0;
    for (let i = 0; i < lattice.length; ++i) {
      // mulberry32
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      lattice[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    for (let y = 0; y < size; ++y) {
      const fy = (y / size) * n;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const r0 = (y0 % n) * n;
      const r1 = ((y0 + 1) % n) * n;
      for (let x = 0; x < size; ++x) {
        const fx = (x / size) * n;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const c0 = x0 % n;
        const c1 = (x0 + 1) % n;
        const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * tx;
        const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * tx;
        out[y * size + x] += (a + (b - a) * ty) * amplitude;
      }
    }
    total += amplitude;
    amplitude *= 0.5;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < out.length; ++i) {
    out[i] /= total;
    lo = Math.min(lo, out[i]);
    hi = Math.max(hi, out[i]);
  }
  for (let i = 0; i < out.length; ++i) out[i] = (out[i] - lo) / Math.max(1e-6, hi - lo);
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
