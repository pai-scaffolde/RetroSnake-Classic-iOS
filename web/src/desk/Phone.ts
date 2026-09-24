import * as THREE from 'three/webgpu';
import {
  texture, vec2, vec3, float, positionLocal, positionGeometry, fract, abs, max, smoothstep, fwidth, mix, uniform, color, mrt,
  emissive, instancedDynamicBufferAttribute, floor, mod, pow, dot, normalView, positionViewDirection,
} from 'three/tsl';
import type { Assets } from '../core/Assets';
import { COVER_NAMES } from '../game/SaveData';
import { DeskMaterials, EmissiveScale } from './materials';
import { UU, ue, keyName, PhoneKey, LcdW, LcdH, PixelPitch, PixelSize, PixelHeight } from './space';

/** Unreal light units (candela at 100x scale, EV100 7) -> web candela at real scale. */
export const LightScale = 1 / 1.536e6;

const NumPixels = LcdW * LcdH;
const GhostingTime = 0.14;
const PressTravel = 0.0012;
const GlowIntensity = 400 * LightScale * 1.6;
const BacklightColor = new THREE.Color(0xb8d86a);

/** Where keys go when the authored key meshes are missing (ARetroPhone PlaceholderKeyLocation), UE units. */
function placeholderKey(key: number): [number, number, number] {
  switch (key) {
    case PhoneKey.Select: return [-235, 0, 4];
    case PhoneKey.Clear: return [-235, 165, 4];
    case PhoneKey.Up: return [-205, -165, 4];
    case PhoneKey.Down: return [-265, -165, 4];
    default: {
      const k = key - PhoneKey.Key1;
      return [-360 - 100 * Math.floor(k / 3), -140 + 140 * (k % 3), 4];
    }
  }
}

/**
 * The candybar phone (ARetroPhone): body, swappable faceplate, bezel, glass, 16 keys and the 95x64 voxel LCD.
 * The LCD is one InstancedMesh: only lit (or still-fading) pixels are drawn, each instance carrying (pixel index, level);
 * the vertex shader places and stretches the voxel, so a frame uploads at most 6080 x 2 floats.
 */
export class Phone {
  readonly root = new THREE.Group();
  /** Everything that shakes when the phone vibrates. */
  private readonly chassis = new THREE.Group();
  private faceplates: THREE.Mesh[] = [];
  private keys: (THREE.Object3D | null)[] = [];
  private keyMeshes: THREE.Mesh[] = [];
  private keyBaseY: number[] = [];
  private readonly keyPress = new Float32Array(PhoneKey.Count);
  private readonly keyFlash = new Float32Array(PhoneKey.Count);
  private keyGlow: { value: number }[] = [];

  private lcd!: THREE.InstancedMesh;
  private pixelGeometryHigh: THREE.BufferGeometry | null = null;
  private pixelGeometryLow: THREE.BufferGeometry | null = null;
  private readonly pixelData = new Float32Array(NumPixels * 2);
  private readonly pixelAttr = new THREE.InstancedBufferAttribute(this.pixelData, 2);
  private readonly levels = new Float32Array(NumPixels);
  private readonly velocities = new Float32Array(NumPixels);
  private readonly targets = new Uint8Array(NumPixels);
  /** Per-pixel voxel coverage, sampled (bilinear) by the backlight for contact occlusion in the gaps and holes. */
  private readonly coverage = new Uint8Array(NumPixels);
  private readonly coverageTex = new THREE.DataTexture(this.coverage, LcdW, LcdH, THREE.RedFormat, THREE.UnsignedByteType);

  private readonly backlightU = uniform(0);
  private backlight = 0;
  private backlightTarget = 1;
  private glow!: THREE.PointLight;
  private vibrateRemaining = 0;
  private vibrateStrength = 1;
  private cover = 0;
  private readonly materials: DeskMaterials;
  private owned: THREE.BufferGeometry[] = [];

  constructor(materials: DeskMaterials) {
    this.materials = materials;
    this.root.name = 'RetroPhone';
    this.chassis.name = 'Chassis';
    this.root.add(this.chassis);
  }

  static modelNames(): string[] {
    const names = ['SM_Phone_Body', 'SM_Phone_Faceplate', 'SM_Phone_ScreenBezel', 'SM_Phone_ScreenGlass', 'SM_LCDPixel'];
    for (let k = 0; k < PhoneKey.Count; ++k) names.push('SM_Phone_Key_' + keyName(k));
    return names;
  }

