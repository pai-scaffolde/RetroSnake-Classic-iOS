import * as THREE from 'three/webgpu';
import { CRITTERS, type SnakeGame } from '../game';
import { CellSize, cellX, cellZ } from './constants';
import type { ArenaMaterials } from './materials';
import { InstancedModel, type Part } from './Models';

export interface PropModels {
  voxel: Part[] | null;
  foodOrb: Part[] | null;
  critter: Part[] | null;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Food, bonus critter, and the optional collectible that opens the next experience. */
export class Props {
  readonly group = new THREE.Group();
  readonly foodLight: THREE.PointLight;
  /** World position of the food (for bursts and the popup). */
  readonly foodPos = new THREE.Vector3();
  era = 0;

  private materials: ArenaMaterials;
  private foodVoxels = new THREE.Group();
  private foodOrb = new THREE.Group();
  private orbFruit: THREE.Mesh[] = [];
  private orbLeaf: THREE.Mesh[] = [];
  private ring: THREE.Mesh;
  private bonusRing: THREE.Mesh;
  private critter = new THREE.Group();
  private transition = new THREE.Group();
  private transitionCore: THREE.Mesh;
  private transitionRing: THREE.Mesh;
  private transitionGround: THREE.Mesh;
  private transitionColors = [new THREE.MeshBasicMaterial({ color: '#38F6FF' }), new THREE.MeshBasicMaterial({ color: '#FF45D2' })];
  private critterVoxels: InstancedModel;
  private lastFood = { x: -2, y: -2 };
  private foodSpawn = -10;
  private time = 0;

