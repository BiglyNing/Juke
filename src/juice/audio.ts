/**
 * Audio subsystem (Phase 7) — Web Audio, fully procedural.
 *
 * Every sound is *synthesized* (oscillators + filtered noise), so Juke ships
 * zero audio assets: nothing to license, source, or download, and it stays in
 * the CRT-arcade register by construction. The brief said "no audio" for input —
 * music and SFX output are explicitly in scope and high-leverage.
 *
 * Graph:  oscillators/noise → sfxBus  ─┐
 *                              musicBus → musicFilter ─┤→ master → destination
 * `master` is the mute gain; `musicFilter` is the "duck on death" low-pass that
 * briefly muffles the loop so the crush freeze-frame lands.
 *
 * Autoplay-safe: the context is created/resumed only from `unlock()`, which the
 * shell calls on the first real user gesture (the Enable-camera button). Before
 * that, and on any browser without Web Audio, every method is a silent no-op.
 */

const MUTE_KEY = 'juke.muted';
const MUSIC_GAIN = 0.16;
const SFX_GAIN = 0.5;

type Ctor = typeof AudioContext;

function audioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext ?? null;
}

const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// A-minor loop: 4-bar bass roots (A, F, G, A) and an 8-step pentatonic lead.
const BASS: number[] = [33, 29, 31, 33]; // one root per bar
const LEAD: number[] = [69, 72, 76, 72, 74, 72, 69, 67]; // eighth-note arpeggio

class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private muted = false;
  private musicOn = false;
  private intensity = 0;
  private scheduler = 0;
  private nextNoteTime = 0;
  private step = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* localStorage blocked — default unmuted */
    }
  }

  /** Create/resume the context on a user gesture. Idempotent. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = audioCtor();
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 1;
      master.connect(ctx.destination);

      const musicFilter = ctx.createBiquadFilter();
      musicFilter.type = 'lowpass';
      musicFilter.frequency.value = 20000;
      musicFilter.connect(master);

      const musicBus = ctx.createGain();
      musicBus.gain.value = MUSIC_GAIN;
      musicBus.connect(musicFilter);

      const sfxBus = ctx.createGain();
      sfxBus.gain.value = SFX_GAIN;
      sfxBus.connect(master);

      // 1s of white noise, reused by every percussive SFX.
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      this.master = master;
      this.musicFilter = musicFilter;
      this.musicBus = musicBus;
      this.sfxBus = sfxBus;
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // --- SFX -----------------------------------------------------------------

  /** Clean-pass swish: band-passed noise sweeping upward. */
  whoosh(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.22);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    src.connect(bp).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.34);
  }

  /** Near-miss crack: a high noise snap + a quick ping. */
  crack(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(hp).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.14);
    this.tone(1200, 900, 'square', 0.09, 0.2);
  }

  /** Crush thud: a low pitch-drop with a noisy body. */
  thud(): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noise) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(1, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    osc.connect(og).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.38);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.7, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(lp).connect(ng).connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.2);
  }

  /** UI click. */
  click(): void {
    this.tone(420, 600, 'square', 0.04, 0.18);
  }

  /**
   * Countdown beep. `step` 0..2 rise in pitch ("3","2","1"); the final downbeat
   * (`step` 3, the "GO") drops to a fat low note.
   */
  beep(step: number): void {
    const go = step >= 3;
    const freq = go ? 330 : 520 + step * 90;
    this.tone(freq, freq, go ? 'sawtooth' : 'square', go ? 0.28 : 0.12, 0.28);
  }

  /** New-high-score sting: a quick major arpeggio. */
  sting(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    [72, 76, 79, 84].forEach((m, i) => {
      this.tone(midiToFreq(m), midiToFreq(m), 'triangle', 0.4, 0.32, ctx.currentTime + i * 0.09);
    });
  }

  /** A short tone with an attack/decay envelope; the workhorse behind most SFX. */
  private tone(
    f0: number,
    f1: number,
    type: OscillatorType,
    dur: number,
    gain: number,
    at?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const t = at ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // --- Music ---------------------------------------------------------------

  /** Looping background track — starts on the menu and carries into gameplay. */
  startMusic(): void {
    if (this.musicOn || !this.ctx) return;
    this.musicOn = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.scheduler = window.setInterval(() => this.pump(), 25);
  }

  stopMusic(): void {
    this.musicOn = false;
    window.clearInterval(this.scheduler);
    this.scheduler = 0;
  }

  /**
   * Difficulty knob (0..1): raises tempo and, past the midpoint, layers an octave
   * on the lead so the music audibly tightens as a run speeds up.
   */
  setIntensity(x: number): void {
    this.intensity = Math.max(0, Math.min(1, x));
  }

  /** Briefly muffle + dip the music (the "duck on death"). */
  duck(ms = 600): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.musicFilter) return;
    const t = ctx.currentTime;
    const sec = ms / 1000;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(MUSIC_GAIN, t);
    this.musicBus.gain.linearRampToValueAtTime(MUSIC_GAIN * 0.25, t + 0.04);
    this.musicBus.gain.linearRampToValueAtTime(MUSIC_GAIN, t + sec);
    this.musicFilter.frequency.cancelScheduledValues(t);
    this.musicFilter.frequency.setValueAtTime(600, t);
    this.musicFilter.frequency.exponentialRampToValueAtTime(20000, t + sec);
  }

  /** Lookahead scheduler: queue any notes due within the next 120ms. */
  private pump(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const bpm = 96 + this.intensity * 40;
    const eighth = 30 / bpm; // seconds per eighth note
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      const s = this.step % 8;
      // Bass note once per bar (8 eighths).
      if (s === 0) {
        const root = BASS[(this.step / 8) % BASS.length | 0];
        this.musicNote(midiToFreq(root), this.nextNoteTime, eighth * 7, 'triangle', 0.5);
      }
      // Lead arpeggio every eighth; an octave doubling kicks in at high intensity.
      const lead = LEAD[s];
      this.musicNote(midiToFreq(lead), this.nextNoteTime, eighth * 0.9, 'square', 0.16);
      if (this.intensity > 0.5) {
        this.musicNote(midiToFreq(lead + 12), this.nextNoteTime, eighth * 0.9, 'square', 0.07);
      }
      this.nextNoteTime += eighth;
      this.step++;
    }
  }

  private musicNote(freq: number, at: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(this.musicBus);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}

/** The one shared audio instance — imported by the games, the shell, and main. */
export const audio = new Audio();
