import * as THREE from 'three/webgpu';
import {
  texture, uv, vec2, float, positionWorld, pow, clamp, mix, sin, time, dot, normalMap, color, mrt, emissive, normalView, positionViewDirection,
} from 'three/tsl';
import type { Assets } from '../core/Assets';

/**
 * PBR materials for the desk, built in code from the texture sets (a port of Tools/ue/build_materials.py).
 * Unreal emissive strengths were authored for a fixed EV100 7 exposure; EmissiveScale maps them to the web renderer.
 */
export const EmissiveScale = 0.012;

type Rgb = [number, number, number];

export interface SurfaceParams {
  /** sRGB hex tint or linear RGB triple (UE `W(...)`). */
  tint?: number | Rgb;
  roughness?: number;
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Linear emissive colour (or sRGB hex) and UE strength. */
  emissive?: number | Rgb;
  emissiveStrength?: number;
  /** Fraction of the emissive that feeds the bloom buffer (default 1). */
  bloom?: number;
  map?: string;
  normalMap?: string;
  normalStrength?: number;
  roughnessMap?: string;
  tiling?: number;
  /** Planar world-space UVs (desk wood) with this tile size in metres. */
  worldTile?: number;
  opacity?: number;
  flakes?: { amount: number; color: Rgb; tiling: number };
  sss?: { color: number | Rgb; amount: number };
  side?: THREE.Side;
}

function toColor(c: number | Rgb): THREE.Color {
  return typeof c === 'number' ? new THREE.Color(c) : new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
}

export class DeskMaterials {
  private cache = new Map<string, THREE.Material>();
  private owned: THREE.Material[] = [];
  private assets: Assets;

  constructor(assets: Assets) {
    this.assets = assets;
  }

  tex(name: string): THREE.Texture | null {
    return this.assets.texture(name);
  }

  track<T extends THREE.Material>(material: T): T {
    this.owned.push(material);
    return material;
  }

  /** A generic lit surface (M_Surface / M_Faceplate / M_Glass in the Unreal build). */
  surface(p: SurfaceParams): THREE.MeshPhysicalNodeMaterial | THREE.MeshStandardNodeMaterial {
    const physical = (p.clearcoat ?? 0) > 0 || p.opacity !== undefined;
    const m = physical ? new THREE.MeshPhysicalNodeMaterial() : new THREE.MeshStandardNodeMaterial();
    const tint = toColor(p.tint ?? [1, 1, 1]);
    const tiling = p.tiling ?? 1;
    const uvNode = p.worldTile ? vec2(positionWorld.z, positionWorld.x).div(p.worldTile) : uv().mul(tiling);
    const base = p.map ? this.tex(p.map) : null;
    let baseNode = base ? texture(base, uvNode).rgb.mul(color(tint)) : color(tint);
    const rough = p.roughnessMap ? this.tex(p.roughnessMap) : null;
    let roughNode = rough ? texture(rough, uvNode).r.mul(p.roughness ?? 0.5) : float(p.roughness ?? 0.5);
    let metalNode: THREE.Node<'float'> = float(p.metalness ?? 0);
    if (p.flakes) {
      const flakeTex = this.tex('T_Faceplate_Flakes_M');
      if (flakeTex) {
        const flake = pow(clamp(texture(flakeTex, uv().mul(p.flakes.tiling)).r, 0, 1), 3).mul(p.flakes.amount);
        baseNode = mix(baseNode, color(toColor(p.flakes.color)), flake.mul(0.5));
        metalNode = mix(metalNode, float(1), flake.mul(0.6));
        roughNode = mix(roughNode, float(0.15), flake);
      }
    }
    m.colorNode = baseNode;
    m.roughnessNode = roughNode;
    m.metalnessNode = metalNode;
    const normal = p.normalMap ? this.tex(p.normalMap) : null;
    if (normal) {
      const s = p.normalStrength ?? 1;
      m.normalNode = normalMap(texture(normal, uvNode), vec2(s, -s));
    }
    let emissiveNode = null;
    if (p.emissive !== undefined && (p.emissiveStrength ?? 0) > 0) {
      emissiveNode = color(toColor(p.emissive)).mul((p.emissiveStrength ?? 0) * EmissiveScale);
    }
    if (p.sss) {
      const view = dot(normalView, positionViewDirection).abs();
      const fres = pow(float(1).sub(view), 2.5);
      const sss = color(toColor(p.sss.color)).mul(p.sss.amount).mul(fres.add(0.35));
      emissiveNode = emissiveNode ? emissiveNode.add(sss) : sss;
    }
    if (emissiveNode) {
      m.emissiveNode = emissiveNode;
      if (p.bloom !== undefined && p.bloom !== 1) m.mrtNode = mrt({ emissive: emissive.mul(p.bloom) });
    }
    if (m instanceof THREE.MeshPhysicalNodeMaterial) {
      m.clearcoat = p.clearcoat ?? 0;
      m.clearcoatRoughness = p.clearcoatRoughness ?? 0.1;
      if (p.opacity !== undefined) {
        m.transparent = true;
        m.opacity = p.opacity;
        m.depthWrite = false;
        m.specularIntensity = 1;
      }
    }
    if (p.side !== undefined) m.side = p.side;
    return this.track(m);
  }