  constructor(materials: ArenaMaterials, models: PropModels) {
    this.materials = materials;
    const voxel = models.voxel ?? [{ slot: 'Voxel', geometry: new THREE.BoxGeometry(1, 1, 1) }];
    // Era 0 food: the LCD's 5-pixel plus, as voxels.
    for (const [x, z] of [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) {
      for (const part of voxel) {
        const mesh = new THREE.Mesh(part.geometry, materials.voxel);
        mesh.position.set(x, 0, z);
        mesh.scale.setScalar(0.45);
        mesh.castShadow = true;
        this.foodVoxels.add(mesh);
      }
    }
    this.group.add(this.foodVoxels);

    const orbParts = models.foodOrb ?? [{ slot: 'Fruit', geometry: new THREE.SphereGeometry(0.6, 32, 20) }];
    for (const part of orbParts) {
      const leaf = part.slot === 'Leaf';
      const mesh = new THREE.Mesh(part.geometry, leaf ? materials.leaf : materials.fruit);
      mesh.castShadow = true;
      (leaf ? this.orbLeaf : this.orbFruit).push(mesh);
      this.foodOrb.add(mesh);
    }
    this.group.add(this.foodOrb);

    const disc = new THREE.CircleGeometry(1, 72);
    disc.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(disc, materials.ring);
    this.ring.renderOrder = 5;
    this.group.add(this.ring);
    this.bonusRing = new THREE.Mesh(disc, materials.bonusRing);
    this.bonusRing.renderOrder = 5;
    this.group.add(this.bonusRing);

    this.foodLight = new THREE.PointLight(0xffffff, 0, 10, 2);
    this.foodLight.castShadow = false;
    this.group.add(this.foodLight);

    for (const part of models.critter ?? [{ slot: 'Shell', geometry: new THREE.SphereGeometry(0.7, 24, 12).scale(1.2, 0.5, 1) }]) {
      const mesh = new THREE.Mesh(part.geometry, part.slot === 'Body' ? materials.critterBody : materials.critterShell);
      mesh.castShadow = true;
      this.critter.add(mesh);
    }
    this.group.add(this.critter);
    this.critterVoxels = new InstancedModel(voxel, () => materials.voxel, 21);
    this.group.add(this.critterVoxels.group);

    // A rotating gateway is visually and mechanically distinct from food and the timed bonus.
    this.transitionCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), this.transitionColors[0]);
    this.transitionRing = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.065, 8, 32), this.transitionColors[0]);
    const groundGeometry = new THREE.RingGeometry(0.55, 0.82, 32);
    groundGeometry.rotateX(-Math.PI / 2);
    this.transitionGround = new THREE.Mesh(groundGeometry, new THREE.MeshBasicMaterial({ color: '#38F6FF', transparent: true, opacity: 0.5, depthWrite: false }));
    this.transitionGround.renderOrder = 5;
    this.transition.add(this.transitionCore, this.transitionRing, this.transitionGround);
    this.group.add(this.transition);
    this.setEra(0);
  }

  setEra(era: number): void {
    this.era = era;
    for (const m of this.orbFruit) m.material = era === 2 ? this.materials.foodNeon : this.materials.fruit;
    for (const m of this.orbLeaf) m.material = era === 2 ? this.materials.neonCyan : this.materials.leaf;
    this.transitionCore.material = this.transitionRing.material = this.transitionColors[era === 0 ? 0 : 1];
    (this.transitionGround.material as THREE.MeshBasicMaterial).color.copy(this.transitionColors[era === 0 ? 0 : 1].color);
  }

  /** Warm-up: make every prop drawable at once (critter, rings, both food styles). */
  showAllParts(): void {
    for (const o of [this.foodVoxels, this.foodOrb, this.ring, this.bonusRing, this.critter, this.transition]) o.visible = true;
    this.critter.position.copy(this.foodPos);
    this.bonusRing.position.copy(this.foodPos);
    this.layoutVoxelCritter(0, this.foodPos.x, this.foodPos.z, 0.5);
    this.critterVoxels.visible = true;
  }

  update(game: SnakeGame, dt: number, frozen: boolean): void {
    this.time += dt;
    const t = this.time;
    const transitionActive = game.isTransitionActive() && !frozen;
    this.transition.visible = transitionActive;
    if (transitionActive) {
      const portal = game.getTransitionPos();
      this.transition.position.set(cellX(portal.x), 0, cellZ(portal.y));
      this.transitionCore.position.y = 1.18 + 0.17 * Math.sin(t * 3.5);
      this.transitionCore.rotation.set(t * 0.7, t * 1.5, t * 0.45);
      this.transitionRing.position.y = 1.2;
      this.transitionRing.rotation.set(0.25 * Math.sin(t * 1.2), t * 0.65, 0.2 * Math.cos(t));
      this.transitionGround.position.y = 0.035;
      this.transitionGround.scale.setScalar(0.95 + 0.1 * Math.sin(t * 3));
    }
    const food = game.getFood();
    if (food.x !== this.lastFood.x || food.y !== this.lastFood.y) {
      this.lastFood = food;
      this.foodSpawn = t;
    }
    const hasFood = food.x >= 0 && !frozen;
    const age = t - this.foodSpawn;
    // New food blinks for half a second, the way it did on the phone.
    const blinkOn = age > 0.5 || age % 0.12 < 0.07;
    const x = cellX(food.x);
    const z = cellZ(food.y);
    const y = 0.95 + 0.2 * Math.sin(t * Math.PI * 2 * 1.2);
    this.foodPos.set(x, y, z);
    this.foodVoxels.visible = hasFood && this.era === 0 && blinkOn;
    this.foodOrb.visible = hasFood && this.era > 0 && blinkOn;
    this.ring.visible = hasFood;
    if (hasFood) {
      this.foodVoxels.position.set(x, y, z);
      this.foodVoxels.rotation.y = t * THREE.MathUtils.degToRad(45);
      this.foodOrb.position.set(x, y, z);
      this.foodOrb.rotation.y = t * THREE.MathUtils.degToRad(70);
      // Pop in: scale up with a little overshoot.
      const pop = Math.min(1, age / 0.25);
      const k = pop < 1 ? 1 - Math.pow(1 - pop, 3) * Math.cos(pop * 6) : 1;
      this.foodOrb.scale.setScalar(Math.max(0.01, k));
      this.foodVoxels.scale.setScalar(Math.max(0.01, k));
      const pulse = 1 + 0.08 * Math.sin(t * Math.PI * 2 * 2);
      this.ring.position.set(x, 0.03, z);
      this.ring.scale.setScalar(2.4 * pulse);
      this.foodLight.position.set(x, y + 0.6, z);
    }

    // Bonus critter + its countdown ring.
    const bonus = game.isBonusActive() && !frozen;
    this.critter.visible = bonus && this.era > 0;
    this.critterVoxels.visible = bonus && this.era === 0;
    this.bonusRing.visible = bonus;
    if (bonus) {
      const pos = game.getBonusPos();
      const bx = cellX(pos.x) + CellSize * 0.5;
      const bz = cellZ(pos.y);
      const hop = 0.45 + 0.1 * Math.abs(Math.sin(t * 6));
      this.critter.position.set(bx, hop, bz);
      this.critter.rotation.y = t * THREE.MathUtils.degToRad(40);
      const remaining = game.getBonusTimer() / 24;
      this.bonusRing.position.set(bx, 0.025, bz);
      this.bonusRing.scale.setScalar((4.2 * remaining + 0.4) * 0.5);
      if (this.era === 0) this.layoutVoxelCritter(game.getBonusKind(), bx, bz, hop);
    }
  }

  /** Era 0 critter: the phone's 7x3 bitmap as voxels spanning its two cells. */
  private layoutVoxelCritter(kind: number, bx: number, bz: number, hop: number): void {
    const bitmap = CRITTERS[Math.max(0, Math.min(CRITTERS.length - 1, kind))];
    const px = 0.56;
    let count = 0;
    for (let r = 0; r < bitmap.length; ++r) {
      for (let c = 0; c < bitmap[r].length; ++c) {
        if (bitmap[r][c] !== '#') continue;
        _p.set(bx + (c - 3) * px, 0.3 + hop * 0.5, bz + (r - 1) * px);
        _m.compose(_p, _q.identity(), _s.setScalar(px * 0.86));
        this.critterVoxels.setMatrixAt(count++, _m);
      }
    }
    this.critterVoxels.count = count;
    this.critterVoxels.commit();
  }

  dispose(): void {
    this.critterVoxels.dispose();
    this.ring.geometry.dispose();
    this.transitionCore.geometry.dispose();
    this.transitionRing.geometry.dispose();
    this.transitionGround.geometry.dispose();
    this.transitionColors.forEach((material) => material.dispose());
    (this.transitionGround.material as THREE.Material).dispose();
    this.foodLight.dispose();
  }
}
