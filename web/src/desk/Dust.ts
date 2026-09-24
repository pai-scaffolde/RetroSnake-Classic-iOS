import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, time, sin, vec3, float, uv, smoothstep, color, uniform } from 'three/tsl';

/**
 * Dust hanging in the lamp beam (the Unreal build shows it with volumetric fog): a few hundred soft motes in one
 * instanced sprite draw, drifting on the GPU. Brightest on the beam axis, fading out toward the cone edge.
 */
export class Dust {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly geometryAttrs: THREE.InstancedBufferAttribute[] = [];
  readonly strength = uniform(1);

  constructor(from: THREE.Vector3, to: THREE.Vector3, count: number) {
    const base = new Float32Array(count * 3);
    const params = new Float32Array(count * 4);
    const axis = to.clone().sub(from);
    const length = axis.length();
    axis.normalize();
    const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, axis).normalize();
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const p = new THREE.Vector3();
    for (let i = 0; i < count; ++i) {
      // Mostly in the last half of the beam (around the phone, where the camera looks).
      const t = 0.35 + 0.72 * Math.sqrt(rnd());
      const radius = Math.tan(THREE.MathUtils.degToRad(24)) * length * t * Math.sqrt(rnd());
      const angle = rnd() * Math.PI * 2;
      p.copy(from).addScaledVector(axis, length * t).addScaledVector(side, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius);
      p.y = Math.max(p.y, 0.004 + rnd() * 0.02);
      base.set([p.x, p.y, p.z], i * 3);
      // phase, speed, size (m), on-axis brightness
      const onAxis = 1 - radius / (Math.tan(THREE.MathUtils.degToRad(24)) * length * t + 1e-6);
      params.set([rnd() * 100, 0.05 + rnd() * 0.12, 0.00035 + rnd() * 0.0006, 0.25 + 0.75 * onAxis * onAxis], i * 4);
    }
    const baseAttr = new THREE.InstancedBufferAttribute(base, 3);
    const paramAttr = new THREE.InstancedBufferAttribute(params, 4);
    this.geometryAttrs.push(baseAttr, paramAttr);
    const b = instancedBufferAttribute(baseAttr, 'vec3') as unknown as THREE.Node<'vec3'>;
    const q = instancedBufferAttribute(paramAttr, 'vec4') as unknown as THREE.Node<'vec4'>;
    const t = time.mul(q.y).add(q.x);
    const drift = vec3(sin(t.mul(1.3)).mul(0.004), sin(t.mul(0.7).add(2)).mul(0.003).add(t.mul(0.0004).sin().mul(0.002)), sin(t.mul(0.9).add(4)).mul(0.004));

    const material = new THREE.SpriteNodeMaterial();
    material.positionNode = b.add(drift);
    material.scaleNode = q.z;
    const d = uv().sub(0.5).length();
    const soft = float(1).sub(smoothstep(0.1, 0.5, d));
    // Twinkle as each mote turns in the light.
    const twinkle = sin(t.mul(3.1)).mul(0.35).add(0.65);
    material.colorNode = color(new THREE.Color(1.0, 0.72, 0.45));
    material.opacityNode = soft.mul(q.w).mul(twinkle).mul(this.strength).mul(0.8);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    this.material = material;

    this.sprite = new THREE.Sprite(material);
    this.sprite.count = count;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 3;
  }

  dispose(): void {
    this.material.dispose();
  }
}
