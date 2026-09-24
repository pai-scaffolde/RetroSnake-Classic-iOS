import * as THREE from 'three/webgpu';
import { ESnakeDir, SnakeGame } from '../game';
import type { IntPoint } from '../game';
import { CellSize, cellX, cellZ } from './constants';
import { SkinTileLength, type ArenaMaterials } from './materials';
import { InstancedModel, type Part } from './Models';

/** Tube radius (m) (ASnakeArena BodyRadius 58 UU) and head scale relative to the authored head. */
const BodyRadius = 0.58;
const HeadScale = 1.45;
/** Corner fillet radius in cells: 0.5 lets a U-turn become one smooth half circle. */
const Fillet = 0.5;
const RadiusKeys = 4096;
/** The authored head's neck ring is a radius-0.5 tube, scaled with the head. */
const NeckRadius = 0.5 * HeadScale * 0.97;

function smooth01(x: number): number {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
}

export interface SnakeModels {
  voxel: Part[] | null;
  voxelHead: Part[] | null;
  head: Part[] | null;
  tongue: Part[] | null;
  /** Tongue root in head space (manifest anchors.tongueSocket). */
  tongueSocket: THREE.Vector3;
}

/** Where the body is this frame, in board cells (see Snake.update). */
export interface SnakePose {
  body: readonly Readonly<IntPoint>[];
  /** The tail cell the last step vacated (the tail slides out of it), or null if the snake grew. */
  vacated: Readonly<IntPoint> | null;
  /** Progress of the current step 0..1. */
  alpha: number;
  /** Steps taken since the run began (keys the corner radii). */
  steps: number;
  /** Direction the next step will take, when known (for rounding the corner before the head reaches it). */
  nextDir: ESnakeDir | null;
  dir: ESnakeDir;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * The snake. The body follows a fixed centreline through the cell centres with rounded corners, and slides
 * along it (so corners never wobble); the head is interpolated inside the current step. Era 0 draws it as LCD
 * voxels, later eras as a continuous tube rebuilt every frame into reused buffers, plus the authored head.
 */
export class Snake {
  readonly group = new THREE.Group();
  readonly headPos = new THREE.Vector3();
  readonly headForward = new THREE.Vector3(1, 0, 0);
  era = 0;

  private materials: ArenaMaterials;
  private voxels: InstancedModel;
  private voxelHead: THREE.Group;
  private head: THREE.Group;
  private headSkin: THREE.Mesh[] = [];
  private tongue: THREE.Group;
  private tube: THREE.Mesh;
  private tubeGeometry!: THREE.BufferGeometry;
  private radial: number;
  private ringSpacing: number;
  private capacity = 0;

  // Path through cell centres (head side first), in cells.
  private px = new Float32Array(1024);
  private pz = new Float32Array(1024);
  private pr = new Float32Array(1024);
  private pathCount = 0;
  /** Path parameter of Body[0]. */
  private pathOffset = 0;
  private radiusKey = new Int32Array(RadiusKeys).fill(-1);
  private radiusValue = new Float32Array(RadiusKeys);
  private tongueTimer = 0;
  private time = 0;
  private yaw = 0;

