import { Beat, emptyBeat, ScaleName, setStep, STEPS_PER_BAR } from './beat';

/**
 * Turns audio into a step grid: band-by-band onset strength, then tempo, then a
 * look at each step of the chosen section. It is an estimate; the user corrects it.
 */

const FRAME = 512;
const HOP = 128;
const ANALYSIS_RATE_TARGET = 22050;
const PITCH_DECIMATION = 16;
const MIN_BPM = 60;
const MAX_BPM = 180;
const TEMPO_WINDOW_SECONDS = 60;
const SILENCE = 1e-3;

type Band = 'low' | 'lowMid' | 'mid' | 'high';
const BANDS: Record<Band, [number, number]> = {
  low: [30, 120],
  lowMid: [120, 400],
  mid: [400, 4000],
  high: [6000, 11000],
};
const BAND_NAMES = Object.keys(BANDS) as Band[];

export interface Analysis {
  duration: number;
  /** Seconds between analysis frames. */
  frameTime: number;
  /** Onset strength per frame, scaled so a typical strong hit is about 1. */
  flux: Record<Band, Float32Array>;
  /** Level per frame, scaled so a loud moment is about 1. Tells a short hit from a held note. */
  level: Record<Band, Float32Array>;
  /** Undoes the scaling of `level`, to compare one band with another. */
  levelScale: Record<Band, number>;
  /** Heavily downsampled signal for reading bass pitch. */
  pitchSignal: Float32Array;
  pitchRate: number;
  hasRhythm: boolean;
}

function fftMagnitudes(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = -sin[k * step];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

function downsample(samples: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return samples;
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    out[i] = sum / factor;
  }
  return out;
}

/** Typical strength of a real hit in this band, ignoring the quiet frames between hits. */
function hitLevel(values: Float32Array): number {
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] >= values[i + 1]) peaks.push(values[i]);
  }
  if (peaks.length === 0) return 0;
  peaks.sort((a, b) => a - b);
  return peaks[Math.floor(peaks.length * 0.95)];
}

export function analyzeAudio(samples: Float32Array, sampleRate: number): Analysis {
  const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE_TARGET));
  const signal = downsample(samples, factor);
  const rate = sampleRate / factor;
  const frames = Math.max(0, Math.floor((signal.length - FRAME) / HOP));

  const cos = new Float64Array(FRAME);
  const sin = new Float64Array(FRAME);
  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / FRAME);
    sin[i] = Math.sin((2 * Math.PI * i) / FRAME);
    window[i] = 0.5 - 0.5 * cos[i];
  }
  const bins = Object.fromEntries(
    BAND_NAMES.map((band) => [
      band,
      [
        Math.max(1, Math.round((BANDS[band][0] * FRAME) / rate)),
        Math.min(FRAME / 2 - 1, Math.round((BANDS[band][1] * FRAME) / rate)),
      ],
    ]),
  ) as Record<Band, [number, number]>;

  const flux = {} as Record<Band, Float32Array>;
  const level = {} as Record<Band, Float32Array>;
  const levelScale = {} as Record<Band, number>;
  for (const band of BAND_NAMES) {
    flux[band] = new Float32Array(frames);
    level[band] = new Float32Array(frames);
  }

  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const previous = new Float64Array(FRAME / 2);
  let loudest = 0;

  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = signal[offset + i] * window[i];
      im[i] = 0;
      loudest = Math.max(loudest, Math.abs(signal[offset + i]));
    }
    fftMagnitudes(re, im, cos, sin);
    for (const band of BAND_NAMES) {
      const [from, to] = bins[band];
      let change = 0;
      let energy = 0;
      for (let bin = from; bin <= to; bin++) {
        const magnitude = Math.hypot(re[bin], im[bin]);
        energy += magnitude * magnitude;
        // Log scale, so a quiet hi-hat registers next to a loud kick.
        const compressed = Math.log1p(100 * magnitude);
        change += Math.max(0, compressed - previous[bin]);
      }
      flux[band][frame] = change / (to - from + 1);
      level[band][frame] = Math.sqrt(energy);
    }
    for (const band of BAND_NAMES) {
      const [from, to] = bins[band];
      for (let bin = from; bin <= to; bin++) previous[bin] = Math.log1p(100 * Math.hypot(re[bin], im[bin]));
    }
  }

  for (const band of BAND_NAMES) {
    const scale = hitLevel(flux[band]);
    if (scale > 0) for (let i = 0; i < frames; i++) flux[band][i] /= scale;
    // From all frames, not just peaks: quiet ripples would otherwise drag the scale down.
    const sorted = level[band].slice().sort();
    const loud = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    levelScale[band] = loud || 1;
    if (loud > 0) for (let i = 0; i < frames; i++) level[band][i] /= loud;
  }

  return {
    duration: samples.length / sampleRate,
    frameTime: HOP / rate,
    flux,
    level,
    levelScale,
    pitchSignal: downsample(downsample(signal, PITCH_DECIMATION / 2), 2),
    pitchRate: rate / PITCH_DECIMATION,
    hasRhythm: loudest > SILENCE && frames > 0,
  };
}

