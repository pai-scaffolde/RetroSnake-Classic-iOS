import type * as THREE from 'three/webgpu';
import type { Engine } from './Engine';
import type { Assets } from './Assets';
import type { Audio } from './Audio';
import type { Action, Input, InputSource } from './Input';
import type { SaveData } from '../game/SaveData';

export type SceneName = 'desk' | 'arena';

/** Hand-off between the desk and the arena (the Unreal build's GameInstance fields). */
export interface Session {
  /** The arena run is the AI (attract/autoplay), so it never makes the table. */
  arenaAutopilot: boolean;
  /** Starting arena experience selected in the phone menu (0..2). */
  arenaStartEra: number;
  returningFromArena: boolean;
  lastScore: number;
  lastLength: number;
  lastEra: number;
  lastWasRecord: boolean;
  lastMaze: number;
  lastLevel: number;
  lastAutopilot: boolean;
}

/** URL switches used for local QA and preview. */
export interface Flags {
  scene: SceneName | null;
  maze: string | null;
  autoplay: boolean;
  /** Scripted tour (desk -> dive -> 3 eras -> back) for trailers and QA. */
  demo: boolean;
  qa: boolean;
  fps: boolean;
}

export interface AppContext {
  readonly engine: Engine;
  readonly assets: Assets;
  readonly audio: Audio;
  readonly input: Input;
  readonly save: SaveData;
  readonly session: Session;
  readonly flags: Flags;
  /** Overlay element for HTML HUD/UI; each scene owns one child and removes it on exit. */
  readonly hud: HTMLElement;
  go(scene: SceneName): Promise<void>;
  writeSave(): void;
}

export interface GameScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  /** Load assets and build the scene (behind the loader / a fade). */
  load(): Promise<void>;
  enter(): void;
  update(dt: number, time: number): void;
  onAction(action: Action, source: InputSource): void;
  exit(): void;
  /** The tab lost focus / was hidden: pause gameplay if running. */
  onBlur?(): void;
}

export type SceneFactory = (ctx: AppContext) => GameScene;

export function parseFlags(search: string): Flags {
  const params = new URLSearchParams(search);
  const scene = params.get('scene');
  return {
    scene: scene === 'desk' || scene === 'arena' ? scene : null,
    maze: params.get('maze'),
    autoplay: params.has('autoplay'),
    demo: params.has('demo'),
    qa: params.has('qa'),
    fps: params.has('fps'),
  };
}

export function newSession(): Session {
  return {
    arenaAutopilot: false,
    arenaStartEra: 0,
    returningFromArena: false,
    lastScore: 0,
    lastLength: 0,
    lastEra: 0,
    lastWasRecord: false,
    lastMaze: 0,
    lastLevel: 5,
    lastAutopilot: false,
  };
}
