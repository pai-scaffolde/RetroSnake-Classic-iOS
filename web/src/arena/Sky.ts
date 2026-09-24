import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  color,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  hash,
  max,
  min,
  mix,
  positionWorld,
  pow,
  saturate,
  smoothstep,
  texture,
  time,
  vec2,
  vec3,
} from 'three/tsl';
import { setEmissive, uFloat, uVec3, type N, type UFloat, type UVec3 } from './tsl';

/** Uniforms the arena drives on the sky. */
export interface SkyParams {
  /** Continuous era 0..2 (the environment blend). */
  era: UFloat;
  /** Direction towards the Present sun. */
  sunDir: UVec3;
  /** Extra drop of the Future neon floor (m) as it rises into view. */
  gridDrop: UFloat;
}

export function createSkyParams(): SkyParams {
  return { era: uFloat(0), sunDir: uVec3(new THREE.Vector3(0, 0.2, -1).normalize()), gridDrop: uFloat(0) };
}

interface SkyTextures {
  noise: THREE.Texture;
  synthSun: THREE.Texture | null;
}

/**
 * One sky for all three eras (the UE build's M_Backdrop + SkyAtmosphere + sea of clouds + neon grid plane):
 *  0  soft LCD-backlight glow, brightest at the horizon
 *  1  golden hour above a sea of clouds, low warm sun
 *  2  synthwave dusk: magenta horizon, striped sun setting on the horizon, stars, and an endless neon grid below
 * The era weights blend continuously during a shift. Glows go to `emissive` so only they feed the bloom.
 */
