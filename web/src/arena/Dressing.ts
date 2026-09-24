import * as THREE from 'three/webgpu';
import { RandomStream } from '../game';
import type { ArenaMaterials } from './materials';
import { InstancedModel, type Part } from './Models';

/** Hidden dressing waits this far below its home (ASnakeArena HiddenDepth, 250 m). */
const HiddenDepth = 250;

export interface DressingModels {
  island: Part[] | null;
  rocks: (Part[] | null)[];
  ruins: (Part[] | null)[];
  grassTuft: Part[] | null;
}

/** One era's set piece, rising into place when its era arrives and sinking away when it leaves. */
class DressingSet {
  readonly group = new THREE.Group();
  readonly fromEra: number;
  readonly onlyThatEra: boolean;

  constructor(fromEra: number, onlyThatEra: boolean) {
    this.fromEra = fromEra;
    this.onlyThatEra = onlyThatEra;
    this.group.position.y = -HiddenDepth;
    this.group.visible = false;
  }

  wanted(era: number): boolean {
    return this.onlyThatEra ? era === this.fromEra : era >= this.fromEra;
  }

  snap(era: number): void {
    const v = this.wanted(era);
    this.group.position.y = v ? 0 : -HiddenDepth;
    this.group.visible = v;
  }

  update(era: number, envEra: number, dt: number): void {
    const v = this.wanted(era);
    if (v) this.group.visible = true;
    const target = v ? 0 : -HiddenDepth;
    const y = this.group.position.y;
    if (Math.abs(y - target) > 0.01) this.group.position.y = y + (target - y) * Math.min(1, dt * (v ? 1.6 : 0.9));
    // Era-only props vanish as soon as their era's light has gone, instead of lingering on the horizon.
    const eraGone = this.onlyThatEra && Math.abs(envEra - this.fromEra) > 0.99;
    if (!v && this.group.visible && (eraGone || this.group.position.y < -50)) this.group.visible = false;
  }
}

/** Floating rocks around the island: (variant, UE x, UE y, UE z) / 100, scale, UE yaw (build_arena_level.py ROCKS). */
const Rocks: [number, number, number, number, number, number][] = [
  [2, -260, -300, -25, 1.6, 20],
  [1, 140, -220, 15, 1.4, 110],
  [0, -90, -125, -9, 1.3, 200],
  [2, 340, 120, -60, 2.2, 300],
  [1, -300, 90, 25, 1.8, 45],
  [0, 90, 150, -30, 1.5, 160],
  [1, -60, 320, -15, 2.0, 250],
];

/**
 * Era dressing (the level's tagged actors): Present's floating island with grass, rim ruins and floating
 * rocks; Future's neon wireframe pyramids and rings on the horizon (its neon floor lives in the sky shader).
 */
export class Dressing {
  readonly group = new THREE.Group();
  private sets: DressingSet[] = [];
  private instanced: InstancedModel[] = [];
  private present: DressingSet;
  private future: DressingSet;
  private materials: ArenaMaterials;
  private detail: number;

  constructor(materials: ArenaMaterials, detail: number) {
    this.materials = materials;
    this.detail = detail;
    this.present = new DressingSet(1, true);
    this.future = new DressingSet(2, true);
    this.sets.push(this.present, this.future);
    this.group.add(this.present.group, this.future.group);
    this.buildNeon();
  }

  /** Add the Present island set once its (large) models have loaded. */
  addIsland(models: DressingModels): void {
    const m = this.materials;
    const g = this.present.group;
    if (models.island) {
      for (const part of models.island) {
        const material = part.slot === 'Grass' ? m.islandGrass : part.slot === 'Earth' ? m.islandEarth : m.islandRock;
        const mesh = new THREE.Mesh(part.geometry, material);
        mesh.receiveShadow = true;
        mesh.castShadow = part.slot === 'Rock';
        g.add(mesh);
      }
    }
    const rockCount = this.detail >= 2 ? Rocks.length : this.detail >= 1 ? 5 : 3;
    for (const [variant, x, y, z, scale, yaw] of Rocks.slice(0, rockCount)) {
      const parts = models.rocks[variant];
      if (!parts) continue;
      const rock = new THREE.Group();
      for (const part of parts) {
        const mesh = new THREE.Mesh(part.geometry, part.slot === 'Grass' ? m.islandGrass : m.islandRock);
        rock.add(mesh);
      }
      rock.position.set(x, z, y);
      rock.rotation.y = -THREE.MathUtils.degToRad(yaw);
      rock.scale.setScalar(scale);
      g.add(rock);
    }
    const rng = new RandomStream(2001);
    const rand = (a: number, b: number) => a + (b - a) * rng.getFraction();
    const rim = this.rimPoints(models.island);
    this.placeGrass(models.grassTuft, rim, rng, rand);
    this.placeRuins(models.ruins, rim, rng, rand);
  }

