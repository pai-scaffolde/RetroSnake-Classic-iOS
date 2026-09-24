import * as THREE from 'three/webgpu';
import { InstancedModel, type Part } from './Models';

const Gravity = 19;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** A fixed pool of spinning voxels with gravity and floor bounces, drawn as one InstancedMesh (ASnakeArena::Burst). */
class Pool {
  readonly model: InstancedModel;
  private capacity: number;
  private count = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;

  constructor(parts: Part[], material: THREE.Material, capacity: number, shadows: boolean) {
    this.capacity = capacity;
    this.model = new InstancedModel(parts, () => material, capacity, shadows, false);
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.spin = new Float32Array(capacity * 2);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
  }

  spawn(at: THREE.Vector3, n: number, speed: number, sizeMin: number, sizeMax: number): void {
    for (let k = 0; k < n; ++k) {
      // Recycle the oldest slot when full.
      const i = this.count < this.capacity ? this.count++ : Math.floor(Math.random() * this.capacity);
      let dx = Math.random() * 2 - 1;
      let dy = Math.random() * 2 - 1;
      let dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      dy = Math.abs(dy) * 1.4 + 0.3;
      const nl = Math.hypot(dx, dy, dz);
      const v = (speed * (0.35 + Math.random() * 0.65)) / nl;
      this.pos[i * 3] = at.x + dx * 0.2;
      this.pos[i * 3 + 1] = at.y + dy * 0.2;
      this.pos[i * 3 + 2] = at.z + dz * 0.2;
      this.vel[i * 3] = dx * v;
      this.vel[i * 3 + 1] = dy * v;
      this.vel[i * 3 + 2] = dz * v;
      this.spin[i * 2] = (Math.random() * 2 - 1) * 12.5;
      this.spin[i * 2 + 1] = (Math.random() * 2 - 1) * 12.5;
      this.maxLife[i] = this.life[i] = 0.7 + Math.random() * 0.9;
      this.size[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
    }
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.count; ++i) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      // Compact live particles to the front.
      if (w !== i) {
        this.pos.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.vel.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.spin.copyWithin(w * 2, i * 2, i * 2 + 2);
        this.maxLife[w] = this.maxLife[i];
        this.size[w] = this.size[i];
      }
      this.life[w] = life;
      const size = this.size[w];
      this.vel[w * 3 + 1] -= Gravity * dt;
      const x = this.pos[w * 3] + this.vel[w * 3] * dt;
      let y = this.pos[w * 3 + 1] + this.vel[w * 3 + 1] * dt;
      const z = this.pos[w * 3 + 2] + this.vel[w * 3 + 2] * dt;
      if (y < size * 0.5 && Math.abs(x) < 24.5 && Math.abs(z) < 24.5) {
        y = size * 0.5;
        this.vel[w * 3 + 1] *= -0.35;
        this.vel[w * 3] *= 0.7;
        this.vel[w * 3 + 2] *= 0.7;
      }
      this.pos[w * 3] = x;
      this.pos[w * 3 + 1] = y;
      this.pos[w * 3 + 2] = z;
      const age = this.maxLife[w] - life;
      _e.set(this.spin[w * 2] * age, this.spin[w * 2 + 1] * age, 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, y, z), _q, _s.setScalar(size * Math.sqrt(life / this.maxLife[w])));
      this.model.setMatrixAt(w, _m);
      ++w;
    }
    this.count = w;
    this.model.count = w;
    this.model.visible = w > 0;
    if (w > 0) this.model.commit();
  }

  setMaterial(material: THREE.Material): void {
    for (const mesh of this.model.meshes) mesh.material = material;
  }

  clear(): void {
    this.count = 0;
    this.model.count = 0;
  }
}

/** Voxel debris and glowing embers. */
export class Particles {
  readonly group = new THREE.Group();
  private solid: Pool;
  private glow: Pool;

  constructor(voxel: Part[], solidMaterial: THREE.Material, glowMaterial: THREE.Material, capacity: number) {
    this.solid = new Pool(voxel, solidMaterial, capacity, true);
    this.glow = new Pool(voxel, glowMaterial, capacity, false);
    this.group.add(this.solid.model.group, this.glow.model.group);
  }

  /** Spray voxels (solid) or embers (glow); speed in m/s. */
  burst(at: THREE.Vector3, count: number, speed: number, glow: boolean): void {
    if (glow) this.glow.spawn(at, count, speed, 0.06, 0.16);
    else this.solid.spawn(at, count, speed, 0.14, 0.32);
  }

  setSolidMaterial(material: THREE.Material): void {
    this.solid.setMaterial(material);
  }

  update(dt: number): void {
    this.solid.update(dt);
    this.glow.update(dt);
  }

  clear(): void {
    this.solid.clear();
    this.glow.clear();
  }

  dispose(): void {
    this.solid.model.dispose();
    this.glow.model.dispose();
  }
}