  constructor(materials: ArenaMaterials, models: SnakeModels, detail: number) {
    this.materials = materials;
    this.radial = detail >= 2 ? 18 : detail >= 1 ? 14 : 10;
    this.ringSpacing = detail >= 2 ? 0.1 : 0.14;

    const voxelParts = models.voxel ?? [{ slot: 'Voxel', geometry: new THREE.BoxGeometry(1, 1, 1) }];
    this.voxels = new InstancedModel(voxelParts, () => materials.voxel, 64);
    this.group.add(this.voxels.group);

    this.voxelHead = new THREE.Group();
    for (const part of models.voxelHead ?? voxelParts) {
      const mesh = new THREE.Mesh(part.geometry, materials.voxelHead);
      mesh.castShadow = mesh.receiveShadow = true;
      this.voxelHead.add(mesh);
    }
    this.voxelHead.scale.setScalar(1.4);
    this.group.add(this.voxelHead);

    this.head = new THREE.Group();
    const headParts = models.head ?? [{ slot: 'Skin', geometry: fallbackHead() }];
    for (const part of headParts) {
      const material = part.slot === 'Eyes' ? materials.eye : part.slot === 'Mouth' ? materials.mouth : materials.headScales;
      const mesh = new THREE.Mesh(part.geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (part.slot !== 'Eyes' && part.slot !== 'Mouth') this.headSkin.push(mesh);
      this.head.add(mesh);
    }
    this.head.scale.setScalar(HeadScale);
    this.tongue = new THREE.Group();
    for (const part of models.tongue ?? []) {
      const mesh = new THREE.Mesh(part.geometry, materials.tongue);
      this.tongue.add(mesh);
    }
    this.tongue.position.copy(models.tongueSocket);
    this.head.add(this.tongue);
    this.group.add(this.head);

    this.tube = new THREE.Mesh(new THREE.BufferGeometry(), materials.snakeScales);
    this.tube.castShadow = true;
    this.tube.receiveShadow = true;
    this.tube.frustumCulled = false;
    this.allocate(256);
    this.group.add(this.tube);
    this.setEra(0);
  }

  /** Skin for an era (the snake changes first, as the era wave starts from its head). */
  setEra(era: number): void {
    this.era = era;
    const voxel = era === 0;
    this.voxels.visible = voxel;
    this.voxelHead.visible = voxel;
    this.head.visible = !voxel;
    this.tube.visible = !voxel;
    this.tube.material = era === 2 ? this.materials.snakeChrome : this.materials.snakeScales;
    for (const mesh of this.headSkin) mesh.material = era === 2 ? this.materials.headChrome : this.materials.headScales;
  }

  /** Warm-up: show every part (the tongue is normally only out while flicking). */
  showAllParts(on: boolean): void {
    this.tongue.visible = on;
  }

  /** Forget corner radii (a new run). */
  reset(): void {
    this.radiusKey.fill(-1);
  }

  private allocate(rings: number): void {
    const verts = rings * (this.radial + 1);
    const geometry = new THREE.BufferGeometry();
    const attr = (itemSize: number) => {
      const a = new THREE.BufferAttribute(new Float32Array(verts * itemSize), itemSize);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    geometry.setAttribute('position', attr(3));
    geometry.setAttribute('normal', attr(3));
    geometry.setAttribute('uv', attr(2));
    geometry.setAttribute('uv1', attr(2));
    const index = new Uint32Array((rings - 1) * this.radial * 6);
    let k = 0;
    const stride = this.radial + 1;
    for (let r = 0; r < rings - 1; ++r) {
      for (let j = 0; j < this.radial; ++j) {
        const a = r * stride + j;
        const b = a + stride;
        index[k++] = a;
        index[k++] = a + 1;
        index[k++] = b;
        index[k++] = b;
        index[k++] = a + 1;
        index[k++] = b + 1;
      }
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    this.tubeGeometry?.dispose();
    this.tubeGeometry = geometry;
    this.tube.geometry = geometry;
    this.capacity = rings;
  }

  // ------------------------------------------------------------------ path

  private key(steps: number): number {
    return ((steps % RadiusKeys) + RadiusKeys) % RadiusKeys;
  }

  /** Build this frame's centreline and return [s0, s1]: the head and tail positions on it (in cells). */
  private buildPath(pose: SnakePose): [number, number] {
    const body = pose.body;
    const n = body.length;
    const need = n + 3;
    if (need > this.px.length) {
      const size = need * 2;
      this.px = new Float32Array(size);
      this.pz = new Float32Array(size);
      this.pr = new Float32Array(size);
    }
    let count = 0;
    const alpha = pose.alpha;
    const s0 = 1 - alpha;
    if (pose.nextDir !== null) {
      const d = SnakeGame.dirDelta(pose.nextDir);
      this.px[count] = body[0].x + d.x;
      this.pz[count] = body[0].y + d.y;
      ++count;
    }
    this.pathOffset = count;
    for (let i = 0; i < n; ++i) {
      this.px[count] = body[i].x;
      this.pz[count] = body[i].y;
      ++count;
    }
    if (pose.vacated) {
      this.px[count] = pose.vacated.x;
      this.pz[count] = pose.vacated.y;
      ++count;
    }
    this.pathCount = count;
    // Corner radii: decided once per corner, never larger than the head's distance to it at that moment
    // (so a late turn gets a tighter corner instead of the head jumping).
    for (let v = 0; v < count; ++v) {
      this.pr[v] = 0;
      if (v === 0 || v === count - 1) continue;
      const inX = this.px[v] - this.px[v - 1];
      const inZ = this.pz[v] - this.pz[v - 1];
      const outX = this.px[v + 1] - this.px[v];
      const outZ = this.pz[v + 1] - this.pz[v];
      if (inX === outX && inZ === outZ) continue;
      if (Math.abs(inX) + Math.abs(inZ) !== 1 || Math.abs(outX) + Math.abs(outZ) !== 1) continue;
      const k = v - this.pathOffset; // body index (-1 = the predicted next cell)
      const key = this.key(pose.steps - k);
      if (this.radiusKey[key] !== pose.steps - k) {
        this.radiusKey[key] = pose.steps - k;
        this.radiusValue[key] = Math.min(Fillet, Math.max(0, Math.abs(k - s0)));
      }
      this.pr[v] = this.radiusValue[key];
    }
    const tailMoves = pose.vacated !== null;
    const s1 = n - 1 + (tailMoves ? s0 : 0);
    return [s0, Math.max(s0, s1)];
  }

  /** Point on the centreline at body parameter s (cells from Body[0]); writes world x/z into out.x/out.z. */
  private pointAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    const count = this.pathCount;
    if (count < 2) {
      out.set(cellX(this.px[0]), 0, cellZ(this.pz[0]));
      return out;
    }
    const sigma = Math.min(Math.max(s + this.pathOffset, 0), count - 1);
    const k = Math.min(Math.floor(sigma), count - 2);
    const t = sigma - k;
    // Inside the fillet of vertex k (just after it) or of vertex k+1 (just before it)?
    let v = -1;
    let d = 0;
    if (this.pr[k] > 0 && t < this.pr[k]) {
      v = k;
      d = t;
    } else if (this.pr[k + 1] > 0 && t > 1 - this.pr[k + 1]) {
      v = k + 1;
      d = t - 1;
    }
    if (v > 0) {
      const r = this.pr[v];
      const inX = this.px[v] - this.px[v - 1];
      const inZ = this.pz[v] - this.pz[v - 1];
      const outX = this.px[v + 1] - this.px[v];
      const outZ = this.pz[v + 1] - this.pz[v];
      // Quarter circle from E = V - in*r to X = V + out*r around O = E + out*r.
      const phi = ((d + r) / (2 * r)) * Math.PI * 0.5;
      const ox = this.px[v] - inX * r + outX * r;
      const oz = this.pz[v] - inZ * r + outZ * r;
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      out.set(cellX(ox - outX * r * c + inX * r * sn), 0, cellZ(oz - outZ * r * c + inZ * r * sn));
      return out;
    }
    out.set(cellX(this.px[k] + (this.px[k + 1] - this.px[k]) * t), 0, cellZ(this.pz[k] + (this.pz[k + 1] - this.pz[k]) * t));
    return out;
  }

  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();

  /** Unit direction of travel (towards the head) at s. */
  private forwardAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    const e = 0.02;
    this.pointAt(s - e, this._a);
    this.pointAt(s + e, this._b);
    out.subVectors(this._a, this._b);
    out.y = 0;
    if (out.lengthSq() < 1e-8) return out.copy(this.headForward);
    return out.normalize();
  }

  // ------------------------------------------------------------------ per frame

  update(pose: SnakePose, dt: number): void {
    this.time += dt;
    if (pose.body.length === 0) return;
    const [s0, s1] = this.buildPath(pose);

    // Head position/heading (heading turns at most 540 deg/s, like VInterpNormalRotationTo).
    this.pointAt(s0, this.headPos);
    this.forwardAt(s0, _v);
    const desired = Math.atan2(-_v.z, _v.x);
    let delta = desired - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const maxStep = THREE.MathUtils.degToRad(540) * Math.max(dt, 1 / 240);
    this.yaw += Math.abs(delta) < maxStep || dt <= 0 ? delta : Math.sign(delta) * maxStep;
    this.headForward.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.era === 0) this.updateVoxels(pose, s0, s1);
    else this.updateTube(s0, s1, dt);
  }