/** Frames line up with the middle of their analysis window. */
const frameAt = (analysis: Analysis, seconds: number) =>
  Math.round(seconds / analysis.frameTime - FRAME / (2 * HOP));

const timeOfFrame = (analysis: Analysis, frame: number) => (frame + FRAME / (2 * HOP)) * analysis.frameTime;

function combined(analysis: Analysis): Float32Array {
  const { low, mid, high } = analysis.flux;
  const out = new Float32Array(low.length);
  for (let i = 0; i < out.length; i++) out[i] = low[i] + mid[i] + 0.5 * high[i];
  return out;
}

function firstStrongFrame(envelope: Float32Array): number {
  const threshold = 0.3 * hitLevel(envelope);
  const found = envelope.findIndex((v) => v > threshold);
  return Math.max(0, found);
}

/** Most dance and hip-hop tempos sit near this, which settles half-or-double ties. */
const FAVOURED_BPM = 115;
const FIRST_SOUND_BONUS = 0.2;
const PROBE_BARS = 8;

export function estimateBpm(analysis: Analysis): number {
  const envelope = combined(analysis);
  const start = firstStrongFrame(envelope);
  const length = Math.min(envelope.length - start, Math.round(TEMPO_WINDOW_SECONDS / analysis.frameTime));
  if (length < 8) return 120;
  const slice = envelope.subarray(start, start + length);
  const mean = slice.reduce((sum, v) => sum + v, 0) / length;

  const beatFrames = (bpm: number) => 60 / bpm / analysis.frameTime;
  const maxLag = Math.min(length - 1, Math.ceil(beatFrames(MIN_BPM) * 8));
  const correlation = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < length; i++) sum += (slice[i] - mean) * (slice[i + lag] - mean);
    correlation[lag] = sum / (length - lag);
  }

  let best = 120;
  let bestScore = -Infinity;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
    const lag = beatFrames(bpm);
    let score = 0;
    let used = 0;
    // Several multiples of the beat pin the tempo down far finer than one frame.
    for (const multiple of [1, 2, 3, 4, 6, 8]) {
      const at = Math.round(lag * multiple);
      if (at <= maxLag) {
        score += correlation[at];
        used++;
      }
    }
    if (used === 0) continue;
    const distance = Math.log2(bpm / FAVOURED_BPM);
    const weighted = (score / used) * Math.exp(-0.5 * (distance / 0.9) ** 2);
    if (weighted > bestScore) {
      bestScore = weighted;
      best = bpm;
    }
  }
  // Produced music is nearly always on a whole-number tempo.
  return Math.abs(best - Math.round(best)) <= 0.3 ? Math.round(best) : best;
}

