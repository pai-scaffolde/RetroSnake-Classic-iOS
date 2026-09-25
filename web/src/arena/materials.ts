import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  color,
  cos,
  dot,
  float,
  floor,
  fract,
  hash,
  instancedDynamicBufferAttribute,
  instanceIndex,
  length,
  max,
  min,
  mix,
  normalMap,
  normalView,
  normalWorld,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  reflectVector,
  saturate,
  sin,
  smoothstep,
  sqrt,
  texture,
  time,
  uv,
  vec2,
  vec3,
  vertexColor,
} from 'three/tsl';
import type { Assets } from '../core/Assets';
import { Palette } from './constants';
import { setEmissive, uColor, uFloat, uVec3, type N, type UColor, type UFloat, type UVec3 } from './tsl';

/** Snake skin: one texture tile along the body (UE SCALE_TILE_UU / SKIN_VSCALE), in metres. */
export const SkinTileLength = (2 * Math.PI * 0.58) / 0.25;
/** Around the body only a quarter of the scale texture is used (bigger, readable scales). */
export const SkinVScale = 0.25;

const fresnel = (power: number) => pow(float(1).sub(saturate(dot(normalView, positionViewDirection))), power);

/**
 * Every arena material, built in TSL from the UE masters (Tools/ue/build_arena_materials.py).
 * Emissive is used only for things that should glow, since only emissive feeds the (selective) bloom.
 */
export class ArenaMaterials {
  /** Wave-front seam glow per tile instance (PerInstanceCustomData[0] in UE), shared by the era tile sets. */
  readonly seam: THREE.InstancedBufferAttribute;
  readonly seamAccent: UColor = uColor(new THREE.Color());
  /** Blended era accent colours driven by the environment. */
  readonly ringColor: UColor = uColor(Palette.olive.clone());
  readonly ringGlow: UFloat = uFloat(0);
  readonly emberColor: UColor = uColor(new THREE.Color('#E6FF9A'));
  readonly eyeGlow: UColor = uColor(new THREE.Color('#E8A020'));
  readonly baseColor: UColor = uColor(new THREE.Color('#10160A'));
  readonly sunDir: UVec3 = uVec3(new THREE.Vector3(0, 1, 0));
  readonly sunBoost: UFloat = uFloat(0);
  readonly overhead: UFloat = uFloat(0);

  readonly tileTop: THREE.NodeMaterial[];
  readonly tileSides: THREE.NodeMaterial;
  readonly basePlate: THREE.NodeMaterial;
  readonly voxel: THREE.NodeMaterial;
  readonly voxelHead: THREE.NodeMaterial;
  readonly neonBody: THREE.NodeMaterial;
  readonly neonCyan: THREE.NodeMaterial;
  readonly neonMagenta: THREE.NodeMaterial;
  readonly ruinStone: THREE.NodeMaterial;
  readonly kerbStone: THREE.NodeMaterial;
  readonly snakeChrome: THREE.NodeMaterial;
  readonly snakeScales: THREE.NodeMaterial;
  readonly headChrome: THREE.NodeMaterial;
  readonly headScales: THREE.NodeMaterial;
  readonly eye: THREE.NodeMaterial;
  readonly mouth: THREE.NodeMaterial;
  readonly tongue: THREE.NodeMaterial;
  readonly foodNeon: THREE.NodeMaterial;
  readonly fruit: THREE.NodeMaterial;
  readonly leaf: THREE.NodeMaterial;
  readonly ring: THREE.NodeMaterial;
  readonly bonusRing: THREE.NodeMaterial;
  /** Burst debris per era (the snake's skin, simplified for tiny cubes). */
  readonly debris: THREE.NodeMaterial[];
  readonly critterShell: THREE.NodeMaterial;
  readonly critterBody: THREE.NodeMaterial;
  readonly ember: THREE.NodeMaterial;
  readonly islandRock: THREE.NodeMaterial;
  readonly islandEarth: THREE.NodeMaterial;
  readonly islandGrass: THREE.NodeMaterial;
  readonly grassBlade: THREE.NodeMaterial;
  readonly strutCyan: THREE.NodeMaterial;
  readonly strutMagenta: THREE.NodeMaterial;

