import { Hand, Note } from './song';

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" -> 60, "F#4" -> 66, "Bb3" -> 58. */
export function pitchToMidi(pitch: string): number {
  const match = /^([A-G])([#b]?)(\d)$/.exec(pitch);
  if (!match) throw new Error(`Nốt không hợp lệ: ${pitch}`);
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return PITCH[match[1]] + accidental + (Number(match[3]) + 1) * 12;
}

/**
 * Reads one hand's part into notes. Tokens are pitch:beats, where "R" is a rest
 * and "+" joins a chord: "C4:1 R:1 C4+E4+G4:2". A missing length means one beat.
 */
export function voice(score: string, hand: Hand, bpm: number): Note[] {
  const secondsPerBeat = 60 / bpm;
  const notes: Note[] = [];
  let beat = 0;
  for (const token of score.trim().split(/\s+/)) {
    const [pitches, beats = '1'] = token.split(':');
    const length = Number(beats);
    if (!(length > 0)) throw new Error(`Độ dài không hợp lệ: ${token}`);
    if (pitches !== 'R') {
      for (const pitch of pitches.split('+')) {
        notes.push({
          midi: pitchToMidi(pitch),
          time: beat * secondsPerBeat,
          duration: length * secondsPerBeat * 0.95,
          velocity: hand === 'R' ? 0.8 : 0.55,
          hand,
        });
      }
    }
    beat += length;
  }
  return notes;
}