/** Where a bar starts, judged from the usual placement of kick and snare. */
export function findDownbeat(analysis: Analysis, bpm: number): number {
  const beat = 60 / bpm;
  const step = beat / 4;
  const envelope = combined(analysis);
  const begin = timeOfFrame(analysis, firstStrongFrame(envelope));
  const candidates = Math.ceil(step / analysis.frameTime);
  const beats = Math.floor(Math.min(analysis.duration - begin, TEMPO_WINDOW_SECONDS) / beat);

  // First line the grid up with the sixteenths, which every pattern shares.
  let phase = 0;
  let phaseScore = -Infinity;
  for (let offset = -Math.floor(candidates / 2); offset < Math.ceil(candidates / 2); offset++) {
    let score = 0;
    for (let i = 0; i < beats * 4; i++) {
      const frame = frameAt(analysis, begin + i * step) + offset;
      if (frame >= 0 && frame < envelope.length) score += envelope[frame];
    }
    if (score > phaseScore) {
      phaseScore = score;
      phase = offset * analysis.frameTime;
    }
  }

  // Read a stretch of the music, and count where kicks and snares fall within a bar.
  const origin = begin + phase;
  const probeBars = Math.max(1, Math.min(PROBE_BARS, Math.floor(beats / 4)));
  const probe = transcribe(analysis, { bpm, start: origin, bars: probeBars });
  const kicks = new Array(STEPS_PER_BAR).fill(0);
  const snares = new Array(STEPS_PER_BAR).fill(0);
  for (const s of probe.drums.kick) kicks[s % STEPS_PER_BAR]++;
  for (const s of probe.drums.snare) snares[s % STEPS_PER_BAR]++;

  // A bar opens on a kick, with the snare on beats 2 and 4, or on beat 3 in half-time
  // styles such as trap. Try the bar starting on each of the 16 steps.
  const kick = (position: number) => kicks[position % STEPS_PER_BAR];
  const snare = (position: number) => snares[position % STEPS_PER_BAR];
  const scores = kicks.map((_, shift) =>
    3 * kick(shift) + kick(shift + 8) - kick(shift + 4) - kick(shift + 12)
    + Math.max(2 * (snare(shift + 4) + snare(shift + 12)), 3 * snare(shift + 8)),
  );
  // Most beat files open right on a bar, so the first sound wins anything close.
  scores[0] += FIRST_SOUND_BONUS * Math.max(...scores, 1);
  const bestShift = scores.indexOf(Math.max(...scores));
  return Math.max(0, origin + bestShift * step);
}

export function detectPitch(analysis: Analysis, seconds: number): number | null {
  const { pitchSignal: signal, pitchRate: rate } = analysis;
  const start = Math.round(seconds * rate);
  const size = Math.round(0.14 * rate);
  if (start < 0 || start + size * 2 >= signal.length) return null;
  const minLag = Math.floor(rate / 280);
  const maxLag = Math.min(size, Math.ceil(rate / 35));
  let energy = 0;
  for (let i = 0; i < size; i++) energy += signal[start + i] ** 2;
  if (energy < 1e-5) return null;

  const scores = new Float64Array(maxLag + 2);
  let top = 0;
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let sum = 0;
    let other = 0;
    for (let i = 0; i < size; i++) {
      sum += signal[start + i] * signal[start + i + lag];
      other += signal[start + i + lag] ** 2;
    }
    scores[lag] = sum / Math.sqrt(energy * other + 1e-12);
    if (lag <= maxLag) top = Math.max(top, scores[lag]);
  }
  if (top < 0.6) return null;
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    // The first strong peak is the true period; later ones are its multiples.
    if (scores[lag] >= top * 0.9 && scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]) {
      const curve = scores[lag - 1] - 2 * scores[lag] + scores[lag + 1];
      const refined = curve === 0 ? lag : lag + (0.5 * (scores[lag - 1] - scores[lag + 1])) / curve;
      return Math.round(69 + 12 * Math.log2(rate / refined / 440));
    }
  }
  return null;
}

export interface Transcription {
  /** Step numbers per drum row. */
  drums: Record<string, number[]>;
  bass: { step: number; midi: number }[];
  swing: number;
}

