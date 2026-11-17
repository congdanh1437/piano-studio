import { Piano } from './audio';
import { InstrumentId } from './loop';
import { playDrum } from './sounds';

/**
 * The looper's instruments. Each starts a note at a given time and returns a handle
 * to end it, so recorded loops and live playing use exactly the same sounds.
 */

export interface Voice {
  stop(when: number): void;
}

export interface Instrument {
  id: InstrumentId;
  name: string;
  color: string;
  play(ctx: AudioContext, out: AudioNode, midi: number, velocity: number, when: number): Voice;
}

export interface DrumPad {
  id: string;
  name: string;
  midi: number;
  code: string;
  keyLabel: string;
}

/** General MIDI drum numbers, so recorded drums stay meaningful if exported later. */
export const DRUM_PADS: DrumPad[] = [
  { id: 'kick', name: 'Trống cái', midi: 36, code: 'KeyZ', keyLabel: 'Z' },
  { id: 'snare', name: 'Snare', midi: 38, code: 'KeyX', keyLabel: 'X' },
  { id: 'clap', name: 'Vỗ tay', midi: 39, code: 'KeyC', keyLabel: 'C' },
  { id: 'shaker', name: 'Shaker', midi: 70, code: 'KeyV', keyLabel: 'V' },
  { id: 'hat', name: 'Hi-hat', midi: 42, code: 'KeyA', keyLabel: 'A' },
  { id: 'open', name: 'Hi-hat mở', midi: 46, code: 'KeyS', keyLabel: 'S' },
  { id: 'tom', name: 'Tom', midi: 45, code: 'KeyD', keyLabel: 'D' },
  { id: 'perc', name: 'Cowbell', midi: 56, code: 'KeyF', keyLabel: 'F' },
];

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const NO_VOICE: Voice = { stop: () => {} };

function envelope(ctx: AudioContext, out: AudioNode, when: number, attack: number, peak: number, sustain: number, decay: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(peak, when + attack);
  gain.gain.setTargetAtTime(peak * sustain, when + attack, decay);
  gain.connect(out);
  return gain;
}

/** Fades out and stops everything a note started. */
function voiceOf(ctx: AudioContext, gain: GainNode, sources: AudioScheduledSourceNode[], release: number): Voice {
  let stopped = false;
  return {
    stop(when: number) {
      if (stopped) return;
      stopped = true;
      const at = Math.max(when, ctx.currentTime);
      gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(0, at, release / 4);
      for (const source of sources) source.stop(at + release * 1.5);
    },
  };
}

function electricPiano(ctx: AudioContext, out: AudioNode, midi: number, velocity: number, when: number): Voice {
  // Two-operator FM: the bell-like attack fades into a softer tone, like a Rhodes.
  const gain = envelope(ctx, out, when, 0.005, 0.25 + velocity * 0.3, 0.35, 0.6);
  const carrier = ctx.createOscillator();
  carrier.frequency.value = frequency(midi);
  const modulator = ctx.createOscillator();
  modulator.frequency.value = frequency(midi);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(frequency(midi) * (1 + velocity * 2), when);
  depth.gain.setTargetAtTime(frequency(midi) * 0.3, when, 0.25);
  modulator.connect(depth).connect(carrier.frequency);
  carrier.connect(gain);
  carrier.start(when);
  modulator.start(when);
  return voiceOf(ctx, gain, [carrier, modulator], 0.3);
}

function pad(ctx: AudioContext, out: AudioNode, midi: number, velocity: number, when: number): Voice {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900 + velocity * 900;
  const gain = envelope(ctx, out, when, 0.35, 0.12 + velocity * 0.08, 0.85, 2);
  filter.connect(gain);
  const sources = [-9, 9, 0].map((detune, i) => {
    const osc = ctx.createOscillator();
    osc.type = i < 2 ? 'sawtooth' : 'triangle';
    osc.frequency.value = frequency(midi) / (i < 2 ? 1 : 2);
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(when);
    return osc;
  });
  return voiceOf(ctx, gain, sources, 0.8);
}

