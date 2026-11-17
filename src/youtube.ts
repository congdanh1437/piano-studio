export interface YouTubeLink {
  videoId: string;
  /** Start time from the link, in seconds. */
  start: number;
}

const VIDEO_ID = /^[\w-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be']);

/** Reads "90", "90s" or "1h2m30s". */
function parseTime(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** Understands the link forms people copy; anything else, including other sites, gives null. */
export function parseYouTubeLink(text: string): YouTubeLink | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (host.endsWith('youtu.be')) id = parts[0];
  else if (parts[0] === 'watch') id = url.searchParams.get('v');
  else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];

  if (!id || !VIDEO_ID.test(id)) return null;
  return { videoId: id, start: parseTime(url.searchParams.get('t') ?? url.searchParams.get('start')) };
}

const TAP_RESET_MS = 2000;
const MIN_TAPS = 4;
const MAX_TAPS = 16;

/** Gives a tempo once enough taps have come in; a long pause starts a new count. */
export function createTapTempo() {
  let taps: number[] = [];
  return (now: number): { count: number; bpm: number | null } => {
    if (taps.length > 0 && now - taps[taps.length - 1] > TAP_RESET_MS) taps = [];
    taps = [...taps, now].slice(-MAX_TAPS);
    if (taps.length < MIN_TAPS) return { count: taps.length, bpm: null };
    const gaps = taps.slice(1).map((time, i) => time - taps[i]).sort((a, b) => a - b);
    // The median ignores the odd tap that came in early or late.
    return { count: taps.length, bpm: 60000 / gaps[Math.floor(gaps.length / 2)] };
  };
}

/** Half and double tempo feel the same, so bring a tempo into the range the board supports. */
export function fitBpm(bpm: number, min = 60, max = 180): number {
  let value = bpm;
  while (value < min) value *= 2;
  while (value > max) value /= 2;
  return Math.round(value);
}

export function youTubeError(code: number): string {
  if (code === 101 || code === 150 || code === 153) return 'Chủ video không cho phát nhúng ở ứng dụng khác. Hãy thử video khác.';
  if (code === 100) return 'Video này không tồn tại hoặc đã bị ẩn.';
  if (code === 2) return 'Link video không hợp lệ.';
  return 'Không phát được video này.';
}
