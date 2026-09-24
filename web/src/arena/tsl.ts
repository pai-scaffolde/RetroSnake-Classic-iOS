import type * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

/** Typed uniform helpers (the TSL `uniform` overloads are awkward to name directly). */
export const uFloat = (value: number) => uniform(value);
export const uVec3 = (value: THREE.Vector3) => uniform(value);
export const uColor = (value: THREE.Color) => uniform(value);
export type UFloat = ReturnType<typeof uFloat>;
export type UVec3 = ReturnType<typeof uVec3>;
export type UColor = ReturnType<typeof uColor>;
export type N<T extends string = string> = THREE.Node<T>;

/** MeshBasicNodeMaterial honours emissiveNode at runtime (NodeMaterial.setupLighting); the typings only list it on lit materials. */
export function setEmissive(material: THREE.NodeMaterial, node: THREE.Node): void {
  (material as unknown as { emissiveNode: THREE.Node }).emissiveNode = node;
}
