import { Hand, makeSong, Note, Song } from './song';

/**
 * Reads MusicXML (score-partwise), the format most notation programs export,
 * including the compressed .mxl form. Handles chords, ties, voices, two-staff
 * piano parts, tempo changes and repeats with first and second endings.
 * D.C. and D.S. jumps are not followed: the score plays straight through them.
 */

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_TEMPO = 120;
const MIDDLE_C = 60;
const MAX_UNFOLDED_MEASURES = 5000;

interface RawNote {
  /** Quarter notes from the start of its measure. */
  start: number;
  length: number;
  midi: number;
  staff: number;
  voice: string;
  tieStart: boolean;
  tieStop: boolean;
}

interface Measure {
  length: number;
  notes: RawNote[];
  tempos: { at: number; bpm: number }[];
  repeatForward: boolean;
  /** How many times to play up to here before moving on; 0 when there is no repeat. */
  repeatBackward: number;
  /** The passes ("1", "1, 2") of an ending that starts here; empty when none starts here. */
  endings: number[];
  /** An ending closes at the end of this measure. */
  endingEnd: boolean;
}

interface Part {
  name: string;
  staves: number;
  measures: Measure[];
}

const child = (el: Element, name: string) => {
  for (const node of Array.from(el.children)) if (node.localName === name) return node;
  return null;
};
const children = (el: Element, name: string) => Array.from(el.children).filter((node) => node.localName === name);
const number = (el: Element | null, fallback = 0) => {
  const value = el ? Number(el.textContent?.trim()) : NaN;
  return Number.isFinite(value) ? value : fallback;
};

function metronomeBpm(direction: Element): number | null {
  const metronome = direction.getElementsByTagName('metronome')[0];
  if (!metronome) return null;
  const perMinute = number(child(metronome, 'per-minute'), NaN);
  if (!Number.isFinite(perMinute)) return null;
  const unit = child(metronome, 'beat-unit')?.textContent?.trim();
  const quarters: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 };
  let size = quarters[unit ?? 'quarter'] ?? 1;
  if (child(metronome, 'beat-unit-dot')) size *= 1.5;
  return perMinute * size;
}

function readPart(part: Element): Omit<Part, 'name'> {
  let divisions = 1;
  let staves = 1;
  const measures: Measure[] = [];

  for (const measureEl of children(part, 'measure')) {
    const measure: Measure = { length: 0, notes: [], tempos: [], repeatForward: false, repeatBackward: 0, endings: [], endingEnd: false };
    let position = 0;
    let lastStart = 0;

    for (const el of Array.from(measureEl.children)) {
      switch (el.localName) {
        case 'attributes': {
          divisions = number(child(el, 'divisions'), divisions) || divisions;
          staves = Math.max(staves, number(child(el, 'staves'), 1));
          break;
        }
        case 'backup':
          position -= number(child(el, 'duration')) / divisions;
          break;
        case 'forward':
          position += number(child(el, 'duration')) / divisions;
          break;
        case 'sound': {
          const tempo = Number(el.getAttribute('tempo'));
          if (tempo > 0) measure.tempos.push({ at: position, bpm: tempo });
          break;
        }
        case 'direction': {
          const sound = child(el, 'sound');
          const tempo = Number(sound?.getAttribute('tempo'));
          const bpm = tempo > 0 ? tempo : metronomeBpm(el);
          const offset = number(child(el, 'offset')) / divisions;
          if (bpm) measure.tempos.push({ at: position + offset, bpm });
          break;
        }
        case 'barline': {
          const repeat = child(el, 'repeat');
          if (repeat?.getAttribute('direction') === 'forward') measure.repeatForward = true;
          if (repeat?.getAttribute('direction') === 'backward') {
            measure.repeatBackward = Math.max(2, Number(repeat.getAttribute('times')) || 2);
          }
          const ending = child(el, 'ending');
          const type = ending?.getAttribute('type');
          if (ending && type === 'start') {
            measure.endings = (ending.getAttribute('number') ?? '1')
              .split(/[,\s]+/)
              .map(Number)
              .filter((n) => n > 0);
          }
          if (type === 'stop' || type === 'discontinue') measure.endingEnd = true;
          break;
        }
        case 'note': {
          // Grace notes take no time. Cue notes do take time, but are another player's part.
          if (child(el, 'grace')) break;
          const isChord = Boolean(child(el, 'chord'));
          const length = number(child(el, 'duration')) / divisions;
          const start = isChord ? lastStart : position;
          const pitch = child(el, 'cue') ? null : child(el, 'pitch');
          if (pitch) {
            const step = STEP[child(pitch, 'step')?.textContent?.trim() ?? ''];
            if (step !== undefined) {
              const midi = step + Math.round(number(child(pitch, 'alter'))) + (number(child(pitch, 'octave'), 4) + 1) * 12;
              const ties = children(el, 'tie').map((t) => t.getAttribute('type'));
              measure.notes.push({
                start,
                length,
                midi,
                staff: number(child(el, 'staff'), 1),
                voice: child(el, 'voice')?.textContent?.trim() ?? '1',
                tieStart: ties.includes('start'),
                tieStop: ties.includes('stop'),
              });
            }
          }
          if (!isChord) {
            lastStart = position;
            position += length;
          }
          break;
        }
      }
      measure.length = Math.max(measure.length, position);
    }
    measures.push(measure);
  }
  return { staves, measures };
}

