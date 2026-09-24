import * as THREE from 'three/webgpu';
import type { SnakeGame } from '../game';
import { BoardCells, CellSize, NumEras, cellX, cellZ, easeOutBack } from './constants';
import type { ArenaMaterials } from './materials';
import { InstancedModel, type Part } from './Models';

/** Wave speed across the board (m/s), tile flip time (s) and hop (m): ASnakeArena's WaveSpeed/TileFlipTime/TileHop. */
const WaveSpeed = 34;
const TileFlipTime = 0.35;
const TileHop = 0.35;
const SinkDepth = 3.2;

export interface BoardModels {
  tile: Part[] | null;
  voxel: Part[] | null;
  neonBlock: Part[] | null;
  ruins: (Part[] | null)[];
  kerb: Part[] | null;
}

interface Kerb {
  col: number;
  row: number;
  /** Rest transform per era. */
  rest: THREE.Matrix4[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const _up = new THREE.Vector3(0, 1, 0);

/**
 * The 24x24 board: floor tiles (one instanced set per era), maze walls (voxel / neon block / three ruin
 * variants) and the board-edge kerb, plus the domino-ripple era shift (ASnakeArena::UpdateShift).
 */
export class Board {
  readonly group = new THREE.Group();
  private tiles: InstancedModel[] = [];
  private walls: InstancedModel[] = [];
  private kerbSets: InstancedModel[] = [];
  private basePlate: THREE.Mesh;
  private wallCells: { col: number; row: number }[] = [];
  /** Per wall set, the wall indices it draws (instance j = wall wallMembers[s][j]). */
  private wallMembers: number[][] = [];
  private kerbs: Kerb[] = [];
  private materials: ArenaMaterials;
  private models: BoardModels;

  fromEra = 0;
  targetEra = 0;
  shifting = false;
  private shiftTime = 0;
  private shiftDuration = 1;
  private origin = { col: 0, row: 0 };

  constructor(materials: ArenaMaterials, models: BoardModels) {
    this.materials = materials;
    this.models = models;
    const count = BoardCells * BoardCells;
    const tileParts = models.tile ?? fallbackTile();
    for (let era = 0; era < NumEras; ++era) {
      const set = new InstancedModel(tileParts, (slot) => (slot === 'Sides' ? materials.tileSides : materials.tileTop[era]), count, false, true);
      set.count = count;
      this.tiles.push(set);
      this.group.add(set.group);
    }
    this.basePlate = new THREE.Mesh(new THREE.PlaneGeometry(BoardCells * CellSize + 0.2, BoardCells * CellSize + 0.2), materials.basePlate);
    this.basePlate.rotation.x = -Math.PI / 2;
    this.basePlate.position.y = -0.36;
    this.basePlate.receiveShadow = true;
    this.group.add(this.basePlate);
  }

  get shiftProgress(): number {
    return this.shifting ? Math.min(1, this.shiftTime / this.shiftDuration) : 1;
  }

  /** Lay out tiles, walls and kerbs for a game's maze (ASnakeArena::BuildBoard). */
  build(game: SnakeGame, era: number): void {
    for (const set of [...this.walls, ...this.kerbSets]) {
      this.group.remove(set.group);
      set.dispose();
    }
    this.walls = [];
    this.kerbSets = [];
    this.wallCells = [];
    for (let row = 0; row < BoardCells; ++row) {
      for (let col = 0; col < BoardCells; ++col) {
        if (game.isWall({ x: col, y: row })) this.wallCells.push({ col, row });
      }
    }
    const m = this.materials;
    const voxel = this.models.voxel ?? fallbackBox(1, 1, 1, 0);
    const wallSets: [Part[], (slot: string) => THREE.Material][] = [
      [voxel, () => m.voxel],
      [this.models.neonBlock ?? fallbackBox(1.9, 1.6, 1.9, 0.8), (slot) => (slot === 'Edge' ? m.neonCyan : m.neonBody)],
      ...this.models.ruins.map((parts): [Part[], (slot: string) => THREE.Material] => [parts ?? fallbackBox(1.9, 1.8, 1.9, 0.9), () => m.ruinStone]),
    ];
    // The voxel and neon sets hold every wall; each ruin variant only the walls that become that variant.
    this.wallMembers = wallSets.map((_, s) => this.wallCells.map((_, i) => i).filter((i) => s < 2 || this.wallVariant(i) === s));
    wallSets.forEach(([parts, mat], s) => {
      const set = new InstancedModel(parts, mat, Math.max(1, this.wallMembers[s].length));
      set.count = this.wallMembers[s].length;
      this.walls.push(set);
      this.group.add(set.group);
    });
    this.buildKerbs(voxel);
    this.setEraImmediate(era);
  }

  private buildKerbs(voxel: Part[]): void {
    const m = this.materials;
    this.kerbs = [];
    const add = (col: number, row: number, nx: number, nz: number, corner: boolean) => {
      // The outside cell's centre is half a cell beyond the board edge.
      const bx = cellX(col) - nx * CellSize * 0.5;
      const bz = cellZ(row) - nz * CellSize * 0.5;
      const alongX = Math.abs(nz) > 0.5;
      const yaw = Math.atan2(-nx, -nz); // local -Z (the carved outward face) -> outward normal
      const rest: THREE.Matrix4[] = [];
      rest.push(new THREE.Matrix4().compose(_p.set(bx + nx * 0.7, 0.3, bz + nz * 0.7), _q.identity(), _s.setScalar(0.6)));
      const stone = this.models.kerb ? _s.set(corner ? 0.25 : 1, 1, 1) : _s.set(corner ? 0.4 : 2, 0.5, 0.4);
      rest.push(
        new THREE.Matrix4().compose(
          _p.set(bx + nx * 0.3, 0, bz + nz * 0.3),
          _q.setFromAxisAngle(_up, yaw),
          stone.clone(),
        ),
      );
      const strip = corner ? _s.setScalar(0.2) : alongX ? _s.set(2, 0.2, 0.2) : _s.set(0.2, 0.2, 2);
      rest.push(new THREE.Matrix4().compose(_p.set(bx + nx * 0.15, 0.1, bz + nz * 0.15), _q.identity(), strip.clone()));
      this.kerbs.push({ col, row, rest });
    };
    for (let col = 0; col < BoardCells; ++col) {
      add(col, -1, 0, -1, false);
      add(col, BoardCells, 0, 1, false);
    }
    for (let row = 0; row < BoardCells; ++row) {
      add(-1, row, -1, 0, false);
      add(BoardCells, row, 1, 0, false);
    }
    const d = Math.SQRT1_2;
    add(-1, -1, -d, -d, true);
    add(BoardCells, -1, d, -d, true);
    add(-1, BoardCells, -d, d, true);
    add(BoardCells, BoardCells, d, d, true);

    const sets: [Part[], (slot: string) => THREE.Material, boolean][] = [
      [voxel, () => m.voxel, true],
      [this.models.kerb ?? fallbackBox(1, 1, 1, 0.5), () => m.kerbStone, true],
      [voxel, () => m.neonMagenta, false],
    ];
    for (const [parts, mat, shadow] of sets) {
      const set = new InstancedModel(parts, mat, this.kerbs.length, shadow);
      set.count = this.kerbs.length;
      this.kerbSets.push(set);
      this.group.add(set.group);
    }
  }

  private wallVariant(i: number): number {
    const { col, row } = this.wallCells[i];
    return 2 + ((col * 31 + row * 17) % 3);
  }

  private wallSetForEra(i: number, era: number): number {
    return era === 0 ? 0 : era === 1 ? this.wallVariant(i) : 1;
  }

  private wallMatrix(i: number, set: number, sink: number, out: THREE.Matrix4): THREE.Matrix4 {
    const { col, row } = this.wallCells[i];
    const yaw = set >= 2 ? (Math.PI / 2) * ((col * 7 + row * 13) % 4) : 0;
    if (set === 0) {
      // SM_Voxel pivots at its centre.
      return out.compose(_p.set(cellX(col), 0.8 - sink, cellZ(row)), _q.identity(), _s.set(1.9, 1.6, 1.9));
    }
    return out.compose(_p.set(cellX(col), -sink, cellZ(row)), _q.setFromAxisAngle(_up, yaw), _s.setScalar(1));
  }

  setEraImmediate(era: number): void {
    this.fromEra = this.targetEra = era;
    this.shifting = false;
    const count = BoardCells * BoardCells;
    for (let e = 0; e < NumEras; ++e) {
      const set = this.tiles[e];
      set.visible = e === era;
      for (let i = 0; i < count; ++i) {
        _m.makeTranslation(cellX(i % BoardCells), 0, cellZ(Math.floor(i / BoardCells)));
        set.setMatrixAt(i, e === era ? _m : _hidden);
      }
      set.commit();
    }
    this.materials.seam.array.fill(0);
    this.materials.seam.needsUpdate = true;
    for (let s = 0; s < this.walls.length; ++s) {
      const set = this.walls[s];
      const members = this.wallMembers[s];
      let any = false;
      for (let j = 0; j < members.length; ++j) {
        const i = members[j];
        const visible = this.wallSetForEra(i, era) === s;
        any ||= visible;
        set.setMatrixAt(j, visible ? this.wallMatrix(i, s, 0, _m) : _hidden);
      }
      set.visible = any;
      set.commit();
    }
    for (let e = 0; e < this.kerbSets.length; ++e) {
      const set = this.kerbSets[e];
      set.visible = e === era;
      for (let i = 0; i < this.kerbs.length; ++i) set.setMatrixAt(i, e === era ? this.kerbs[i].rest[e] : _hidden);
      set.commit();
    }
  }

  /** Show every era's sets (hidden instances included) so their pipelines get built; false restores. */
  warmup(on: boolean): void {
    if (!on) {
      this.setEraImmediate(this.targetEra);
      return;
    }
    for (const set of [...this.tiles, ...this.walls, ...this.kerbSets]) set.visible = true;
  }

  /** Ripple into the next era from a cell (ASnakeArena::StartEraShift). */
  startShift(era: number, col: number, row: number): void {
    if (era === this.targetEra) return;
    if (this.shifting) this.update(this.shiftDuration + 1); // finish the previous wave first
    this.fromEra = this.targetEra;
    this.targetEra = era;
    this.shifting = true;
    this.shiftTime = 0;
    this.origin = { col, row };
    const maxDistance = Math.hypot(BoardCells, BoardCells) * CellSize;
    this.shiftDuration = maxDistance / WaveSpeed + TileFlipTime + 0.2;
    for (let e = 0; e < NumEras; ++e) this.tiles[e].visible = e === this.fromEra || e === this.targetEra;
    for (let e = 0; e < this.kerbSets.length; ++e) this.kerbSets[e].visible = e === this.fromEra || e === this.targetEra;
    for (const set of this.walls) set.visible = true;
  }

  private cellProgress(col: number, row: number): number {
    const delay = (Math.hypot(col - this.origin.col, row - this.origin.row) * CellSize) / WaveSpeed;
    return Math.min(1, Math.max(0, (this.shiftTime - delay) / TileFlipTime));
  }

  /** Advance the wave (game time, so it slows with the slow-motion). */
  update(dt: number): void {
    if (!this.shifting) return;
    this.shiftTime += dt;
    const done = this.shiftTime >= this.shiftDuration;
    const from = this.tiles[this.fromEra];
    const to = this.tiles[this.targetEra];
    const seam = this.materials.seam.array as Float32Array;
    for (let i = 0; i < BoardCells * BoardCells; ++i) {
      const col = i % BoardCells;
      const row = Math.floor(i / BoardCells);
      const p = done ? 1 : this.cellProgress(col, row);
      let rx = col - this.origin.col;
      let rz = row - this.origin.row;
      const len = Math.hypot(rx, rz);
      if (len < 1e-3) {
        rx = 1;
        rz = 0;
      } else {
        rx /= len;
        rz /= len;
      }
      // Tip over outward (axis = up x radial), swapping faces half-way, with a hop.
      const firstHalf = p < 0.5;
      const angle = firstHalf ? p * Math.PI : (p - 1) * Math.PI;
      _q.setFromAxisAngle(_axis.set(rz, 0, -rx), angle);
      const hop = Math.sin(p * Math.PI) * TileHop;
      _m.compose(_p.set(cellX(col), hop, cellZ(row)), _q, _s.setScalar(1));
      from.setMatrixAt(i, firstHalf && p < 1 ? _m : _hidden);
      to.setMatrixAt(i, !firstHalf || p >= 1 ? _m : _hidden);
      seam[i] = p > 0.3 && p < 0.7 ? 1 - Math.abs(p - 0.5) / 0.2 : 0;
    }
    from.commit();
    to.commit();
    this.materials.seam.needsUpdate = true;

    // Walls and kerb sink away and rise again as the wave passes.
    const sinkFor = (p: number, old: boolean) => (old ? p * 2 * SinkDepth : (1 - easeOutBack((p - 0.5) * 2)) * SinkDepth);
    for (let s = 0; s < this.walls.length; ++s) {
      const set = this.walls[s];
      const members = this.wallMembers[s];
      for (let j = 0; j < members.length; ++j) {
        const i = members[j];
        const { col, row } = this.wallCells[i];
        const p = done ? 1 : this.cellProgress(col, row);
        const old = s === this.wallSetForEra(i, this.fromEra) && p < 0.5;
        const now = s === this.wallSetForEra(i, this.targetEra) && p >= 0.5;
        set.setMatrixAt(j, old || now ? this.wallMatrix(i, s, sinkFor(p, old), _m) : _hidden);
      }
      set.commit();
    }
    for (let e = 0; e < this.kerbSets.length; ++e) {
      if (e !== this.fromEra && e !== this.targetEra) continue;
      const set = this.kerbSets[e];
      for (let i = 0; i < this.kerbs.length; ++i) {
        const k = this.kerbs[i];
        const p = done ? 1 : this.cellProgress(Math.min(Math.max(k.col, 0), BoardCells - 1), Math.min(Math.max(k.row, 0), BoardCells - 1));
        const old = e === this.fromEra && p < 0.5;
        const now = e === this.targetEra && p >= 0.5;
        if (old || now) {
          _m.copy(k.rest[e]);
          _m.elements[13] -= sinkFor(p, old) * 0.4;
          set.setMatrixAt(i, _m);
        } else {
          set.setMatrixAt(i, _hidden);
        }
      }
      set.commit();
    }

    if (done) {
      this.shifting = false;
      this.fromEra = this.targetEra;
      this.setEraImmediate(this.targetEra);
    }
  }

  dispose(): void {
    for (const set of [...this.tiles, ...this.walls, ...this.kerbSets]) set.dispose();
    this.basePlate.geometry.dispose();
  }
}

function fallbackTile(): Part[] {
  return fallbackBox(1.9, 0.4, 1.9, -0.2, 'Top');
}

/** A box part (the UE build's engine-cube fallback), centred at `lift` above the pivot. */
export function fallbackBox(w: number, h: number, d: number, lift: number, slot = ''): Part[] {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(0, lift, 0);
  return [{ slot, geometry }];
}
