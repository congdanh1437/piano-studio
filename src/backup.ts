import { Beat } from './beat';
import { Song } from './song';
import { StoredAudio } from './storage';

/**
 * One file that carries everything a person made on one device to another:
 * imported songs, beats, lesson stars, and optionally the recordings beats use.
 */

const APP = 'piano-studio';
const VERSION = 1;

export interface Backup {
  app: typeof APP;
  version: number;
  createdAt: number;
  songs: Song[];
  beats: Beat[];
  stars: Record<string, number>;
  audio: { id: string; name: string; data: string }[];
}

export interface DeviceData {
  songs: Song[];
  beats: Beat[];
  stars: Record<string, number>;
  audioIds: string[];
}

const CHUNK = 0x8000;

export function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let text = '';
  for (let i = 0; i < bytes.length; i += CHUNK) text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(text);
}

export function fromBase64(text: string): ArrayBuffer {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export function createBackup(data: DeviceData, audio: StoredAudio[]): Backup {
  return {
    app: APP,
    version: VERSION,
    createdAt: Date.now(),
    songs: data.songs,
    beats: data.beats,
    stars: data.stars,
    audio: audio.map((a) => ({ id: a.id, name: a.name, data: toBase64(a.data) })),
  };
}

// ---------- Reading a file someone picked: trust nothing in it ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown, min = -Infinity, max = Infinity): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isText = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length <= max;
const isId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);

function isSong(value: unknown): value is Song {
  if (!isRecord(value) || !isId(value.id) || !isText(value.title) || !isNumber(value.duration, 0)) return false;
  if (!Array.isArray(value.notes) || value.notes.length > 100_000) return false;
  return value.notes.every(
    (n) =>
      isRecord(n) &&
      isNumber(n.midi, 0, 127) &&
      isNumber(n.time, 0) &&
      isNumber(n.duration, 0) &&
      isNumber(n.velocity, 0, 1) &&
      (n.hand === 'L' || n.hand === 'R'),
  );
}

function isBeat(value: unknown): value is Beat {
  if (!isRecord(value) || !isId(value.id) || !isText(value.name, 200)) return false;
  if (!isNumber(value.bpm, 20, 400) || !isNumber(value.swing, 0, 1) || !isNumber(value.updatedAt, 0)) return false;
  if (!Number.isInteger(value.bars) || !isNumber(value.bars, 1, 4)) return false;
  if (!Number.isInteger(value.root) || !isNumber(value.root, 0, 11)) return false;
  if (value.scale !== 'minor' && value.scale !== 'major') return false;
  if (!isRecord(value.grid) || !Object.entries(value.grid).every(([row, steps]) =>
    /^[a-z]+\d?$/.test(row) && Array.isArray(steps) && steps.every((s) => Number.isInteger(s) && isNumber(s, 0, 63)))) return false;
  if (!Array.isArray(value.muted) || !value.muted.every((m) => isText(m, 20))) return false;
  if (!isRecord(value.mix) || !['drums', 'bass', 'lead'].every((part) => isNumber((value.mix as Record<string, unknown>)[part], 0, 1))) return false;

  const backing = value.backing;
  if (backing !== undefined && !(isRecord(backing) && isId(backing.audioId) && isText(backing.name) &&
    isNumber(backing.start, 0) && isNumber(backing.bpm, 20, 400) && isNumber(backing.volume, 0, 1) && typeof backing.on === 'boolean')) return false;

  const youtube = value.youtube;
  if (youtube !== undefined && !(isRecord(youtube) && typeof youtube.videoId === 'string' && /^[\w-]{11}$/.test(youtube.videoId) &&
    isNumber(youtube.start, 0) && (youtube.loopA === null || isNumber(youtube.loopA, 0)) &&
    (youtube.loopB === null || isNumber(youtube.loopB, 0)) && isNumber(youtube.rate, 0.25, 2) && typeof youtube.linked === 'boolean')) return false;
  return true;
}

export interface ParsedBackup {
  backup: Backup;
  /** Entries left out because they were damaged or not understood. */
  skipped: number;
}

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('File này không phải bản sao lưu của Piano Studio.');
  }
  if (!isRecord(raw) || raw.app !== APP) throw new Error('File này không phải bản sao lưu của Piano Studio.');
  if (!isNumber(raw.version, 1) || raw.version > VERSION) {
    throw new Error('Bản sao lưu này được tạo từ phiên bản mới hơn của app. Hãy cập nhật app rồi thử lại.');
  }

  let skipped = 0;
  const keep = <T>(list: unknown, check: (item: unknown) => item is T): T[] => {
    if (!Array.isArray(list)) return [];
    const good = list.filter(check);
    skipped += list.length - good.length;
    return good;
  };
  const isAudio = (a: unknown): a is Backup['audio'][number] =>
    isRecord(a) && isId(a.id) && isText(a.name) && typeof a.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(a.data);

  const stars: Record<string, number> = {};
  if (isRecord(raw.stars)) {
    for (const [id, value] of Object.entries(raw.stars)) {
      if (isId(id) && Number.isInteger(value) && isNumber(value, 0, 3)) stars[id] = value as number;
      else skipped++;
    }
  }

  return {
    backup: {
      app: APP,
      version: raw.version,
      createdAt: isNumber(raw.createdAt, 0) ? raw.createdAt : 0,
      songs: keep(raw.songs, isSong),
      beats: keep(raw.beats, isBeat),
      stars,
      audio: keep(raw.audio, isAudio),
    },
    skipped,
  };
}

export interface MergePlan {
  songs: Song[];
  beats: Beat[];
  stars: Record<string, number>;
  audio: Backup['audio'];
  /** Beats kept as they are because the copy on this device was edited more recently. */
  keptNewer: number;
}

/** Works out what to write so nothing on this device is lost or replaced by something older. */
export function planMerge(current: DeviceData, incoming: Backup): MergePlan {
  const songIds = new Set(current.songs.map((s) => s.id));
  const beatsHere = new Map(current.beats.map((b) => [b.id, b]));
  let keptNewer = 0;

  const beats = incoming.beats.filter((beat) => {
    const here = beatsHere.get(beat.id);
    if (!here) return true;
    if (beat.updatedAt > here.updatedAt) return true;
    if (beat.updatedAt < here.updatedAt) keptNewer++;
    return false;
  });

  const stars: Record<string, number> = { ...current.stars };
  for (const [id, value] of Object.entries(incoming.stars)) stars[id] = Math.max(stars[id] ?? 0, value);

  const finalBeats = [...current.beats.filter((b) => !beats.some((n) => n.id === b.id)), ...beats];
  const needed = new Set(finalBeats.map((b) => b.backing?.audioId).filter(Boolean));
  const have = new Set(current.audioIds);
  const audio = incoming.audio.filter((a) => needed.has(a.id) && !have.has(a.id));

  return {
    songs: incoming.songs.filter((s) => !songIds.has(s.id)),
    beats,
    stars,
    audio,
    keptNewer,
  };
}

export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `piano-studio-sao-luu-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
