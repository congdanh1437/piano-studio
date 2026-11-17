import { describe, expect, it } from 'vitest';
import { createTapTempo, fitBpm, parseYouTubeLink, youTubeError } from './youtube';

const ID = 'M7lc1UVf-VE';

describe('parseYouTubeLink', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?list=abc&v=${ID}&index=2`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `  youtu.be/${ID}  `,
  ])('reads %s', (link) => {
    expect(parseYouTubeLink(link)?.videoId).toBe(ID);
  });

  it.each([
    [`https://youtu.be/${ID}?t=90`, 90],
    [`https://youtu.be/${ID}?t=90s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1m30s`, 90],
    [`https://www.youtube.com/watch?v=${ID}&t=1h0m5s`, 3605],
    [`https://www.youtube.com/embed/${ID}?start=12`, 12],
    [`https://youtu.be/${ID}`, 0],
    [`https://youtu.be/${ID}?t=nonsense`, 0],
  ])('reads the start time of %s', (link, start) => {
    expect(parseYouTubeLink(link)?.start).toBe(start);
  });

  it.each([
    '',
    'not a link',
    `https://evil.example.com/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `javascript:alert(1)//youtu.be/${ID}`,
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/@somechannel',
    `https://youtu.be/${ID}"><script>`,
  ])('rejects %s', (link) => {
    expect(parseYouTubeLink(link)).toBeNull();
  });
});

describe('tap tempo', () => {
  it('waits for enough taps, then reads the tempo', () => {
    const tap = createTapTempo();
    expect(tap(0).bpm).toBeNull();
    expect(tap(500).bpm).toBeNull();
    expect(tap(1000).bpm).toBeNull();
    expect(tap(1500).bpm).toBeCloseTo(120);
  });

  it('shrugs off one badly timed tap', () => {
    const tap = createTapTempo();
    let result = tap(0);
    for (const time of [600, 1200, 1500, 2400, 3000, 3600]) result = tap(time);
    expect(result.bpm).toBeCloseTo(100);
  });

  it('starts over after a long pause', () => {
    const tap = createTapTempo();
    for (const time of [0, 500, 1000, 1500]) tap(time);
    expect(tap(10000)).toEqual({ count: 1, bpm: null });
  });
});

describe('fitBpm', () => {
  it('moves a tempo into range by octaves', () => {
    expect(fitBpm(45)).toBe(90);
    expect(fitBpm(200)).toBe(100);
    expect(fitBpm(92.4)).toBe(92);
  });
});

describe('youTubeError', () => {
  it('explains blocked embedding', () => {
    expect(youTubeError(150)).toContain('nhúng');
    expect(youTubeError(101)).toBe(youTubeError(150));
    expect(youTubeError(999)).toBeTruthy();
  });
});