  async load(assets: Assets, quality: number): Promise<void> {
    const m = this.materials;
    const [body, faceplate, bezel, glass, pixel, ...keys] = await Promise.all([
      assets.model('SM_Phone_Body'),
      assets.model('SM_Phone_Faceplate'),
      assets.model('SM_Phone_ScreenBezel'),
      assets.model('SM_Phone_ScreenGlass'),
      assets.geometry('SM_LCDPixel'),
      ...Array.from({ length: PhoneKey.Count }, (_, k) => assets.model('SM_Phone_Key_' + keyName(k))),
    ]);

    // Body (fallback: the tinted cube of the Unreal build).
    if (body) {
      this.applySlots(body);
      this.chassis.add(body);
    } else {
      const box = this.own(new THREE.BoxGeometry(1130 * UU, 200 * UU, 480 * UU));
      const mesh = new THREE.Mesh(box, m.slot('MI_Phone_Shell'));
      mesh.position.copy(ue(-250, 0, -102));
      mesh.castShadow = mesh.receiveShadow = true;
      this.chassis.add(mesh);
    }
    if (faceplate) {
      faceplate.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) this.faceplates.push(node as THREE.Mesh);
      });
      this.chassis.add(faceplate);
    }
    if (bezel) {
      this.applySlots(bezel);
      this.chassis.add(bezel);
    }
    if (glass) {
      this.applySlots(glass);
      glass.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = false;
          mesh.renderOrder = 2;
        }
      });
      this.chassis.add(glass);
    }

    this.buildBackplane();
    this.buildKeys(keys);
    this.buildLcd(pixel, quality);

    this.glow = new THREE.PointLight(BacklightColor, 0, 0.16, 2);
    this.glow.position.copy(ue(-60, 0, 140));
    this.glow.castShadow = false;
    this.chassis.add(this.glow);

    this.setCover(this.cover);
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.owned.push(geometry);
    return geometry;
  }

  private applySlots(root: THREE.Object3D): void {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as THREE.Material).name;
      mesh.material = this.materials.slot(name);
    });
  }

  /** The glowing LCD backlight plane (M_LCDBacklight): falloff texture, faint cell grid, lit base colour. */
  private buildBackplane(): void {
    const geometry = this.own(new THREE.PlaneGeometry(272 * UU, 396 * UU).rotateX(-Math.PI / 2));
    const material = this.materials.track(new THREE.MeshStandardNodeMaterial());
    // Screen coordinates in UE units: lx toward the top of the phone, ly toward the player's right.
    const lx = positionLocal.x.div(UU);
    const ly = positionLocal.z.div(UU);
    const gx = abs(fract(lx.div(4)).sub(0.5)).mul(2);
    const gy = abs(fract(ly.sub(2).div(4)).sub(0.5)).mul(2);
    const gridWidth = 0.14;
    const line = smoothstep(1 - gridWidth, 1 - gridWidth * 0.35, max(gx, gy));
    const aa = float(1).sub(smoothstep(0.12, 0.45, fwidth(lx.div(4))));
    const grid = line.mul(aa).mul(0.16);
    const falloffTex = this.materials.tex('T_LCDBacklightFalloff');
    const nx = lx.div(136);
    const ny = ly.div(198);
    const falloff = falloffTex
      ? texture(falloffTex, vec2(ny.mul(0.5).add(0.5), float(0.5).sub(nx.mul(0.5)))).r
      : float(1.12).sub(nx.add(1).mul(0.16));
    this.coverageTex.magFilter = THREE.LinearFilter;
    this.coverageTex.minFilter = THREE.LinearFilter;
    this.coverageTex.generateMipmaps = false;
    this.coverageTex.needsUpdate = true;
    const coverUv = vec2(ly.div(4).add(LcdW * 0.5).div(LcdW), float(LcdH * 0.5).sub(lx.div(4)).div(LcdH));
    const occlusion = texture(this.coverageTex, coverUv).r;
    const edge = color(new THREE.Color(0x7fa650));
    const lit = mix(edge, color(BacklightColor), falloff.mul(1.4).clamp(0, 1));
    const level = mix(float(0.05), float(1), this.backlightU);
    const strength = 90 * EmissiveScale * 0.75;
    material.colorNode = lit.mul(0.55).mul(float(1).sub(grid.mul(1.6))).mul(float(1).sub(occlusion.mul(0.6)));
    material.roughnessNode = float(0.55);
    material.emissiveNode = lit.mul(level).mul(strength).mul(falloff.mul(0.9).add(0.55)).mul(float(1).sub(grid))
      .mul(float(1).sub(occlusion.mul(0.8)));
    // Only a little of the backlight feeds the bloom buffer so the voxel text stays crisp.
    material.mrtNode = mrt({ emissive: emissive.mul(0.12) });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.y = -0.2 * UU;
    plane.receiveShadow = true;
    plane.castShadow = false;
    this.chassis.add(plane);
  }

  private buildKeys(models: (THREE.Object3D | null)[]): void {
    const labels = this.materials.tex('T_KeyLabels');
    const glowTex = this.materials.tex('T_KeyLabels_Glow');
    for (let k = 0; k < PhoneKey.Count; ++k) {
      const glow = uniform(1);
      this.keyGlow.push(glow);
      const material = this.materials.track(new THREE.MeshStandardNodeMaterial());
      const rubber = color(new THREE.Color(0xc9cdd2));
      const fresnel = pow(float(1).sub(dot(normalView, positionViewDirection).abs()), 4).mul(0.12);
      material.colorNode = (labels ? texture(labels).rgb : rubber).add(fresnel);
      material.roughnessNode = float(0.55);
      const mask = glowTex ? texture(glowTex).r.mul(40).add(0.15) : float(0.15);
      material.emissiveNode = color(new THREE.Color(0x8cff50)).mul(mask).mul(glow).mul(EmissiveScale);

      let key = models[k];
      if (key) {
        key.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.material = material;
            mesh.userData.phoneKey = k;
            this.keyMeshes.push(mesh);
          }
        });
      } else {
        const nav = k <= PhoneKey.Down;
        const geometry = this.own(new THREE.CylinderGeometry(0.5, 0.5, 1, 24));
        const mesh = new THREE.Mesh(geometry, material);
        const [x, y, z] = placeholderKey(k);
        mesh.position.copy(ue(x, y, z));
        mesh.scale.set((nav ? 0.55 : 0.8) * 100 * UU, 0.12 * 100 * UU, (nav ? 1.1 : 1.05) * 100 * UU);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.phoneKey = k;
        this.keyMeshes.push(mesh);
        key = mesh;
      }
      this.chassis.add(key);
      this.keys.push(key);
      this.keyBaseY.push(key.position.y);
    }
  }

  private buildLcd(authored: THREE.BufferGeometry | null, quality: number): void {
    // Authored voxel: 0.1 mm cube, pivot bottom centre. Fallback/low: a plain box with the same pivot.
    this.pixelGeometryHigh = authored ? this.own(authored) : null;
    this.pixelGeometryLow = this.own(new THREE.BoxGeometry(UU, UU, UU).translate(0, UU / 2, 0));
    this.pixelAttr.setUsage(THREE.DynamicDrawUsage);
    const material = this.materials.track(new THREE.MeshStandardNodeMaterial());
    const data = instancedDynamicBufferAttribute(this.pixelAttr, 'vec2') as unknown as THREE.Node<'vec2'>;
    const index = data.x;
    const level = data.y;
    const px = mod(index, LcdW);
    const py = floor(index.div(LcdW));
    const offset = vec3(
      float(LcdH * 0.5 - 0.5).sub(py).mul(PixelPitch),
      0,
      px.add(0.5 - LcdW * 0.5).mul(PixelPitch),
    );
    material.positionNode = positionGeometry.mul(vec3(PixelSize / UU, level.mul(PixelHeight / UU), PixelSize / UU)).add(offset);
    material.colorNode = color(new THREE.Color(0x1c2612));
    material.roughnessNode = float(0.45);
    this.lcd = new THREE.InstancedMesh(this.pickPixelGeometry(quality), material, NumPixels);
    this.lcd.count = 0;
    this.lcd.frustumCulled = false;
    this.lcd.castShadow = true;
    this.lcd.receiveShadow = true;
    this.lcd.name = 'LCDPixels';
    this.chassis.add(this.lcd);
  }

  private pickPixelGeometry(quality: number): THREE.BufferGeometry {
    const g = quality >= 1 && this.pixelGeometryHigh ? this.pixelGeometryHigh : this.pixelGeometryLow!;
    return g;
  }

  /** Bevelled voxels from MED up; plain boxes on LOW. */
  setQuality(quality: number): void {
    if (this.lcd) this.lcd.geometry = this.pickPixelGeometry(quality);
  }

  /** Push a new frame to the LCD. Voxels animate toward it (fast springy rise, slow ghosting fall). */
  present(frame: Readonly<Uint8Array>): void {
    this.targets.set(frame);
  }

  pressKey(key: number): void {
    if (key >= 0 && key < PhoneKey.Count) {
      this.keyPress[key] = 1;
      this.keyFlash[key] = 1;
    }
  }

  vibrate(duration: number, strength = 1): void {
    this.vibrateRemaining = Math.max(this.vibrateRemaining, duration);
    this.vibrateStrength = strength;
  }

  setBacklight(target: number): void {
    this.backlightTarget = target;
  }

  get backlightLevel(): number {
    return this.backlight;
  }

  setCover(index: number): void {
    const n = COVER_NAMES.length;
    this.cover = ((index % n) + n) % n;
    const material = this.materials.cover(COVER_NAMES[this.cover]);
    for (const mesh of this.faceplates) mesh.material = material;
  }

  /** Which key (if any) a ray hits. */
  pickKey(raycaster: THREE.Raycaster): number | null {
    const hits = raycaster.intersectObjects(this.keyMeshes, false);
    return hits.length > 0 ? (hits[0].object.userData.phoneKey as number) : null;
  }

  update(dt: number): void {
    this.updateLcd(dt);

    // Keys: dip and flash.
    for (let k = 0; k < this.keys.length; ++k) {
      const key = this.keys[k];
      if (!key) continue;
      if (this.keyPress[k] > 0) {
        this.keyPress[k] = Math.max(0, this.keyPress[k] - dt / 0.18);
        key.position.y = this.keyBaseY[k] - PressTravel * THREE.MathUtils.clamp(this.keyPress[k] * 1.8, 0, 1);
      }
      if (this.keyFlash[k] > 0) this.keyFlash[k] = Math.max(0, this.keyFlash[k] - dt / 0.35);
      this.keyGlow[k].value = this.backlight * (1 + 2.5 * this.keyFlash[k] * this.keyFlash[k]);
    }

    // Backlight.
    this.backlight += (this.backlightTarget - this.backlight) * THREE.MathUtils.clamp(dt * 5, 0, 1);
    this.backlightU.value = this.backlight;
    this.glow.intensity = GlowIntensity * this.backlight;

    // Vibration motor.
    if (this.vibrateRemaining > 0) {
      this.vibrateRemaining -= dt;
      const s = this.vibrateStrength * THREE.MathUtils.clamp(this.vibrateRemaining * 6, 0, 1);
      const r = () => Math.random() * 2 - 1;
      this.chassis.position.set(r() * 3 * UU * s, Math.random() * 0.6 * 3 * UU * s, r() * 3 * UU * s);
      this.chassis.rotation.y = THREE.MathUtils.degToRad(r() * 0.5 * s);
      if (this.vibrateRemaining <= 0) {
        this.chassis.position.set(0, 0, 0);
        this.chassis.rotation.y = 0;
      }
    }
  }

  private updateLcd(delta: number): void {
    const dt = Math.min(delta, 1 / 20);
    const subSteps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / subSteps;
    const decay = Math.exp(-dt / GhostingTime);
    const levels = this.levels;
    const velocities = this.velocities;
    const targets = this.targets;
    const out = this.pixelData;
    let count = 0;
    for (let i = 0; i < NumPixels; ++i) {
      const target = targets[i] / 100;
      let level = levels[i];
      let velocity = velocities[i];
      if (target > 0) {
        if (Math.abs(target - level) > 0.001 || Math.abs(velocity) > 0.001) {
          for (let s = 0; s < subSteps; ++s) {
            velocity += (900 * (target - level) - 26 * velocity) * h;
            level += velocity * h;
          }
          if (Math.abs(target - level) < 0.002 && Math.abs(velocity) < 0.02) {
            level = target;
            velocity = 0;
          }
        }
      } else if (level > 0) {
        velocity = 0;
        level *= decay;
        if (level < 0.02) level = 0;
      }
      levels[i] = level;
      velocities[i] = velocity;
      this.coverage[i] = level >= 1 ? 255 : (level * 255) | 0;
      if (level > 0.01) {
        out[count * 2] = i;
        out[count * 2 + 1] = level;
        ++count;
      }
    }
    this.lcd.count = count;
    this.lcd.visible = count > 0;
    this.pixelAttr.clearUpdateRanges();
    this.pixelAttr.addUpdateRange(0, Math.max(2, count * 2));
    this.pixelAttr.needsUpdate = true;
    this.coverageTex.needsUpdate = true;
  }

  dispose(): void {
    for (const g of this.owned) g.dispose();
    this.owned = [];
    this.lcd?.dispose();
    this.coverageTex.dispose();
  }
}