function sineLead(ctx: AudioContext, out: AudioNode, midi: number, velocity: number, when: number): Voice {
  const gain = envelope(ctx, out, when, 0.01, 0.2 + velocity * 0.2, 0.8, 1.5);
  const osc = ctx.createOscillator();
  osc.frequency.value = frequency(midi);
  // A gentle vibrato that only comes in once the note is held.
  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.5;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, when);
  depth.gain.linearRampToValueAtTime(frequency(midi) * 0.006, when + 0.4);
  vibrato.connect(depth).connect(osc.frequency);
  osc.connect(gain);
  osc.start(when);
  vibrato.start(when);
  return voiceOf(ctx, gain, [osc, vibrato], 0.15);
}

const SATURATION = (() => {
  const curve = new Float32Array(512);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2);
  return curve;
})();

function bass(ctx: AudioContext, out: AudioNode, midi: number, velocity: number, when: number): Voice {
  const gain = envelope(ctx, out, when, 0.005, 0.35 + velocity * 0.3, 0.6, 0.8);
  const shaper = ctx.createWaveShaper();
  shaper.curve = SATURATION;
  shaper.connect(gain);
  const osc = ctx.createOscillator();
  osc.frequency.value = frequency(midi);
  osc.connect(shaper);
  osc.start(when);
  return voiceOf(ctx, gain, [osc], 0.08);
}

export function createInstruments(piano: Piano): Record<InstrumentId, Instrument> {
  return {
    piano: {
      id: 'piano', name: 'Piano', color: '#4fd1c5',
      play: (_ctx, out, midi, velocity, when) => piano.voice(midi, velocity, when, out) ?? NO_VOICE,
    },
    ep: { id: 'ep', name: 'Electric piano', color: '#f2c14e', play: electricPiano },
    pad: { id: 'pad', name: 'Pad', color: '#b79cf5', play: pad },
    sine: { id: 'sine', name: 'Sine lead', color: '#7cc6ff', play: sineLead },
    bass: { id: 'bass', name: 'Bass', color: '#f6a04d', play: bass },
    drums: {
      id: 'drums', name: 'Trống', color: '#ef6461',
      play: (ctx, out, midi, _velocity, when) => {
        const drum = DRUM_PADS.find((d) => d.midi === midi);
        if (drum) playDrum(ctx, out, drum.id, when);
        return NO_VOICE;
      },
    },
  };
}

export const INSTRUMENT_ORDER: InstrumentId[] = ['piano', 'ep', 'pad', 'sine', 'bass', 'drums'];

/**
 * Master effects: a filter to sweep, a tempo-synced echo and a room. Everything the
 * audience would hear passes through here, so recordings capture effect moves too.
 */
export class EffectsChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly delay: DelayNode;
  private readonly delayWet: GainNode;
  private readonly reverbWet: GainNode;

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.output.gain.value = 0.8;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.9;
    this.input.connect(this.filter);
    this.filter.connect(this.output);

    this.delay = ctx.createDelay(2);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    this.delayWet = ctx.createGain();
    this.filter.connect(this.delay);
    this.delay.connect(feedback).connect(this.delay);
    this.delay.connect(this.delayWet).connect(this.output);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.roomImpulse(2.4);
    this.reverbWet = ctx.createGain();
    this.filter.connect(reverb);
    reverb.connect(this.reverbWet).connect(this.output);
  }

  /** 0 closes the filter down to a muffled thump; 1 leaves it fully open. */
  setFilter(amount: number) {
    const hz = 120 * 2 ** (amount * 7.4);
    this.filter.frequency.setTargetAtTime(Math.min(20000, hz), this.ctx.currentTime, 0.02);
  }

  setDelay(amount: number, bpm: number) {
    this.delay.delayTime.setTargetAtTime(Math.min(2, (60 / bpm) * 0.75), this.ctx.currentTime, 0.05);
    this.delayWet.gain.setTargetAtTime(amount * 0.6, this.ctx.currentTime, 0.02);
  }

  setReverb(amount: number) {
    this.reverbWet.gain.setTargetAtTime(amount * 0.9, this.ctx.currentTime, 0.02);
  }

  private roomImpulse(seconds: number): AudioBuffer {
    const length = Math.round(seconds * this.ctx.sampleRate);
    const buffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    return buffer;
  }
}