  private assets: Assets;
  private noise: THREE.Texture;
  /** 0 = phones (fewer texture samples), 1 = mid, 2+ = full. */
  private detail: number;
  private seamNode: N<'float'>;

  constructor(assets: Assets, noise: THREE.Texture, detail: number, tileCount: number) {
    this.assets = assets;
    this.noise = noise;
    this.detail = detail;
    this.seam = new THREE.InstancedBufferAttribute(new Float32Array(tileCount), 1);
    this.seam.setUsage(THREE.DynamicDrawUsage);
    this.seamNode = instancedDynamicBufferAttribute(this.seam, 'float') as unknown as N<'float'>;

    this.tileTop = [this.lcdTile(), this.paverTile(), this.lacquerTile()];
    this.tileSides = standard('#1B1A1F', 0.65);
    this.basePlate = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
    this.basePlate.colorNode = this.baseColor;

    this.voxel = standard('#1C2612', 0.42);
    this.voxelHead = standard('#1C2612', 0.42);
    (this.voxelHead as THREE.MeshStandardNodeMaterial).emissiveNode = color('#D8F58A').mul(vertexColor(0).r).mul(1.6);

    this.neonBody = this.neonBlockBody();
    this.neonCyan = glow(Palette.cyan, 2.6);
    this.neonMagenta = glow(Palette.magenta, 2.2);
    this.ruinStone = this.rock({ tiling: 0.5, tint: new THREE.Color(1.0, 0.93, 0.82), moss: 0.45, cavity: 0.55, lighten: 0.25, darken: 0 });
    this.kerbStone = this.rock({ tiling: 0.5, tint: new THREE.Color(1.05, 0.9, 0.72), moss: 0.25, cavity: 0.6, lighten: 0.3, darken: 0 });
    this.islandRock = this.rock({ tiling: 1, tint: new THREE.Color(0.95, 0.88, 0.8), moss: 0.4, cavity: 0.5, lighten: 0, darken: 0.35 });
    this.islandEarth = this.rock({ tiling: 1.3, tint: new THREE.Color(0.55, 0.42, 0.3), moss: 0.75, cavity: 0.5, lighten: 0, darken: 0, normal: 0.6 });
    this.islandGrass = this.ground();
    // SM_Island's Grass and Earth primitives are exported with (mostly) inverted winding and normals; drawing
    // them two-sided lets three flip the normal per face, which lights both kinds correctly.
    this.islandGrass.side = THREE.DoubleSide;
    this.islandEarth.side = THREE.DoubleSide;

    this.snakeChrome = this.chrome(false);
    this.headChrome = this.chrome(true);
    this.snakeScales = this.scales(false);
    this.headScales = this.scales(true);
    this.eye = this.eyeMaterial();
    this.mouth = standard('#160707', 0.6);
    this.tongue = physical('#5C0A14', 0.2, 1.0);

    this.foodNeon = this.neonOrb();
    this.fruit = this.fruitMaterial();
    this.leaf = standard('#3D6A1C', 0.45);
    this.ring = ringMaterial(this.ringColor, this.ringGlow);
    this.bonusRing = ringMaterial(color('#FFC060'), float(1.6));
    this.debris = [
      this.voxel,
      new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#7A5A2E'), roughness: 0.45, metalness: 0 }),
      new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#D8DCE8'), roughness: 0.12, metalness: 1 }),
    ];
    this.critterShell = this.scarabShell();
    this.critterBody = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#3A2A10'), roughness: 0.35, metalness: 0.9 });
    this.ember = new THREE.MeshBasicNodeMaterial();
    this.ember.colorNode = this.emberColor;
    setEmissive(this.ember, this.emberColor.mul(3.0));
    this.grassBlade = this.grassBladeMaterial();
    this.strutCyan = glow(Palette.cyan, 3.0, false);
    this.strutMagenta = glow(Palette.magenta, 3.0, false);
  }

  // ------------------------------------------------------------------ helpers

  private tex(name: string): THREE.Texture | null {
    return this.assets.texture(name);
  }

  /** Emissive seam on the wave front: brightest on the tile edges, in the incoming era's accent. */
  private seamGlow(uvNode: N<'vec2'>) {
    const edge = max(abs(uvNode.x.sub(0.5)), abs(uvNode.y.sub(0.5))).mul(2);
    return this.seamAccent.mul(this.seamNode).mul(smoothstep(0.7, 1.0, edge).mul(1.6).add(0.25));
  }

