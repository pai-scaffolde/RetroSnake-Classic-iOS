import * as THREE from 'three/webgpu';
import { densityFogFactor, fog } from 'three/tsl';
import type { Engine } from '../core/Engine';
import { EraLooks, NumEras, type EraLook } from './constants';
import type { ArenaMaterials } from './materials';
import { createSkyDome, createSkyMaterial, createSkyParams, type SkyParams } from './Sky';
import { uColor, uFloat } from './tsl';

/** The lighting/grade blend finishes about when the wave reaches the board centre, so light leads the wave. */
const EnvBlendSeconds = 1.0;

/** Blend two looks (smoothstepped t) into `out`. */
function blendLook(a: EraLook, b: EraLook, t: number, out: EraLook): EraLook {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, t);
  out.sunIntensity = lerp(a.sunIntensity, b.sunIntensity);
  out.sunDir.copy(a.sunDir).lerp(b.sunDir, t).normalize();
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  out.hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity);
  out.envIntensity = lerp(a.envIntensity, b.envIntensity);
  out.fogColor.copy(a.fogColor).lerp(b.fogColor, t);
  out.fogDensity = lerp(a.fogDensity, b.fogDensity);
  out.exposure = lerp(a.exposure, b.exposure);
  out.bloomStrength = lerp(a.bloomStrength, b.bloomStrength);
  out.bloomRadius = lerp(a.bloomRadius, b.bloomRadius);
  out.bloomThreshold = lerp(a.bloomThreshold, b.bloomThreshold);
  out.foodLightColor.copy(a.foodLightColor).lerp(b.foodLightColor, t);
  out.foodLightIntensity = lerp(a.foodLightIntensity, b.foodLightIntensity);
  out.accent.copy(a.accent).lerp(b.accent, t);
  return out;
}

function cloneLook(l: EraLook): EraLook {
  return {
    ...l,
    sunColor: l.sunColor.clone(),
    sunDir: l.sunDir.clone(),
    hemiSky: l.hemiSky.clone(),
    hemiGround: l.hemiGround.clone(),
    fogColor: l.fogColor.clone(),
    foodLightColor: l.foodLightColor.clone(),
    accent: l.accent.clone(),
  };
}

/** Per-era extras that are not part of the UE look struct. */
const RingGlow = [0, 1.2, 1.8];
const Ember = ['#E6FF9A', '#FFC060', '#FF5AD8'].map((h) => new THREE.Color(h));
const EyeGlow = ['#E8A020', '#E8A020', '#35F4FF'].map((h) => new THREE.Color(h));
const BaseColor = ['#141C0C', '#1E2A10', '#07040E'].map((h) => new THREE.Color(h));

