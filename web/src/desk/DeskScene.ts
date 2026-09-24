import * as THREE from 'three/webgpu';
import type { AppContext, GameScene } from '../core/App';
import type { Action, InputSource } from '../core/Input';
import type { Voice } from '../core/Audio';
import { QualityNames, type Quality } from '../core/Engine';
import { SnakeGame, LcdFramebuffer, ESnakeDir, ESnakeMaze, SnakeEvents, qualifies, addScore, COVER_NAMES, INDEX_NONE } from '../game';
import { DeskMaterials } from './materials';
import { Phone } from './Phone';
import { Room, PropModels, RoomTextures } from './Room';
import { CameraRig, Shot } from './CameraRig';
import { DeskHud } from './DeskHud';
import * as Screens from './Screens';
import { BacklightGreen, PhoneKey, pixelToLocal } from './space';

/** ERetroState */
const State = {
  Attract: 0, Menu: 1, TopScores: 2, Playing: 3, Paused: 4, Dying: 5, GameOver: 6, Diving: 7, Settings: 8, About: 9, EnterName: 10,
} as const;
type State = (typeof State)[keyof typeof State];

/** The standalone menu keeps the original phone settings and starts LCD Snake. */
const MenuItem = { NewGame: 0, Level: 1, Maze: 2, Cover: 3, Settings: 4, TopScores: 5, About: 6, Count: 7 } as const;
type SettingItem = 'sound' | 'gfx' | 'screen' | 'back';

const BacklightTimeout = 15;
const RingDuration = 22;
const AttractTitleTime = 8;
const AttractDemoTime = 16;
const DiveSeconds = 1.7;
const Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const Sounds = [
  'SFX_Eat', 'SFX_BonusEat', 'SFX_BonusAppear', 'SFX_Die', 'SFX_MenuMove', 'SFX_MenuSelect', 'SFX_Start', 'SFX_KeyClick',
  'SFX_Vibrate', 'SFX_DiveIn', 'MUS_Ringtone', 'AMB_Room',
];

const rand = () => Math.floor(Math.random() * 0x7fffffff);

function keyForDirection(dir: ESnakeDir, inGame: boolean): number {
  // In-game the classic 2/4/6/8 keys steer; menus use the up/down rocker.
  switch (dir) {
    case ESnakeDir.Up: return inGame ? PhoneKey.Key2 : PhoneKey.Up;
    case ESnakeDir.Down: return inGame ? PhoneKey.Key8 : PhoneKey.Down;
    case ESnakeDir.Left: return PhoneKey.Key4;
    default: return PhoneKey.Key6;
  }
}

interface QAStep {
  t: number;
  run: () => void;
}

/**
 * The desk scene: the director from RetroSnakePlayerController (state machine, LCD screens, cinematic camera,
 * audio, scripted tour) driving the phone on the desk, and the dive into / return from the arena.
 */
class DeskScene implements GameScene {
  readonly scene = new THREE.Scene();
  private readonly rig = new CameraRig();
  private readonly ctx: AppContext;
  private readonly materials: DeskMaterials;
  private readonly phone: Phone;
  private readonly room: Room;
  private hud: DeskHud | null = null;
  private readonly game = new SnakeGame();
  private readonly frame = new LcdFramebuffer();
  private readonly driftTarget = new THREE.Vector3();

  private state: State = State.Attract;
  private stateTime = 0;
  private clock = 0;
  private stepAccumulator = 0;
  private lastInputTime = 0;
  private menuIndex = 0;
  private menuScroll = 0;
  private settingsIndex = 0;
  private settingsScroll = 0;
  private nameEntry = 'AAA';
  private nameCursor = 0;
  private qualifies = false;
  private lastRunMaze = 0;
  private lastRunLevel = 5;
  private topScoresMaze = 0;
  private highlightRank = INDEX_NONE;
  private autopilot = false;
  private demo = false;
  private newRecord = false;
  private ringing = false;
  private ringPending = false;
  private ringStart = 0;
  private nextBuzzTime = 0;
  private returned = false;
  private lastScore = 0;
  private attractOffset = 0;
  private leaving = false;