  // ------------------------------------------------------------------ tiles

  private lcdTile(): THREE.NodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0 });
    const t = this.tex('T_LCDTile');
    const raw = t ? texture(t, uv()).rgb : vec3(Palette.lcd.r, Palette.lcd.g, Palette.lcd.b);
    // A touch more saturation: the backlight is a strong yellow-green, not a pale wash.
    const base = mix(vec3(dot(raw, vec3(0.2126, 0.7152, 0.0722))), raw, 1.35).max(0);
    const litBase = mix(base, color('#DAEFA9'), this.overhead.mul(0.4));
    const vary = hash(instanceIndex).sub(0.5).mul(0.07).add(1);
    // An LED hotspot along one edge (the texture's V=1 edge), like the phone's backlight bleeding in.
    // The dot matrix: every tile is 4 x 4 LCD pixels with thin darker gutters, and the backlight is
    // brightest in the pixel centres, so the floor reads as a lit phone screen rather than flat paint.
    const cell = fract(uv().mul(4)).sub(0.5).abs();
    const gutter = smoothstep(0.39, 0.48, max(cell.x, cell.y));
    const pixel = float(1).sub(gutter.mul(mix(0.38, 0.12, this.overhead)));
    const centre = float(1).sub(length(cell).mul(mix(0.35, 0.12, this.overhead)));
    const tileEdge = smoothstep(0.40, 0.50, max(abs(uv().x.sub(0.5)), abs(uv().y.sub(0.5))));
    const bezel = float(1).sub(tileEdge.mul(mix(0.82, 0.25, this.overhead)));
    m.colorNode = litBase.mul(mix(0.68, 0.78, this.overhead)).mul(pixel).mul(bezel);
    m.emissiveNode = litBase.mul(vary).mul(mix(0.22, 0.25, this.overhead)).mul(pixel).mul(centre).mul(bezel).add(this.seamGlow(uv()));
    return m;
  }

  private lacquerTile(): THREE.NodeMaterial {
    const m = this.detail >= 2 ? new THREE.MeshPhysicalNodeMaterial({ clearcoat: 1, clearcoatRoughness: 0.03 }) : new THREE.MeshStandardNodeMaterial();
    m.roughness = 0.24;
    m.metalness = 0;
    const t = this.tex('T_NeonGrid');
    const grid = t ? texture(t, uv()) : null;
    const major = grid ? grid.g : smoothstep(0.46, 0.49, max(abs(uv().x.sub(0.5)), abs(uv().y.sub(0.5))));
    const minor = grid ? grid.b : float(0);
    const wp = positionWorld;
    const diag = saturate(wp.x.add(wp.z).div(96).add(0.5));
    const col = mix(color(Palette.cyan), color(Palette.magenta), diag);
    // A bright ring that keeps expanding from the board centre.
    const ring = pow(fract(length(wp.xz).div(32).sub(time.mul(0.35))), 10);
    const lines = saturate(major.add(minor).mul(2));
    m.colorNode = mix(color('#08060E'), col.mul(0.2), lines);
    m.emissiveNode = col.mul(major.mul(ring.mul(2.6).add(0.95)).add(minor.mul(0.12))).add(this.seamGlow(uv()));
    return m;
  }

  private paverTile(): THREE.NodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    const u = uv();
    const rnd = hash(instanceIndex);
    // One slab per tile, each turned by a random multiple of 90 degrees.
    const angle = floor(rnd.mul(3.999)).mul(Math.PI / 2);
    const c = cos(angle);
    const s = sin(angle);
    const cx = u.x.sub(0.5);
    const cy = u.y.sub(0.5);
    const ruv = vec2(c.mul(cx).sub(s.mul(cy)), s.mul(cx).add(c.mul(cy))).add(0.5);
    const tD = this.tex('T_StonePaver_D');
    const tN = this.tex('T_StonePaver_N');
    const tR = this.tex('T_StonePaver_R');
    const tH = this.tex('T_StonePaver_H');
    const tAO = this.tex('T_StonePaver_AO');
    const mD = this.tex('T_Moss_D');
    const mN = this.tex('T_Moss_N');
    const mH = this.tex('T_Moss_H');
    const d = tD ? texture(tD, ruv).bias(float(0.8)).rgb : vec3(0.42, 0.37, 0.3);
    const h = tH ? texture(tH, ruv).r : float(0.5);
    const muv = u.mul(0.9).add(vec2(rnd, fract(rnd.mul(7.31))).mul(5));
    const md = mD ? texture(mD, muv).rgb : vec3(0.18, 0.26, 0.08);
    const mh = mH ? texture(mH, muv).r : float(0.5);
    const edge = max(abs(cx), abs(cy)).mul(2);
    const edgeM = smoothstep(0.72, 1.0, edge);
    const thresh = float(0.72).sub(fract(rnd.mul(13.7)).mul(0.35));
    const raw = float(1).sub(h).mul(0.55).add(edgeM.mul(0.8)).add(mh.sub(0.5).mul(0.7));
    const moss = saturate(raw.sub(thresh).mul(6));
    const tint = mix(vec3(1.06, 0.98, 0.88), vec3(0.88, 0.82, 0.74), fract(rnd.mul(5.7)));
    m.colorNode = mix(d.mul(tint), md.mul(vec3(0.9, 1.0, 0.8)), moss);
    const rough = tR ? texture(tR, ruv).r : float(0.8);
    m.roughnessNode = mix(rough, float(0.85), moss);
    if (tAO) m.aoNode = texture(tAO, ruv).r;
    if (tN && this.detail >= 1) {
      // Rotate the tangent-space normal back into the mesh's UV frame (n' = R^T n), in the texture's 0..1 encoding.
      const n = texture(tN, ruv).xyz.mul(2).sub(1);
      const nr = vec3(c.mul(n.x).add(s.mul(n.y)), c.mul(n.y).sub(s.mul(n.x)), n.z);
      let packed: N<'vec3'> = nr.mul(0.5).add(0.5);
      if (mN) packed = mix(packed, texture(mN, muv).xyz, moss);
      m.normalNode = normalMap(packed, vec2(0.6, -0.6));
    }
    m.emissiveNode = this.seamGlow(u);
    return m;
  }

  // ------------------------------------------------------------------ walls, kerbs, world

  private neonBlockBody(): THREE.NodeMaterial {
    const m = this.detail >= 2 ? new THREE.MeshPhysicalNodeMaterial({ clearcoat: 1, clearcoatRoughness: 0.02 }) : new THREE.MeshStandardNodeMaterial();
    m.color = new THREE.Color('#0C0718');
    m.roughness = 0.12;
    m.metalness = 0.2;
    m.emissiveNode = color(Palette.cyan).mul(fresnel(3)).mul(0.55);
    return m;
  }

  private rock(o: { tiling: number; tint: THREE.Color; moss: number; cavity: number; lighten: number; darken: number; normal?: number }): THREE.NodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    const u = uv().mul(o.tiling);
    const vc = vertexColor(0);
    const tD = this.tex('T_Rock_D');
    const tN = this.tex('T_Rock_N');
    const tR = this.tex('T_Rock_R');
    const tAO = this.tex('T_Rock_AO');
    const mD = this.tex('T_Moss_D');
    const mH = this.tex('T_Moss_H');
    const muv = uv().mul(o.tiling * 1.5);
    const d = tD ? texture(tD, u).rgb : vec3(0.45, 0.4, 0.34);
    const md = mD ? texture(mD, muv).rgb : vec3(0.2, 0.28, 0.1);
    const mh = mH ? texture(mH, muv).r : float(0.5);
    const up = smoothstep(0.35, 0.85, normalWorld.y);
    const raw = up.mul(vc.b.mul(1.4)).add(mh.sub(0.5).mul(0.8));
    const moss = saturate(raw.sub(1 - o.moss).mul(5));
    const cav = float(1).sub(vc.r.mul(o.cavity));
    const wear = float(1).add(vc.g.mul(o.lighten));
    const depth = float(1).sub(vc.g.mul(o.darken));
    const rock = d.mul(color(o.tint)).mul(cav).mul(wear).mul(depth);
    m.colorNode = mix(rock, md, moss);
    m.roughnessNode = mix(tR ? texture(tR, u).r : float(0.85), float(0.9), moss);
    m.aoNode = (tAO ? texture(tAO, u).r : float(1)).mul(cav);
    if (tN && this.detail >= 1) {
      const k = o.normal ?? 1;
      m.normalNode = normalMap(texture(tN, u).xyz, vec2(k, -k));
    }
    return m;
  }

  private ground(): THREE.NodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    const u0 = uv();
    const u = u0.mul(2.0);
    const tD = this.tex('T_Grass_D');
    const tN = this.tex('T_Grass_N');
    const tR = this.tex('T_Grass_R');
    const d = tD ? texture(tD, u).rgb : vec3(0.2, 0.32, 0.08);
    const macro = texture(this.noise, u0.mul(0.23)).r;
    const macro2 = texture(this.noise, u0.mul(0.071)).g;
    const mm = saturate(macro.sub(0.5).mul(1.6).add(macro2.sub(0.5).mul(1.2)).add(0.5));
    const tint = mix(vec3(0.78, 1.08, 0.5), vec3(1.35, 1.12, 0.55), mm.mul(0.8).add(0.1));
    const cav = float(1).sub(vertexColor(0).r.mul(0.4));
    m.colorNode = d.mul(tint).mul(cav).mul(1.25);
    m.roughnessNode = tR ? texture(tR, u).r : float(0.85);
    if (tN && this.detail >= 1) m.normalNode = normalMap(texture(tN, u).xyz, vec2(1, -1));
    return m;
  }

  private grassBladeMaterial(): THREE.NodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0 });
    const v = uv().y;
    const rnd = hash(instanceIndex);
    const tip = mix(color('#8DB03E'), color('#C9C063'), rnd.mul(0.7));
    m.colorNode = mix(color('#1F3A0C'), tip, pow(v, 0.9));
    // Wind: tips sway, phase per tuft.
    const phase = time.mul(1.7).add(rnd.mul(6.283));
    const sway = sin(phase).add(sin(phase.mul(2.7)).mul(0.35)).mul(v.mul(v)).mul(0.05);
    m.positionNode = positionLocal.add(vec3(sway.mul(0.8), 0, sway.mul(0.6)));
    return m;
  }

  // ------------------------------------------------------------------ snake

  /** Future: liquid chrome, magenta belly underglow and cyan side lines pulsing down the body. */
  private chrome(head: boolean): THREE.NodeMaterial {
    const m = this.detail >= 2 ? new THREE.MeshPhysicalNodeMaterial({ clearcoat: 0.6, clearcoatRoughness: 0.03 }) : new THREE.MeshStandardNodeMaterial();
    m.metalness = 1;
    m.colorNode = vec3(0.92, 0.94, 1.0);
    const tN = this.tex('T_SnakeScales_N');
    const tR = this.tex('T_SnakeScales_R');
    const u = uv();
    const suv = head ? vec2(u.x.mul(1.45 / SkinTileLength), u.y.sub(0.5).mul(SkinVScale).add(0.5)) : vec2(u.x, u.y.sub(0.5).mul(SkinVScale).add(0.5));
    m.roughnessNode = float(0.07).add(tR ? texture(tR, suv).r.mul(0.1) : float(0.04));
    if (tN) m.normalNode = normalMap(texture(tN, suv).xyz, vec2(0.3, -0.3));
    // A stylised synthwave world seen in the chrome (sky above, hot horizon band, neon floor below),
    // so it reads as liquid chrome whatever the reflection probe caught.
    const r = reflectVector.y;
    const horizon = color('#FF3D9A');
    const skyEnv = mix(horizon, color('#3A2A9A'), smoothstep(0.0, 0.35, r));
    const floorEnv = mix(horizon.mul(0.5), color('#0E5A70'), smoothstep(0.0, 0.5, r.negate()));
    const band = pow(float(1).sub(saturate(abs(r).mul(12))), 4.0);
    const env = mix(floorEnv, skyEnv, smoothstep(-0.03, 0.03, r)).add(vec3(1.0, 0.7, 1.0).mul(band));
    const envGlow = env.mul(fresnel(3).mul(0.5).add(0.3)).mul(0.55);
    if (head) {
      const belly = vertexColor(0).g;
      m.emissiveNode = color(Palette.magenta).mul(belly).mul(1.2).add(envGlow);
    } else {
      const v = u.y;
      const vv = min(v, float(1).sub(v));
      const belly = float(1).sub(smoothstep(0.0, 0.12, vv));
      const side = float(1).sub(smoothstep(0.012, 0.028, abs(vv.sub(0.25))));
      const sHead = uv(1).x;
      const pulse = pow(fract(sHead.div(-7).add(time.mul(0.8))), 5);
      const taper = uv(1).y;
      m.emissiveNode = color(Palette.magenta)
        .mul(belly.mul(pulse.mul(0.8).add(0.6)))
        .mul(1.5)
        .add(color(Palette.cyan).mul(side.mul(pulse.mul(2).add(0.3))).mul(2.0))
        .mul(taper.mul(0.5).add(0.5))
        .add(envGlow);
    }
    return m;
  }

  /** Present hero skin: glued python scales, clear coat, thin-film sheen and a warm back-lit rim. */
  private scales(head: boolean): THREE.NodeMaterial {
    const physicalOK = this.detail >= 1;
    const m = physicalOK ? new THREE.MeshPhysicalNodeMaterial({ clearcoat: 0.7, clearcoatRoughness: 0.14 }) : new THREE.MeshStandardNodeMaterial();
    m.metalness = 0;
    const u = uv();
    const suv = head ? vec2(u.x.mul(1.45 / SkinTileLength), u.y.sub(0.5).mul(SkinVScale).add(0.5)) : vec2(u.x, u.y.sub(0.5).mul(SkinVScale).add(0.5));
    const tD = this.tex('T_SnakeScales_D');
    const tN = this.tex('T_SnakeScales_N');
    const tR = this.tex('T_SnakeScales_R');
    const tAO = this.tex('T_SnakeScales_AO');
    const tI = this.tex('T_SnakeScales_Iridescence');
    let base: N<'vec3'> = tD ? texture(tD, suv).rgb : vec3(0.35, 0.26, 0.12);
    let ao: N<'float'> = tAO ? texture(tAO, suv).r : float(1);
    if (head) {
      const vc = vertexColor(0);
      if (tD) base = mix(base, texture(tD, uv(1).mul(1.3)).rgb, vc.r);
      base = mix(base, color('#D6C9A2'), vc.g.mul(0.6));
      ao = ao.mul(float(1).sub(vc.b.mul(0.6)));
    }
    m.colorNode = base;
    m.aoNode = ao;
    m.roughnessNode = tR ? texture(tR, suv).r.mul(1.1) : float(0.45);
    if (tN) m.normalNode = normalMap(texture(tN, suv).xyz, vec2(0.9, -0.9));
    if (physicalOK && tI) {
      const pm = m as THREE.MeshPhysicalNodeMaterial;
      pm.iridescenceNode = texture(tI, suv).r.mul(0.55);
      pm.iridescenceIOR = 1.35;
      pm.iridescenceThicknessRange = [220, 520];
    }
    // Fake subsurface: warm glow on the rim when the low sun is behind the body.
    const viewDir = positionWorld.sub(cameraPosition).normalize();
    const back = pow(saturate(dot(viewDir, this.sunDir)), 3);
    const rim = fresnel(2);
    m.emissiveNode = base.mul(color('#FF7A30')).mul(back.mul(rim).add(rim.mul(0.12))).mul(this.sunBoost).mul(0.5);
    return m;
  }

  private eyeMaterial(): THREE.NodeMaterial {
    const m = this.detail >= 1 ? new THREE.MeshPhysicalNodeMaterial({ clearcoat: 1, clearcoatRoughness: 0.01 }) : new THREE.MeshStandardNodeMaterial();
    m.roughness = 0.15;
    m.metalness = 0;
    const x = uv().x.sub(0.5);
    const y = uv().y.sub(0.5);
    const rr = length(vec2(x, y));
    const slitH = 0.34;
    const wy = sqrt(saturate(float(1).sub(y.div(slitH).mul(y.div(slitH))))).mul(0.07);
    const slit = float(1).sub(smoothstep(wy.mul(0.7), wy.add(0.005), abs(x)));
    const iris = mix(this.eyeGlow, this.eyeGlow.mul(0.12), smoothstep(0.05, 0.45, rr));
    m.colorNode = mix(iris, vec3(0.005, 0.004, 0.003), slit);
    m.emissiveNode = iris.mul(float(1).sub(slit)).mul(0.45);
    return m;
  }

  // ------------------------------------------------------------------ food, critter, fx

  private neonOrb(): THREE.NodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.05, metalness: 0 });
    m.colorNode = color('#2A0620');
    const f = fresnel(1);
    const bands = sin(positionLocal.y.mul(9).add(time.mul(3))).mul(0.25).add(0.75);
    const breathe = sin(time.mul(4)).mul(0.2).add(0.8);
    const core = color(Palette.magenta).mul(1.3).mul(float(1).sub(f.mul(0.7))).mul(bands.mul(breathe));
    const rim = vec3(1.0, 0.75, 1.0).mul(2.6).mul(pow(f, 2.5));
    m.emissiveNode = core.add(rim);
    return m;
  }

  private fruitMaterial(): THREE.NodeMaterial {
    const m = this.detail >= 1 ? new THREE.MeshPhysicalNodeMaterial({ clearcoat: 1, clearcoatRoughness: 0.05 }) : new THREE.MeshStandardNodeMaterial();
    m.metalness = 0;
    const tD = this.tex('T_FruitSkin_D');
    const tN = this.tex('T_FruitSkin_N');
    const tR = this.tex('T_FruitSkin_R');
    const base = tD ? texture(tD, uv()).rgb : vec3(0.9, 0.6, 0.1);
    m.colorNode = base;
    m.roughnessNode = tR ? texture(tR, uv()).r : float(0.35);
    if (tN) m.normalNode = normalMap(texture(tN, uv()).xyz, vec2(1, -1));
    const f = fresnel(1);
    const glowTerm = base.mul(color('#FFB040')).mul(0.55).mul(float(1.35).sub(f));
    const rim = color('#FFD27A').mul(0.9).mul(pow(f, 3));
    m.emissiveNode = glowTerm.add(rim);
    return m;
  }

  private scarabShell(): THREE.NodeMaterial {
    const m = this.detail >= 1 ? new THREE.MeshPhysicalNodeMaterial({ clearcoat: 0.5, clearcoatRoughness: 0.05 }) : new THREE.MeshStandardNodeMaterial();
    m.metalness = 1;
    const tD = this.tex('T_Scarab_D');
    const tN = this.tex('T_Scarab_N');
    const tR = this.tex('T_Scarab_R');
    m.colorNode = tD ? texture(tD, uv()).rgb : vec3(0.8, 0.6, 0.15);
    m.roughnessNode = tR ? texture(tR, uv()).r : float(0.3);
    if (tN) m.normalNode = normalMap(texture(tN, uv()).xyz, vec2(1, -1));
    return m;
  }
}

function standard(hex: string, roughness: number, metalness = 0): THREE.MeshStandardNodeMaterial {
  return new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(hex), roughness, metalness });
}

function physical(hex: string, roughness: number, clearcoat: number): THREE.MeshPhysicalNodeMaterial {
  return new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color(hex), roughness, metalness: 0, clearcoat, clearcoatRoughness: 0.05 });
}

/** A flat glowing ring on the floor (CircleGeometry UVs): bright rim, faint fill. */
function ringMaterial(tint: N<'vec3'> | N<'color'>, glowAmount: N<'float'>): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  const r = length(uv().sub(0.5)).mul(2);
  const ring = smoothstep(0.74, 0.95, r).mul(float(1).sub(smoothstep(0.95, 1.0, r)));
  const amount = ring.add(float(1).sub(r).mul(0.18));
  m.colorNode = tint;
  m.opacityNode = amount.mul(0.85);
  setEmissive(m, tint.mul(amount).mul(glowAmount));
  return m;
}

/** Unlit neon: black body, colour only in emissive (so it all feeds the bloom). */
function glow(c: THREE.Color, strength: number, fogged = true): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ fog: fogged });
  m.colorNode = color(c).mul(0.35);
  setEmissive(m, color(c).mul(strength));
  return m;
}