/**
 * Sun, sky light, fog, sky dome, reflections and the post grade for the three eras, blended continuously
 * (ASnakeArena::UpdateEnvironment). Reflections come from one PMREM target re-rendered from the sky.
 */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: SkyParams;
  readonly skyDome: THREE.Mesh;
  envEra = 0;
  targetEra = 0;
  private look: EraLook = cloneLook(EraLooks[0]);
  private fogColor = uColor(new THREE.Color());
  private fogDensity = uFloat(0);
  private scene: THREE.Scene;
  private engine: Engine;
  private materials: ArenaMaterials;
  private foodLight: THREE.PointLight | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky: SkyParams;
  private envTarget: THREE.RenderTarget | null = null;
  private envCapturedEra = -1;
  private framesSinceCapture = 0;
  private envSize: number;

  constructor(scene: THREE.Scene, engine: Engine, materials: ArenaMaterials, noise: THREE.Texture, synthSun: THREE.Texture | null) {
    this.scene = scene;
    this.engine = engine;
    this.materials = materials;
    const q = engine.quality;
    this.envSize = q >= 2 ? 256 : 128;

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = q >= 1;
    const size = [512, 1024, 2048, 4096][q];
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -30;
    cam.right = cam.top = 30;
    cam.near = 1;
    cam.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.sky = createSkyParams();
    this.skyDome = createSkyDome(createSkyMaterial(this.sky, { noise, synthSun }, q));
    scene.add(this.skyDome);

    scene.fogNode = fog(this.fogColor, densityFogFactor(this.fogDensity));

    // A separate sky for capturing reflections (its era is set per capture).
    this.envSky = createSkyParams();
    this.envScene.add(createSkyDome(createSkyMaterial(this.envSky, { noise, synthSun }, 1), 1000));
    this.pmrem = new THREE.PMREMGenerator(engine.renderer as unknown as THREE.WebGPURenderer);
  }

  setFoodLight(light: THREE.PointLight): void {
    this.foodLight = light;
  }

  /** Re-render the reflection probe from the sky at a (possibly fractional) era. */
  private capture(era: number): void {
    this.envSky.era.value = era;
    this.envSky.sunDir.value.copy(EraLooks[1].sunDir);
    this.envSky.gridDrop.value = Math.max(0, 2 - era) * 400;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000, { size: this.envSize, renderTarget: this.envTarget ?? undefined });
    if (this.scene.environment !== this.envTarget.texture) this.scene.environment = this.envTarget.texture;
    this.envCapturedEra = era;
    this.framesSinceCapture = 0;
  }

  setEraImmediate(era: number): void {
    this.envEra = this.targetEra = era;
    this.apply();
    this.capture(era);
  }

  startShift(era: number): void {
    this.targetEra = era;
  }

  /** Keep the sky dome centred on the camera. */
  follow(cameraPos: THREE.Vector3): void {
    this.skyDome.position.copy(cameraPos);
  }

  setOverhead(classic: boolean, dt: number): void {
    const target = classic && this.engine.aspect < 0.8 && this.envEra < 0.5 ? 1 : 0;
    const current = this.sky.overhead.value as number;
    const next = current + (target - current) * Math.min(1, dt * 5);
    this.sky.overhead.value = next;
    this.materials.overhead.value = next;
  }

  update(dt: number): void {
    ++this.framesSinceCapture;
    if (this.envEra !== this.targetEra) {
      const step = dt / EnvBlendSeconds;
      this.envEra = this.envEra < this.targetEra ? Math.min(this.targetEra, this.envEra + step) : Math.max(this.targetEra, this.envEra - step);
      this.apply();
      // Refresh reflections a few times a second while the sky changes (mid-way only on low quality).
      const every = this.engine.quality >= 2 ? 6 : 1000;
      const crossedMid = Math.abs(Math.round(this.envEra) - this.envCapturedEra) >= 1;
      if (this.framesSinceCapture >= every || crossedMid) this.capture(this.envEra);
      if (this.envEra === this.targetEra) this.capture(this.targetEra);
    }
  }

  private apply(): void {
    const lo = Math.max(0, Math.min(NumEras - 1, Math.floor(this.envEra)));
    const hi = Math.min(NumEras - 1, lo + 1);
    const raw = this.envEra - lo;
    const t = raw * raw * (3 - 2 * raw);
    const look = blendLook(EraLooks[lo], EraLooks[hi], t, this.look);

    this.sun.color.copy(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.sun.position.copy(look.sunDir).multiplyScalar(120);
    this.hemi.color.copy(look.hemiSky);
    this.hemi.groundColor.copy(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.scene.environmentIntensity = look.envIntensity;
    this.fogColor.value.copy(look.fogColor);
    this.fogDensity.value = look.fogDensity;

    this.sky.era.value = this.envEra;
    this.sky.sunDir.value.copy(EraLooks[1].sunDir);
    // The neon floor rises into view as Future arrives.
    this.sky.gridDrop.value = Math.max(0, 2 - this.envEra) * 400;

    const m = this.materials;
    const mix = (list: THREE.Color[], out: THREE.Color) => out.copy(list[lo]).lerp(list[hi], t);
    m.ringColor.value.copy(look.accent);
    m.ringGlow.value = RingGlow[lo] + (RingGlow[hi] - RingGlow[lo]) * t;
    mix(Ember, m.emberColor.value);
    mix(EyeGlow, m.eyeGlow.value);
    mix(BaseColor, m.baseColor.value);
    m.sunDir.value.copy(look.sunDir);
    m.sunBoost.value = Math.min(1, this.envEra);

    if (this.foodLight) {
      this.foodLight.color.copy(look.foodLightColor);
      this.foodLight.intensity = look.foodLightIntensity * 0.08;
    }
    this.engine.setPost(
      { bloomStrength: look.bloomStrength, bloomRadius: look.bloomRadius, bloomThreshold: look.bloomThreshold, exposure: look.exposure },
      0,
    );
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.skyDome.geometry.dispose();
    this.scene.environment = null;
    this.scene.fogNode = null;
  }
}
