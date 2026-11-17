import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import {
  beatFromPreset,
  beatToMidi,
  copyBar,
  DRUMS,
  emptyBeat,
  encodeWav,
  isOn,
  MAX_BARS,
  MELODY_ROWS,
  nearestStep,
  PRESETS,
  rowMidi,
  rowsAtStep,
  setStep,
  stepCount,
  stepDuration,
  stepTime,
} from './beat';

describe('grid editing', () => {
  it('switches steps on and off without duplicates', () => {
    const beat = emptyBeat();
    setStep(beat, 'kick', 4, true);
    setStep(beat, 'kick', 4, true);
    setStep(beat, 'kick', 0, true);
    expect(beat.grid.kick).toEqual([0, 4]);
    setStep(beat, 'kick', 4, false);
    expect(isOn(beat, 'kick', 4)).toBe(false);
  });

  it('copies a bar onto the next one, replacing what was there', () => {
    const beat = emptyBeat();
    beat.bars = 2;
    setStep(beat, 'kick', 0, true);
    setStep(beat, 'kick', 20, true);
    copyBar(beat, 0);
    expect(beat.grid.kick).toEqual([0, 16]);
  });

  it('leaves muted rows out of playback', () => {
    const beat = emptyBeat();
    setStep(beat, 'kick', 0, true);
    setStep(beat, 'hat', 0, true);
    beat.muted = ['hat'];
    expect(rowsAtStep(beat, 0)).toEqual(['kick']);
  });
});

describe('timing', () => {
  it('makes a sixteenth a quarter of a beat', () => {
    expect(stepDuration(120)).toBeCloseTo(0.125);
  });

  it('swings only the off-beat sixteenths', () => {
    expect(stepTime(2, 120, 0.5)).toBeCloseTo(0.25);
    expect(stepTime(1, 120, 0.5)).toBeCloseTo(0.125 + 0.03125);
  });

  it('puts a live tap on the closest step', () => {
    const scheduled = [{ time: 1, step: 3 }, { time: 1.2, step: 4 }];
    expect(nearestStep(1.05, scheduled)).toBe(3);
    expect(nearestStep(1.15, scheduled)).toBe(4);
    expect(nearestStep(1, [])).toBeNull();
  });
});

describe('scales', () => {
  it('follows the key and wraps at the octave', () => {
    const beat = emptyBeat();
    beat.root = 0;
    beat.scale = 'minor';
    expect(rowMidi(beat, 'lead', 0)).toBe(60);
    expect(rowMidi(beat, 'lead', 2)).toBe(63);
    expect(rowMidi(beat, 'lead', 7)).toBe(72);
    expect(rowMidi(beat, 'bass', 0)).toBe(36);
    beat.scale = 'major';
    beat.root = 2;
    expect(rowMidi(beat, 'lead', 2)).toBe(66);
  });
});

describe.each(PRESETS.map((p) => [p.name, p] as const))('preset %s', (_name, preset) => {
  const beat = beatFromPreset(preset);

  it('only uses rows and steps the screen can show', () => {
    const drumIds = DRUMS.map((d) => d.id);
    expect(beat.bars).toBeLessThanOrEqual(MAX_BARS);
    expect(Number.isInteger(beat.bars)).toBe(true);
    for (const [row, steps] of Object.entries(beat.grid)) {
      const known = drumIds.includes(row) || /^(bass|lead)[0-7]$/.test(row);
      expect(known, row).toBe(true);
      if (!drumIds.includes(row)) expect(Number(row.slice(4))).toBeLessThan(MELODY_ROWS);
      expect(Math.max(...steps)).toBeLessThan(stepCount(beat));
    }
  });

  it('has drums in every bar', () => {
    for (let bar = 0; bar < beat.bars; bar++) {
      expect(beat.grid.kick.some((s) => Math.floor(s / 16) === bar)).toBe(true);
    }
  });

  it('exports notes for every switched-on step', () => {
    const expected = Object.values(beat.grid).reduce((sum, steps) => sum + steps.length, 0);
    const midi = new Midi(beatToMidi(beat));
    expect(midi.tracks.reduce((sum, t) => sum + t.notes.length, 0)).toBe(expected);
    expect(midi.header.tempos[0].bpm).toBeCloseTo(beat.bpm);
    expect(midi.tracks[0].channel).toBe(9);
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit stereo file and clips safely', () => {
    const wav = encodeWav([new Float32Array([0, 1, 2]), new Float32Array([0, -1, -2])], 44100);
    const view = new DataView(wav);
    const text = (offset: number) => String.fromCharCode(...new Uint8Array(wav, offset, 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(12);
    expect(wav.byteLength).toBe(56);
    expect(view.getInt16(52, true)).toBe(32767);
    expect(view.getInt16(54, true)).toBe(-32768);
  });
});
