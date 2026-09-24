import * as THREE from 'three/webgpu';
import { UU, noise1, smoothStep01 } from './space';

/** Cinematic shots (ERetroShot), authored in the phone's screen space like the Unreal director. */
export const Shot = { Attract: 0, Menu: 1, Gameplay: 2, GameOver: 3, Dive: 4 } as const;
export type Shot = (typeof Shot)[keyof typeof Shot];

/** A shot as orbit parameters: blended in this space so pushes and pull-outs stay centred on the subject. */
interface Pose {
  lookAt: THREE.Vector3;
  /** Unit vector from the look-at point toward the camera. */
  dir: THREE.Vector3;
  distance: number;
  /** Vertical field of view, degrees. */
  fov: number;
}

function newPose(): Pose {
  return { lookAt: new THREE.Vector3(), dir: new THREE.Vector3(0, 1, 0), distance: 0.1, fov: 30 };
}

/** UE CineCamera: 36 mm filmback, horizontal FOV from the focal length, authored at 16:9. */
function referenceVerticalFov(focalLength: number): number {
  const halfH = Math.atan(18 / focalLength);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfH) / (16 / 9)));
}

/**
 * Port of ARetroSnakePlayerController's camera: EvaluateShot + SetShot/UpdateCamera blends (quintic smoothstep).
 * Web additions: Hor+ framing at any aspect, and each shot pulls back until its subject fits the screen width,
 * so the LCD stays readable on a 390x844 portrait phone.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.001, 20);
  private shot: Shot = Shot.Attract;
  private current = newPose();
  private from = newPose();
  private target = newPose();
  private blendAlpha = 1;
  private blendDuration = 1;
  /** Gameplay lean toward the snake's head (web units, screen space). */
  readonly drift = new THREE.Vector3();
  private readonly sway = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly up = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private clock = 0;

  get currentShot(): Shot {
    return this.shot;
  }

  /** Snap to a shot (no blend). */
  cut(shot: Shot, clock: number, aspect: number): void {
    this.shot = shot;
    this.clock = clock;
    this.evaluate(shot, clock, aspect, this.current);
    this.blendAlpha = 1;
    this.apply();
  }

  set(shot: Shot, blendTime: number): void {
    if (shot === this.shot && this.blendAlpha >= 1) return;
    this.shot = shot;
    this.copy(this.current, this.from);
    this.blendAlpha = 0;
    this.blendDuration = Math.max(blendTime, 0.01);
  }

  update(dt: number, clock: number, aspect: number, driftTarget: THREE.Vector3): void {
    const k = THREE.MathUtils.clamp(dt * 1.2, 0, 1);
    this.drift.lerp(driftTarget, k);
    this.clock = clock;
    this.evaluate(this.shot, clock, aspect, this.target);
    if (this.blendAlpha < 1) {
      this.blendAlpha = Math.min(1, this.blendAlpha + dt / this.blendDuration);
      const a = smoothStep01(this.blendAlpha);
      const c = this.current;
      c.lookAt.lerpVectors(this.from.lookAt, this.target.lookAt, a);
      c.dir.lerpVectors(this.from.dir, this.target.dir, a).normalize();
      // Exponential in distance: a push-in covers the last millimetres as smoothly as the first centimetres.
      c.distance = Math.exp(THREE.MathUtils.lerp(Math.log(this.from.distance), Math.log(this.target.distance), a));
      c.fov = THREE.MathUtils.lerp(this.from.fov, this.target.fov, a);
    } else {
      this.copy(this.target, this.current);
    }
    this.apply();
  }

  /** 0 at the start of a blend, 1 when settled. */
  get blend(): number {
    return this.blendAlpha;
  }

  private apply(): void {
    const cam = this.camera;
    const c = this.current;
    // A breath of hand-held drift so the shot never feels frozen.
    const t = this.clock;
    this.sway.set(noise1(t * 0.21), noise1(t * 0.13 + 3), noise1(t * 0.17 + 7)).multiplyScalar(c.distance * 0.012);
    this.position.copy(c.lookAt).addScaledVector(c.dir, c.distance).add(this.sway);
    // Looking straight down at the LCD, "up" is the top of the phone (+X), otherwise the world up.
    const steep = THREE.MathUtils.smoothstep(c.dir.y, 0.75, 0.97);
    this.up.set(steep, 1 - steep, 0).normalize();
    this.m.lookAt(this.position, c.lookAt, this.up);
    cam.position.copy(this.position);
    cam.quaternion.setFromRotationMatrix(this.m);
    // Macro framing: keep the near plane a fraction of the subject distance (the dive ends 6 mm from the voxels).
    const near = THREE.MathUtils.clamp(this.current.distance * 0.08, 0.0003, 0.02);
    if (cam.fov !== this.current.fov || cam.near !== near) {
      cam.fov = this.current.fov;
      cam.near = near;
      cam.far = Math.max(8, near * 20000);
      cam.updateProjectionMatrix();
    }
  }

  private copy(a: Pose, b: Pose): void {
    b.lookAt.copy(a.lookAt);
    b.dir.copy(a.dir);
    b.fov = a.fov;
    b.distance = a.distance;
  }

  private evaluate(shot: Shot, clock: number, aspect: number, out: Pose): void {
    // UE screen space (X toward the top of the phone, Y right, Z out of the screen) -> web (x, z, y).
    let lx = 0, ly = 0, lz = 0;
    let dx = 0, dy = 0, dz = 1;
    let distance = 700;
    let focal = 50;
    /** Width (m) that must stay on screen: the phone's face, or the phone plus a little desk. */
    let fitWidth = 0;
    const portrait = THREE.MathUtils.clamp((1.25 - aspect) / 0.7, 0, 1);
    switch (shot) {
      case Shot.Attract: {
        // Low and slow, so the desk's story props sit in the soft background.
        const yaw = THREE.MathUtils.degToRad(14 + 16 * Math.sin(clock * 0.11));
        const elev = THREE.MathUtils.degToRad(22 + 4 * Math.sin(clock * 0.07 + 1) + 10 * portrait);
        lx = -150 - 250 * portrait;
        lz = 120;
        dx = -Math.cos(elev) * Math.cos(yaw);
        dy = -Math.cos(elev) * Math.sin(yaw);
        dz = Math.sin(elev);
        distance = 2500;
        focal = 35;
        fitWidth = 0.085;
        break;
      }
      case Shot.Menu: {
        const tilt = THREE.MathUtils.degToRad(36 - 10 * portrait);
        lx = -110 - 170 * portrait;
        dx = -Math.sin(tilt);
        dz = Math.cos(tilt);
        distance = 1250;
        fitWidth = 0.05;
        break;
      }
      case Shot.Gameplay: {
        const tilt = THREE.MathUtils.degToRad(26);
        lx = this.drift.x / UU;
        ly = this.drift.z / UU;
        dx = -Math.sin(tilt);
        dz = Math.cos(tilt);
        distance = 720;
        fitWidth = 0.043;
        break;
      }
      case Shot.Dive: {
        // Nose right up against the LCD, looking straight in.
        const len = Math.hypot(0.05, 1);
        dx = -0.05 / len;
        dz = 1 / len;
        distance = 60;
        break;
      }
      case Shot.GameOver: {
        const tilt = THREE.MathUtils.degToRad(33);
        const side = 0.12 * (1 - 0.75 * portrait);
        const len = Math.hypot(Math.sin(tilt), side, Math.cos(tilt));
        dx = -Math.sin(tilt) / len;
        dy = side / len;
        dz = Math.cos(tilt) / len;
        distance = 900;
        fitWidth = 0.056;
        break;
      }
    }

    // Hor+: the vertical FOV of the 16:9 master; pull back when the screen is too narrow for the subject.
    const fov = referenceVerticalFov(focal);
    const halfV = THREE.MathUtils.degToRad(fov / 2);
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    let d = distance * UU;
    if (fitWidth > 0) d = Math.max(d, fitWidth / (2 * Math.tan(halfH)));

    out.lookAt.set(lx * UU, lz * UU, ly * UU);
    out.dir.set(dx, dz, dy).normalize();
    out.fov = fov;
    out.distance = d;
  }
}
