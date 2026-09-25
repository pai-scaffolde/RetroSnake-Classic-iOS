import * as THREE from 'three/webgpu';
import type { AppContext, GameScene } from '../core/App';
import type { Voice } from '../core/Audio';
import type { Action, InputSource } from '../core/Input';
import { nativeHaptic } from '../core/NativeHaptics';
import { ESnakeDir, ESnakeMaze, SnakeEvents, SnakeGame, type IntPoint } from '../game';
import { Board } from './Board';
import { CameraRig } from './CameraRig';
import { BacklightGreen, EraThresholds, IntroSeconds, NumEras, cellX, cellZ } from './constants';
import { Dressing } from './Dressing';
import { Environment } from './Environment';
import { Hud, type HudState, type Popup } from './Hud';
import { ArenaMaterials } from './materials';
import { Models } from './Models';
import { createNoiseTexture } from './noise';
import { Particles } from './Particles';
import { Props } from './Props';
import { Snake, type SnakePose } from './Snake';

type State = 'wait' | 'warmup' | 'intro' | 'playing' | 'paused' | 'dying' | 'gameover';

const MusicVolume = 0.8;
const TouchHintKey = 'retrosnake.arena.tapHint';
const ArenaTextures = [
  'T_LCDTile', 'T_NeonGrid', 'T_SynthSun', 'T_StonePaver_D', 'T_StonePaver_R', 'T_StonePaver_AO', 'T_StonePaver_H', 'T_StonePaver_N',
  'T_Moss_D', 'T_Moss_H', 'T_Moss_N', 'T_Rock_D', 'T_Rock_R', 'T_Rock_AO', 'T_Rock_N', 'T_Grass_D', 'T_Grass_R', 'T_Grass_N',
  'T_SnakeScales_D', 'T_SnakeScales_N', 'T_SnakeScales_R', 'T_SnakeScales_AO', 'T_SnakeScales_Iridescence',
  'T_FruitSkin_D', 'T_FruitSkin_N', 'T_FruitSkin_R', 'T_Scarab_D', 'T_Scarab_N', 'T_Scarab_R',
];
const Cues = [
  'MUS_Era0', 'MUS_Era1', 'MUS_Era2', 'AMB_Wind', 'SFX_Arena_Eat', 'SFX_Arena_Bonus', 'SFX_Arena_Turn', 'SFX_Arena_Die',
  'SFX_EraShift', 'SFX_DiveIn', 'SFX_BonusAppear', 'SFX_MenuSelect',
];

/** Scripted tour (the UE -QAShots timeline): wall-clock seconds after the arena takes over the screen -> action. */
const Tour: [number, string][] = [
  [9.0, 'camera'],
  [12.0, 'camera'],
  [14.0, 'era1'],
  [23.0, 'era2'],
  [33.0, 'camera'],
  [36.5, 'camera'],
  [41.0, 'die'],
];

const SeamAccent = ['#C8F07A', '#FFB84A', '#FF2EC8'];
/** Music files keep the original production names: LCD, neon, island. */
const MusicAssetByEra = [0, 2, 1] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The playable 3D arena (AArenaPlayerController + ASnakeArena + AArenaHUD): Snake on a 24x24 board whose
 * world evolves when a portal is collected: 2001 LCD, present-day island, then neon future.
 */