export const HIT_THRESHOLD = { low: 0.35, lowMid: 0.35, mid: 0.4, high: 0.3 };
const MIN_LOUDNESS: Record<Band, number> = { low: 0.25, lowMid: 0.15, mid: 0.35, high: 0.08 };
const KICK_BRIGHTNESS = 0.5;
const KICK_PUNCH_DELAY = 0.09;
const KICK_PUNCH_DECAY = 0.9;
const MID_RISE = 1.6;
const SNARE_HIGH_LEVEL = 0.4;
const BASS_UNDER_KICK = 0.33;
const OPEN_HAT_DELAY = 0.1;
const OPEN_HAT_RATIO = 0.3;

export function transcribe(analysis: Analysis, options: { bpm: number; start: number; bars: number }): Transcription {
  const { bpm, start, bars } = options;
  const stepSeconds = 60 / bpm / 4;
  const drums: Record<string, number[]> = { kick: [], snare: [], hat: [], open: [] };
  const bass: { step: number; midi: number }[] = [];
  const lateness: number[] = [];

  const strongest = (band: Band, center: number) => {
    // Off-beat notes can be swung late, so look further ahead than behind.
    const from = frameAt(analysis, center - stepSeconds * 0.35);
    const to = frameAt(analysis, center + stepSeconds * 0.6);
    let peak = 0;
    let at = from;
    const values = analysis.flux[band];
    const loudness = analysis.level[band];
    for (let f = Math.max(0, from); f <= to && f < values.length; f++) {
      // Onset strength is on a log scale, so a tiny leak from another drum can look like
      // a hit. A real hit must also be loud for its band.
      let loud = 0;
      for (let g = f; g <= f + 4; g++) loud = Math.max(loud, loudness[g] ?? 0);
      if (values[f] > peak && loud >= MIN_LOUDNESS[band]) {
        peak = values[f];
        at = f;
      }
    }
    return { peak, time: timeOfFrame(analysis, at) };
  };
  const levelAfter = (band: Band, time: number, delay: number) => {
    const values = analysis.level[band];
    const at = (t: number) => {
      const center = frameAt(analysis, t);
      let top = 0;
      for (let f = center; f <= center + 3; f++) top = Math.max(top, values[f] ?? 0);
      return top;
    };
    const now = at(time);
    return now > 0 ? at(time + delay) / now : 0;
  };

  const rawLevel = (band: Band, time: number) =>
    (analysis.level[band][frameAt(analysis, time)] ?? 0) * analysis.levelScale[band];

  for (let step = 0; step < bars * STEPS_PER_BAR; step++) {
    const center = start + step * stepSeconds;
    const low = strongest('low', center);
    const mid = strongest('mid', center);
    const high = strongest('high', center);

    // Something new must have started: a note still ringing doesn't count as a hit.
    const lowRose = rawLevel('low', low.time + 0.025) > 1.25 * rawLevel('low', low.time - 0.03);
    if (low.peak > HIT_THRESHOLD.low && lowRose) {
      // A kick's pitch falls fast, so its upper-low attack vanishes while its low end stays.
      // A bass note fades evenly across both bands, however short it is.
      const attack = rawLevel('lowMid', low.time + 0.012);
      const body = rawLevel('low', low.time + 0.012);
      const lowMidLeft = attack > 0 ? rawLevel('lowMid', low.time + KICK_PUNCH_DELAY) / attack : 1;
      const lowLeft = body > 0 ? rawLevel('low', low.time + KICK_PUNCH_DELAY) / body : 0;
      const punchy = attack > KICK_BRIGHTNESS * body && lowMidLeft < KICK_PUNCH_DECAY * lowLeft;
      // A kick on its own has mostly gone by now; if much is left, a bass note came with it.
      const withBass = lowLeft > BASS_UNDER_KICK;
      const midi = !punchy ? detectPitch(analysis, low.time + 0.05) : withBass ? detectPitch(analysis, low.time + KICK_PUNCH_DELAY) : null;
      if (punchy || midi === null) drums.kick.push(step);
      if (midi !== null) bass.push({ step, midi });
    }

    // Noise from a real snare lifts the mid band. Hi-hat leakage over a note that is
    // already playing doesn't, even though it looks like an onset on the log scale.
    const midRose = rawLevel('mid', mid.time + 0.015) > MID_RISE * rawLevel('mid', mid.time - 0.03);
    // A snare is also far louder up high than a hi-hat or the top of a kick.
    const loudUpHigh = rawLevel('high', high.time + 0.015) / analysis.levelScale.high > SNARE_HIGH_LEVEL;
    const snare = mid.peak > HIT_THRESHOLD.mid && midRose && high.peak > HIT_THRESHOLD.high && loudUpHigh;
    const highRose = rawLevel('high', high.time + 0.015) > MID_RISE * rawLevel('high', high.time - 0.03);
    if (snare) drums.snare.push(step);
    else if (high.peak > HIT_THRESHOLD.high && highRose) {
      const open = levelAfter('high', high.time, OPEN_HAT_DELAY) > OPEN_HAT_RATIO;
      drums[open ? 'open' : 'hat'].push(step);
    }

    const hits = [low, mid, high].filter((h, i) => h.peak > [HIT_THRESHOLD.low, HIT_THRESHOLD.mid, HIT_THRESHOLD.high][i]);
    if (hits.length > 0 && step % 2 === 1) {
      lateness.push(Math.min(...hits.map((h) => h.time)) - center);
    }
  }

  let swing = 0;
  if (lateness.length >= 4) {
    lateness.sort((a, b) => a - b);
    const median = lateness[Math.floor(lateness.length / 2)];
    swing = Math.max(0, Math.min(0.6, median / (stepSeconds * 0.5)));
    swing = Math.round(swing * 20) / 20;
    if (swing < 0.1) swing = 0;
  }
  return { drums, bass, swing };
}

