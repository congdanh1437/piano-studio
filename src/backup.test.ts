import { describe, expect, it } from 'vitest';
import { backupFileName, createBackup, DeviceData, fromBase64, parseBackup, planMerge, toBase64 } from './backup';
import { beatFromPreset, emptyBeat, PRESETS } from './beat';
import { demoSongs } from './demos';
import { makeSong } from './song';

const song = makeSong('song-1', 'Bài của tôi', [{ midi: 60, time: 0, duration: 1, velocity: 0.8, hand: 'R' }]);

function beatWith(id: string, updatedAt: number, extra: Partial<ReturnType<typeof emptyBeat>> = {}) {
  return { ...beatFromPreset(PRESETS[0]), id, updatedAt, ...extra };
}

const empty: DeviceData = { songs: [], beats: [], stars: {}, audioIds: [] };

describe('base64', () => {
  it('round-trips binary data, including large files', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 37) % 256);
    const back = new Uint8Array(fromBase64(toBase64(bytes.buffer)));
    expect(back).toEqual(bytes);
  });
});

describe('backup round trip', () => {
  it('reads back exactly what was written', () => {
    const beat = beatWith('beat-a', 5, {
      backing: { audioId: 'audio-1', name: 'x', start: 1.5, bpm: 92, volume: 0.8, on: true },
      youtube: { videoId: 'M7lc1UVf-VE', start: 0, loopA: 1, loopB: null, rate: 0.5, linked: true },
    });
    const data: DeviceData = { songs: [song], beats: [beat], stars: { 'lesson-1': 3 }, audioIds: ['audio-1'] };
    const backup = createBackup(data, [{ id: 'audio-1', name: 'x', data: new Uint8Array([1, 2, 3]).buffer }]);
    const { backup: read, skipped } = parseBackup(JSON.stringify(backup));
    expect(skipped).toBe(0);
    expect(read.songs).toEqual([song]);
    expect(read.beats).toEqual([beat]);
    expect(read.stars).toEqual({ 'lesson-1': 3 });
    expect(new Uint8Array(fromBase64(read.audio[0].data))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('keeps the built-in demo songs valid', () => {
    const backup = createBackup({ ...empty, songs: demoSongs }, []);
    expect(parseBackup(JSON.stringify(backup)).backup.songs).toHaveLength(demoSongs.length);
  });
});

describe('parseBackup', () => {
  it.each(['', 'not json', '[]', '{}', JSON.stringify({ app: 'other', version: 1 })])('rejects %s', (text) => {
    expect(() => parseBackup(text)).toThrow('không phải bản sao lưu');
  });

  it('refuses a backup from a newer app', () => {
    expect(() => parseBackup(JSON.stringify({ app: 'piano-studio', version: 99 }))).toThrow('phiên bản mới hơn');
  });

  it('drops damaged entries and keeps the rest', () => {
    const good = beatWith('beat-ok', 1);
    const text = JSON.stringify({
      app: 'piano-studio',
      version: 1,
      songs: [song, { id: 'bad', title: 'x', duration: 1, notes: [{ midi: 999 }] }],
      beats: [
        good,
        { ...good, id: '../../etc' },
        { ...good, id: 'b2', bars: 99 },
        { ...good, id: 'b3', grid: { kick: ['<img>'] } },
        { ...good, id: 'b4', youtube: { videoId: 'javascript:x', start: 0, loopA: null, loopB: null, rate: 1, linked: false } },
      ],
      stars: { 'lesson-1': 2, 'lesson-2': 9, '<script>': 1 },
      audio: [{ id: 'a1', name: 'x', data: 'not base64!' }],
    });
    const { backup, skipped } = parseBackup(text);
    expect(backup.songs.map((s) => s.id)).toEqual(['song-1']);
    expect(backup.beats.map((b) => b.id)).toEqual(['beat-ok']);
    expect(backup.stars).toEqual({ 'lesson-1': 2 });
    expect(backup.audio).toEqual([]);
    expect(skipped).toBe(8); // 1 song, 4 beats, 2 stars, 1 recording
  });
});

describe('planMerge', () => {
  it('adds what is new and never lowers stars', () => {
    const incoming = createBackup({ songs: [song], beats: [beatWith('b1', 1)], stars: { 'lesson-1': 1, 'lesson-2': 3 }, audioIds: [] }, []);
    const plan = planMerge({ ...empty, stars: { 'lesson-1': 3 } }, incoming);
    expect(plan.songs.map((s) => s.id)).toEqual(['song-1']);
    expect(plan.beats.map((b) => b.id)).toEqual(['b1']);
    expect(plan.stars).toEqual({ 'lesson-1': 3, 'lesson-2': 3 });
  });

  it('keeps whichever copy of a beat was edited last', () => {
    const here: DeviceData = { ...empty, beats: [beatWith('old', 1), beatWith('newer-here', 9)] };
    const incoming = createBackup({ ...empty, beats: [beatWith('old', 5), beatWith('newer-here', 2)] }, []);
    const plan = planMerge(here, incoming);
    expect(plan.beats.map((b) => [b.id, b.updatedAt])).toEqual([['old', 5]]);
    expect(plan.keptNewer).toBe(1);
  });

  it('skips songs that are already here', () => {
    const plan = planMerge({ ...empty, songs: [song] }, createBackup({ ...empty, songs: [song] }, []));
    expect(plan.songs).toEqual([]);
  });

  it('brings only recordings that a kept beat uses and this device lacks', () => {
    const beat = beatWith('b1', 1, { backing: { audioId: 'needed', name: 'x', start: 0, bpm: 90, volume: 1, on: true } });
    const incoming = createBackup({ ...empty, beats: [beat] }, [
      { id: 'needed', name: 'x', data: new ArrayBuffer(4) },
      { id: 'unused', name: 'y', data: new ArrayBuffer(4) },
    ]);
    expect(planMerge(empty, incoming).audio.map((a) => a.id)).toEqual(['needed']);
    expect(planMerge({ ...empty, audioIds: ['needed'] }, incoming).audio).toEqual([]);
  });
});

describe('backupFileName', () => {
  it('dates the file', () => {
    expect(backupFileName(new Date(2026, 10, 7))).toBe('piano-studio-sao-luu-2026-11-07.json');
  });
});
