import * as THREE from 'three/webgpu';
import type { Assets } from '../core/Assets';
import type { DeskMaterials } from './materials';
import { LightScale } from './Phone';
import { Dust } from './Dust';
import { DeskY, UU, ue, ueYaw } from './space';

// Room layout from Tools/ue/build_level.py (UE units at 100x scale; converted with ue()).
const WallX = 5600;
const WallT = 200;
const WinY = -2500;
const WinSillZ = 1500;

export const PropModels = [
  'SM_Desk', 'SM_CDPlayer', 'SM_CDCase', 'SM_GelPen', 'SM_TopUpCard', 'SM_VirtualPet', 'SM_DeskLamp', 'SM_CRTMonitor', 'SM_Window',
];

export const RoomTextures = [
  'T_DeskWood', 'T_DeskWood_N', 'T_DeskWood_R', 'T_CDArt_A', 'T_CDArt_B', 'T_CDArt_C', 'T_CRTScreen', 'T_NightWindow',
  'T_Poster_A', 'T_Poster_B', 'T_Faceplate_Flakes_M',
];

/** Kelvin -> sRGB colour (Tanner Helland's fit), for the tungsten lamp. */
function kelvin(k: number): THREE.Color {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => THREE.MathUtils.clamp(v, 0, 255) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

/**
 * The desk at 1:40am in 2001: desk slab, props, back wall with posters and a night window, and the lights
 * (warm lamp key with the only shadow map, cool CRT rim, moonlight, the phone adds its own green glow).
 */
export class Room {
  readonly group = new THREE.Group();
  lamp!: THREE.SpotLight;
  dust: Dust | null = null;
  private owned: THREE.BufferGeometry[] = [];
  private envTarget: THREE.RenderTarget | null = null;
  private readonly materials: DeskMaterials;

  constructor(materials: DeskMaterials) {
    this.materials = materials;
    this.group.name = 'Room';
  }

  async load(assets: Assets, renderer: THREE.WebGPURenderer, scene: THREE.Scene, isMobile: boolean): Promise<void> {
    const models = await Promise.all(PropModels.map((name) => assets.model(name)));
    const get = (name: string) => models[PropModels.indexOf(name)];
    const clone = async (name: string) => (await assets.model(name));

    // Desk slab: long side along the player's left-right (UE yaw 90), top at the desk plane.
    const desk = get('SM_Desk');
    if (desk) {
      this.slots(desk);
      this.placeOnDesk(desk, 1500, 0, 90, -300);
      desk.traverse((n) => ((n as THREE.Mesh).castShadow = false));
    } else {
      const slab = new THREE.Mesh(this.own(new THREE.BoxGeometry(0.8, 0.03, 1.6)), this.materials.slot('MI_DeskWood'));
      slab.position.set(0.15, DeskY - 0.015, 0);
      slab.receiveShadow = true;
      this.group.add(slab);
    }

    this.buildWalls();

    const place = (name: string, x: number, y: number, yaw: number, extra = 0) => {
      const obj = get(name);
      if (!obj) return null;
      this.slots(obj);
      this.placeOnDesk(obj, x, y, yaw, extra);
      return obj;
    };
    place('SM_CDPlayer', 900, -2300, 20);
    place('SM_GelPen', -700, 1100, 35);
    place('SM_TopUpCard', -700, -1300, -15);
    place('SM_VirtualPet', 400, 1200, -25);
    // A little stack of CDs, each with its own art.
    const firstCase = get('SM_CDCase');
    if (firstCase) {
      const cases = [firstCase, await clone('SM_CDCase'), await clone('SM_CDCase')];
      const box = new THREE.Box3().setFromObject(firstCase);
      const thickness = (box.max.y - box.min.y) / UU;
      cases.forEach((cd, i) => {
        if (!cd) return;
        const letter = 'ABC'[i];
        cd.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          const slot = (mesh.material as THREE.Material).name;
          mesh.material = this.materials.slot(slot.startsWith('MI_CDArt') ? 'MI_CDArt_' + letter : slot);
        });
        this.placeOnDesk(cd, 1300 + i * 40, 2300 - i * 30, 8 + [-6, 5, 13][i], i * thickness);
      });
    }
    const lampX = 2900;
    const lampY = -3900;
    const lampYaw = THREE.MathUtils.radToDeg(Math.atan2(0 - lampY, 0 - lampX));
    const lampModel = place('SM_DeskLamp', lampX, lampY, lampYaw);
    const crt = place('SM_CRTMonitor', 3100, 5500, 180 - 90 + 15);

    const window = get('SM_Window');
    if (window) {
      this.slots(window);
      window.position.copy(ue(WallX + WallT - 600, WinY, WinSillZ));
      window.rotation.y = ueYaw(90);
      this.group.add(window);
    }

    this.buildLights(lampModel, crt, isMobile);
    this.buildEnvironment(renderer, scene);
  }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.owned.push(geometry);
    return geometry;
  }

  private slots(root: THREE.Object3D): void {
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.materials.slot((mesh.material as THREE.Material).name);
    });
  }

  /** build_level.place_on_desk: bounds centre (XY) on the UE point, bottom resting on the desk. */
  private placeOnDesk(obj: THREE.Object3D, x: number, y: number, yaw: number, zExtra = 0): void {
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, ueYaw(yaw), 0);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    obj.position.set(x * UU - cx, DeskY - box.min.y + zExtra * UU, y * UU - cz);
    this.group.add(obj);
  }

  private buildWalls(): void {
    const wall = this.materials.slot('MI_Wall');
    const unit = this.own(new THREE.BoxGeometry(1, 1, 1));
    const wx = (WallX + WallT * 0.5) * UU;
    const block = (ya: number, yb: number, za: number, zb: number) => {
      const mesh = new THREE.Mesh(unit, wall);
      mesh.position.set(wx, ((za + zb) / 2) * UU, ((ya + yb) / 2) * UU);
      mesh.scale.set(WallT * UU, (zb - za) * UU, (yb - ya) * UU);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    const y0 = -14000, y1 = 14000, z0 = -8000, z1 = 16000;
    const oy0 = WinY - 5700, oy1 = WinY + 5700;
    const oz0 = WinSillZ + 150, oz1 = WinSillZ + 9800;
    block(y0, oy0, z0, z1);
    block(oy1, y1, z0, z1);
    block(oy0, oy1, z0, oz0);
    block(oy0, oy1, oz1, z1);
    const floor = new THREE.Mesh(unit, wall);
    floor.position.copy(ue(1500, 0, -7800));
    floor.scale.set(2, 0.01, 2.8);
    this.group.add(floor);

    // Posters (A2) on the wall, facing into the room.
    const posterGeometry = this.own(flipV(new THREE.PlaneGeometry(0.42, 0.594)));
    for (const [name, y, z, tilt] of [['A', 6400, 5200, 1.5], ['B', -11200, 4400, -2]] as const) {
      const tex = 'T_Poster_' + name;
      const material = this.materials.surface({ map: tex, tint: this.materials.tex(tex) ? [1, 1, 1] : 0x6b5a7a, roughness: 0.55 });
      const poster = new THREE.Mesh(posterGeometry, material);
      poster.position.copy(ue(WallX - 3, y, z));
      poster.rotation.y = -Math.PI / 2;
      poster.rotateZ(THREE.MathUtils.degToRad(tilt));
      poster.receiveShadow = true;
      this.group.add(poster);
    }

    // The night outside: an emissive backdrop just behind the window opening.
    const back = new THREE.Mesh(this.own(flipV(new THREE.PlaneGeometry(1.3, 1.1))), this.materials.slot('MI_NightWindow'));
    back.position.copy(ue(WallX + WallT + 400, WinY, WinSillZ + 5000));
    back.rotation.y = -Math.PI / 2;
    this.group.add(back);
  }

  private buildLights(lampModel: THREE.Object3D | null, crt: THREE.Object3D | null, isMobile: boolean): void {
    const target = new THREE.Vector3(-150 * UU, 0, 0);
    // Desk lamp: warm key, the only shadow caster. Sits just outside the shade mouth, aimed at the phone.
    const head = ue(2213, -2975, -205 + 3340);
    if (lampModel) {
      lampModel.updateMatrixWorld(true);
      const mouth = lampModel.localToWorld(new THREE.Vector3(0.1794, 0.3339, 0));
      const toPhone = target.clone().sub(mouth).normalize();
      head.copy(mouth).addScaledVector(toPhone, 0.006);
    }
    const lamp = new THREE.SpotLight(kelvin(2800), 300000 * LightScale, 2.5, THREE.MathUtils.degToRad(32), 1 - 10 / 32, 2);
    lamp.position.copy(head);
    lamp.target.position.copy(target);
    lamp.castShadow = true;
    const size = isMobile ? 1024 : 2048;
    lamp.shadow.mapSize.set(size, size);
    lamp.shadow.camera.near = 0.08;
    lamp.shadow.camera.far = 1.2;
    lamp.shadow.focus = 0.42;
    lamp.shadow.bias = -0.00004;
    lamp.shadow.normalBias = 0.00015;
    lamp.shadow.radius = 3;
    this.group.add(lamp, lamp.target);
    this.lamp = lamp;
    this.dust = new Dust(head, target, isMobile ? 100 : 220);
    this.group.add(this.dust.sprite);

    // CRT: cool blue rim from behind-right, emitted from the tube face.
    const crtFace = ue(2600, 1550, -205 + 1900);
    if (crt) {
      crt.updateMatrixWorld(true);
      crtFace.copy(crt.localToWorld(new THREE.Vector3(0, 0.25, 0.215)));
    }
    const rim = new THREE.SpotLight(0x5e8bff, 60000 * LightScale * 2.2, 2, THREE.MathUtils.degToRad(70), 1, 2);
    rim.position.copy(crtFace);
    rim.target.position.copy(ue(-100, 0, 0));
    this.group.add(rim, rim.target);

    // Moonlight through the window (a dim cool directional light stands in for the rect light).
    const moon = new THREE.DirectionalLight(0x8fa6ff, 0.05);
    moon.position.copy(ue(WallX - 1800, WinY, WinSillZ + 5000));
    moon.target.position.copy(ue(0, -600, -205));
    this.group.add(moon, moon.target);

    // Lumen's bounce light, roughly: a very dim warm-from-below / cool-from-above fill.
    this.group.add(new THREE.HemisphereLight(0x1a2238, 0x3a2412, 0.25));
  }

  /** A tiny emissive "room" baked to a PMREM so glossy plastic and chrome have something to reflect. */
  private buildEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene): void {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x07080c);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const quad = (col: number, strength: number, pos: [number, number, number], scale: [number, number, number]) => {
      const m = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(col).multiplyScalar(strength) });
      const mesh = new THREE.Mesh(box, m);
      mesh.position.set(...pos);
      mesh.scale.set(...scale);
      env.add(mesh);
      return m;
    };
    const mats = [
      quad(0xffa860, 6, [3.5, 6, -4.5], [1.2, 1.2, 1.2]), // lamp
      quad(0x5e8bff, 2.2, [5, 2.5, 7], [0.4, 3, 3.5]), // CRT
      quad(0x3a4a7a, 1.2, [9, 6, -3], [0.2, 7, 9]), // window
      quad(0x2a1a10, 0.8, [0, -3, 0], [30, 0.2, 30]), // desk bounce
      quad(0x12141c, 1, [-12, 4, 0], [0.2, 16, 30]), // room behind the camera
    ];
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      this.envTarget = pmrem.fromScene(env, 0.04, 0.1, 50);
      scene.environment = this.envTarget.texture;
      scene.environmentIntensity = 0.35;
    } catch (error) {
      console.warn('desk environment failed', error);
    } finally {
      pmrem.dispose();
      box.dispose();
      for (const m of mats) m.dispose();
    }
  }

  dispose(): void {
    for (const g of this.owned) g.dispose();
    this.owned = [];
    this.envTarget?.dispose();
    this.lamp?.shadow.dispose();
    this.dust?.dispose();
  }
}

function flipV(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; ++i) uv.setY(i, 1 - uv.getY(i));
  return geometry;
}
