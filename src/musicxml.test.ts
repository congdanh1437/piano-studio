// @vitest-environment jsdom
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseMusicXml, playOrder, readScoreFile, unzip } from './musicxml';

/** Builds a score from measure bodies; the first measure gets the given attributes. */
function score(parts: { id: string; name?: string; measures: string[] }[], attributes = '<divisions>1</divisions>', title = '') {
  const list = parts.map((p) => `<score-part id="${p.id}"><part-name>${p.name ?? p.id}</part-name></score-part>`).join('');
  const body = parts
    .map((p) => `<part id="${p.id}">${p.measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes>${attributes}</attributes>` : ''}${m}</measure>`).join('')}</part>`)
    .join('');
  const work = title ? `<work><work-title>${title}</work-title></work>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${work}<part-list>${list}</part-list>${body}</score-partwise>`;
}

const note = (step: string, octave: number, duration: number, extra = '') =>
  `<note>${extra.includes('<chord/>') ? '<chord/>' : ''}<pitch><step>${step[0]}</step>${step[1] === '#' ? '<alter>1</alter>' : step[1] === 'b' ? '<alter>-1</alter>' : ''}<octave>${octave}</octave></pitch><duration>${duration}</duration>${extra.replace('<chord/>', '')}</note>`;
const rest = (duration: number) => `<note><rest/><duration>${duration}</duration></note>`;
const tempo = (bpm: number) => `<direction><direction-type><words>x</words></direction-type><sound tempo="${bpm}"/></direction>`;

const simple = (s: ReturnType<typeof parseMusicXml>) => s.notes.map((n) => [n.midi, +n.time.toFixed(3), +n.duration.toFixed(3), n.hand]);