/** The order measures are played in once repeats and endings are written out. */
export function playOrder(
  measures: Pick<Measure, 'repeatForward' | 'repeatBackward' | 'endings' | 'endingEnd'>[],
): number[] {
  const order: number[] = [];
  const timesDone = new Map<number, number>();
  let sectionStart = 0;
  let pass = 1;
  let endingPasses: number[] = [];
  let i = 0;

  while (i < measures.length && order.length < MAX_UNFOLDED_MEASURES) {
    const measure = measures[i];
    if (measure.repeatForward && i !== sectionStart) {
      sectionStart = i;
      pass = 1;
    }
    if (measure.endings.length > 0) endingPasses = measure.endings;
    const skip = endingPasses.length > 0 && !endingPasses.includes(pass);
    if (!skip) order.push(i);

    const backward = measure.repeatBackward;
    const done = timesDone.get(i) ?? 0;
    if (backward && !skip && done < backward - 1) {
      timesDone.set(i, done + 1);
      pass++;
      i = sectionStart;
      endingPasses = [];
      continue;
    }

    const endingCloses = measure.endingEnd || backward > 0 || (measures[i + 1]?.endings.length ?? 0) > 0;
    if (endingPasses.length > 0 && endingCloses) {
      // Finishing the last ending, the one with no repeat sign, ends the whole repeated section.
      const finalEnding = !skip && !backward;
      endingPasses = [];
      if (finalEnding) {
        sectionStart = i + 1;
        pass = 1;
      }
    }
    if (backward && !skip) {
      sectionStart = i + 1;
      pass = 1;
    }
    i++;
  }
  return order;
}

class TempoMap {
  private readonly changes: { quarter: number; bpm: number; seconds: number }[] = [];

  constructor(events: { quarter: number; bpm: number }[]) {
    const sorted = [...events].sort((a, b) => a.quarter - b.quarter);
    let seconds = 0;
    let previous = { quarter: 0, bpm: sorted[0]?.quarter === 0 ? sorted[0].bpm : DEFAULT_TEMPO };
    this.changes.push({ ...previous, seconds: 0 });
    for (const event of sorted) {
      if (event.quarter <= previous.quarter) {
        this.changes[this.changes.length - 1].bpm = event.bpm;
        previous = { quarter: previous.quarter, bpm: event.bpm };
        continue;
      }
      seconds += ((event.quarter - previous.quarter) * 60) / previous.bpm;
      this.changes.push({ quarter: event.quarter, bpm: event.bpm, seconds });
      previous = event;
    }
  }

  seconds(quarter: number): number {
    let change = this.changes[0];
    for (const c of this.changes) if (c.quarter <= quarter) change = c;
    return change.seconds + ((quarter - change.quarter) * 60) / change.bpm;
  }
}

