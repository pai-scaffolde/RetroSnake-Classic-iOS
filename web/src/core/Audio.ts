import type { AssetManifest } from './Assets';

export interface PlayOptions {
  volume?: number;
  pitch?: number;
  loop?: boolean;
  /** Stereo pan -1..1. */
  pan?: number;
  /** Loops only: start at the same point in the cycle as this voice. */
  syncTo?: Voice | null;
}

export interface Voice {
  /** Seconds into the loop cycle (or since start for one-shots). */
  position(): number;
  stop(fadeSeconds?: number): void;
  setVolume(volume: number, seconds?: number): void;
  readonly gain: GainNode;
}

/**
 * Web Audio playback of the game's cues. Browsers only allow audio after a user gesture,
 * so `unlock()` must be called from one (the title screen's "tap to start").
 * Music and SFX go through separate buses so the settings menu can mute everything at once.
 */
export class Audio {
  readonly context: AudioContext;
  private readonly master: GainNode;
  readonly musicBus: GainNode;
  readonly sfxBus: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private manifest: AssetManifest;
  private baseUrl: string;
  private enabled = true;

  constructor(manifest: AssetManifest, baseUrl: string) {
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    this.musicBus = this.context.createGain();
    this.musicBus.gain.value = 0.8;
    this.musicBus.connect(this.master);
    this.sfxBus = this.context.createGain();
    this.sfxBus.connect(this.master);
  }

  async unlock(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.master.gain.setTargetAtTime(enabled ? 1 : 0, this.context.currentTime, 0.05);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Decode cues ahead of time so the first play has no latency. */
  preload(names: string[]): Promise<unknown> {
    return Promise.all(names.map((name) => this.load(name)));
  }

  load(name: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(name);
    if (cached) return Promise.resolve(cached);
    let promise = this.pending.get(name);
    if (!promise) {
      const entry = this.manifest.audio?.[name];
      promise = entry
        ? fetch(this.baseUrl + entry.path)
            .then((r) => r.arrayBuffer())
            .then((data) => this.context.decodeAudioData(data))
            .then((buffer) => {
              this.buffers.set(name, buffer);
              return buffer;
            })
            .catch((error) => {
              console.warn(`audio ${name} failed`, error);
              return null;
            })
        : Promise.resolve(null);
      this.pending.set(name, promise);
    }
    return promise;
  }

  /** Fire-and-forget cue; silently skipped if not loaded yet (it will be next time). */
  play(name: string, options: PlayOptions = {}, bus: GainNode = this.sfxBus): Voice | null {
    const buffer = this.buffers.get(name);
    if (!buffer) {
      void this.load(name);
      return null;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.pitch ?? 1;
    const entry = this.manifest.audio?.[name];
    if (options.loop) {
      source.loop = true;
      // MP3 adds encoder delay at the start; some browsers trim it on decode, some don't. Loop only the source samples.
      if (entry?.duration) {
        const priming = entry.mp3PrimingSeconds ?? 0;
        const offset = buffer.duration - entry.duration > priming / 2 ? priming : 0;
        source.loopStart = offset;
        source.loopEnd = offset + entry.duration;
      }
    }
    const gain = this.context.createGain();
    gain.gain.value = options.volume ?? 1;
    let tail: AudioNode = gain;
    if (options.pan) {
      const panner = this.context.createStereoPanner();
      panner.pan.value = options.pan;
      gain.connect(panner);
      tail = panner;
    }
    source.connect(gain);
    tail.connect(bus);
    let startOffset = options.loop ? source.loopStart : 0;
    const cycle = source.loopEnd - source.loopStart;
    if (options.loop && options.syncTo && cycle > 0) startOffset = source.loopStart + (options.syncTo.position() % cycle);
    source.start(0, startOffset);
    const context = this.context;
    const startedAt = context.currentTime - (startOffset - (options.loop ? source.loopStart : 0)) / source.playbackRate.value;
    return {
      gain,
      position() {
        const elapsed = (context.currentTime - startedAt) * source.playbackRate.value;
        return options.loop && cycle > 0 ? elapsed % cycle : elapsed;
      },
      stop(fadeSeconds = 0) {
        const now = context.currentTime;
        if (fadeSeconds > 0) {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
          source.stop(now + fadeSeconds + 0.05);
        } else {
          source.stop();
        }
      },
      setVolume(volume: number, seconds = 0) {
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        if (seconds > 0) {
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(volume, now + seconds);
        } else {
          gain.gain.setValueAtTime(volume, now);
        }
      },
    };
  }

  /**
   * Looping music/ambience on the music bus. `syncTo` starts the loop at the same position in its cycle as a
   * voice already playing (the era loops are sample-aligned, so crossfades stay on the beat).
   */
  loop(name: string, volume = 1, fadeIn = 0, syncTo?: Voice | null): Voice | null {
    const voice = this.play(name, { loop: true, volume: fadeIn > 0 ? 0 : volume, syncTo }, this.musicBus);
    if (voice && fadeIn > 0) voice.setVolume(volume, fadeIn);
    return voice;
  }
}