const SCALE_STEPS: Record<ScaleName, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

/** The key the bass notes fit best, with the first note counting extra as a likely root. */
export function estimateKey(notes: { midi: number }[]): { root: number; scale: ScaleName } {
  if (notes.length === 0) return { root: 0, scale: 'minor' };
  const weight = new Array(12).fill(0);
  notes.forEach((n, i) => (weight[((n.midi % 12) + 12) % 12] += i === 0 ? 2 : 1));
  let best = { root: 0, scale: 'minor' as ScaleName };
  let bestScore = -Infinity;
  for (let root = 0; root < 12; root++) {
    for (const scale of ['minor', 'major'] as ScaleName[]) {
      let score = weight[root] * 1.5;
      for (const step of SCALE_STEPS[scale]) score += weight[(root + step) % 12];
      if (scale === 'minor') score += 0.01; // Beats lean minor; only settles exact ties.
      if (score > bestScore) {
        bestScore = score;
        best = { root, scale };
      }
    }
  }
  return best;
}

/** The grid row closest to this pitch, ignoring octave. */
export function nearestDegree(midi: number, root: number, scale: ScaleName): number {
  const pitch = ((midi - root) % 12 + 12) % 12;
  let best = 0;
  let distance = Infinity;
  SCALE_STEPS[scale].forEach((step, degree) => {
    const gap = Math.min(Math.abs(step - pitch), 12 - Math.abs(step - pitch));
    if (gap < distance) {
      distance = gap;
      best = degree;
    }
  });
  return best;
}

export interface ImportChoice {
  name: string;
  audioId: string;
  bpm: number;
  start: number;
  bars: number;
}

export function beatFromTranscription(result: Transcription, choice: ImportChoice): Beat {
  const beat = emptyBeat(choice.name);
  beat.bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(choice.bpm)));
  beat.bars = choice.bars;
  beat.swing = result.swing;
  const key = estimateKey(result.bass);
  beat.root = key.root;
  beat.scale = key.scale;
  for (const [row, steps] of Object.entries(result.drums)) {
    for (const step of steps) setStep(beat, row, step, true);
  }
  for (const { step, midi } of result.bass) {
    setStep(beat, `bass${nearestDegree(midi, key.root, key.scale)}`, step, true);
  }
  beat.backing = { audioId: choice.audioId, name: choice.name, start: choice.start, bpm: choice.bpm, volume: 0.8, on: true };
  return beat;
}
