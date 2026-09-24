import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive, uniform, mix, vec4, renderOutput } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

/** Look parameters a scene hands to the post chain; blended over time by the engine. */
export interface PostSettings {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  exposure: number;
}

export const DefaultPost: PostSettings = { bloomStrength: 0.6, bloomRadius: 0.35, bloomThreshold: 0.1, exposure: 1.0 };

export type Quality = 0 | 1 | 2 | 3;
export const QualityNames = ['LOW', 'MED', 'HIGH', 'EPIC'] as const;

/**
 * Owns the WebGPU renderer (WebGL 2 fallback), the post chain and the frame loop.
 * Post chain: scene pass (colour + emissive MRT) -> selective bloom on emissive -> exposure -> fade -> FXAA.
 */
export class Engine {
  readonly renderer: THREE.WebGPURenderer;
  readonly canvas: HTMLCanvasElement;
  readonly isMobile: boolean;
  quality: Quality;

  private pipeline: THREE.RenderPipeline;
  private scene: THREE.Scene = new THREE.Scene();
  private camera: THREE.Camera = new THREE.PerspectiveCamera();
  private readonly bloomStrength = uniform(DefaultPost.bloomStrength);
  private readonly bloomRadius = uniform(DefaultPost.bloomRadius);
  private readonly bloomThreshold = uniform(DefaultPost.bloomThreshold);
  private readonly exposure = uniform(DefaultPost.exposure);
  private readonly fadeAmount = uniform(0);
  private readonly fadeColor = uniform(new THREE.Vector3(0, 0, 0));
  private post: PostSettings = { ...DefaultPost };
  private postTarget: PostSettings = { ...DefaultPost };
  private postBlendRate = 0;
  private resizeObserver: ResizeObserver;
  private frameCallback: ((dt: number, time: number) => void) | null = null;
  private lastTime = -1;
  /** Frame times (ms) for the perf overlay and adaptive quality. */
  readonly frameTimes: number[] = [];

  static async create(canvas: HTMLCanvasElement, quality?: Quality): Promise<Engine> {
    const forceWebGL = new URLSearchParams(location.search).has('webgl');
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL, powerPreference: 'high-performance' });
    await renderer.init();
    return new Engine(canvas, renderer, quality);
  }

  private constructor(canvas: HTMLCanvasElement, renderer: THREE.WebGPURenderer, quality?: Quality) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
    this.quality = quality ?? (this.isMobile ? 1 : 2);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.rebuildPipeline();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  get backendName(): string {
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean };
    return backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  }

  /** Point the engine at a scene/camera pair (rebuilds the post chain). */
  setView(scene: THREE.Scene, camera: THREE.Camera): void {
    if (scene === this.scene && camera === this.camera) return;
    this.scene = scene;
    this.camera = camera;
    this.rebuildPipeline();
    this.resize();
  }

  /** Blend post settings towards a target over `seconds` (0 = snap). */
  setPost(settings: Partial<PostSettings>, seconds = 0): void {
    this.postTarget = { ...this.postTarget, ...settings };
    if (seconds <= 0) {
      this.post = { ...this.postTarget };
      this.postBlendRate = 0;
      this.applyPost();
    } else {
      this.postBlendRate = 1 / seconds;
    }
  }

  /** Full-screen fade used by transitions (0 = clear, 1 = solid colour). */
  setFade(amount: number, color?: THREE.ColorRepresentation): void {
    this.fadeAmount.value = THREE.MathUtils.clamp(amount, 0, 1);
    if (color !== undefined) {
      const srgb = new THREE.Color(color).convertLinearToSRGB();
      this.fadeColor.value.set(srgb.r, srgb.g, srgb.b);
    }
  }

  get fade(): number {
    return this.fadeAmount.value as number;
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    this.renderer.shadowMap.enabled = quality >= 1;
    this.rebuildPipeline();
    this.resize();
  }

  start(callback: (dt: number, time: number) => void): void {
    this.frameCallback = callback;
    void this.renderer.setAnimationLoop((time: number) => this.tick(time / 1000));
  }

  private tick(time: number): void {
    const dt = this.lastTime < 0 ? 1 / 60 : Math.min(time - this.lastTime, 0.1);
    this.lastTime = time;
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    if (this.postBlendRate > 0) {
      const k = Math.min(1, dt * this.postBlendRate * 3);
      for (const key of Object.keys(this.post) as (keyof PostSettings)[]) {
        this.post[key] += (this.postTarget[key] - this.post[key]) * k;
      }
      this.applyPost();
    }
    this.frameCallback?.(dt, time);
    this.pipeline.render();
  }

  private applyPost(): void {
    this.bloomStrength.value = this.post.bloomStrength;
    this.bloomRadius.value = this.post.bloomRadius;
    this.bloomThreshold.value = this.post.bloomThreshold;
    this.exposure.value = this.post.exposure;
    this.renderer.toneMappingExposure = this.post.exposure;
  }

  private rebuildPipeline(): void {
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive }));
    const color = scenePass.getTextureNode('output');
    const glow = this.quality >= 1 ? bloom(scenePass.getTextureNode('emissive'), 1, 0.35, 0) : null;
    if (glow) {
      glow.strength = this.bloomStrength;
      glow.radius = this.bloomRadius;
      glow.threshold = this.bloomThreshold;
    }
    const result = glow ? color.add(glow) : color.mul(1);
    // Tone map + sRGB first, then fade in display space (so a fade to the LCD green is exactly that green), then FXAA.
    const toned = renderOutput(result);
    const faded = vec4(mix(toned.rgb, this.fadeColor, this.fadeAmount), 1);
    this.pipeline.outputNode = this.quality >= 1 ? fxaa(faded) : faded;
    this.pipeline.outputColorTransform = false;
    this.pipeline.needsUpdate = true;
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const maxRatio = [1, 1.25, 1.75, 2][this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    this.renderer.setSize(width, height, false);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = width / Math.max(1, height);
      this.camera.updateProjectionMatrix();
    }
  }

  get aspect(): number {
    return (this.canvas.clientWidth || 1) / Math.max(1, this.canvas.clientHeight || 1);
  }
}
