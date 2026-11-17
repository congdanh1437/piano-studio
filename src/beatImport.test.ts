import { describe, expect, it } from 'vitest';
import { rowMidi } from './beat';
import { analyzeAudio, beatFromTranscription, detectPitch, estimateBpm, estimateKey, findDownbeat, nearestDegree, transcribe } from './beatImport';

const RATE = 44100;

/** Same noise every run, so a failure can be reproduced. */
function noiseSource(seed = 1) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 2147483648 - 1;
  };
}

interface Pattern {
  kick?: string;
  snare?: string;
  hat?: string;
  /** Step character is a semitone offset letter: a = +0, b = +1, ... above `bassRoot`. */
  bass?: string;
  bassRoot?: number;
}

function render(pattern: Pattern, bpm: number, seconds: number, swing = 0, lead = 0.5) {
  const out = new Float32Array(Math.round(seconds * RATE));
  const noise = noiseSource();
  const stepTime = 60 / bpm / 4;
  const add = (time: number, length: number, fn: (t: number) => number) => {
    const from = Math.round(time * RATE);
    const count = Math.round(length * RATE);
    for (let i = 0; i < count && from + i < out.length; i++) out[from + i] += fn(i / RATE);
  };
  const steps = Math.floor((seconds - lead) / stepTime);
  const size = (pattern.kick ?? pattern.hat ?? '').length || 16;
  for (let step = 0; step < steps; step++) {
    const time = lead + step * stepTime + (step % 2 === 1 ? swing * stepTime * 0.5 : 0);
    const at = step % size;
    if (pattern.kick?.[at] === 'x') {
      let phase = 0;
      add(time, 0.3, (t) => {
        phase += (2 * Math.PI * (45 + 105 * Math.exp(-t * 28))) / RATE;
        return Math.sin(phase) * Math.exp(-t * 14) * 0.9;
      });
    }
    if (pattern.snare?.[at] === 'x') {
      let prev = 0;
      add(time, 0.2, (t) => {
        const n = noise();
        const high = n - prev;
        prev = n;
        return (high * 0.35 + n * 0.2) * Math.exp(-t * 22) + Math.sin(2 * Math.PI * 900 * t) * 0.3 * Math.exp(-t * 30);
      });
    }
    if (pattern.hat?.[at] === 'x') {
      let prev = 0;
      add(time, 0.05, (t) => {
        const n = noise();
        const high = n - prev;
        prev = n;
        return high * 0.18 * Math.exp(-t * 80);
      });
    }
    const bassNote = pattern.bass?.[at];
    if (bassNote && bassNote !== '.') {
      const midi = (pattern.bassRoot ?? 40) + bassNote.charCodeAt(0) - 97;
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      add(time, 0.5, (t) => Math.sin(2 * Math.PI * frequency * t) * 0.45 * Math.exp(-t * 2.5) * Math.min(1, t * 200));
    }
  }
  return out;
}

const steps = (pattern: string, repeats = 1) =>
  Array.from({ length: repeats }, (_, r) => [...pattern].flatMap((c, i) => (c === 'x' ? [r * pattern.length + i] : []))).flat();