class ArenaScene implements GameScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.3, 9000);

  private ctx: AppContext;
  private game = new SnakeGame();
  private quality: number;
  private detail: number;
  private models!: Models;
  private materials!: ArenaMaterials;
  private noise!: THREE.DataTexture;
  private board!: Board;
  private snake!: Snake;
  private props!: Props;
  private particles!: Particles;
  private env!: Environment;
  private dressing!: Dressing;
  private rig = new CameraRig(this.camera);
  private hud: Hud | null = null;

  private state: State = 'wait';
  private stateTime = 0;
  private realTime = 0;
  private stepAccumulator = 0;
  private steps = 0;
  private vacated: IntPoint | null = null;
  private era = 0;
  private foodAtLastEraShift = 0;
  private bannerTime = -100;
  private slowMoUntil = 0;
  private classic = false;
  private autopilot = false;
  private scripted = false;
  private tourStart = 0;
  private tourStep = 0;
  private warmupFrame = 0;
  private popups: (Popup & { world: THREE.Vector3 })[] = [];
  private music: (Voice | null)[] = [];
  private wind: Voice | null = null;
  private musicRetry = 0;
  private exiting = false;
  private best = 0;
  private hintShown = false;
  private sawTouch = false;
  private sawKeyboard = false;
  private pendingUploads: THREE.Texture[] = [];
  private readonly hudState: HudState = {
    era: 0, score: 0, length: 0, best: 0, combo: 1, comboRemaining: 0, bonusTimer: 0, bonus: false, demo: false,
    transitionTarget: null,
    state: 'wait', stateTime: 0, classic: false, touch: false, bannerAge: -100, showControlsHint: false,
  };
  private readonly pose: SnakePose = { body: [], vacated: null, alpha: 1, steps: 0, nextDir: null, dir: ESnakeDir.Right };
  private readonly _v = new THREE.Vector3();

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    // QA hook for scripted runs (read from shot.mjs `eval` steps).
    if (ctx.flags.qa || ctx.flags.demo) (window as unknown as { __arena?: unknown }).__arena = this;
    this.quality = ctx.engine.quality;
    this.detail = this.quality;
    for (let i = 0; i < 12; ++i) this.popups.push({ world: new THREE.Vector3(), x: 0, y: 0, visible: false, text: '', combo: 1, age: 9 });
  }

  // ------------------------------------------------------------------ lifecycle

  async load(): Promise<void> {
    const { assets, audio, flags, save, session } = this.ctx;
    const q = this.quality;
    // EPIC uses the authored meshes. HIGH keeps the first simplified LOD;
    // lower tiers use the phone LODs to bound geometry cost.
    this.models = new Models(assets, q >= 3 ? 0 : q >= 2 ? 1 : 2);
    this.noise = createNoiseTexture(q >= 2 ? 256 : 128);
    // Start and track all texture downloads before materials request their live Texture objects.
    const texturesReady = assets.preload([], ArenaTextures);
    this.materials = new ArenaMaterials(assets, this.noise, this.detail, 24 * 24);
    const cuesReady = q >= 2 ? audio.preload(Cues) : Promise.resolve();

    const p = (name: string, max: 0 | 1 | 2 = 2) => this.models.parts(name, max);
    const [tile, voxel, voxelHead, neonBlock, ruinA, ruinB, ruinC, kerb, head, tongue, foodOrb, critter, island, rockA, rockB, rockC, tuft] = await Promise.all([
      p('SM_ArenaTile'), p('SM_Voxel'), p('SM_VoxelHead'), p('SM_NeonBlock'), p('SM_Ruin_A'), p('SM_Ruin_B'), p('SM_Ruin_C'),
      p('SM_BoardKerb'), p('SM_SnakeHead', q >= 2 ? 0 : 1), p('SM_SnakeTongue'), p('SM_FoodOrb'), p('SM_Critter'),
      p('SM_Island', q >= 3 ? 0 : 2), p('SM_FloatingRock_A'), p('SM_FloatingRock_B'), p('SM_FloatingRock_C'), p('SM_GrassTuft'),
    ]);
    const m = this.materials;
    this.board = new Board(m, { tile, voxel, neonBlock, ruins: [ruinA, ruinB, ruinC], kerb });
    const socket = (assets.manifest.models?.SM_SnakeHead as { anchors?: { tongueSocket?: number[] } } | undefined)?.anchors?.tongueSocket;
    this.snake = new Snake(m, { voxel, voxelHead, head, tongue, tongueSocket: new THREE.Vector3(...(socket ?? [1.83, -0.035, 0])) }, this.detail);
    this.props = new Props(m, { voxel, foodOrb, critter });
    const voxelParts = voxel ?? [{ slot: '', geometry: new THREE.BoxGeometry(1, 1, 1) }];
    this.particles = new Particles(voxelParts, m.voxel, m.ember, q >= 2 ? 480 : 260);
    this.dressing = new Dressing(m, this.detail);
    this.dressing.addIsland({ island, rocks: [rockA, rockB, rockC], ruins: [ruinA, ruinB, ruinC], grassTuft: tuft });
    this.env = new Environment(this.scene, this.ctx.engine, m, this.noise, assets.texture('T_SynthSun', false));
    this.env.setFoodLight(this.props.foodLight);
    this.scene.add(this.board.group, this.snake.group, this.props.group, this.particles.group, this.dressing.group);

    // The run: maze from ?maze=Name or the save, level from the save; the AI plays demo/QA/attract runs.
    let maze = save.maze;
    if (flags.maze) {
      for (let i = 0; i < ESnakeMaze.Count; ++i) if (SnakeGame.getMazeName(i).toLowerCase() === flags.maze.toLowerCase()) maze = i;
    }
    this.scripted = flags.demo || flags.qa;
    this.autopilot = this.scripted || flags.autoplay || session.arenaAutopilot;
    this.classic = save.classicCamera && !this.scripted;
    this.game.resetArena(save.level, maze as ESnakeMaze, (Math.random() * 0x7fffffff) | 0);
    this.best = save.topScores[maze] ?? 0;
    // The standalone app always begins in the original voxel world.
    const startEra = 0;
    this.era = startEra;
    this.board.build(this.game, startEra);
    this.env.setEraImmediate(startEra);
    this.dressing.snap(startEra);
    this.updatePose(1);
    this.snake.update(this.pose, 0);
    this.snake.snapHeading();

    // Wait for sounds and (briefly) textures, so the first frames are complete; the rest streams in.
    await Promise.race([Promise.all([texturesReady, cuesReady]), sleep(q >= 2 ? 5000 : 1000)]);
    this.pendingUploads = ArenaTextures
      .map((name) => assets.texture(name)).filter((t): t is THREE.Texture => !!t);
    this.uploadTextures(Infinity);
    if (q < 2) setTimeout(() => { void audio.preload(Cues); }, 0);
  }

  /** Upload loaded textures to the GPU ahead of first use (a 2k texture + mips mid-game is a visible hitch). */
  private uploadTextures(budget: number): void {
    const renderer = this.ctx.engine.renderer;
    for (let i = this.pendingUploads.length - 1; i >= 0 && budget > 0; --i) {
      const texture = this.pendingUploads[i];
      const image = texture.image as { width?: number } | undefined;
      if (!image || !image.width) continue;
      renderer.initTexture(texture);
      this.pendingUploads.splice(i, 1);
      --budget;
    }
  }

  enter(): void {
    const { engine, hud, input } = this.ctx;
    // We arrive through the phone's screen: start under the backlight green.
    engine.setFade(1, BacklightGreen);
    this.hud = new Hud(hud);
    this.hud.onPause = () => this.togglePause();
    this.hud.onCamera = () => this.toggleCamera();
    this.hud.onResume = () => this.state === 'paused' && this.enterState('playing');
    this.hud.onEndRun = () => this.state === 'paused' && this.enterState('dying');
    this.hud.onRetry = () => this.state === 'gameover' && void this.retryRun();
    this.hud.onTurnLeft = () => input.emit('left', 'touch');
    this.hud.onTurnRight = () => input.emit('right', 'touch');
    input.tapZones = false;

    this.startMusic();
    this.state = 'warmup';
    this.warmupFrame = 0;
    this.tourStart = performance.now();
  }

  /** All three era tracks run in lock-step; we only ever crossfade their volumes. Retried until the loops have loaded. */
  private startMusic(): void {
    const audio = this.ctx.audio;
    if (!this.music.length || !this.music[0]) {
      const first = audio.loop(`MUS_Era${MusicAssetByEra[this.era]}`, MusicVolume, 0.6);
      if (first) {
        this.music = [0, 1, 2].map((e) => (e === this.era ? first : audio.loop(`MUS_Era${MusicAssetByEra[e]}`, 0.0001, 0, first)));
      }
    }
    if (!this.wind) {
      const playing = this.state === 'playing' || this.state === 'paused';
      this.wind = audio.loop('AMB_Wind', playing ? (this.era === 1 ? 0.6 : 0.15) : 0.0001, playing ? 1 : 0);
    }
  }

  exit(): void {
    const { input } = this.ctx;
    delete (window as unknown as { __arena?: unknown }).__arena;
    input.tapZones = false;
    for (const voice of [...this.music, this.wind]) voice?.stop(0.3);
    this.music = [];
    this.wind = null;
    this.hud?.dispose();
    this.hud = null;
    this.board.dispose();
    this.snake.dispose();
    this.props.dispose();
    this.particles.dispose();
    this.dressing.dispose();
    this.env.dispose();
    this.noise.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(mat);
    });
    for (const value of Object.values(this.materials)) {
      for (const mat of Array.isArray(value) ? value : [value]) if (mat instanceof THREE.Material) materials.add(mat);
    }
    geometries.forEach((g) => g.dispose());
    materials.forEach((mat) => mat.dispose());
    this.scene.clear();
  }

  onBlur(): void {
    if (this.state === 'playing') this.enterState('paused');
  }

  // ------------------------------------------------------------------ input

  onAction(action: Action, source: InputSource): void {
    if (this.state === 'wait' || this.state === 'warmup' || this.exiting) return;
    if (source === 'touch') {
      this.sawTouch = true;
      this.maybeTouchHint();
    } else if (source === 'keyboard') this.sawKeyboard = true;
    switch (action) {
      case 'left':
        this.steer(this.classic ? ESnakeDir.Left : SnakeGame.turnLeft(this.game.getQueuedDir()));
        this.hud?.hideTouchHint();
        break;
      case 'right':
        this.steer(this.classic ? ESnakeDir.Right : SnakeGame.turnRight(this.game.getQueuedDir()));
        this.hud?.hideTouchHint();
        break;
      case 'up':
        if (this.classic) this.steer(ESnakeDir.Up);
        break;
      case 'down':
        if (this.classic) this.steer(ESnakeDir.Down);
        break;
      case 'camera':
        this.toggleCamera();
        break;
      case 'pause':
      case 'back':
        this.togglePause();
        break;
      case 'select':
        if (this.state === 'paused') this.enterState('dying'); // leaving mid-run still banks the score
        else if (this.state === 'intro' && this.stateTime > 0.6) this.enterState('playing');
        else if (this.state === 'gameover') void this.retryRun();
        break;
    }
  }

  private steer(dir: ESnakeDir): void {
    if ((this.state !== 'playing' && this.state !== 'intro') || this.autopilot) return;
    const before = this.game.getQueuedDir();
    this.game.queueTurn(dir);
    // Quiet and slightly varied so constant steering never gets tiring.
    if (this.game.getQueuedDir() !== before) {
      this.ctx.audio.play('SFX_Arena_Turn', { volume: 0.32, pitch: 0.95 + Math.random() * 0.1 });
      nativeHaptic('turn');
    }
  }

  private toggleCamera(): void {
    this.classic = !this.classic;
    this.ctx.audio.play('SFX_MenuSelect', { volume: 0.5 });
    this.updateTapZones();
  }

  private togglePause(): void {
    if (this.state === 'playing') this.enterState('paused');
    else if (this.state === 'paused') this.enterState('playing');
  }

  private updateTapZones(): void {
    this.ctx.input.tapZones = this.state === 'playing' && !this.classic && !this.autopilot;
  }

  private maybeTouchHint(): void {
    if (this.hintShown || this.autopilot || this.classic || this.state !== 'playing') return;
    this.hintShown = true;
    try {
      if (localStorage.getItem(TouchHintKey)) return;
      localStorage.setItem(TouchHintKey, '1');
    } catch {
      /* storage disabled: show it anyway */
    }
    this.hud?.showTouchHint(3.5, this.realTime);
  }

  // ------------------------------------------------------------------ flow

  private enterState(next: State): void {
    this.state = next;
    this.stateTime = 0;
    const audio = this.ctx.audio;
    switch (next) {
      case 'playing':
        this.wind?.setVolume(this.era === 1 ? 0.6 : 0.15, 1);
        if (this.autopilot) this.queueAutopilot();
        if ((this.ctx.engine.isMobile && !this.sawKeyboard) || this.sawTouch) this.maybeTouchHint();
        break;
      case 'dying':
        nativeHaptic('death');
        audio.play('SFX_Arena_Die');
        this.particles.burst(this._v.copy(this.snake.headPos).setY(0.8), 90, 12, false);
        this.particles.burst(this._v, 70, 16, true);
        this.rig.shake = 1;
        for (const voice of this.music) voice?.setVolume(0.0001, 1.5);
        this.wind?.setVolume(0.3, 1.5);
        break;
      case 'gameover':
        this.finishRun();
        break;
      default:
        break;
    }
    this.updateTapZones();
  }

  private queueAutopilot(): void {
    if (!this.game.isDead()) this.game.queueTurn(this.game.chooseAutopilotDir());
  }

  private tickGame(dt: number): void {
    this.stepAccumulator += dt;
    const interval = this.game.getStepInterval();
    while (this.stepAccumulator >= interval && !this.game.isDead()) {
      this.stepAccumulator -= interval;
      const body = this.game.getBody();
      const tail = { ...body[body.length - 1] };
      const lengthBefore = body.length;
      const food = this.game.getFood();
      const events = this.game.step();
      if (events & SnakeEvents.Died) {
        this.enterState('dying');
        this.stepAccumulator = 0;
        break;
      }
      ++this.steps;
      this.vacated = this.game.getLength() === lengthBefore ? tail : null;
      // The AI decides its next turn right away, so the corner is rounded before the head gets there.
      if (this.autopilot) this.queueAutopilot();

      if (events & SnakeEvents.Ate) {
        nativeHaptic('eat');
        // Burst just ahead of the head so the bite never hides it.
        const where = this._v.set(cellX(food.x), 0.95, cellZ(food.y)).addScaledVector(this.snake.headForward, 0.6);
        this.particles.burst(where, 14, 7.5, this.era > 0);
        this.particles.burst(where, 8, 5, false);
        // Each combo step raises the pitch a little: a musical reward for eating quickly.
        this.ctx.audio.play('SFX_Arena_Eat', { pitch: 1 + 0.07 * (this.game.getCombo() - 1) });
        this.addPopup(where.setY(1.75));
        this.rig.shake = Math.max(this.rig.shake, 0.18 + 0.05 * (this.game.getCombo() - 1));
        this.checkTransitionItem();
      }
      if (events & SnakeEvents.AteTransition) {
        this.shiftToEra(this.era + 1);
      }
      if (events & SnakeEvents.AteBonus) {
        this.particles.burst(this._v.copy(this.snake.headPos).setY(0.8), 60, 13, true);
        this.addPopup(this._v.setY(2.2));
        this.ctx.audio.play('SFX_Arena_Bonus');
        this.rig.shake = Math.max(this.rig.shake, 0.35);
      }
      if (events & SnakeEvents.BonusAppeared) this.ctx.audio.play('SFX_BonusAppear', { volume: 0.7 });
    }
  }

  private addPopup(world: THREE.Vector3): void {
    let slot = this.popups[0];
    for (const p of this.popups) if (p.age > slot.age) slot = p;
    slot.world.copy(world);
    slot.text = `+${this.game.getLastPoints()}`;
    slot.combo = this.game.getCombo();
    slot.age = 0;
  }

  private checkTransitionItem(): void {
    if (this.era >= NumEras - 1 || this.game.isTransitionActive()) return;
    if (this.game.getFoodEaten() - this.foodAtLastEraShift < EraThresholds[this.era + 1]) return;
    if (this.game.spawnTransition()) this.ctx.audio.play('SFX_BonusAppear', { volume: 0.8 });
  }

  private shiftToEra(era: number): void {
    era = Math.min(NumEras - 1, Math.max(0, era));
    if (era === this.era) return;
    this.game.clearTransition();
    this.foodAtLastEraShift = this.game.getFoodEaten();
    const head = this.game.getHead();
    this.board.startShift(era, head.x, head.y);
    this.env.startShift(era);
    // The wave front glows in the incoming era's accent.
    this.materials.seamAccent.value.set(SeamAccent[era]).multiplyScalar(era === 1 ? 1.6 : 1.3);
    // The snake changes skin first, shedding the old era in a shower of voxels.
    const at = this._v.copy(this.snake.headPos).addScaledVector(this.snake.headForward, 0.6).setY(0.9);
    this.particles.burst(at, 50, 9, false);
    this.particles.burst(at, 24, 13, true);
    this.era = era;
    this.snake.setEra(era);
    this.props.setEra(era);
    this.particles.setSolidMaterial(this.materials.debris[era]);
    this.ctx.audio.play('SFX_EraShift');
    this.bannerTime = this.realTime;
    this.slowMoUntil = this.realTime + 2.2;
    this.rig.shake = Math.max(this.rig.shake, 0.5);
    for (let i = 0; i < this.music.length; ++i) this.music[i]?.setVolume(i === era ? MusicVolume : 0.0001, 2.5);
    this.wind?.setVolume(era === 1 ? 0.6 : 0.15, 2);
  }

  private finishRun(): void {
    const { session, save } = this.ctx;
    const maze = this.game.getMaze();
    session.returningFromArena = true;
    session.lastScore = this.game.getScore();
    session.lastLength = this.game.getLength();
    session.lastEra = this.era;
    session.lastWasRecord = false;
    session.lastMaze = maze;
    session.lastLevel = this.game.getLevel();
    session.lastAutopilot = this.autopilot;
    if (!this.autopilot && maze < save.topScores.length && this.game.getScore() > save.topScores[maze]) {
      save.topScores[maze] = this.game.getScore();
      session.lastWasRecord = true;
      this.ctx.writeSave();
    }
    this.best = Math.max(this.best, this.game.getScore());
  }

  private async retryRun(): Promise<void> {
    if (this.exiting) return;
    this.exiting = true;
    this.ctx.engine.setFade(1, BacklightGreen);
    await this.ctx.go('arena');
  }

  // ------------------------------------------------------------------ frame

  private updatePose(alpha: number): void {
    const pose = this.pose;
    pose.body = this.game.getBody();
    pose.vacated = this.vacated;
    pose.alpha = alpha;
    pose.steps = this.steps;
    pose.dir = this.game.getDir();
    // The next step's direction is only certain when exactly one turn is buffered (or none).
    const queued = this.game.getQueuedDir();
    const dir = this.game.getDir();
    pose.nextDir = this.game.isDead() ? null : queued === dir || !SnakeGame.isOpposite(queued, dir) ? queued : null;
  }

  private loaderUp(): boolean {
    const loader = document.getElementById('loader');
    return !!loader && !loader.classList.contains('gone');
  }

  update(dt: number): void {
    const realDelta = Math.min(dt, 0.1);
    const engine = this.ctx.engine;
    if (this.pendingUploads.length) this.uploadTextures(1);
    // Loops that were not decoded in time for enter() start as soon as they are (checked twice a second).
    if ((!this.music[0] || !this.wind) && this.state !== 'dying' && this.state !== 'gameover' && (this.musicRetry -= dt) <= 0) {
      this.musicRetry = 0.5;
      this.startMusic();
    }

    if (this.state === 'warmup') {
      // Draw every era's materials once under the green fade so their pipelines are built before play.
      this.warmup(this.warmupFrame++);
      if (this.warmupFrame > NumEras) {
        this.warmup(-1);
        this.state = this.loaderUp() && !this.scripted ? 'wait' : 'intro';
        this.stateTime = 0;
      }
      return;
    }
    if (this.state === 'wait') {
      if (!this.loaderUp()) this.enterState('intro');
      this.frame(realDelta, 0);
      return;
    }

    this.realTime += realDelta;
    this.stateTime += realDelta;
    // Slow motion for era shifts and the death moment.
    let dilation = 1;
    if (this.state === 'dying') dilation = 0.3;
    else if (this.realTime < this.slowMoUntil) dilation = 0.45;
    const gameDelta = this.state === 'paused' ? 0 : realDelta * dilation;

    switch (this.state) {
      case 'intro':
        engine.setFade(Math.max(0, 1 - this.stateTime / 1.4), BacklightGreen);
        if (this.stateTime >= IntroSeconds) this.enterState('playing');
        break;
      case 'playing':
        this.tickGame(gameDelta);
        break;
      case 'dying':
        if (this.stateTime > 2.4) this.enterState('gameover');
        break;
      default:
        break;
    }
    // QA controls each era explicitly; only the demo follows the timed tour.
    if (this.ctx.flags.demo) this.tickTour();
    this.frame(realDelta, gameDelta);
  }

  /** The tour runs on the wall clock from the moment the arena takes over the screen (like the QA timeline). */
  private tickTour(): void {
    const t = (performance.now() - this.tourStart) / 1000;
    while (this.tourStep < Tour.length && t >= Tour[this.tourStep][0]) {
      const action = Tour[this.tourStep++][1];
      if (action === 'camera') this.toggleCamera();
      else if (action === 'era1') this.shiftToEra(1);
      else if (action === 'era2') this.shiftToEra(2);
      else if (action === 'die' && this.state === 'playing') this.enterState('dying');
    }
  }

  /** Visuals for this frame. */
  private frame(realDelta: number, gameDelta: number): void {
    const playing = this.state === 'playing' || this.state === 'paused';
    const alpha = playing && !this.game.isDead() ? Math.min(1, this.stepAccumulator / this.game.getStepInterval()) : 1;
    this.updatePose(alpha);
    this.snake.update(this.pose, gameDelta);
    this.props.update(this.game, gameDelta, false);
    this.board.update(gameDelta);
    this.env.update(gameDelta);
    this.dressing.update(this.era, this.env.envEra, gameDelta);
    this.particles.update(gameDelta);

    const mode = this.state === 'intro' || this.state === 'wait' ? 'intro' : this.state === 'dying' || this.state === 'gameover' ? 'death' : this.classic ? 'classic' : 'chase';
    this.rig.update(
      {
        mode,
        classic: this.classic,
        head: this.snake.headPos,
        yaw: Math.atan2(-this.snake.headForward.z, this.snake.headForward.x),
        stateTime: this.stateTime,
        shift: this.board.shifting ? this.board.shiftProgress : -1,
        aspect: this.ctx.engine.aspect,
      },
      realDelta,
    );
    this.env.follow(this.camera.position);
    this.env.setOverhead(this.classic, realDelta);
    this.updateHud(realDelta);
  }

  private updateHud(dt: number): void {
    if (!this.hud) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const p of this.popups) {
      p.age += dt;
      p.visible = p.age < 1.3;
      if (!p.visible) continue;
      this._v.copy(p.world).setY(p.world.y + p.age * 1.6).project(this.camera);
      p.visible = this._v.z < 1;
      p.x = (this._v.x * 0.5 + 0.5) * w;
      p.y = (-this._v.y * 0.5 + 0.5) * h;
    }
    const g = this.game;
    const input = this.ctx.input;
    // Touch wording once a touch arrives, or up front on phones until a key says otherwise.
    const touch = this.sawTouch || input.lastSource === 'touch' || (this.ctx.engine.isMobile && !this.sawKeyboard);
    const state = this.hudState;
    state.era = this.era;
    state.score = g.getScore();
    state.length = g.getLength();
    state.best = this.best;
    state.combo = g.getCombo();
    state.comboRemaining = g.getComboRemaining();
    state.bonus = g.isBonusActive();
    state.transitionTarget = this.state === 'playing' && g.isTransitionActive() ? this.era + 1 : null;
    state.bonusTimer = g.getBonusTimer();
    state.demo = this.autopilot;
    state.state = this.state === 'warmup' ? 'wait' : this.state;
    state.stateTime = this.stateTime;
    state.classic = this.classic;
    state.touch = touch;
    state.bannerAge = this.realTime - this.bannerTime;
    state.showControlsHint = this.state === 'playing' && this.stateTime < 6 && g.getFoodEaten() === 0 && !this.autopilot;
    this.hud.update(state, this.popups, this.realTime);
  }

  /** Warm-up frame `k` (0..2): show every era's objects with era k's materials; -1 restores the current era. */
  private warmup(k: number): void {
    const era = k < 0 ? this.era : k;
    this.snake.setEra(era);
    this.props.setEra(era);
    this.particles.setSolidMaterial(this.materials.debris[era]);
    this.updatePose(1);
    this.snake.update(this.pose, 0);
    this.snake.showAllParts(k >= 0);
    this.props.update(this.game, 0, false);
    if (k >= 0) this.props.showAllParts();
    this.board.warmup(k >= 0);
    this.dressing.warmup(k >= 0);
    this.env.update(0);
    this.rig.update({ mode: 'intro', classic: false, head: this.snake.headPos, yaw: 0, stateTime: 0, shift: -1, aspect: this.ctx.engine.aspect }, 0);
    if (k >= 0) {
      // Particles too: a few voxels so their pipelines exist.
      this.particles.burst(this._v.copy(this.snake.headPos).setY(1), 2, 1, false);
      this.particles.burst(this._v, 2, 1, true);
      this.particles.update(0.001);
      this.env.follow(this.camera.position);
    } else {
      this.particles.clear();
      this.particles.update(0);
      this.snake.snapHeading();
      this.rig.snap();
    }
  }
}

export function createArenaScene(ctx: AppContext): GameScene {
  return new ArenaScene(ctx);
}