  // Scripted tour (?demo / ?qa) and endless autoplay (?autoplay).
  private readonly scripted: boolean;
  private readonly autoplayMode: boolean;
  /** Wall-clock start of the tour (deterministic for screenshot timelines even when early frames hitch). */
  private qaStart = -1;
  private qaStep = 0;
  private qaSteps: QAStep[] = [];

  private gateOpen = false;
  private fadeFrom = 0;
  private fadeTo = 0;
  private fadeTime = 0;
  private fadeDuration = 0;
  private ringVoice: Voice | null = null;
  private ambience: Voice | null = null;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
    this.scripted = ctx.flags.demo || ctx.flags.qa;
    this.autoplayMode = ctx.flags.autoplay;
    this.materials = new DeskMaterials(ctx.assets);
    this.phone = new Phone(this.materials);
    this.room = new Room(this.materials);
    this.scene.background = new THREE.Color(0x040506);
    this.scene.add(this.room.group, this.phone.root);
    this.qaSteps = this.buildTour();
  }

  get camera(): THREE.Camera {
    return this.rig.camera;
  }

  private get save() {
    return this.ctx.save;
  }

  private get touch(): boolean {
    return this.ctx.engine.isMobile || this.ctx.input.lastSource === 'touch';
  }

  async load(): Promise<void> {
    const { assets, audio, engine } = this.ctx;
    const textures = [...RoomTextures, 'T_KeyLabels', 'T_KeyLabels_Glow', 'T_LCDBacklightFalloff',
      ...COVER_NAMES.map((c) => 'T_Faceplate_' + c)];
    await Promise.all([
      assets.preload([...Phone.modelNames(), ...PropModels], textures),
      audio.preload(Sounds),
    ]);
    await this.phone.load(assets, engine.quality);
    await this.room.load(assets, engine.renderer, this.scene, engine.isMobile);
    this.phone.setCover(this.save.cover);
    this.game.reset(this.save.level, this.save.maze as ESnakeMaze, 1);
    // Compile every material up front (behind the loader or the dive's green), so the first frames don't hitch.
    this.rig.cut(Shot.Attract, 0, engine.aspect);
    try {
      await engine.renderer.compileAsync(this.scene, this.rig.camera);
    } catch (error) {
      console.warn('desk precompile failed', error);
    }
  }

  enter(): void {
    const { engine, audio, session } = this.ctx;
    engine.setPost({ bloomStrength: 0.75, bloomRadius: 0.45, bloomThreshold: 0.02, exposure: 1.0 }, 0);
    this.hud = new DeskHud(this.ctx, this.phone, this.rig.camera, (key) => this.onPhoneKey(key));
    this.gateOpen = !document.querySelector('#loader:not(.gone)');
    this.ctx.input.tapZones = false;
    this.ambience = audio.loop('AMB_Room', 0.55);

    if (session.returningFromArena) {
      // Pulled back out of the screen: the phone shows how the run ended.
      session.returningFromArena = false;
      this.returned = true;
      this.lastScore = session.lastScore;
      this.lastRunMaze = session.lastMaze;
      this.lastRunLevel = session.lastLevel;
      // Scripted tours always show the name entry so QA and the demo reel cover it (they never write the save).
      this.qualifies = this.scripted || (!session.lastAutopilot && qualifies(this.save, this.lastRunMaze, this.lastScore));
      // The AI's runs never count as records (the arena doesn't save them either).
      this.newRecord = !session.lastAutopilot && (session.lastWasRecord || this.lastScore > this.topScore(this.lastRunMaze));
      this.rig.cut(Shot.Dive, this.clock, engine.aspect);
      this.enterState(State.GameOver);
      this.rig.set(Shot.GameOver, 2.2);
      engine.setFade(1, BacklightGreen);
      this.startFade(1, 0, 1.2);
      this.cue('SFX_Vibrate', 0.8);
      this.phone.vibrate(0.8, 0.8);
      this.buzz(200);
      return;
    }
    engine.setFade(0);
    this.rig.cut(Shot.Attract, this.clock, engine.aspect);
    this.enterState(State.Attract);
  }

  exit(): void {
    this.stopRinging();
    this.ambience?.stop(0.4);
    this.ambience = null;
    this.hud?.dispose();
    this.hud = null;
    this.phone.dispose();
    this.room.dispose();
    this.materials.dispose();
    this.scene.environment = null;
    this.scene.clear();
  }

  onBlur(): void {
    if (this.state === State.Playing) this.enterState(State.Paused);
  }

  // ------------------------------------------------------------------------------------------ input

  onAction(action: Action, source: InputSource): void {
    if (!this.gateOpen) this.gateOpen = !document.querySelector('#loader:not(.gone)');
    if (!this.gateOpen || this.leaving) return;
    if (action === 'select' && source === 'touch' && this.hud?.consumedTap()) return;
    if (action === 'select' && source === 'keyboard' && this.hud?.consumedTap()) return;
    switch (action) {
      case 'up': this.handleDirection(ESnakeDir.Up); break;
      case 'down': this.handleDirection(ESnakeDir.Down); break;
      case 'left': this.handleDirection(ESnakeDir.Left); break;
      case 'right': this.handleDirection(ESnakeDir.Right); break;
      case 'select': this.onSelect(); break;
      case 'back':
      case 'pause': this.onBack(); break;
      default: break;
    }
  }

  /** A 3D key on the phone was tapped/clicked. */
  private onPhoneKey(key: number): void {
    if (!this.gateOpen || this.leaving) return;
    switch (key) {
      case PhoneKey.Up: case PhoneKey.Key2: this.handleDirection(ESnakeDir.Up, key); break;
      case PhoneKey.Down: case PhoneKey.Key8: this.handleDirection(ESnakeDir.Down, key); break;
      case PhoneKey.Key4: this.handleDirection(ESnakeDir.Left, key); break;
      case PhoneKey.Key6: this.handleDirection(ESnakeDir.Right, key); break;
      case PhoneKey.Select: case PhoneKey.Key5: this.onSelect(key); break;
      case PhoneKey.Clear: this.onBack(); break;
      default:
        this.touchInput(key);
        if (this.state === State.Attract) this.answer();
        break;
    }
  }

  private touchInput(key: number): void {
    this.lastInputTime = this.clock;
    this.phone.pressKey(key);
    this.cue('SFX_KeyClick', 0.6);
    this.buzz(8);
    this.hud?.noteInput();
  }

  private answer(): void {
    this.stopRinging();
    this.cue('SFX_MenuSelect');
    this.startGame(false);
  }

  private handleDirection(dir: ESnakeDir, pressed?: number): void {
    const inGame = this.state === State.Playing || this.state === State.Paused;
    this.touchInput(pressed ?? keyForDirection(dir, inGame));
    const vertical = dir === ESnakeDir.Up || dir === ESnakeDir.Down;
    switch (this.state) {
      case State.Attract:
        this.answer();
        break;
      case State.Menu:
        if (vertical) {
          const n = MenuItem.Count;
          this.menuIndex = (this.menuIndex + (dir === ESnakeDir.Down ? 1 : n - 1)) % n;
          this.cue('SFX_MenuMove');
        } else {
          this.changeMenuValue(dir === ESnakeDir.Right ? 1 : -1);
        }
        break;
      case State.Settings: {
        if (vertical) {
          const n = this.settingItems().length;
          this.settingsIndex = (this.settingsIndex + (dir === ESnakeDir.Down ? 1 : n - 1)) % n;
          this.cue('SFX_MenuMove');
        } else {
          this.changeSetting(dir === ESnakeDir.Right ? 1 : -1);
        }
        break;
      }
      case State.About:
        this.cue('SFX_MenuMove');
        this.enterState(State.Menu);
        break;
      case State.EnterName: {
        if (vertical) {
          const index = Math.max(Alphabet.indexOf(this.nameEntry[this.nameCursor]), 0);
          const next = (index + (dir === ESnakeDir.Up ? 1 : Alphabet.length - 1)) % Alphabet.length;
          this.nameEntry = this.nameEntry.slice(0, this.nameCursor) + Alphabet[next] + this.nameEntry.slice(this.nameCursor + 1);
        } else {
          this.nameCursor = THREE.MathUtils.clamp(this.nameCursor + (dir === ESnakeDir.Right ? 1 : -1), 0, 2);
        }
        this.cue('SFX_MenuMove');
        break;
      }
      case State.TopScores:
        if (!vertical) {
          const n = ESnakeMaze.Count;
          this.topScoresMaze = (this.topScoresMaze + (dir === ESnakeDir.Right ? 1 : n - 1)) % n;
          this.highlightRank = INDEX_NONE;
          this.cue('SFX_MenuMove');
        }
        break;
      case State.Playing:
        if (!this.autopilot) this.game.queueTurn(dir);
        break;
      default:
        break;
    }
  }

  private onSelect(pressed?: number): void {
    this.touchInput(pressed ?? (this.state === State.Playing ? PhoneKey.Key5 : PhoneKey.Select));
    switch (this.state) {
      case State.Attract:
        this.answer();
        break;
      case State.Menu:
        this.cue('SFX_MenuSelect');
        switch (this.menuIndex) {
          case MenuItem.NewGame: this.startGame(false); break;
          case MenuItem.TopScores:
            this.topScoresMaze = this.save.maze;
            this.highlightRank = INDEX_NONE;
            this.enterState(State.TopScores);
            break;
          case MenuItem.Settings: this.settingsIndex = 0; this.enterState(State.Settings); break;
          case MenuItem.About: this.enterState(State.About); break;
          default: this.changeMenuValue(1); break;
        }
        break;
      case State.Settings:
        this.cue('SFX_MenuSelect');
        if (this.settingItems()[this.settingsIndex] === 'back') this.enterState(State.Menu);
        else this.changeSetting(1);
        break;
      case State.About:
      case State.TopScores:
        this.cue('SFX_MenuSelect');
        this.enterState(State.Menu);
        break;
      case State.Playing:
        this.cue('SFX_MenuSelect');
        this.enterState(State.Paused);
        break;
      case State.Paused:
        this.cue('SFX_MenuSelect');
        this.enterState(State.Playing);
        break;
      case State.GameOver:
        if (this.stateTime > 0.8) {
          if (this.qualifies) this.enterState(State.EnterName);
          else if (this.returned) this.beginDive(false);
          else this.startGame(false);
        }
        break;
      case State.EnterName:
        this.cue('SFX_MenuSelect');
        if (this.nameCursor < 2) ++this.nameCursor;
        else this.confirmName();
        break;
      default:
        break;
    }
  }

  private onBack(): void {
    this.touchInput(PhoneKey.Clear);
    switch (this.state) {
      case State.Attract:
        if (this.ringing) this.stopRinging(); // "reject call"
        break;
      case State.Menu:
        this.cue('SFX_MenuMove');
        this.enterState(State.Attract);
        break;
      case State.TopScores:
      case State.Settings:
      case State.About:
        this.cue('SFX_MenuMove');
        this.enterState(State.Menu);
        break;
      case State.EnterName:
        this.nameCursor = Math.max(0, this.nameCursor - 1);
        this.cue('SFX_MenuMove');
        break;
      case State.Playing:
        this.cue('SFX_MenuSelect');
        this.enterState(State.Paused);
        break;
      case State.Paused:
        this.recordScore();
        this.enterState(State.Menu);
        break;
      case State.GameOver:
        if (this.stateTime > 0.8) this.enterState(State.Menu);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------------------------------ flow

  private enterState(next: State): void {
    this.state = next;
    this.stateTime = 0;
    switch (next) {
      case State.Attract:
        this.demo = false;
        this.attractOffset = 0;
        this.rig.set(Shot.Attract, 2.2);
        break;
      case State.Menu:
      case State.TopScores:
      case State.Settings:
      case State.About:
        this.rig.set(Shot.Menu, 1.6);
        break;
      case State.EnterName:
        this.nameEntry = this.save.lastName.length === 3 ? this.save.lastName.toUpperCase() : 'AAA';
        this.nameCursor = 0;
        this.rig.set(Shot.Menu, 1.2);
        break;
      case State.Playing:
        this.rig.set(Shot.Gameplay, 1.4);
        break;
      case State.Dying:
        this.cue('SFX_Die');
        this.cue('SFX_Vibrate', 0.9);
        this.phone.vibrate(1.1, 1);
        this.buzz(300);
        break;
      case State.GameOver:
        if (!this.returned) {
          this.recordScore();
          this.lastScore = this.game.getScore();
          this.lastRunMaze = this.game.getMaze();
          this.lastRunLevel = this.game.getLevel();
          this.qualifies = !this.autopilot && qualifies(this.save, this.lastRunMaze, this.lastScore);
        }
        this.rig.set(Shot.GameOver, 1.2);
        break;
      case State.Diving:
        this.rig.set(Shot.Dive, DiveSeconds);
        break;
      default:
        break;
    }
  }

  /** Classic Snake on the phone's own LCD. */
  private startGame(autopilot: boolean): void {
    this.stopRinging();
    this.autopilot = autopilot;
    this.demo = false;
    this.newRecord = false;
    this.returned = false;
    this.stepAccumulator = 0;
    this.game.reset(this.save.level, this.save.maze as ESnakeMaze, rand());
    this.cue('SFX_Start');
    this.enterState(State.Playing);
  }

  /** Fly the camera into the LCD and load the 3D arena. */
  private beginDive(autopilot: boolean): void {
    const session = this.ctx.session;
    session.arenaAutopilot = autopilot;
    session.returningFromArena = false;
    this.stopRinging();
    this.demo = false;
    // The LCD shows the run's opening frame as we fall in.
    this.game.reset(this.save.level, this.save.maze as ESnakeMaze, rand());
    this.cue('SFX_Start');
    this.cue('SFX_DiveIn', 0.9);
    this.enterState(State.Diving);
  }

  private tickGame(dt: number): void {
    this.stepAccumulator += dt;
    const interval = this.game.getStepInterval();
    while (this.stepAccumulator >= interval && !this.game.isDead()) {
      this.stepAccumulator -= interval;
      if (this.autopilot || this.demo) this.game.queueTurn(this.game.chooseAutopilotDir());
      const events = this.game.step();
      if (this.demo) continue; // the attract demo is silent
      if (events & SnakeEvents.Ate) this.cue('SFX_Eat');
      if (events & SnakeEvents.AteBonus) this.cue('SFX_BonusEat');
      if (events & SnakeEvents.BonusAppeared) this.cue('SFX_BonusAppear');
      if (events & SnakeEvents.Died) this.enterState(State.Dying);
    }
  }

  private changeMenuValue(delta: number): void {
    const save = this.save;
    switch (this.menuIndex) {
      case MenuItem.Level:
        save.level = ((save.level - 1 + delta + SnakeGame.MaxLevel) % SnakeGame.MaxLevel) + 1;
        break;
      case MenuItem.Maze:
        save.maze = (save.maze + delta + ESnakeMaze.Count) % ESnakeMaze.Count;
        break;
      case MenuItem.Cover:
        save.cover = (save.cover + delta + COVER_NAMES.length) % COVER_NAMES.length;
        this.phone.setCover(save.cover);
        break;
      default:
        return;
    }
    this.cue('SFX_MenuMove');
    this.ctx.writeSave();
  }

  private settingItems(): SettingItem[] {
    const items: SettingItem[] = ['sound', 'gfx'];
    if (document.fullscreenEnabled) items.push('screen');
    items.push('back');
    return items;
  }

  private changeSetting(delta: number): void {
    const { save, engine, audio } = this.ctx;
    switch (this.settingItems()[this.settingsIndex]) {
      case 'sound':
        save.soundOn = !save.soundOn;
        audio.setEnabled(save.soundOn);
        break;
      case 'gfx': {
        const q = ((engine.quality + delta + 4) % 4) as Quality;
        engine.setQuality(q);
        save.quality = q;
        this.phone.setQuality(q);
        // Shadow maps may have been switched on/off: recompile lit materials.
        this.scene.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) (mesh.material as THREE.Material).needsUpdate = true;
        });
        break;
      }
      case 'screen':
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void document.documentElement.requestFullscreen().catch(() => {});
        break;
      default:
        return;
    }
    this.cue('SFX_MenuMove');
    this.ctx.writeSave();
  }

  private recordScore(): void {
    const maze = this.game.getMaze();
    if (this.game.getScore() > this.topScore(maze) && !this.autopilot && !this.demo) {
      this.save.topScores[maze] = this.game.getScore();
      this.newRecord = true;
      this.ctx.writeSave();
    }
  }

  private confirmName(): void {
    this.highlightRank = addScore(this.save, this.lastRunMaze, this.nameEntry, this.lastScore, this.lastRunLevel);
    this.save.lastName = this.nameEntry;
    this.qualifies = false;
    this.newRecord = false;
    this.ctx.writeSave();
    this.topScoresMaze = this.lastRunMaze;
    this.cue('SFX_Start');
    this.enterState(State.TopScores);
  }

  private topScore(maze: number): number {
    return this.save.topScores[maze] ?? 0;
  }

  private stopRinging(): void {
    this.ringing = false;
    this.ringPending = false;
    this.ringVoice?.stop(0.25);
    this.ringVoice = null;
  }

  private cue(name: string, volume = 1): void {
    this.ctx.audio.play(name, { volume });
  }

  /** Haptics on phones (the real phone buzzing in your hand). */
  private buzz(ms: number): void {
    if (this.ctx.engine.isMobile && this.ctx.save.soundOn) navigator.vibrate?.(ms);
  }

  private startFade(from: number, to: number, seconds: number): void {
    this.fadeFrom = from;
    this.fadeTo = to;
    this.fadeTime = 0;
    this.fadeDuration = seconds;
    this.ctx.engine.setFade(from, BacklightGreen);
  }

  // ------------------------------------------------------------------------------------------ frame

  update(dt: number): void {
    const { engine, audio } = this.ctx;
    if (!this.gateOpen) {
      this.gateOpen = !document.querySelector('#loader:not(.gone)');
      if (this.gateOpen) this.lastInputTime = this.clock;
      else {
        this.drawFrame();
        this.phone.update(dt);
        return;
      }
    }
    this.clock += dt;
    this.stateTime += dt;

    if (this.ringPending && this.gateOpen && audio.context.state === 'running') {
      this.ringPending = false;
      this.ringing = true;
      this.ringStart = this.clock;
      this.nextBuzzTime = this.clock + 0.6;
      this.ringVoice = audio.loop('MUS_Ringtone', 0.8);
    } else if (this.ringPending && this.gateOpen && this.scripted) {
      // Scripted captures may run without an audio gesture: ring silently (buzz only).
      this.ringPending = false;
      this.ringing = true;
      this.ringStart = this.clock;
      this.nextBuzzTime = this.clock + 0.6;
    }

    switch (this.state) {
      case State.Attract: {
        if (this.autoplayMode && this.gateOpen && this.stateTime > 6 && !this.scripted) {
          this.beginDive(true);
          break;
        }
        // Alternate between the title card and a self-playing demo.
        const cycle = (this.stateTime + this.attractOffset) % (AttractTitleTime + AttractDemoTime);
        const wantDemo = cycle >= AttractTitleTime;
        if (wantDemo && !this.demo) {
          this.game.reset(6, Math.floor(Math.random() * ESnakeMaze.Count) as ESnakeMaze, rand());
          this.stepAccumulator = 0;
        }
        this.demo = wantDemo;
        if (this.demo) {
          this.tickGame(dt);
          if (this.game.isDead()) this.game.reset(6, this.game.getMaze(), rand());
        }
        if (this.ringing) {
          if (this.clock >= this.nextBuzzTime) {
            this.phone.vibrate(0.9, 0.7);
            this.cue('SFX_Vibrate', 0.7);
            this.nextBuzzTime = this.clock + 2.6;
          }
          if (this.clock - this.ringStart > RingDuration) this.stopRinging();
        }
        break;
      }
      case State.Playing:
        this.tickGame(dt);
        break;
      case State.Dying:
        if (this.stateTime > 1.6) this.enterState(State.GameOver);
        break;
      case State.GameOver:
        if (this.qualifies && this.stateTime > 3.5) {
          this.enterState(State.EnterName);
          break;
        }
        if (this.autoplayMode && !this.scripted && this.stateTime > 4) this.beginDive(true);
        break;
      case State.Diving:
        if (this.stateTime > DiveSeconds - 0.45 && this.fadeTo !== 1) this.startFade(0, 1, 0.4);
        if (this.stateTime > DiveSeconds && !this.leaving) {
          this.leaving = true;
          this.ctx.writeSave();
          this.ctx.go('arena').catch((error: unknown) => {
            console.error('arena failed to load', error);
            this.leaving = false;
            this.startFade(1, 0, 0.6);
            this.enterState(State.Menu);
          });
        }
        break;
      default:
        break;
    }

    if (this.scripted) this.tickTour();

    this.drawFrame();
    this.updateBacklight();

    // Gameplay camera leans gently toward the snake's head.
    this.driftTarget.set(0, 0, 0);
    if (this.state === State.Playing || this.state === State.Paused || this.state === State.Dying) {
      const head = this.game.getHead();
      pixelToLocal(SnakeGame.cellPixelX(head.x) + 1.5, SnakeGame.cellPixelY(head.y) + 1.5, this.driftTarget).multiplyScalar(0.12);
    }
    this.rig.update(dt, this.clock, engine.aspect, this.driftTarget);
    const dust = this.room.dust;
    if (dust) {
      const shot = this.rig.currentShot;
      const want = shot === Shot.Attract ? 1 : shot === Shot.Dive ? 0 : 0.3;
      dust.strength.value += (want - (dust.strength.value as number)) * Math.min(1, dt * 1.5);
    }
    this.phone.update(dt);

    if (this.fadeDuration > 0) {
      this.fadeTime += dt;
      const a = Math.min(1, this.fadeTime / this.fadeDuration);
      engine.setFade(THREE.MathUtils.lerp(this.fadeFrom, this.fadeTo, a));
      if (a >= 1) this.fadeDuration = 0;
    }
    const s = this.state;
    this.hud?.update(dt, s === State.Attract || s === State.Menu || s === State.Settings || s === State.TopScores, engine.fade);
  }

  private drawFrame(): void {
    const fb = this.frame;
    fb.clear();
    const save = this.save;
    switch (this.state) {
      case State.Attract:
        if (this.demo) this.game.render(fb, true, true, this.clock);
        else Screens.drawAttract(fb, this.clock, this.ringing, this.topScore(save.maze), this.touch);
        break;
      case State.Menu: {
        const rows: Screens.Row[] = [
          ['NEW GAME', ''],
          ['LEVEL', String(save.level)],
          ['MAZE', SnakeGame.getMazeName(save.maze)],
          ['COVER', COVER_NAMES[save.cover].toUpperCase()],
          ['SETTINGS', ''],
          ['TOP SCORES', ''],
          ['ABOUT', ''],
        ];
        this.menuScroll = Screens.drawList(fb, 'SNAKE', rows, this.menuIndex, this.menuScroll);
        break;
      }
      case State.Settings: {
        const rows = this.settingItems().map((item): Screens.Row => {
          switch (item) {
            case 'sound': return ['SOUND', save.soundOn ? 'ON' : 'OFF'];
            case 'gfx': return ['GFX', QualityNames[this.ctx.engine.quality]];
            case 'screen': return ['SCREEN', document.fullscreenElement ? 'FULL' : 'WINDOW'];
            default: return ['BACK', ''];
          }
        });
        this.settingsIndex = Math.min(this.settingsIndex, rows.length - 1);
        this.settingsScroll = Screens.drawList(fb, 'SETTINGS', rows, this.settingsIndex, this.settingsScroll);
        break;
      }
      case State.TopScores: Screens.drawTopScores(fb, save, this.topScoresMaze, this.highlightRank, this.stateTime); break;
      case State.About: Screens.drawAbout(fb, this.stateTime); break;
      case State.EnterName: Screens.drawEnterName(fb, this.lastScore, this.nameEntry, this.nameCursor, this.stateTime); break;
      case State.Playing: this.game.render(fb, true, false, this.clock); break;
      case State.Paused: Screens.drawPaused(fb, this.game, this.clock); break;
      case State.Dying: this.game.render(fb, this.stateTime % 0.3 < 0.15, false, this.clock); break;
      case State.GameOver: Screens.drawGameOver(fb, this.lastScore, this.newRecord, this.topScore(save.maze), this.stateTime); break;
      case State.Diving:
        // Fall into the game itself: the opening frame of the run, then pure backlight green just before the cut.
        if (this.stateTime < DiveSeconds - 0.3) this.game.render(fb, true, false, this.clock);
        break;
    }
    this.phone.present(fb.getData());
  }

  private updateBacklight(): void {
    const s = this.state;
    const idle = s === State.Attract || s === State.Menu || s === State.TopScores || s === State.GameOver || s === State.Settings || s === State.EnterName;
    const asleep = idle && !this.ringing && !this.demo && !this.scripted && this.clock - this.lastInputTime > BacklightTimeout;
    this.phone.setBacklight(asleep ? 0.2 : 1);
  }

  // ------------------------------------------------------------------------------------------ scripted tour

  /** The -QAShots / -DemoReel walk: attract -> demo -> menu -> cover swap -> settings -> about -> top scores -> dive. */
  private buildTour(): QAStep[] {
    const s = (t: number, run: () => void): QAStep => ({ t, run });
    const dir = (d: ESnakeDir) => () => this.handleDirection(d);
    return [
      s(4.5, () => { this.attractOffset = AttractTitleTime - this.stateTime; }),
      s(10, () => this.onSelect()),
      s(12.5, dir(ESnakeDir.Down)), s(12.8, dir(ESnakeDir.Down)), s(13.1, dir(ESnakeDir.Down)), s(13.4, dir(ESnakeDir.Down)),
      s(13.8, dir(ESnakeDir.Right)),
      s(14.8, dir(ESnakeDir.Right)),
      s(16.5, dir(ESnakeDir.Left)), s(16.8, dir(ESnakeDir.Left)),
      s(17.2, dir(ESnakeDir.Down)), s(17.5, () => this.onSelect()),
      s(20.5, () => this.onBack()),
      s(20.8, dir(ESnakeDir.Down)), s(21.1, () => this.onSelect()),
      s(24, () => this.onBack()),
      s(24.3, dir(ESnakeDir.Down)), s(24.6, () => this.onSelect()),
      s(29, () => this.onBack()),
      s(29.5, dir(ESnakeDir.Down)),
      s(30.8, () => { this.touchInput(PhoneKey.Select); this.cue('SFX_MenuSelect'); this.beginDive(true); }),
    ];
  }

  private tickTour(): void {
    if (!this.returned) {
      if (this.qaStart < 0) this.qaStart = performance.now();
      const qaTime = (performance.now() - this.qaStart) / 1000;
      while (this.qaStep < this.qaSteps.length && qaTime >= this.qaSteps[this.qaStep].t) {
        this.qaSteps[this.qaStep].run();
        ++this.qaStep;
      }
      return;
    }
    // After the arena: game over -> enter initials (auto) -> the table -> (demo) round again.
    if (this.state === State.EnterName && this.qaStep < 3 && this.stateTime > 1.3 + 0.45 * this.qaStep) {
      this.onSelect();
      ++this.qaStep;
    } else if (this.state === State.TopScores && this.ctx.flags.demo && this.stateTime > 4) {
      this.returned = false;
      this.qaStart = -1;
      this.qaStep = 0;
      this.enterState(State.Attract);
    }
  }
}

export function createDeskScene(ctx: AppContext): GameScene {
  return new DeskScene(ctx);
}
