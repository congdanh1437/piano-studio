import { describe, expect, it } from 'vitest';
import { computerKeyLabels, fitOctaveShift, midiForCode } from './keyboard';
import { evaluate, LEVELS, Lesson, lessons } from './lessons';
import { PracticeSession } from './practice';
import { pitchToMidi, voice } from './score';

const userNotes = (lesson: Lesson) =>
  lesson.song.notes.filter((n) => lesson.mode === 'both' || n.hand === lesson.mode);

/** Plays a lesson the way a flawless player would. */
function playPerfectly(lesson: Lesson): PracticeSession {
  const session = new PracticeSession(lesson.song, lesson.mode);
  session.wait = lesson.wait;
  session.speed = lesson.speed;
  session.playing = true;
  for (let i = 0; i < 400_000 && !session.finished; i++) {
    session.tick(1 / 120);
    for (const note of session.nextChord()) {
      if (note.time <= session.t) session.press(note.midi);
    }
  }
  return session;
}

describe('score notation', () => {
  it('reads sharps and flats', () => {
    expect(pitchToMidi('C4')).toBe(60);
    expect(pitchToMidi('F#4')).toBe(66);
    expect(pitchToMidi('Bb3')).toBe(58);
    expect(() => pitchToMidi('H4')).toThrow();
  });

  it('places rests and chords in time', () => {
    const notes = voice('C4:2 R:1 C4+E4:1', 'R', 60);
    expect(notes.map((n) => [n.midi, n.time])).toEqual([[60, 0], [60, 3], [64, 3]]);
  });
});

describe('computer keys', () => {
  it('keeps Q on middle C and Z an octave lower', () => {
    expect(midiForCode('KeyQ', 0)).toBe(60);
    expect(midiForCode('KeyZ', 0)).toBe(48);
    expect(midiForCode('Digit2', 0)).toBe(61);
    expect(midiForCode('KeyA', 0)).toBeNull();
    expect(midiForCode('KeyQ', -1)).toBe(48);
  });

  it('labels every key the way that key really plays', () => {
    const labels = computerKeyLabels(0);
    expect(labels.get(60)).toBe('Q');
    expect(labels.get(48)).toBe('Z');
    expect(labels.get(72)).toBe('I');
    expect(labels.get(59)).toBe('M');
    expect(labels.get(83)).toBeUndefined();
  });
});

describe('curriculum', () => {
  it('runs from level 1 to the last level with unique ids', () => {
    expect(new Set(lessons.map((l) => l.id)).size).toBe(lessons.length);
    const levels = lessons.map((l) => l.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(LEVELS.length);
  });

  it.each(lessons.map((l) => [l.title, l] as const))('%s can be played from a computer keyboard', (_title, lesson) => {
    const shift = fitOctaveShift(userNotes(lesson));
    const labels = computerKeyLabels(shift);
    const unreachable = userNotes(lesson).filter((n) => !labels.has(n.midi));
    expect(userNotes(lesson).length).toBeGreaterThan(0);
    expect(unreachable.map((n) => n.midi)).toEqual([]);
  });

  it.each(lessons.map((l) => [l.title, l] as const))('%s earns 3 stars when played perfectly', (_title, lesson) => {
    const session = playPerfectly(lesson);
    expect(session.finished).toBe(true);
    expect(session.misses).toBe(0);
    expect(session.wrong).toBe(0);
    expect(evaluate(lesson, session)).toEqual({ notCounted: '', stars: 3 });
  });

  it('keeps both hands the same length in two-hand pieces', () => {
    // In these two, one hand rests at the end on purpose.
    const endsApart = ['Hai tay thay phiên', 'Prelude cung Đô (Bach, 4 ô nhịp đầu)'];
    for (const lesson of lessons.filter((l) => !endsApart.includes(l.title))) {
      const end = (hand: string) =>
        Math.max(0, ...lesson.song.notes.filter((n) => n.hand === hand).map((n) => n.time + n.duration));
      if (end('R') > 0 && end('L') > 0) expect(Math.abs(end('R') - end('L')), lesson.title).toBeLessThan(0.1);
    }
  });
});

describe('evaluate', () => {
  const realTempo = lessons.find((l) => !l.wait)!;

  it('gives no stars below the required speed', () => {
    const session = playPerfectly({ ...realTempo, speed: realTempo.speed - 0.2 });
    expect(evaluate(realTempo, session).stars).toBe(0);
    expect(evaluate(realTempo, session).notCounted).not.toBe('');
  });

  it('gives no stars when notes were skipped', () => {
    const session = new PracticeSession(realTempo.song, realTempo.mode);
    session.speed = realTempo.speed;
    session.wait = false;
    expect(evaluate(realTempo, session).stars).toBe(0);
  });
});
