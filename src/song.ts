import { Midi } from '@tonejs/midi';

export type Hand = 'L' | 'R';

export interface Note {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  hand: Hand;
}

export interface Song {
  id: string;
  title: string;
  duration: number;
  notes: Note[];
  builtIn?: boolean;
}

const MIDDLE_C = 60;

/** Sorts notes and derives the song length so every Song obeys the same invariants. */
export function makeSong(id: string, title: string, notes: Note[], builtIn = false): Song {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const duration = sorted.reduce((end, n) => Math.max(end, n.time + n.duration), 0);
  return { id, title, duration, notes: sorted, builtIn };
}

/**
 * Parses a Standard MIDI File. A piano file usually has one track per hand, so with
 * exactly two melodic tracks the higher one becomes the right hand. Anything else
 * is split at middle C.
 */
export function parseMidi(data: ArrayBuffer, id: string, title: string): Song {
  const midi = new Midi(data);
  const tracks = midi.tracks.filter((t) => t.notes.length > 0 && !t.instrument.percussion);
  if (tracks.length === 0) throw new Error('File MIDI không có nốt nào để chơi');

  const mean = (t: (typeof tracks)[number]) => t.notes.reduce((sum, n) => sum + n.midi, 0) / t.notes.length;
  const rightTrack = tracks.length === 2 ? (mean(tracks[0]) >= mean(tracks[1]) ? tracks[0] : tracks[1]) : null;

  const notes = tracks.flatMap((track) =>
    track.notes.map((n): Note => ({
      midi: n.midi,
      time: n.time,
      duration: n.duration,
      velocity: n.velocity,
      hand: rightTrack ? (track === rightTrack ? 'R' : 'L') : n.midi >= MIDDLE_C ? 'R' : 'L',
    })),
  );
  return makeSong(id, title, notes);
}