export function parseMusicXml(text: string, id: string, fallbackTitle: string): Song {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('File MusicXML bị lỗi, không đọc được.');
  const root = doc.documentElement;
  if (root.localName === 'score-timewise') {
    throw new Error('Dạng MusicXML "timewise" chưa được hỗ trợ. Hãy xuất lại file ở dạng thông thường (partwise).');
  }
  if (root.localName !== 'score-partwise') throw new Error('File này không phải bản nhạc MusicXML.');

  const names = new Map(
    Array.from(root.getElementsByTagName('score-part')).map((p) => [p.getAttribute('id') ?? '', child(p, 'part-name')?.textContent?.trim() ?? '']),
  );
  const parts: Part[] = children(root, 'part').map((p) => ({ name: names.get(p.getAttribute('id') ?? '') ?? '', ...readPart(p) }));
  if (parts.length === 0) throw new Error('Bản nhạc không có bè nào.');

  // All parts share the measure grid; lengths come from whichever part fills each measure most.
  const measureCount = Math.max(...parts.map((p) => p.measures.length));
  const lengths = Array.from({ length: measureCount }, (_, i) => Math.max(0, ...parts.map((p) => p.measures[i]?.length ?? 0)));
  const order = playOrder(parts[0].measures);
  const offsets: number[] = [];
  let total = 0;
  for (const index of order) {
    offsets.push(total);
    total += lengths[index];
  }

  const tempoEvents = order.flatMap((index, k) =>
    parts.flatMap((p) => (p.measures[index]?.tempos ?? []).map((t) => ({ quarter: offsets[k] + t.at, bpm: t.bpm }))),
  );
  const tempo = new TempoMap(tempoEvents);

  // One staff per hand in a piano part; otherwise decide by part, or by pitch as a last resort.
  const singleStaff = parts.filter((p) => p.staves < 2);
  const pitched = singleStaff.filter((p) => p.measures.some((m) => m.notes.length > 0));
  const meanPitch = (p: Part) => {
    const all = p.measures.flatMap((m) => m.notes.map((n) => n.midi));
    return all.reduce((s, v) => s + v, 0) / Math.max(1, all.length);
  };
  const rightPart = pitched.length === 2 ? (meanPitch(pitched[0]) >= meanPitch(pitched[1]) ? pitched[0] : pitched[1]) : null;
  const handFor = (part: Part, note: RawNote): Hand => {
    if (part.staves >= 2) return note.staff >= 2 ? 'L' : 'R';
    if (rightPart && pitched.includes(part)) return part === rightPart ? 'R' : 'L';
    return note.midi >= MIDDLE_C ? 'R' : 'L';
  };

  const notes: Note[] = [];
  parts.forEach((part, partIndex) => {
    // A tie joins notes of the same pitch in the same voice into one held note.
    const open = new Map<string, { start: number; end: number; midi: number; hand: Hand }>();
    const finish = (key: string) => {
      const held = open.get(key);
      if (!held) return;
      open.delete(key);
      const time = tempo.seconds(held.start);
      notes.push({ midi: held.midi, time, duration: Math.max(0.05, tempo.seconds(held.end) - time), velocity: held.hand === 'R' ? 0.8 : 0.65, hand: held.hand });
    };

    order.forEach((index, k) => {
      for (const raw of part.measures[index]?.notes ?? []) {
        const start = offsets[k] + raw.start;
        const key = `${partIndex}:${raw.voice}:${raw.staff}:${raw.midi}`;
        const held = open.get(key);
        if (raw.tieStop && held && Math.abs(held.end - start) < 1e-6) {
          held.end = start + raw.length;
        } else {
          finish(key);
          open.set(key, { start, end: start + raw.length, midi: raw.midi, hand: handFor(part, raw) });
        }
        if (!raw.tieStart) finish(key);
      }
    });
    for (const key of [...open.keys()]) finish(key);
  });

  if (notes.length === 0) throw new Error('Bản nhạc không có nốt nào để chơi.');
  const title = (root.getElementsByTagName('work-title')[0]?.textContent ?? root.getElementsByTagName('movement-title')[0]?.textContent ?? '').trim();
  return makeSong(id, title || fallbackTitle, notes);
}

// ---------- .mxl: a zip holding the score ----------

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(data.slice()).then(() => writer.close()).catch(() => {});
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value);
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Reads the files out of a zip; only "stored" and "deflate", which is all .mxl uses. */
export async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('File .mxl bị hỏng.');
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('File .mxl bị hỏng.');
    const method = view.getUint16(cursor + 10, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflate(data));
  }
  return files;
}

function decodeXml(data: Uint8Array): string {
  // MuseScore and others sometimes write UTF-16 with a byte-order mark.
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data);
  return new TextDecoder().decode(data);
}

export async function readMxl(buffer: ArrayBuffer): Promise<string> {
  const files = await unzip(buffer);
  const container = files.get('META-INF/container.xml');
  let path: string | null | undefined;
  if (container) {
    const doc = new DOMParser().parseFromString(decodeXml(container), 'application/xml');
    path = doc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  }
  path ??= [...files.keys()].find((name) => !name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(name));
  const score = path ? files.get(path) : undefined;
  if (!score) throw new Error('Không tìm thấy bản nhạc trong file .mxl.');
  return decodeXml(score);
}

/** Opens any score file the library accepts, telling the formats apart by their content. */
export async function readScoreFile(buffer: ArrayBuffer): Promise<{ kind: 'midi' } | { kind: 'musicxml'; text: string }> {
  const head = new Uint8Array(buffer.slice(0, 4));
  if (String.fromCharCode(...head) === 'MThd') return { kind: 'midi' };
  if (head[0] === 0x50 && head[1] === 0x4b) return { kind: 'musicxml', text: await readMxl(buffer) };
  const text = decodeXml(new Uint8Array(buffer));
  if (!text.replace(/^﻿/, '').trimStart().startsWith('<')) {
    throw new Error('File này không phải MIDI hay bản nhạc MusicXML.');
  }
  return { kind: 'musicxml', text };
}
