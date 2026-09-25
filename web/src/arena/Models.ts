import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Assets } from '../core/Assets';

/** One material slot of a model: its geometry (in model space) and the slot name from the GLB. */
export interface Part {
  slot: string;
  geometry: THREE.BufferGeometry;
}

type LodLevel = 'L1' | 'L2';
type LodIndex = Record<string, Partial<Record<LodLevel, { path: string; triangles: number }>>>;

/**
 * Arena model access with level-of-detail: the heavy meshes (Nanite meshes in Unreal) have simplified
 * copies in assets/models/lod (scripts/make_lods.mjs). Missing LODs fall back to the full mesh, missing
 * models to null (callers then use primitives, like the UE build).
 */
export class Models {
  private loader = new GLTFLoader();
  private index: Promise<LodIndex>;
  private cache = new Map<string, Promise<Part[] | null>>();

  private assets: Assets;
  /** 0 = full detail, 1 = L1, 2 = L2 (phones / low quality). */
  readonly detail: 0 | 1 | 2;

  constructor(assets: Assets, detail: 0 | 1 | 2) {
    this.assets = assets;
    this.detail = detail;
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.index = fetch(assets.baseUrl + 'assets/models/lod/index.json')
      // WKURLSchemeHandler responses have status 0 despite delivering the JSON.
      .then((r) => (r.ok || r.status === 0 ? (r.json() as Promise<LodIndex>) : {}))
      .catch(() => ({}));
  }

  /** Parts of a model at this detail level; `minDetail` lets heroes (the snake head) stay sharper than props. */
  parts(name: string, maxDetail: 0 | 1 | 2 = 2): Promise<Part[] | null> {
    const detail = Math.min(this.detail, maxDetail);
    const key = `${name}@${detail}`;
    let promise = this.cache.get(key);
    if (!promise) {
      promise = this.load(name, detail);
      this.cache.set(key, promise);
    }
    return promise;
  }

  private async load(name: string, detail: number): Promise<Part[] | null> {
    let root: THREE.Object3D | null = null;
    if (detail > 0) {
      const index = await this.index;
      const entry = index[name]?.[detail === 1 ? 'L1' : 'L2'] ?? index[name]?.L1;
      if (entry) {
        try {
          root = (await this.loader.loadAsync(this.assets.baseUrl + entry.path)).scene;
        } catch (error) {
          console.warn(`lod ${name} failed`, error);
        }
      }
    }
    root ??= await this.assets.model(name);
    if (!root) return null;
    return extractParts(root);
  }
}

/** Flatten a loaded glTF scene into (slot, geometry) parts with node transforms baked in. */
export function extractParts(root: THREE.Object3D): Part[] {
  const parts: Part[] = [];
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geometry = mesh.geometry.clone();
    if (!mesh.matrixWorld.equals(IDENTITY)) geometry.applyMatrix4(mesh.matrixWorld);
    parts.push({ slot: materials[0]?.name ?? '', geometry });
  });
  return parts;
}

const IDENTITY = new THREE.Matrix4();

/** Bounding box over all parts. */
export function partsBounds(parts: Part[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
  }
  return box;
}

/**
 * A model drawn as one InstancedMesh per material slot, all sharing a single instance-matrix buffer
 * (and any extra per-instance attributes), so one update moves every slot.
 */
export class InstancedModel {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[] = [];
  readonly capacity: number;
  private matrices: THREE.InstancedBufferAttribute;

  constructor(parts: Part[], materialFor: (slot: string) => THREE.Material, capacity: number, castShadow = true, receiveShadow = true) {
    this.capacity = Math.max(1, capacity);
    this.matrices = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 16), 16);
    this.matrices.setUsage(THREE.DynamicDrawUsage);
    for (const part of parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, materialFor(part.slot), this.capacity);
      mesh.instanceMatrix = this.matrices;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  set count(n: number) {
    for (const mesh of this.meshes) mesh.count = Math.min(n, this.capacity);
  }

  get count(): number {
    return this.meshes[0]?.count ?? 0;
  }

  setMatrixAt(index: number, matrix: THREE.Matrix4): void {
    matrix.toArray(this.matrices.array, index * 16);
  }

  /** Mark the matrices dirty (only the first `count` instances are uploaded). */
  commit(): void {
    this.matrices.clearUpdateRanges();
    this.matrices.addUpdateRange(0, this.count * 16);
    this.matrices.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  setMaterial(slot: number, material: THREE.Material): void {
    const mesh = this.meshes[slot];
    if (mesh) mesh.material = material;
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.dispose();
  }
}