  /** Emissive screens (CRT, night window): texture x colour x strength with scanlines and a vignette. */
  screen(texName: string, fallback: number, strength: number, scanlines: number, scanCount: number, vignette: number, flicker: number): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    const t = this.tex(texName);
    const uvn = uv();
    const col = t ? texture(t, uvn).rgb : color(new THREE.Color(fallback));
    const lines = sin(uvn.y.mul(scanCount * Math.PI * 2)).mul(0.5).add(0.5);
    const scan = float(1).sub(lines.mul(scanlines));
    const centred = uvn.sub(0.5);
    const vig = float(1).sub(clamp(dot(centred, centred).mul(4).sub(0.25), 0, 1).mul(vignette));
    const flick = float(1).add(sin(time.mul(7.3)).mul(flicker));
    m.colorNode = col.mul(0.03);
    m.roughnessNode = float(0.08);
    m.emissiveNode = col.mul(strength * EmissiveScale).mul(scan).mul(vig).mul(flick);
    return this.track(m);
  }

  /** Material for a glTF primitive, by its slot name (build_materials.py instances). */
  slot(name: string): THREE.Material {
    let m = this.cache.get(name);
    if (!m) {
      m = this.createSlot(name);
      m.name = name;
      this.cache.set(name, m);
    }
    return m;
  }

  private createSlot(name: string): THREE.Material {
    const S = (p: SurfaceParams) => this.surface(p);
    const glass = (tint: number | Rgb, opacity: number, roughness: number) => S({ tint, opacity, roughness, clearcoat: 0 });
    switch (name) {
      case 'MI_DeskWood':
        return S({ map: 'T_DeskWood', normalMap: 'T_DeskWood_N', roughnessMap: 'T_DeskWood_R', worldTile: 0.55,
          tint: this.tex('T_DeskWood') ? [0.62, 0.58, 0.55] : 0x6a5238, roughness: 0.7, normalStrength: 0.45 });
      case 'MI_CDPlayer_Body': return S({ tint: 0xa9aeb8, metalness: 0.55, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.1 });
      case 'MI_CDPlayer_Window': return glass(0x1c2026, 0.55, 0.04);
      case 'MI_CD_Disc': return S({ tint: 0xd4d8e2, metalness: 1, roughness: 0.1 });
      case 'MI_CDPlayer_LCD': return S({ tint: 0x3a4452, roughness: 0.25, emissive: [0.25, 0.55, 1], emissiveStrength: 3 });
      case 'MI_Prop_RubberBlack': return S({ tint: 0x131313, roughness: 0.8 });
      case 'MI_Prop_Chrome': return S({ tint: 0xd2d4d8, metalness: 1, roughness: 0.14 });
      case 'MI_CDCase_Tray': return S({ tint: 0x0e0e10, roughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.05 });
      case 'MI_CDCase_Clear': return glass([0.7, 0.72, 0.75], 0.12, 0.03);
      case 'MI_CDArt_A':
      case 'MI_CDArt_B':
      case 'MI_CDArt_C': {
        const t = 'T_CDArt_' + name.slice(-1);
        return S({ map: t, tint: this.tex(t) ? [1, 1, 1] : 0x7a7a90, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.05 });
      }
      case 'MI_GelPen_Barrel': return glass([0.45, 0.3, 0.75], 0.3, 0.05);
      case 'MI_GelPen_Cap': return glass([0.35, 0.2, 0.7], 0.5, 0.06);
      case 'MI_GelPen_Ink':
        return S({ tint: 0x5b1e9a, roughness: 0.3, clearcoat: 1, flakes: { amount: 1, color: [1, 0.8, 1], tiling: 8 } });
      case 'MI_CRT_Plastic': return S({ tint: 0xc4ba9f, roughness: 0.55 });
      case 'MI_CRTScreen': return this.screen('T_CRTScreen', 0x3a6bd8, 22, 0.35, 260, 0.6, 0.015);
      case 'MI_CRT_LED': return S({ tint: 0x063006, roughness: 0.2, emissive: [0.2, 1, 0.1], emissiveStrength: 90 });
      case 'MI_Lamp_Paint': return S({ tint: 0x6e1a1a, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12 });
      case 'MI_Lamp_ShadeInner': return S({ tint: 0xdcd6c8, roughness: 0.4, emissive: [1, 0.6, 0.3], emissiveStrength: 30 });
      case 'MI_LampBulb': return S({ tint: [1, 0.9, 0.75], roughness: 0.3, emissive: [1, 0.62, 0.3], emissiveStrength: 400 });
      case 'MI_TopUpCard': return S({ tint: 0x2c5fc0, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.1 });
      case 'MI_TopUpCard_Back': return S({ tint: 0xe4e2da, roughness: 0.6 });
      case 'MI_VPet_Shell':
        return S({ tint: 0xd9589a, roughness: 0.25, clearcoat: 1, tiling: 2, flakes: { amount: 0.15, color: [0.8, 0.85, 1], tiling: 9 },
          sss: { color: 0xff8ac0, amount: 0.01 } });
      case 'MI_VPet_LCD': return S({ tint: 0x8c9878, roughness: 0.3 });
      case 'MI_VPet_Button': return S({ tint: 0xefe4cf, roughness: 0.45 });
      case 'MI_WindowFrame': return S({ tint: 0xd6d2c8, roughness: 0.6 });
      case 'MI_NightWindow': return this.screen('T_NightWindow', 0x1a2240, 6, 0, 1, 0.25, 0);
      case 'MI_Phone_Shell': return S({ tint: 0x1a2236, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 });
      case 'MI_Bezel': return S({ tint: 0x0b0c0e, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
      case 'MI_ScreenGlass': return glass([0.01, 0.012, 0.01], 0.06, 0.02);
      case 'MI_Wall': return S({ tint: 0x3b3f4a, roughness: 0.9 });
      default: {
        // Unknown slot: keyword preset like build_materials.material_for_slot.
        const low = name.toLowerCase();
        if (low.includes('chrome') || low.includes('metal')) return S({ tint: 0x9a9ca0, metalness: 1, roughness: 0.28 });
        if (low.includes('glass') || low.includes('clear')) return glass([0.6, 0.65, 0.7], 0.12, 0.03);
        if (low.includes('rubber')) return S({ tint: 0x161616, roughness: 0.75 });
        return S({ tint: 0x6e6e72, roughness: 0.45 });
      }
    }
  }

  /** Faceplate covers (MI_Faceplate_Navy/Flames/Camo/Ice). */
  cover(name: string): THREE.Material {
    const key = 'MI_Faceplate_' + name;
    let m = this.cache.get(key);
    if (m) return m;
    const t = 'T_Faceplate_' + name;
    const has = !!this.tex(t);
    const presets: Record<string, SurfaceParams> = {
      Navy: { tint: has ? [1.35, 1.35, 1.6] : 0x1d2b4f, flakes: { amount: 0.3, color: [0.55, 0.65, 1], tiling: 9 } },
      Flames: { tint: has ? [1, 1, 1] : 0x141414, tiling: 1, flakes: { amount: 0.12, color: [1, 0.7, 0.3], tiling: 9 } },
      Camo: { tint: has ? [1, 1, 1] : 0x5a6270, roughness: 0.45, clearcoatRoughness: 0.18, flakes: { amount: 0.05, color: [0.8, 0.8, 0.8], tiling: 9 } },
      Ice: { tint: has ? [1, 1, 1] : 0x9cc8e8, roughness: 0.3, flakes: { amount: 0.25, color: [0.8, 0.95, 1], tiling: 9 }, sss: { color: 0x7fb8ff, amount: 0.05 } },
    };
    m = this.surface({
      map: t, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.12, tiling: 2.5,
      ...(presets[name] ?? presets.Navy),
    });
    m.name = key;
    this.cache.set(key, m);
    return m;
  }

  dispose(): void {
    for (const m of this.owned) m.dispose();
    this.owned = [];
    this.cache.clear();
  }
}
