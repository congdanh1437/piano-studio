/** Salamander Grand Piano samples (CC-BY 3.0, Alexander Holm), one every three semitones. */
const SAMPLE_BASE = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_NAMES: Record<number, string> = { 9: 'A', 0: 'C', 3: 'Ds', 6: 'Fs' };
const SAMPLE_MIDIS = Array.from({ length: 30 }, (_, i) => 21 + i * 3);
const PARALLEL_DOWNLOADS = 6;
const RELEASE_TIME = 0.08;

interface Voice {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class Piano {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private samples = new Map<number, AudioBuffer>();
  private held = new Map<number, Voice>();
  private loading = false;
  samplesLoaded = 0;
  readonly samplesTotal = SAMPLE_MIDIS.length;

  /** Must first run inside a click: browsers keep audio off until the user acts. */
  unlock() {
    this.context();
    void this.loadSamples();
  }

  /** The app's one audio context, without fetching piano samples. */
  context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    return this.ctx;
  }

  /** Output delay the browser reports, in ms; touch-screen delay comes on top of this. */
  get latencyMs(): number | null {
    if (!this.ctx) return null;
    return Math.round((this.ctx.baseLatency + (this.ctx.outputLatency || 0)) * 1000);
  }

  noteOn(midi: number, velocity = 0.8) {
    this.noteOff(midi);
    const voice = this.start(midi, velocity);
    if (voice) this.held.set(midi, voice);
  }

  noteOff(midi: number) {
    const voice = this.held.get(midi);
    if (voice && this.ctx) this.release(voice, this.ctx.currentTime);
    this.held.delete(midi);
  }

  /** Plays a note that nobody is holding, such as the accompanying hand. */
  playFor(midi: number, velocity: number, seconds: number) {
    const voice = this.start(midi, velocity);
    if (voice && this.ctx) this.release(voice, this.ctx.currentTime + seconds);
  }

  stopAll() {
    for (const midi of [...this.held.keys()]) this.noteOff(midi);
  }

  /** A piano note at a set time into any output, for other screens such as the looper. */
  voice(midi: number, velocity: number, when: number, output: AudioNode): { stop(at: number): void } | null {
    const voice = this.start(midi, velocity, when, output);
    return voice ? { stop: (at: number) => this.release(voice, Math.max(at, when)) } : null;
  }

  private start(midi: number, velocity: number, when?: number, output?: AudioNode): Voice | null {
    const { ctx, master } = this;
    if (!ctx || !master) return null;
    const at = when ?? ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(output ?? master);
    const sample = this.nearestSample(midi);
    const voice = sample
      ? this.startSample(ctx, gain, sample, midi, velocity, at)
      : this.startSynth(ctx, gain, midi, velocity, at);
    return voice;
  }

  private nearestSample(midi: number): { root: number; buffer: AudioBuffer } | null {
    let best: { root: number; buffer: AudioBuffer } | null = null;
    for (const [root, buffer] of this.samples) {
      if (!best || Math.abs(root - midi) < Math.abs(best.root - midi)) best = { root, buffer };
    }
    return best;
  }

  private startSample(
    ctx: AudioContext,
    gain: GainNode,
    sample: { root: number; buffer: AudioBuffer },
    midi: number,
    velocity: number,
    when: number,
  ): Voice {
    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = 2 ** ((midi - sample.root) / 12);
    gain.gain.value = 0.25 + velocity * 0.75;
    source.connect(gain);
    source.start(when);
    return { gain, sources: [source] };
  }

  /** Fallback until samples arrive, and when offline before they were ever cached. */
  private startSynth(ctx: AudioContext, gain: GainNode, midi: number, velocity: number, now: number): Voice {
    const peak = 0.12 + velocity * 0.3;
    gain.gain.setValueAtTime(peak, now);
    gain.gain.setTargetAtTime(peak * 0.05, now + 0.01, 0.9);
    const sources = [
      { type: 'triangle', ratio: 1, level: 1 },
      { type: 'sine', ratio: 2, level: 0.35 },
    ].map(({ type, ratio, level }) => {
      const osc = ctx.createOscillator();
      const partial = ctx.createGain();
      osc.type = type as OscillatorType;
      osc.frequency.value = frequency(midi) * ratio;
      partial.gain.value = level;
      osc.connect(partial).connect(gain);
      osc.start(now);
      return osc;
    });
    return { gain, sources };
  }

  private release(voice: Voice, when: number) {
    voice.gain.gain.cancelScheduledValues(when);
    voice.gain.gain.setTargetAtTime(0, when, RELEASE_TIME);
    for (const source of voice.sources) source.stop(when + RELEASE_TIME * 6);
  }

  private async loadSamples() {
    if (this.loading) return;
    this.loading = true;
    // The middle of the piano is what gets played first.
    const queue = [...SAMPLE_MIDIS].sort((a, b) => Math.abs(a - 60) - Math.abs(b - 60));
    const worker = async () => {
      for (let midi = queue.shift(); midi !== undefined; midi = queue.shift()) {
        try {
          const name = `${SAMPLE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}.mp3`;
          const response = await fetch(SAMPLE_BASE + name);
          if (!response.ok) continue;
          this.samples.set(midi, await this.ctx!.decodeAudioData(await response.arrayBuffer()));
          this.samplesLoaded++;
        } catch {
          // Offline: the nearest sample or the synth covers this note.
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, worker));
  }
}