const BOOM = { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' };

describe('tempo', () => {
  it.each([70, 90, 100, 124, 140, 170])('finds %i BPM, or a half or double of it', (bpm) => {
    const analysis = analyzeAudio(render(BOOM, bpm, 20), RATE);
    const found = estimateBpm(analysis);
    const ratio = [1, 2, 0.5].map((m) => Math.abs(found - bpm * m));
    expect(Math.min(...ratio)).toBeLessThan(1);
  });

  it('survives silence and very short files', () => {
    expect(analyzeAudio(new Float32Array(44100), RATE).hasRhythm).toBe(false);
    const tiny = analyzeAudio(new Float32Array(100), RATE);
    expect(tiny.hasRhythm).toBe(false);
    expect(estimateBpm(tiny)).toBe(120);
  });
});

describe('downbeat', () => {
  it('starts the bar on the kick, even with a pickup before it', () => {
    const analysis = analyzeAudio(render(BOOM, 100, 16), RATE);
    const start = findDownbeat(analysis, 100);
    const barOffset = (start - 0.5) / (60 / 100 * 4);
    expect(Math.abs(barOffset - Math.round(barOffset))).toBeLessThan(0.03);
  });

  it.each([2, 5, 7, 11])('finds the bar when a file is cut %i steps into it', (cutSteps) => {
    const bpm = 100;
    const stepSeconds = 60 / bpm / 4;
    const whole = render(BOOM, bpm, 18, 0, 0);
    const samples = whole.subarray(Math.round(cutSteps * stepSeconds * RATE));
    const start = findDownbeat(analyzeAudio(samples, RATE), bpm);
    const inBar = (start / stepSeconds + cutSteps) % 16;
    expect(Math.min(inBar, 16 - inBar)).toBeLessThan(0.5);
  });

  it('recognises a half-time pattern', () => {
    const trap = { kick: 'x.....x.......x.', snare: '........x.......', hat: 'x.x.x.x.x.x.x.x.' };
    const bpm = 140;
    const stepSeconds = 60 / bpm / 4;
    const samples = render(trap, bpm, 14, 0, 0).subarray(Math.round(3 * stepSeconds * RATE));
    const start = findDownbeat(analyzeAudio(samples, RATE), bpm);
    const inBar = (start / stepSeconds + 3) % 16;
    expect(Math.min(inBar, 16 - inBar)).toBeLessThan(0.5);
  });
});

describe('transcribe', () => {
  it('reads kick, snare and hat at their steps', () => {
    const analysis = analyzeAudio(render(BOOM, 100, 16), RATE);
    const { drums } = transcribe(analysis, { bpm: 100, start: 0.5, bars: 2 });
    expect(drums.kick).toEqual(steps(BOOM.kick, 2));
    expect(drums.snare).toEqual(steps(BOOM.snare, 2));
    const hatOrSnare = [...drums.hat, ...drums.open, ...drums.snare].sort((a, b) => a - b);
    expect(hatOrSnare).toEqual(steps('x.x.x.x.x.x.x.x.', 2));
  });

  it('reads swing from late off-beats', () => {
    const swung = { kick: 'x.......x.......', hat: 'xxxxxxxxxxxxxxxx' };
    const analysis = analyzeAudio(render(swung, 90, 16, 0.4), RATE);
    const { swing } = transcribe(analysis, { bpm: 90, start: 0.5, bars: 2 });
    expect(swing).toBeGreaterThan(0.2);
    expect(swing).toBeLessThan(0.6);
    const straight = analyzeAudio(render(swung, 90, 16), RATE);
    expect(transcribe(straight, { bpm: 90, start: 0.5, bars: 2 }).swing).toBe(0);
  });

  it('tells a held bass note from a kick and reads its pitch', () => {
    const pattern = { bass: 'a.......h.......', bassRoot: 40, hat: 'x.x.x.x.x.x.x.x.' };
    const analysis = analyzeAudio(render(pattern, 100, 16), RATE);
    const { bass, drums } = transcribe(analysis, { bpm: 100, start: 0.5, bars: 1 });
    expect(bass).toEqual([{ step: 0, midi: 40 }, { step: 8, midi: 47 }]);
    expect(drums.kick).toEqual([]);
  });

  it('finds nothing in silence', () => {
    const analysis = analyzeAudio(new Float32Array(RATE * 4), RATE);
    const result = transcribe(analysis, { bpm: 120, start: 0, bars: 1 });
    expect(Object.values(result.drums).flat()).toEqual([]);
    expect(result.bass).toEqual([]);
  });
});

describe('pitch', () => {
  it.each([33, 40, 45, 52])('reads MIDI note %i', (midi) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const samples = new Float32Array(RATE);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * frequency * i) / RATE);
    expect(detectPitch(analyzeAudio(samples, RATE), 0.3)).toBe(midi);
  });
});

describe('key and grid', () => {
  it('picks the key from the bass notes', () => {
    const notes = [45, 45, 48, 52, 50, 45].map((midi) => ({ midi }));
    expect(estimateKey(notes)).toEqual({ root: 9, scale: 'minor' });
    expect(estimateKey([])).toEqual({ root: 0, scale: 'minor' });
  });

  it('puts an off-key note on the nearest row', () => {
    expect(nearestDegree(48, 0, 'minor')).toBe(0);
    expect(nearestDegree(51, 0, 'minor')).toBe(2);
    expect(nearestDegree(52, 0, 'minor')).toBeGreaterThanOrEqual(2);
  });

  it('builds a beat that plays the same notes and remembers the recording', () => {
    const beat = beatFromTranscription(
      { drums: { kick: [0, 8] }, bass: [{ step: 0, midi: 45 }, { step: 8, midi: 45 }], swing: 0.2 },
      { name: 'x', audioId: 'a1', bpm: 93.5, start: 1.25, bars: 2 },
    );
    expect(beat.grid.kick).toEqual([0, 8]);
    expect(beat.root).toBe(9);
    expect(beat.bpm).toBe(94);
    expect(beat.swing).toBe(0.2);
    expect(beat.grid.bass0).toEqual([0, 8]);
    expect(rowMidi(beat, 'bass', 0) % 12).toBe(9);
    expect(beat.backing).toMatchObject({ audioId: 'a1', start: 1.25, bpm: 93.5, on: true });
  });
});
