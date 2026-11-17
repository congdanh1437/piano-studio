import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { demoSongs } from './demos';
import { fitRange, isBlack, keyAt, layoutKeys } from './keyboard';
import { PracticeSession } from './practice';
import { makeSong, Note, parseMidi } from './song';

const note = (midi: number, time: number, hand: Note['hand'] = 'R'): Note => ({
  midi,
  time,
  hand,
  duration: 0.5,
  velocity: 0.8,
});

const session = (notes: Note[], mode: 'R' | 'L' | 'both' | 'listen' = 'R') => {
  const s = new PracticeSession(makeSong('t', 't', notes), mode);
  s.playing = true;
  return s;
};

describe('PracticeSession', () => {
  it('waits at a note until it is played', () => {
    const s = session([note(60, 1), note(62, 2)]);
    s.t = 0;
    s.tick(5);
    expect(s.t).toBe(1);
    expect(s.waiting).toBe(true);
    s.tick(5);
    expect(s.t).toBe(1);

    expect(s.press(60)).toBe('hit');
    s.tick(5);
    expect(s.t).toBe(2);
    expect(s.hits).toBe(1);
  });

  it('needs every note of a chord before moving on', () => {
    const s = session([note(60, 1), note(64, 1), note(72, 3)]);
    s.t = 0;
    s.tick(2);
    s.press(60);
    s.tick(1);
    expect(s.t).toBe(1);
    s.press(64);
    s.tick(1);
    expect(s.t).toBe(2);
  });

  it('counts wrong keys without moving on', () => {
    const s = session([note(60, 1)]);
    s.t = 0;
    s.tick(2);
    expect(s.press(61)).toBe('wrong');
    expect(s.wrong).toBe(1);
    expect(s.t).toBe(1);
  });

  it('marks notes missed when not waiting', () => {
    const s = session([note(60, 1), note(62, 2)]);
    s.wait = false;
    s.t = 0;
    s.tick(1.5);
    expect(s.misses).toBe(1);
    expect(s.status[0]).toBe('missed');
    expect(s.press(60)).toBe('wrong');
  });

  it('plays the other hand exactly once and keeps it back while waiting', () => {
    const s = session([note(60, 1, 'R'), note(40, 1, 'L'), note(41, 0.5, 'L')]);
    s.t = 0;
    expect(s.tick(5).map((n) => n.midi)).toEqual([41]);
    expect(s.tick(5)).toEqual([]);
    s.press(60);
    expect(s.tick(0.1).map((n) => n.midi)).toEqual([40]);
    expect(s.tick(0.1)).toEqual([]);
  });

  it('plays everything and scores nothing in listen mode', () => {
    const s = session([note(60, 1), note(40, 1, 'L')], 'listen');
    s.t = 0;
    expect(s.tick(2)).toHaveLength(2);
    expect(s.press(60)).toBe('free');
    expect(s.accuracy).toBeNull();
  });

  it('scales the timing window with speed', () => {
    const s = session([note(60, 1)]);
    s.wait = false;
    s.speed = 0.5;
    s.t = 0.85;
    expect(s.press(60)).toBe('wrong');
    s.t = 0.95;
    expect(s.press(60)).toBe('hit');
  });

  it('loops and lets the section be scored again', () => {
    const s = session([note(60, 1), note(62, 2), note(64, 3)]);
    s.t = 0.5;
    s.loop = { a: 0.5, b: 1.5 };
    s.tick(0.5);
    s.press(60);
    s.tick(5);
    expect(s.t).toBe(0.5);
    expect(s.status[0]).toBe('pending');
  });

  it('finishes after the last note', () => {
    const s = session([note(60, 1)]);
    s.t = 0;
    s.tick(1);
    s.press(60);
    s.tick(5);
    expect(s.finished).toBe(true);
    expect(s.playing).toBe(false);
    expect(s.accuracy).toBe(100);
  });
});

describe('keyboard', () => {
  it('fits a small hand range to at least two octaves of white keys', () => {
    const { lo, hi } = fitRange([note(60, 0), note(67, 1)]);
    expect(lo).toBeLessThanOrEqual(59);
    expect(hi).toBeGreaterThanOrEqual(68);
    expect(isBlack(lo)).toBe(false);
    expect(isBlack(hi)).toBe(false);
    expect(layoutKeys({ lo, hi }, 100).filter((k) => !k.black)).toHaveLength(15);
  });

  it('never leaves the 88-key piano', () => {
    const { lo, hi } = fitRange([note(21, 0), note(108, 1)]);
    expect([lo, hi]).toEqual([21, 108]);
  });

  it('prefers black keys in the upper part only', () => {
    const keys = layoutKeys({ lo: 60, hi: 64 }, 300);
    expect(keyAt(keys, 100, 10, 100)).toBe(61);
    expect(keyAt(keys, 100, 90, 100)).toBe(62);
    expect(keyAt(keys, 20, 10, 100)).toBe(60);
    expect(keyAt(keys, 20, 120, 100)).toBeNull();
  });
});

describe('parseMidi', () => {
  const build = (tracks: number[][], percussion = false) => {
    const midi = new Midi();
    tracks.forEach((pitches) => {
      const track = midi.addTrack();
      if (percussion) track.channel = 9;
      pitches.forEach((p, i) => track.addNote({ midi: p, time: i, duration: 0.5 }));
    });
    return midi.toArray().slice().buffer as ArrayBuffer;
  };

  it('gives the higher of two tracks to the right hand', () => {
    const song = parseMidi(build([[40, 42], [72, 74]]), 'a', 'a');
    expect(song.notes.filter((n) => n.hand === 'R').map((n) => n.midi)).toEqual([72, 74]);
    expect(song.notes.filter((n) => n.hand === 'L').map((n) => n.midi)).toEqual([40, 42]);
  });

  it('splits a single track at middle C', () => {
    const song = parseMidi(build([[59, 60]]), 'a', 'a');
    expect(song.notes.map((n) => n.hand)).toEqual(['L', 'R']);
  });

  it('rejects a file with only drums', () => {
    expect(() => parseMidi(build([[36, 38]], true), 'a', 'a')).toThrow();
  });
});

describe('demo songs', () => {
  it('keep both hands in step', () => {
    for (const song of demoSongs) {
      const end = (hand: string) =>
        Math.max(...song.notes.filter((n) => n.hand === hand).map((n) => n.time + n.duration));
      expect(Math.abs(end('R') - end('L'))).toBeLessThan(0.01);
    }
  });
});
