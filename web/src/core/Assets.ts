import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export interface ModelEntry {
  path: string;
  bytes: number;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  materials?: string[];
}
export interface TextureEntry {
  path: string;
  bytes: number;
  width?: number;
  height?: number;
  colorSpace?: 'srgb' | 'linear';
}
export interface AudioEntry {
  path: string;
  bytes: number;
  duration?: number;
  sampleRate?: number;
  loop?: boolean;
  /** Encoder delay the browser's decoder may or may not have trimmed (see Tools/web/README.md). */
  mp3PrimingSeconds?: number;
}
export interface FontEntry {
  path: string;
  family?: string;
  weight?: number;
}
export interface AssetManifest {
  models?: Record<string, ModelEntry>;
  textures?: Record<string, TextureEntry>;
  audio?: Record<string, AudioEntry>;
  fonts?: Record<string, FontEntry>;
  totalBytes?: number;
}

/**
 * Loads the web asset set described by assets/manifest.json (built by Tools/web/export_assets.py).
 * Everything is cached; missing assets resolve to fallbacks so a scene can still run
 * (the same way the Unreal build falls back to engine primitives).
 */
export class Assets {
  readonly manifest: AssetManifest;
  readonly baseUrl: string;
  private gltf = new GLTFLoader();
  private textureLoader = new THREE.TextureLoader();
  private models = new Map<string, Promise<THREE.Object3D | null>>();
  private textures = new Map<string, THREE.Texture>();
  maxAnisotropy = 8;
  /** Progress callback for the loading screen (loaded bytes, total bytes). */
  onProgress: ((loaded: number, total: number) => void) | null = null;
  private loadedBytes = 0;
  private expectedBytes = 0;

  static async load(baseUrl: string): Promise<Assets> {
    let manifest: AssetManifest = {};
    try {
      const response = await fetch(baseUrl + 'assets/manifest.json', { cache: 'no-cache' });
      if (response.ok) manifest = (await response.json()) as AssetManifest;
    } catch (error) {
      console.warn('asset manifest missing; running on fallbacks', error);
    }
    return new Assets(manifest, baseUrl);
  }

  private constructor(manifest: AssetManifest, baseUrl: string) {
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
  }

  hasModel(name: string): boolean {
    return !!this.manifest.models?.[name];
  }

  /** Load a model; resolves to a fresh clone each call (geometry/material shared). */
  async model(name: string): Promise<THREE.Object3D | null> {
    let promise = this.models.get(name);
    if (!promise) {
      const entry = this.manifest.models?.[name];
      promise = entry
        ? this.gltf
            .loadAsync(this.baseUrl + entry.path)
            .then((gltf) => {
              this.track(entry.bytes);
              gltf.scene.traverse((node) => {
                const mesh = node as THREE.Mesh;
                if (mesh.isMesh) {
                  mesh.castShadow = true;
                  mesh.receiveShadow = true;
                }
              });
              return gltf.scene as THREE.Object3D;
            })
            .catch((error) => {
              console.warn(`model ${name} failed`, error);
              return null;
            })
        : Promise.resolve(null);
      this.models.set(name, promise);
    }
    const scene = await promise;
    return scene ? scene.clone(true) : null;
  }

  /** First mesh's geometry of a model (for instancing), or null. */
  async geometry(name: string): Promise<THREE.BufferGeometry | null> {
    const root = await this.model(name);
    let found: THREE.BufferGeometry | null = null;
    root?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!found && mesh.isMesh) {
        mesh.updateWorldMatrix(true, false);
        found = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      }
    });
    return found;
  }

  /** Texture by manifest name; returns immediately (fills in when loaded). Null if unknown. */
  texture(name: string, repeat = true): THREE.Texture | null {
    const cached = this.textures.get(name);
    if (cached) return cached;
    const entry = this.manifest.textures?.[name];
    if (!entry) return null;
    const texture = this.textureLoader.load(this.baseUrl + entry.path, () => this.track(entry.bytes));
    texture.colorSpace = entry.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.flipY = false; // glTF UV convention
    texture.anisotropy = this.maxAnisotropy;
    if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    this.textures.set(name, texture);
    return texture;
  }

  /** Wait for a batch of models/textures (used behind the loading screen). */
  async preload(models: string[], textures: string[]): Promise<void> {
    const entries = this.manifest;
    this.expectedBytes +=
      models.reduce((sum, n) => sum + (entries.models?.[n]?.bytes ?? 0), 0) +
      textures.reduce((sum, n) => sum + (entries.textures?.[n]?.bytes ?? 0), 0);
    const textureLoads = textures.map(
      (name) =>
        new Promise<void>((resolve) => {
          const entry = entries.textures?.[name];
          if (!entry || this.textures.has(name)) return resolve();
          const texture = this.textureLoader.load(
            this.baseUrl + entry.path,
            () => {
              this.track(entry.bytes);
              resolve();
            },
            undefined,
            () => resolve(),
          );
          texture.colorSpace = entry.colorSpace === 'linear' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          texture.flipY = false;
          texture.anisotropy = this.maxAnisotropy;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          this.textures.set(name, texture);
        }),
    );
    await Promise.all([...models.map((m) => this.model(m)), ...textureLoads]);
  }

  /** Register the manifest's fonts with the document (for the HTML HUD). */
  async loadFonts(): Promise<void> {
    const fonts = Object.entries(this.manifest.fonts ?? {});
    await Promise.all(
      fonts.map(async ([key, entry]) => {
        try {
          const face = new FontFace(entry.family ?? key, `url(${this.baseUrl + entry.path})`, {
            weight: String(entry.weight ?? 400),
          });
          document.fonts.add(await face.load());
        } catch (error) {
          console.warn(`font ${key} failed`, error);
        }
      }),
    );
  }

  private track(bytes: number): void {
    this.loadedBytes += bytes;
    this.onProgress?.(this.loadedBytes, Math.max(this.expectedBytes, this.loadedBytes));
  }
}
