import { describe, expect, it } from 'vitest';
import { Layer, notesBetween, snap, TakeRecorder, Transport } from './loop';

const layer = (id = 'l1'): Layer => ({ id, instrument: 'piano', notes: [], muted: false, volume: 1 });

describe('Transport', () => {
  // 120 BPM: one beat is half a second; a 4-beat loop lasts 2 seconds.
  const transport = () => new Transport(10, 120, 4);

  it('finds the pass and beat for a time', () => {
    expect(transport().position(10)).toEqual({ pass: 0, beat: 0 });
    expect(transport().position(11.25)).toEqual({ pass: 0, beat: 2.5 });
    expect(transport().position(12.5)).toEqual({ pass: 1, beat: 1 });
    expect(transport().position(9.5).pass).toBe(-1);
  });

  it('turns a pass and beat back into a time', () => {
    expect(transport().timeOf(1, 1)).toBeCloseTo(12.5);
  });

  it('keeps the playhead in place when the tempo changes', () => {
    const t = transport();
    const before = t.position(11);
    t.setBpm(11, 60);
    expect(t.position(11)).toEqual(before);
    expect(t.position(12).beat).toBeCloseTo(before.beat + 1);
  });
});

describe('snap', () => {
  it('rounds to the grid', () => {
    expect(snap(0, 1.13, 0.25, 4)).toEqual({ pass: 0, beat: 1.25 });
    expect(snap(0, 1.1, 0.25, 4)).toEqual({ pass: 0, beat: 1 });
  });

  it('moves a slightly early downbeat into the next pass', () => {
    expect(snap(2, 3.9, 0.25, 4)).toEqual({ pass: 3, beat: 0 });
  });

  it('leaves timing alone with no grid', () => {
    expect(snap(0, 1.13, 0, 4)).toEqual({ pass: 0, beat: 1.13 });
  });
});

describe('TakeRecorder', () => {
  it('records where and how long a key was held', () => {
    const t = new Transport(0, 120, 4);
    const l = layer();
    const r = new TakeRecorder(l, t, 0, 0, false);
    r.noteOn(60, 0.8, 0.5);
    r.noteOff(60, 1.5);
    expect(l.notes).toEqual([{ at: 1, length: 2, midi: 60, velocity: 0.8, pass: 0 }]);
  });

  it('takes the latency off, so a note heard on the beat lands on the beat', () => {
    const t = new Transport(0, 120, 4);
    const l = layer();
    const r = new TakeRecorder(l, t, 0.25, 0.08, false);
    r.noteOn(60, 0.8, 1.08 + 0.02);
    r.noteOff(60, 1.6);
    expect(l.notes[0].at).toBe(2);
  });

  it('records a held note across the loop end at its full length', () => {
    const t = new Transport(0, 120, 4);
    const l = layer();
    const r = new TakeRecorder(l, t, 0, 0, false);
    r.noteOn(60, 0.8, 1.5);
    r.noteOff(60, 2.5);
    expect(l.notes[0]).toMatchObject({ at: 3, length: 2, pass: 0 });
  });

  it('never makes a note longer than the loop', () => {
    const t = new Transport(0, 120, 4);
    const l = layer();
    const r = new TakeRecorder(l, t, 0, 0, false);
    r.noteOn(60, 0.8, 0);
    r.noteOff(60, 10);
    expect(l.notes[0].length).toBe(4);
  });

  it('finishes drum hits straight away', () => {
    const l = layer();
    const r = new TakeRecorder(l, new Transport(0, 120, 4), 0.25, 0, true);
    r.noteOn(36, 1, 0.5);
    expect(l.notes).toEqual([{ at: 1, length: 0.25, midi: 36, velocity: 1, pass: 0 }]);
    r.noteOff(36, 0.6);
    expect(l.notes).toHaveLength(1);
  });

  it('closes held notes when recording stops', () => {
    const l = layer();
    const r = new TakeRecorder(l, new Transport(0, 120, 4), 0, 0, false);
    r.noteOn(60, 0.8, 0);
    r.noteOn(64, 0.8, 0);
    r.releaseAll(0.5);
    expect(l.notes.map((n) => n.length)).toEqual([1, 1]);
  });

  it('puts a count-in pickup on the first downbeat', () => {
    const l = layer();
    const r = new TakeRecorder(l, new Transport(2, 120, 4), 0.25, 0, true);
    r.noteOn(36, 1, 1.97);
    expect(l.notes[0]).toMatchObject({ at: 0, pass: 0 });
  });
});

describe('notesBetween', () => {
  const t = new Transport(0, 120, 4);
  const l: Layer = { ...layer(), notes: [
    { at: 0, length: 1, midi: 60, velocity: 1, pass: 0 },
    { at: 3, length: 1, midi: 62, velocity: 1, pass: 5 },
  ] };

  it('finds notes on both sides of a loop boundary', () => {
    const found = notesBetween([l], t, 1.4, 2.1).map((s) => [s.note.midi, s.time]);
    expect(found).toEqual([[62, 1.5], [60, 2]]);
  });

  it('skips a note in the pass it was played live', () => {
    expect(notesBetween([l], t, 0, 0.1)).toEqual([]);
    expect(notesBetween([l], t, 2, 2.1)).toHaveLength(1);
  });

  it('leaves out muted layers and anything before the loop starts', () => {
    expect(notesBetween([{ ...l, muted: true }], t, 0, 10)).toEqual([]);
    expect(notesBetween([l], new Transport(5, 120, 4), 0, 5)).toEqual([]);
  });

  it('keeps notes in time order across layers', () => {
    const other: Layer = { ...layer('l2'), notes: [{ at: 0.5, length: 1, midi: 40, velocity: 1, pass: -1 }] };
    const times = notesBetween([l, other], t, 0, 4).map((s) => s.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