export function createSkyMaterial(params: SkyParams, tex: SkyTextures, detail: number): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  const dir = positionWorld.sub(cameraPosition).normalize();
  const el = dir.y;
  const era = params.era;
  const w0 = saturate(float(1).sub(abs(era)));
  const w1 = saturate(float(1).sub(abs(era.sub(1))));
  const w2 = saturate(float(1).sub(abs(era.sub(2))));

  // ---- Era 0: the phone's backlight, a gentle glow brightest on the horizon, with a faint giant dot matrix.
  const glow = pow(float(1).sub(smoothstep(0.0, 0.45, abs(el))), 1.8);
  const c0 = mix(color('#34501A'), color('#C2E272'), glow);

  // ---- Future: synthwave dusk.
  const horizon = color('#FF3D9A');
  const up = smoothstep(0.0, 0.32, el);
  const sky1 = mix(horizon, color('#14062F'), pow(up, 0.55));
  const below1 = mix(horizon.mul(0.6), color('#07020F'), smoothstep(0.0, 0.06, el.negate()));
  let c1 = mix(below1, sky1, smoothstep(-0.002, 0.002, el)).mul(0.55);
  const hline = pow(float(1).sub(saturate(abs(el).mul(22))), 3.0);
  let e1 = horizon.mul(hline.mul(0.9));
  // Sun on the -X horizon, its lower half already set.
  const sunSize = 0.22;
  const su = dir.z.div(sunSize);
  const sv = el.sub(0.1).div(sunSize);
  const inside = float(1)
    .sub(smoothstep(0.98, 1.0, max(abs(su), abs(sv))))
    .mul(smoothstep(0.0, 0.05, dir.x.negate()))
    .mul(smoothstep(-0.003, 0.003, el));
  const sunUV = vec2(su, sv.negate()).mul(0.5).add(0.5);
  if (tex.synthSun) {
    const sun = texture(tex.synthSun, sunUV);
    c1 = mix(c1, sun.rgb.mul(1.1), sun.a.mul(inside));
    e1 = e1.add(sun.rgb.mul(inside).mul(1.4));
  } else {
    const r = sunUV.sub(0.5).length();
    const disc = smoothstep(0.5, 0.49, r).mul(inside);
    const sunCol = mix(color('#FFE36A'), color('#FF2E9A'), sunUV.y);
    c1 = mix(c1, sunCol, disc);
    e1 = e1.add(sunCol.mul(disc).mul(1.4));
  }
  // Stars
  const starCell = floor(dir.mul(detail >= 2 ? 620 : 420));
  const starHash = hash(dot(starCell, vec3(1.0, 57.0, 113.0)));
  const stars = smoothstep(0.9965, 0.9995, starHash).mul(smoothstep(0.06, 0.45, el)).mul(float(1).sub(inside));
  e1 = e1.add(vec3(1.0, 0.85, 1.0).mul(stars).mul(1.6));
  // The endless neon floor 30 m under the board, scrolling towards the horizon glow.
  const floorY = float(-30).sub(params.gridDrop);
  const tHit = cameraPosition.y.sub(floorY).div(max(el.negate(), 1e-4));
  const hit = cameraPosition.xz.add(dir.xz.mul(tHit));
  const gridUV = hit.div(8.0).add(vec2(time.mul(0.15), 0.0));
  const lineMajor = gridLine(gridUV, 1.0);
  const lineMinor = gridLine(gridUV.mul(4.0), 0.6);
  const below = smoothstep(0.0, -0.004, el);
  const far = smoothstep(60.0, 1400.0, tHit);
  const gridCol = mix(color('#2BF0FF'), color('#FF2EC8'), smoothstep(0.0, 0.55, far));
  const gridAmount = lineMajor.add(lineMinor.mul(0.18)).mul(below).mul(float(1).sub(far));
  c1 = c1.add(gridCol.mul(gridAmount).mul(0.35));
  e1 = e1.add(gridCol.mul(gridAmount).mul(1.3));

  // ---- Present: golden hour.
  const sunD = params.sunDir;
  const mu = dot(dir, sunD);
  const toward = pow(saturate(mu.mul(0.5).add(0.5)), 2.0);
  const horizon2 = mix(color('#E9C4A2'), color('#FFD08A'), toward);
  const zenith2 = color('#4A76B6');
  const upness = pow(smoothstep(-0.02, 0.62, el), 0.5);
  let sky2 = mix(horizon2, zenith2, upness);
  const halo = pow(saturate(mu), 6.0).mul(0.35).add(pow(saturate(mu), 48.0).mul(0.9));
  sky2 = sky2.add(color('#FFB870').mul(halo));
  const disc = smoothstep(0.99955, 0.9998, mu);
  let e2 = color('#FFE6B0').mul(disc).mul(6.0).add(color('#FF9A40').mul(pow(saturate(mu), 180.0)).mul(0.8));
  // Sea of clouds ~300 m below the island.
  const cloudY = float(-300);
  const tc = cameraPosition.y.sub(cloudY).div(max(el.negate(), 1e-4));
  const cp = cameraPosition.xz.add(dir.xz.mul(tc)).add(vec2(time.mul(4.0), time.mul(1.5)));
  const n1 = texture(tex.noise, cp.div(2600.0)).r;
  const n2 = texture(tex.noise, cp.div(700.0).add(0.37)).g;
  const density = smoothstep(0.32, 0.7, n1.mul(0.72).add(n2.mul(0.28)));
  const sunXZ = sunD.xz.normalize();
  const n1s = texture(tex.noise, cp.add(sunXZ.mul(90.0)).div(2600.0)).r;
  const n2s = texture(tex.noise, cp.add(sunXZ.mul(90.0)).div(700.0).add(0.37)).g;
  const densityS = smoothstep(0.32, 0.7, n1s.mul(0.72).add(n2s.mul(0.28)));
  const lit = saturate(density.sub(densityS).mul(2.2).add(0.55));
  const cloudCol = mix(color('#8C90A6'), color('#FFE6C0'), lit).mul(mix(0.88, 1.12, toward));
  const gap = color('#58658A');
  let sea = mix(gap, cloudCol, density);
  const haze = float(1).sub(exp(tc.div(-2600.0)));
  sea = mix(sea, horizon2.mul(1.02), saturate(haze.mul(1.1)));
  const blend2 = smoothstep(0.004, -0.01, el);
  const c2 = mix(sky2, sea, blend2);
  e2 = e2.mul(float(1).sub(blend2));

  material.colorNode = c0.mul(w0).add(c2.mul(w1)).add(c1.mul(w2));
  setEmissive(material, e2.mul(w1).add(e1.mul(w2)));
  return material;
}

/** Anti-aliased grid lines at integer UV coordinates (1 on a line, 0 between). */
function gridLine(uv: N<'vec2'>, width: number) {
  const g = abs(fract(uv.sub(0.5)).sub(0.5)).div(fwidth(uv).mul(width).add(1e-5));
  return float(1).sub(clamp(min(g.x, g.y), 0.0, 1.0));
}

export function createSkyDome(material: THREE.Material, radius = 4000): THREE.Mesh {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.castShadow = false;
  dome.receiveShadow = false;
  return dome;
}
