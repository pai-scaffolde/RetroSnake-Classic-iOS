import * as THREE from 'three/webgpu';
import { IntroSeconds, smoothstep01 } from './constants';

export type CameraMode = 'intro' | 'chase' | 'classic' | 'death';

export interface CameraInput {
  mode: CameraMode;
  classic: boolean;
  head: THREE.Vector3;
  /** Snake heading yaw (forward = (cos, 0, -sin)). */
  yaw: number;
  stateTime: number;
  /** 0..1 era-wave progress while shifting, else -1. */
  shift: number;
  aspect: number;
}

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _loc = new THREE.Vector3();
const _look = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
/** Chase look-at points stay this far inside the board (m). */
const LookLimit = 19;

/** Horizontal FOV (radians) of a focal length on the UE cine camera's 36 mm filmback. */
function hfovFor(focal: number): number {
  return 2 * Math.atan(18 / focal);
}

/**
 * The arena camera (AArenaPlayerController::UpdateCamera): a 28 mm chase camera 15 m behind and 10 m above
 * the head looking 11 m ahead, a long-lens classic top-down view, the intro swoop down from straight above,
 * a crane-up during era shifts and the death pull-back orbit. Portrait screens get a taller, pulled-back framing.
 *
 * The camera eases its position and its look-at point (not its angles), so while it travels between framings
 * it always looks at something on the board.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private loc = new THREE.Vector3();
  private look = new THREE.Vector3();
  private focal = 28;
  private yaw = 0;
  private viewYaw = 0;
  private initialised = false;
  shake = 0;
  private time = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  snap(): void {
    this.initialised = false;
  }

  update(input: CameraInput, dt: number): void {
    this.time += dt;
    const { head, aspect } = input;
    // 0 on landscape, 1 on a tall phone.
    const portrait = THREE.MathUtils.clamp((1.25 - aspect) / 0.75, 0, 1);

    // Chase yaw trails the snake's heading, faster the further behind it is.
    let delta = input.yaw - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    if (!this.initialised) this.yaw = input.yaw;
    else {
      const step = (THREE.MathUtils.degToRad(200) + Math.abs(delta) * 3.5) * dt;
      this.yaw += Math.abs(delta) <= step ? delta : Math.sign(delta) * step;
    }
    _fwd.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // Chase: behind and above; the head sits ~60 % down the frame with the horizon near the top.
    const back = THREE.MathUtils.lerp(15, 17.5, portrait);
    const height = THREE.MathUtils.lerp(10, 15.5, portrait);
    const ahead = THREE.MathUtils.lerp(11, 7, portrait);
    _loc.copy(head).addScaledVector(_fwd, -back).addScaledVector(_up, height);
    _look.copy(head).addScaledVector(_fwd, ahead);
    // Near the edge, keep looking at the board rather than out over the void.
    _look.x = THREE.MathUtils.clamp(_look.x, -LookLimit, LookLimit);
    _look.z = THREE.MathUtils.clamp(_look.z, -LookLimit, LookLimit);
    let focal = 28;
    let speed = 6;
    let vfov = 0;

    if (input.classic) {
      // Far and long-lens so every cell reads the same size; arrows are absolute like on the phone.
      const land = 2 * Math.atan(10.125 / 50);
      const vf = THREE.MathUtils.lerp(land, THREE.MathUtils.degToRad(40), portrait);
      const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
      const dist = Math.max(25.5 / Math.tan(vf / 2), 26 / Math.tan(hf / 2));
      _loc.set(0, 110, 35).normalize().multiplyScalar(dist);
      _look.set(0, 0, 0);
      vfov = vf;
      speed = 3.5;
      focal = 50;
    }

    if (input.mode === 'intro') {
      // From straight above the snake (like the phone screen we dived through) down behind it. Starting a hair
      // south of vertical keeps screen-up = board Up (-Z), like the phone.
      const a = smoothstep01(input.stateTime / IntroSeconds);
      _loc.copy(_a.set(head.x, head.y + 90, head.z + 0.05).lerp(_loc, a));
      _look.copy(_b.copy(head).lerp(_look, a));
      focal = THREE.MathUtils.lerp(35, focal, a);
      speed = 0;
    } else if (input.mode === 'death') {
      // Pull back and orbit the crash site.
      const pull = smoothstep01(input.stateTime / 0.6);
      const orbit = this.yaw + Math.PI + THREE.MathUtils.degToRad(input.stateTime * 30);
      const dist = THREE.MathUtils.lerp(15, 24, pull) * (1 + portrait * 0.3);
      const up = THREE.MathUtils.lerp(10, 17, pull) * (1 + portrait * 0.3);
      _loc.set(head.x + Math.cos(orbit) * dist, head.y + up, head.z - Math.sin(orbit) * dist);
      _look.copy(head);
      focal = 28;
      speed = 3;
      vfov = 0;
    } else if (input.shift >= 0 && !input.classic) {
      // Crane up so the era wave is seen rolling across the whole board.
      const p = input.shift;
      const w = smoothstep01(Math.min(p / 0.25, (1 - p) / 0.2));
      _loc.lerp(_a.copy(head).addScaledVector(_fwd, -18).addScaledVector(_up, 26), w);
      _look.lerp(_b.copy(head).addScaledVector(_fwd, 3), w);
      speed = 4;
    }

    if (!this.initialised || speed <= 0) {
      this.loc.copy(_loc);
      this.look.copy(_look);
      this.focal = focal;
      this.initialised = true;
    } else {
      this.loc.lerp(_loc, Math.min(1, dt * speed));
      this.look.lerp(_look, Math.min(1, dt * speed * 1.3));
      this.focal += (focal - this.focal) * Math.min(1, dt * 3);
    }

    // Field of view: keep the UE horizontal FOV on landscape; on portrait widen vertically instead.
    const cam = this.camera;
    let v = vfov;
    if (v <= 0) {
      const landscape = 2 * Math.atan(Math.tan(hfovFor(this.focal) / 2) / Math.max(aspect, 1e-3));
      const tall = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(66, 70, (this.focal - 28) / 7));
      v = THREE.MathUtils.lerp(Math.min(landscape, THREE.MathUtils.degToRad(80)), tall, portrait);
    }
    cam.fov = THREE.MathUtils.radToDeg(v);
    cam.aspect = aspect;
    cam.updateProjectionMatrix();

    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = 0.4 * this.shake * this.shake;
    const t = this.time;
    cam.position.set(this.loc.x + s * noise(t * 23), this.loc.y + s * noise(t * 19 + 5), this.loc.z + s * noise(t * 29 + 9));
    // Aim as yaw/pitch (no roll); keep the last yaw when looking straight down.
    const dx = this.look.x - this.loc.x;
    const dy = this.look.y - this.loc.y;
    const dz = this.look.z - this.loc.z;
    const flat = Math.hypot(dx, dz);
    if (flat > 1e-4) this.viewYaw = Math.atan2(-dx, -dz);
    cam.quaternion.setFromEuler(_euler.set(Math.atan2(dy, flat), this.viewYaw, 0, 'YXZ'));
    cam.updateMatrixWorld();
  }
}

/** Cheap smooth 1D noise in -1..1. */
function noise(x: number): number {
  return (Math.sin(x) * 0.6 + Math.sin(x * 2.17 + 1.3) * 0.3 + Math.sin(x * 4.31 + 2.1) * 0.1) * 1.1;
}