  /** Up-facing island vertices on the rim around the board (grass section preferred). */
  private rimPoints(island: Part[] | null): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const grass = island?.find((p) => p.slot === 'Grass') ?? island?.[0];
    if (grass) {
      const pos = grass.geometry.getAttribute('position');
      const nrm = grass.geometry.getAttribute('normal');
      for (let i = 0; i < pos.count; ++i) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const r = Math.max(Math.abs(x), Math.abs(z));
        // |ny|: parts of SM_Island's Grass/Earth are exported inside out (see ArenaMaterials.islandGrass).
        if (r > 25.6 && r < 36.5 && y > -0.3 && (!nrm || Math.abs(nrm.getY(i)) > 0.8)) points.push(new THREE.Vector3(x, y, z));
      }
    }
    if (points.length === 0) {
      for (let i = 0; i < 2000; ++i) {
        const a = (i / 2000) * Math.PI * 2 * 7.3;
        const r = 26 + ((i * 37) % 80) / 10;
        points.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
    }
    return points;
  }

  private placeGrass(tuft: Part[] | null, rim: THREE.Vector3[], rng: RandomStream, rand: (a: number, b: number) => number): void {
    if (!tuft || rim.length === 0) return;
    const count = this.detail >= 2 ? 260 : this.detail >= 1 ? 160 : 90;
    const near = rim.filter((p) => Math.max(Math.abs(p.x), Math.abs(p.z)) < 29);
    const pick = (list: THREE.Vector3[]) => list[Math.floor(rng.getFraction() * list.length)];
    const centres = Array.from({ length: 46 }, () => pick(near.length && rng.getFraction() < 0.8 ? near : rim));
    const set = new InstancedModel(tuft, () => this.materials.grassBlade, count, false, true);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const clumps = centres.map((c) => rim.filter((p) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < 2.6 * 2.6));
    for (let i = 0; i < count; ++i) {
      const c = centres[i % centres.length];
      const around = clumps[i % centres.length];
      const p = around.length ? pick(around) : c;
      const k = rand(2.0, 3.6);
      e.set(THREE.MathUtils.degToRad(rand(-6, 6)), rand(0, Math.PI * 2), THREE.MathUtils.degToRad(rand(-6, 6)));
      m.compose(new THREE.Vector3(p.x, p.y - 0.03, p.z), q.setFromEuler(e), s.set(k, k * rand(0.9, 1.3), k));
      set.setMatrixAt(i, m);
    }
    set.count = count;
    set.commit();
    this.instanced.push(set);
    this.present.group.add(set.group);
  }

  private placeRuins(ruins: (Part[] | null)[], rim: THREE.Vector3[], rng: RandomStream, rand: (a: number, b: number) => number): void {
    const outer = rim.filter((p) => {
      const r = Math.max(Math.abs(p.x), Math.abs(p.z));
      return r > 28 && r < 34.5;
    });
    if (!outer.length) return;
    const chosen: THREE.Vector3[] = [];
    const want = this.detail >= 1 ? 12 : 8;
    for (let i = 0; i < 400 && chosen.length < want; ++i) {
      const p = outer[Math.floor(rng.getFraction() * outer.length)];
      if (chosen.every((q) => (p.x - q.x) ** 2 + (p.z - q.z) ** 2 > 13 * 13)) chosen.push(p);
    }
    chosen.forEach((p, i) => {
      const parts = ruins[i % 3];
      if (!parts) return;
      const ruin = new THREE.Group();
      for (const part of parts) {
        const mesh = new THREE.Mesh(part.geometry, this.materials.ruinStone);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        ruin.add(mesh);
      }
      const k = rand(0.9, 1.5);
      ruin.position.set(p.x, p.y - 0.25, p.z);
      ruin.rotation.set(THREE.MathUtils.degToRad(rand(-4, 4)), rand(0, Math.PI * 2), THREE.MathUtils.degToRad(rand(-4, 4)));
      ruin.scale.set(k, k * rand(0.8, 1.3), k);
      this.present.group.add(ruin);
    });
  }

  /** Neon wireframe pyramids and rings far out on the synthwave horizon, as instanced struts. */
  private buildNeon(): void {
    const struts: { a: THREE.Vector3; b: THREE.Vector3; thick: number; magenta: boolean }[] = [];
    // UE (X, Y, Z) in metres -> web (X, Z, Y)
    const w = (x: number, y: number, z: number) => new THREE.Vector3(x, z, y);
    const pyramid = (cx: number, cy: number, baseZ: number, size: number, height: number, yaw: number, thick: number, magenta: boolean) => {
      const corners: THREE.Vector3[] = [];
      for (let k = 0; k < 4; ++k) {
        const a = THREE.MathUtils.degToRad(yaw + 45 + 90 * k);
        corners.push(w(cx + size * 0.7071 * Math.cos(a), cy + size * 0.7071 * Math.sin(a), baseZ));
      }
      const apex = w(cx, cy, baseZ + height);
      for (let k = 0; k < 4; ++k) {
        struts.push({ a: corners[k], b: corners[(k + 1) % 4], thick, magenta });
        struts.push({ a: corners[k], b: apex, thick, magenta });
      }
    };
    const ring = (c: [number, number, number], radius: number, tilt: number, yaw: number, segments: number, thick: number, magenta: boolean) => {
      const pts: THREE.Vector3[] = [];
      const t = THREE.MathUtils.degToRad(tilt);
      const yw = THREE.MathUtils.degToRad(yaw);
      for (let k = 0; k < segments; ++k) {
        const a = (2 * Math.PI * k) / segments;
        let x = radius * Math.cos(a);
        let y = radius * Math.sin(a);
        let z = 0;
        [y, z] = [y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
        [x, y] = [x * Math.cos(yw) - y * Math.sin(yw), x * Math.sin(yw) + y * Math.cos(yw)];
        pts.push(w(c[0] + x, c[1] + y, c[2] + z));
      }
      for (let k = 0; k < segments; ++k) struts.push({ a: pts[k], b: pts[(k + 1) % segments], thick, magenta });
    };
    pyramid(-950, -120, -30, 300, 200, 10, 2.6, true);
    pyramid(-700, 380, -30, 140, 100, 35, 1.8, false);
    pyramid(-750, -600, -30, 180, 130, 60, 2.0, false);
    pyramid(700, -480, -30, 200, 140, 20, 2.0, true);
    ring([-200, 300, 90], 50, 70, 30, 40, 0.9, false);
    ring([260, -380, 120], 70, 60, -40, 48, 1.1, true);
    ring([300, 260, 60], 35, 80, 120, 32, 0.8, false);

    const box = [{ slot: '', geometry: new THREE.BoxGeometry(1, 1, 1) }];
    for (const magenta of [false, true]) {
      const list = struts.filter((s) => s.magenta === magenta);
      const set = new InstancedModel(box, () => (magenta ? this.materials.strutMagenta : this.materials.strutCyan), list.length, false, false);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const dir = new THREE.Vector3();
      list.forEach((s, i) => {
        dir.subVectors(s.b, s.a);
        const len = dir.length();
        q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
        m.compose(s.a.clone().add(s.b).multiplyScalar(0.5), q, new THREE.Vector3(len, s.thick, s.thick));
        set.setMatrixAt(i, m);
      });
      set.count = list.length;
      set.commit();
      this.instanced.push(set);
      this.future.group.add(set.group);
    }
  }

  private era = 0;

  snap(era: number): void {
    this.era = era;
    for (const set of this.sets) set.snap(era);
  }

  /** Make everything drawable (unculled) for a pipeline warm-up frame; false restores. */
  warmup(on: boolean): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh) mesh.frustumCulled = !on;
    });
    // At home height, so shadow-casting parts also land in the shadow camera and get their depth pipelines.
    if (on) {
      for (const set of this.sets) {
        set.group.visible = true;
        set.group.position.y = 0;
      }
    } else this.snap(this.era);
  }

  update(era: number, envEra: number, dt: number): void {
    this.era = era;
    for (const set of this.sets) set.update(era, envEra, dt);
  }

  /** Every mesh (for pipeline pre-compilation). */
  forEachMesh(fn: (mesh: THREE.Mesh) => void): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) fn(o as THREE.Mesh);
    });
  }

  dispose(): void {
    for (const set of this.instanced) set.dispose();
  }
}
