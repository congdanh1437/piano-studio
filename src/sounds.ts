import { Beat, exportLoops, encodeWav, Part, partOfRow, rowMidi, rowsAtStep, stepCount, stepDuration, stepTime } from './beat';

/**
 * All beat sounds are synthesized. The same code feeds the speakers and the WAV
 * export, so an exported file sounds like what was heard, and nothing needs downloading.
 */

export interface Bus {
  parts: Record<Part, GainNode>;
}

export function createBus(ctx: BaseAudioContext, beat: Beat): Bus {
  // A soft clipper, not a compressor: its curve tops out below 1, so loud hits can't distort
  // harshly, and it can't push the level up the way the browser's compressor does.
  const input = ctx.createGain();
  input.gain.value = 0.5;
  const clipper = ctx.createWaveShaper();
  clipper.curve = SATURATION;
  input.connect(clipper).connect(ctx.destination);
  const part = (name: Part) => {
    const gain = ctx.createGain();
    gain.gain.value = beat.mix[name];
    gain.connect(input);
    return gain;
  };
  return { parts: { drums: part('drums'), bass: part('bass'), lead: part('lead') } };
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBufferSourceNode {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  return source;
}

function envelope(ctx: BaseAudioContext, out: AudioNode, time: number, peak: number, decay: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  gain.connect(out);
  return gain;
}

function sweep(ctx: BaseAudioContext, out: AudioNode, time: number, from: number, to: number, sweepTime: number, peak: number, decay: number) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, time);
  osc.frequency.exponentialRampToValueAtTime(to, time + sweepTime);
  osc.connect(envelope(ctx, out, time, peak, decay));
  osc.start(time);
  osc.stop(time + decay + 0.02);
}

function burst(ctx: BaseAudioContext, out: AudioNode, time: number, type: BiquadFilterType, frequency: number, peak: number, decay: number) {
  const source = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  source.connect(filter).connect(envelope(ctx, out, time, peak, decay));
  source.start(time);
  source.stop(time + decay + 0.02);
}

export function playDrum(ctx: BaseAudioContext, out: AudioNode, id: string, time: number) {
  switch (id) {
    case 'kick':
      sweep(ctx, out, time, 150, 45, 0.09, 1, 0.32);
      break;
    case 'snare':
      sweep(ctx, out, time, 220, 160, 0.05, 0.45, 0.12);
      burst(ctx, out, time, 'highpass', 1800, 0.6, 0.18);
      break;
    case 'clap':
      for (const delay of [0, 0.012, 0.024]) burst(ctx, out, time + delay, 'bandpass', 1400, 0.55, 0.05);
      burst(ctx, out, time + 0.03, 'bandpass', 1400, 0.5, 0.2);
      break;
    case 'hat':
      burst(ctx, out, time, 'highpass', 8000, 0.3, 0.045);
      break;
    case 'open':
      burst(ctx, out, time, 'highpass', 7000, 0.3, 0.32);
      break;
    case 'tom':
      sweep(ctx, out, time, 200, 95, 0.12, 0.75, 0.28);
      break;
    case 'shaker':
      // Two quick swishes, like beads hitting the inside of the shell.
      burst(ctx, out, time, 'bandpass', 6500, 0.22, 0.05);
      burst(ctx, out, time + 0.018, 'highpass', 5500, 0.3, 0.07);
      break;
    case 'perc':
      for (const frequency of [540, 800]) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = frequency;
        osc.connect(envelope(ctx, out, time, 0.16, 0.16));
        osc.start(time);
        osc.stop(time + 0.18);
      }
      break;
  }
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const SATURATION = (() => {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 2.2);
  return curve;
})();

function playBass(ctx: BaseAudioContext, out: AudioNode, midi: number, time: number) {
  const osc = ctx.createOscillator();
  osc.frequency.value = frequency(midi);
  const drive = ctx.createWaveShaper();
  drive.curve = SATURATION;
  osc.connect(drive).connect(envelope(ctx, out, time, 0.8, 0.55));
  osc.start(time);
  osc.stop(time + 0.57);
}

function playLead(ctx: BaseAudioContext, out: AudioNode, midi: number, time: number) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3200, time);
  filter.frequency.exponentialRampToValueAtTime(700, time + 0.3);
  filter.connect(envelope(ctx, out, time, 0.4, 0.42));
  for (const [type, detune] of [['sawtooth', -6], ['triangle', 6]] as const) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency(midi);
    osc.detune.value = detune;
    osc.connect(filter);
    osc.start(time);
    osc.stop(time + 0.44);
  }
}

export function playRow(ctx: BaseAudioContext, bus: Bus, beat: Beat, row: string, time: number) {
  const part = partOfRow(row);
  const out = bus.parts[part];
  if (part === 'drums') playDrum(ctx, out, row, time);
  else if (part === 'bass') playBass(ctx, out, rowMidi(beat, 'bass', Number(row.slice(4))), time);
  else playLead(ctx, out, rowMidi(beat, 'lead', Number(row.slice(4))), time);
}

const SAMPLE_RATE = 44100;
const TAIL_SECONDS = 1;

export async function renderWav(beat: Beat): Promise<ArrayBuffer> {
  const loops = exportLoops(beat);
  const steps = stepCount(beat);
  const seconds = loops * steps * stepDuration(beat.bpm) + TAIL_SECONDS;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const bus = createBus(ctx, beat);
  for (let step = 0; step < loops * steps; step++) {
    const time = stepTime(step, beat.bpm, beat.swing);
    for (const row of rowsAtStep(beat, step % steps)) playRow(ctx, bus, beat, row, time);
  }
  const rendered = await ctx.startRendering();
  return encodeWav([rendered.getChannelData(0), rendered.getChannelData(1)], SAMPLE_RATE);
}