  /** Snap the heading (a fresh run or a camera cut). */
  snapHeading(): void {
    this.forwardAt(0, _v);
    this.yaw = Math.atan2(-_v.z, _v.x);
    this.headForward.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  private updateVoxels(pose: SnakePose, s0: number, s1: number): void {
    const n = pose.body.length;
    if (n > this.voxels.capacity) {
      this.group.remove(this.voxels.group);
      this.voxels.dispose();
      this.voxels = new InstancedModel(
        this.voxels.meshes.map((m) => ({ slot: 'Voxel', geometry: m.geometry })),
        () => this.materials.voxel,
        n * 2,
      );
      this.group.add(this.voxels.group);
    }
    // LCD pixels: one cube per cell with a clear gap; smaller towards the tail.
    let count = 0;
    for (let i = 1; i < n; ++i) {
      const tailT = Math.min(1, Math.max(0, (i - n * 0.7) / Math.max(1, n * 0.3)));
      const size = 0.82 + (0.6 - 0.82) * tailT;
      const s = Math.min(s0 + i, s1);
      this.pointAt(s, _v);
      _v.y = size * 0.5;
      this.forwardAt(s, this._a);
      _q.setFromAxisAngle(_up, Math.atan2(-this._a.z, this._a.x));
      _m.compose(_v, _q, _s.setScalar(size));
      this.voxels.setMatrixAt(count++, _m);
    }
    this.voxels.count = count;
    this.voxels.commit();
    this.voxelHead.position.set(this.headPos.x, 0.7, this.headPos.z);
    this.voxelHead.rotation.set(0, this.yaw, 0);
  }

  private updateTube(s0: number, s1: number, dt: number): void {
    const lengthCells = Math.max(0.05, s1 - s0);
    const totalM = lengthCells * CellSize;
    const spacing = this.ringSpacing; // cells
    const rings = Math.max(2, Math.ceil(lengthCells / spacing) + 1) + 1; // +1 for the tail cap
    if (rings > this.capacity) this.allocate(Math.ceil(rings * 1.5));
    const g = this.tubeGeometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const uv0 = g.getAttribute('uv') as THREE.BufferAttribute;
    const uv1 = g.getAttribute('uv1') as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const Nn = nrm.array as Float32Array;
    const U0 = uv0.array as Float32Array;
    const U1 = uv1.array as Float32Array;
    const stride = this.radial + 1;
    const wave = this.era > 0;
    const fwd = this._b;
    let w = 0;
    for (let r = 0; r < rings; ++r) {
      const cap = r === rings - 1;
      const sCells = cap ? s1 : Math.min(s0 + r * spacing, s1);
      const sM = (sCells - s0) * CellSize; // metres from the head
      this.pointAt(sCells, _v);
      this.forwardAt(sCells, fwd);
      // Side = forward x up (to the snake's right).
      const sx = -fwd.z;
      const sz = fwd.x;
      // Taper: full to 55 % of the length, then down to 20 %; the cap closes the tail.
      const tailStart = totalM * 0.55;
      let taper = sM < tailStart ? 1 : 1 + (0.2 - 1) * Math.min(1, (sM - tailStart) / Math.max(0.01, totalM - tailStart));
      if (cap) taper = 0.0;
      // Swell into the (larger) head's neck so there is no step at the joint.
      const neck = 1 + (NeckRadius / BodyRadius - 1) * (1 - smooth01(sM / 1.6));
      const radius = BodyRadius * taper * neck;
      // A gentle living undulation.
      const lateral = wave ? 0.09 * Math.min(1, sM / 3) * Math.sin(sM * 1.8 - this.time * 5) : 0;
      const cx = _v.x + sx * lateral;
      const cz = _v.z + sz * lateral;
      const cy = BodyRadius * Math.max(taper, 0.2) * 0.88 + 0.12 * (1 - smooth01(sM / 1.6));
      for (let j = 0; j <= this.radial; ++j) {
        const v = j / this.radial;
        const theta = v * Math.PI * 2; // 0 = belly, pi = back
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);
        const belly = cosT > 0; // lower half
        const x = sinT * radius;
        const y = -cosT * radius * (belly ? 0.82 : 1);
        let nx = sinT;
        let ny = -cosT * (belly ? 1.25 : 1);
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
        P[w * 3] = cx + sx * x;
        P[w * 3 + 1] = cy + y;
        P[w * 3 + 2] = cz + sz * x;
        Nn[w * 3] = sx * nx;
        Nn[w * 3 + 1] = ny;
        Nn[w * 3 + 2] = sz * nx;
        U0[w * 2] = sM / SkinTileLength;
        U0[w * 2 + 1] = v;
        U1[w * 2] = sM;
        U1[w * 2 + 1] = taper;
        ++w;
      }
    }
    const verts = rings * stride;
    markRange(pos, verts * 3);
    markRange(nrm, verts * 3);
    markRange(uv0, verts * 2);
    markRange(uv1, verts * 2);
    g.setDrawRange(0, (rings - 1) * this.radial * 6);

    // Head: a touch larger than the body and nose-up so it reads from the chase camera.
    this.head.position.set(this.headPos.x, BodyRadius * 0.88 + 0.12, this.headPos.z);
    this.head.rotation.set(0, this.yaw, THREE.MathUtils.degToRad(4), 'YXZ');
    this.tongueTimer += dt;
    const flick = this.tongueTimer % 2.3;
    const out = flick < 0.32 ? Math.sin((Math.PI * flick) / 0.32) : 0;
    this.tongue.visible = out > 0.01;
    this.tongue.scale.set(Math.max(out, 0.01) * 1.5, 1.5, 1.5);
  }

  dispose(): void {
    this.voxels.dispose();
    this.tubeGeometry.dispose();
  }
}

/** Upload only the used part of a dynamic attribute. */
function markRange(a: THREE.BufferAttribute, count: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(0, count);
  a.needsUpdate = true;
}

function fallbackHead(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 24, 16);
  g.scale(1.9 / HeadScale, 1.1 / HeadScale, 1.5 / HeadScale);
  g.translate(0.6, 0, 0);
  return g;
}