describe('parseMusicXml', () => {
  it('reads pitches, accidentals and rests at the default tempo', () => {
    const song = parseMusicXml(score([{ id: 'P1', measures: [note('C', 4, 1) + note('F#', 4, 1) + rest(1) + note('Bb', 3, 1)] }]), 'id', 'file');
    expect(simple(song)).toEqual([
      [60, 0, 0.5, 'R'],
      [66, 0.5, 0.5, 'R'],
      [58, 1.5, 0.5, 'L'],
    ]);
    expect(song.title).toBe('file');
  });

  it('follows divisions and tempo marks', () => {
    const xml = score([{ id: 'P1', measures: [tempo(60) + note('C', 4, 4) + note('D', 4, 2), tempo(120) + note('E', 4, 4)] }], '<divisions>4</divisions>');
    expect(simple(parseMusicXml(xml, 'id', 'x'))).toEqual([
      [60, 0, 1, 'R'],
      [62, 1, 0.5, 'R'],
      [64, 1.5, 0.5, 'R'],
    ]);
  });

  it('reads a metronome mark when there is no sound tempo', () => {
    const mark = '<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>40</per-minute></metronome></direction-type></direction>';
    expect(parseMusicXml(score([{ id: 'P1', measures: [mark + note('C', 4, 1) + note('D', 4, 1)] }]), 'id', 'x').notes[1].time).toBeCloseTo(0.75);
  });

  it('stacks chord notes and keeps going after them', () => {
    const xml = score([{ id: 'P1', measures: [note('C', 4, 2) + note('E', 4, 2, '<chord/>') + note('G', 4, 2, '<chord/>') + note('A', 4, 1)] }]);
    expect(simple(parseMusicXml(xml, 'id', 'x')).map(([m, t]) => [m, t])).toEqual([[60, 0], [64, 0], [67, 0], [69, 1]]);
  });

  it('gives each piano staff its hand, using backup to rewind', () => {
    const measure =
      `${note('E', 4, 2, '<staff>1</staff>')}${note('G', 4, 2, '<staff>1</staff>')}<backup><duration>4</duration></backup>` +
      `${note('C', 3, 4, '<staff>2</staff>')}`;
    const xml = score([{ id: 'P1', measures: [measure] }], '<divisions>1</divisions><staves>2</staves>');
    expect(simple(parseMusicXml(xml, 'id', 'x'))).toEqual([
      [48, 0, 2, 'L'],
      [64, 0, 1, 'R'],
      [67, 1, 1, 'R'],
    ]);
  });

  it('treats the higher of two single-staff parts as the right hand', () => {
    const xml = score([
      { id: 'P1', measures: [note('C', 3, 1) + note('C', 5, 1)] },
      { id: 'P2', measures: [note('C', 4, 1) + note('C', 6, 1)] },
    ]);
    const hands = parseMusicXml(xml, 'id', 'x').notes.map((n) => `${n.midi}${n.hand}`);
    expect(hands.sort()).toEqual(['48L', '60R', '72L', '84R']);
  });

  it('joins tied notes, including across a bar line', () => {
    const xml = score([{
      id: 'P1',
      measures: [
        note('C', 4, 2) + note('G', 4, 2, '<tie type="start"/>'),
        note('G', 4, 2, '<tie type="stop"/><tie type="start"/>'),
        note('G', 4, 1, '<tie type="stop"/>') + note('G', 4, 1),
      ],
    }], '<divisions>1</divisions>');
    expect(simple(parseMusicXml(xml, 'id', 'x'))).toEqual([
      [60, 0, 1, 'R'],
      [67, 1, 2.5, 'R'],
      [67, 3.5, 0.5, 'R'],
    ]);
  });

  it('skips grace and cue notes', () => {
    const grace = '<note><grace/><pitch><step>D</step><octave>4</octave></pitch></note>';
    const cue = '<note><cue/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>';
    const xml = score([{ id: 'P1', measures: [grace + note('C', 4, 1) + cue + note('F', 4, 1)] }]);
    expect(simple(parseMusicXml(xml, 'id', 'x')).map(([m, t]) => [m, t])).toEqual([[60, 0], [65, 1]]);
  });

  it('plays repeats and endings in order', () => {
    const repeatForward = '<barline location="left"><repeat direction="forward"/></barline>';
    const ending1 = '<barline location="left"><ending number="1" type="start"/></barline>';
    const ending1End = '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>';
    const ending2 = '<barline location="left"><ending number="2" type="start"/></barline>';
    const ending2End = '<barline location="right"><ending number="2" type="discontinue"/></barline>';
    const xml = score([{
      id: 'P1',
      measures: [
        note('C', 4, 4),
        repeatForward + note('D', 4, 4),
        ending1 + note('E', 4, 4) + ending1End,
        ending2 + note('F', 4, 4) + ending2End,
        note('G', 4, 4),
      ],
    }], '<divisions>1</divisions>');
    const song = parseMusicXml(xml, 'id', 'x');
    expect(song.notes.map((n) => n.midi)).toEqual([60, 62, 64, 62, 65, 67]);
    expect(song.notes.map((n) => n.time)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('uses the score title', () => {
    expect(parseMusicXml(score([{ id: 'P1', measures: [note('C', 4, 1)] }], undefined, 'Für Elise'), 'id', 'x').title).toBe('Für Elise');
  });

  it.each([
    ['broken XML', '<score-partwise><part', 'bị lỗi'],
    ['not a score', '<html></html>', 'không phải bản nhạc'],
    ['timewise scores', '<score-timewise></score-timewise>', 'timewise'],
    ['a score with only rests', score([{ id: 'P1', measures: [rest(4)] }]), 'không có nốt'],
  ])('explains %s', (_label, xml, message) => {
    expect(() => parseMusicXml(xml, 'id', 'x')).toThrow(message);
  });
});

describe('playOrder', () => {
  const m = (opts: { f?: boolean; b?: number; e?: number[]; end?: boolean } = {}) => ({
    repeatForward: opts.f ?? false,
    repeatBackward: opts.b ?? 0,
    endings: opts.e ?? [],
    endingEnd: opts.end ?? false,
  });

  it('plays straight through without repeats', () => {
    expect(playOrder([m(), m(), m()])).toEqual([0, 1, 2]);
  });

  it('repeats from the start when there is no forward sign', () => {
    expect(playOrder([m(), m({ b: 2 }), m()])).toEqual([0, 1, 0, 1, 2]);
  });

  it('honours a repeat count', () => {
    expect(playOrder([m({ f: true }), m({ b: 3 })])).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it('starts a second repeat after the first one, not from the top', () => {
    expect(playOrder([m(), m({ b: 2 }), m(), m({ b: 2 })])).toEqual([0, 1, 0, 1, 2, 3, 2, 3]);
  });

  it('carries on after a second ending into a later repeat', () => {
    const measures = [m({ f: true }), m({ e: [1], b: 2, end: true }), m({ e: [2], end: true }), m({ f: true }), m({ b: 2 }), m()];
    expect(playOrder(measures)).toEqual([0, 1, 0, 2, 3, 4, 3, 4, 5]);
  });

  it('handles an ending that covers two passes', () => {
    const measures = [m({ f: true }), m({ e: [1, 2], b: 3, end: true }), m({ e: [3], end: true }), m()];
    expect(playOrder(measures)).toEqual([0, 1, 0, 1, 0, 2, 3]);
  });
});

describe('score files', () => {
  const xml = score([{ id: 'P1', measures: [note('C', 4, 1)] }], undefined, 'Nén');

  /** Writes a minimal zip, like the .mxl files notation programs save. */
  function zip(files: Record<string, string>, compress: boolean): ArrayBuffer {
    const encoder = new TextEncoder();
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(files)) {
      const raw = encoder.encode(text);
      const data = compress ? deflateRawSync(raw) : Buffer.from(raw);
      const nameBytes = Buffer.from(name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(compress ? 8 : 0, 8);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(nameBytes.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(compress ? 8 : 0, 10);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(raw.length, 24);
      central.writeUInt16LE(nameBytes.length, 28);
      central.writeUInt32LE(offset, 42);
      locals.push(local, nameBytes, data);
      centrals.push(central, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const centralSize = centrals.reduce((s, b) => s + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    const all = Buffer.concat([...locals, ...centrals, end]);
    return all.buffer.slice(all.byteOffset, all.byteOffset + all.length) as ArrayBuffer;
  }

  const container = '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/song.musicxml"/></rootfiles></container>';

  it.each([true, false])('opens a .mxl file (compressed: %s)', async (compress) => {
    const file = zip({ 'META-INF/container.xml': container, 'score/song.musicxml': xml }, compress);
    const result = await readScoreFile(file);
    expect(result.kind).toBe('musicxml');
    if (result.kind === 'musicxml') expect(parseMusicXml(result.text, 'id', 'x').title).toBe('Nén');
  });

  it('finds the score even without a container file', async () => {
    const files = await unzip(zip({ 'song.xml': xml }, true));
    expect([...files.keys()]).toEqual(['song.xml']);
    const result = await readScoreFile(zip({ 'song.xml': xml }, true));
    expect(result.kind === 'musicxml' && result.text).toContain('score-partwise');
  });

  it('tells MIDI and plain MusicXML apart', async () => {
    const midi = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6]).buffer;
    expect((await readScoreFile(midi)).kind).toBe('midi');
    expect((await readScoreFile(new TextEncoder().encode(xml).buffer as ArrayBuffer)).kind).toBe('musicxml');
  });

  it('reads UTF-16 files', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from(xml).flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    const result = await readScoreFile(utf16.buffer);
    expect(result.kind === 'musicxml' && parseMusicXml(result.text, 'id', 'x').title).toBe('Nén');
  });

  it('says plainly when a file is neither MIDI nor MusicXML', async () => {
    await expect(readScoreFile(new TextEncoder().encode('hello').buffer as ArrayBuffer)).rejects.toThrow('không phải MIDI');
  });

  it('rejects a damaged zip', async () => {
    await expect(readScoreFile(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]).buffer)).rejects.toThrow('hỏng');
  });
});
