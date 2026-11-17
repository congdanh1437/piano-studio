import { Beat } from './beat';
import { createTapTempo, fitBpm, parseYouTubeLink, youTubeError } from './youtube';

const API_URL = 'https://www.youtube.com/iframe_api';
/** Doesn't set YouTube cookies until the viewer presses play. */
const PLAYER_HOST = 'https://www.youtube-nocookie.com';
const LOOP_CHECK_MS = 100;
/** Start the board anyway if the video takes this long, so Play never seems dead. */
const VIDEO_START_TIMEOUT_MS = 3000;
const SPEEDS = [0.25, 0.5, 0.75, 1];
const STATE_PLAYING = 1;

interface Player {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getVideoData?(): { title?: string };
  destroy(): void;
}

interface PlayerEvent {
  target: Player;
  data: number;
}

declare global {
  interface Window {
    YT?: { Player: new (element: HTMLElement, options: unknown) => Player };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoading: Promise<void> | null = null;

function loadApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (!apiLoading) {
    apiLoading = new Promise<void>((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => resolve();
      const script = document.createElement('script');
      script.src = API_URL;
      script.onerror = () => {
        apiLoading = null;
        script.remove();
        reject(new Error('offline'));
      };
      document.head.append(script);
    });
  }
  return apiLoading;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface YouTubePanelHooks {
  /** The beat on screen right now. */
  beat(): Beat;
  changed(): void;
  message(text: string): void;
  /** A tapped tempo came in. */
  tempo(bpm: number): void;
  /** Runs a change to the video's speed or link, keeping the board's playhead in place. */
  timing(apply: () => void): void;
}

export function createYouTubePanel(hooks: YouTubePanelHooks) {
  let player: Player | null = null;
  let playerReady = false;
  let loadedVideoId: string | null = null;
  let loopTimer = 0;
  let pendingStart: (() => void) | null = null;
  let pendingTimer = 0;
  const tap = createTapTempo();

  const box = el('section', 'yt-box');
  box.setAttribute('aria-label', 'Video YouTube');

  const form = el('form', 'yt-form');
  // People paste "youtu.be/…" without https://. The app's own check handles that; the browser's would refuse it.
  form.noValidate = true;
  const input = el('input', 'beat-name yt-input');
  input.type = 'url';
  input.placeholder = 'Dán link YouTube vào đây';
  input.setAttribute('aria-label', 'Link YouTube');
  form.append(input, button('Gắn', () => form.requestSubmit(), 'btn btn-primary'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const link = parseYouTubeLink(input.value);
    if (!link) {
      hooks.message('Link này không phải video YouTube. Hãy dán link dạng youtube.com/watch?v=… hoặc youtu.be/…');
      return;
    }
    hooks.beat().youtube = { videoId: link.videoId, start: link.start, loopA: null, loopB: null, rate: 1, linked: false };
    input.value = '';
    hooks.message('');
    hooks.changed();
    sync();
  });

  const frameHolder = el('div', 'yt-frame');
  const controls = el('div', 'beat-bar yt-controls');
  const titleText = el('p', 'yt-title');
  const playToggle = button('▶ Video', () => {
    if (!player || !playerReady) return;
    if (player.getPlayerState() === STATE_PLAYING) player.pauseVideo();
    else player.playVideo();
  });
  const back = button('− 5 giây', () => nudge(-5));
  const forward = button('+ 5 giây', () => nudge(5));
  const markA = button('Đặt A', () => setLoop('a'));
  const markB = button('Đặt B', () => setLoop('b'));
  const clearLoop = button('Bỏ lặp', () => {
    const youtube = hooks.beat().youtube;
    if (!youtube) return;
    youtube.loopA = null;
    youtube.loopB = null;
    hooks.changed();
    syncControls();
  }, 'btn btn-quiet');

  const speed = el('select', 'beat-select');
  speed.setAttribute('aria-label', 'Tốc độ video');
  speed.append(...SPEEDS.map((rate) => new Option(rate === 1 ? 'Tốc độ gốc' : `${rate * 100}% tốc độ`, String(rate))));
  speed.addEventListener('change', () => {
    const youtube = hooks.beat().youtube;
    if (!youtube) return;
    hooks.timing(() => {
      youtube.rate = Number(speed.value);
    });
    if (playerReady) player?.setPlaybackRate(youtube.rate);
    hooks.changed();
  });

  const linkToggle = button('Chạy cùng bảng: Tắt', () => {
    const youtube = hooks.beat().youtube;
    if (!youtube) return;
    hooks.timing(() => {
      youtube.linked = !youtube.linked;
    });
    hooks.changed();
    syncControls();
  });

  const tapButton = button('Gõ tìm BPM', () => {
    const result = tap(performance.now());
    if (result.bpm === null) {
      tapButton.textContent = `Gõ tiếp (${result.count}/4)`;
      return;
    }
    const bpm = fitBpm(result.bpm);
    tapButton.textContent = `≈ ${bpm} BPM, gõ tiếp`;
    hooks.tempo(bpm);
  });
  const remove = button('Bỏ video', () => {
    hooks.timing(() => {
      hooks.beat().youtube = undefined;
    });
    hooks.changed();
    sync();
  }, 'btn btn-quiet');
  const hint = el('p', 'muted', 'Bấm vào trong video sẽ khiến phím máy tính tác động lên video. Bấm ra ngoài khung để gõ trống tiếp.');

  controls.append(playToggle, back, forward, markA, markB, clearLoop, speed, linkToggle, tapButton, remove);
  const side = el('div', 'yt-side');
  side.append(titleText, controls, hint);
  box.append(form, frameHolder, side);

  function nudge(seconds: number) {
    if (playerReady) player?.seekTo(Math.max(0, player.getCurrentTime() + seconds), true);
  }

  function setLoop(point: 'a' | 'b') {
    const youtube = hooks.beat().youtube;
    if (!youtube || !player || !playerReady) return;
    const now = player.getCurrentTime();
    if (point === 'a') {
      youtube.loopA = now;
      if (youtube.loopB !== null && youtube.loopB <= now) youtube.loopB = null;
    } else {
      if (youtube.loopA !== null && now <= youtube.loopA) {
        hooks.message('Điểm B phải nằm sau điểm A.');
        return;
      }
      youtube.loopB = now;
    }
    hooks.changed();
    syncControls();
  }

  function syncControls() {
    const youtube = hooks.beat().youtube;
    if (!youtube) return;
    markA.textContent = youtube.loopA === null ? 'Đặt A' : `A ${clock(youtube.loopA)}`;
    markB.textContent = youtube.loopB === null ? 'Đặt B' : `B ${clock(youtube.loopB)}`;
    clearLoop.disabled = youtube.loopA === null && youtube.loopB === null;
    speed.value = String(youtube.rate);
    linkToggle.textContent = `Chạy cùng bảng: ${youtube.linked ? 'Bật' : 'Tắt'}`;
    linkToggle.setAttribute('aria-pressed', String(youtube.linked));
    if (playerReady && player) {
      const title = player.getVideoData?.().title;
      titleText.textContent = title || 'Video YouTube';
    }
  }

  function releaseWaitingBoard() {
    clearTimeout(pendingTimer);
    const start = pendingStart;
    pendingStart = null;
    start?.();
  }

  function destroyPlayer() {
    clearInterval(loopTimer);
    loopTimer = 0;
    releaseWaitingBoard();
    player?.destroy();
    player = null;
    playerReady = false;
    loadedVideoId = null;
    frameHolder.replaceChildren();
  }

  async function ensurePlayer(videoId: string, start: number) {
    if (loadedVideoId === videoId) return;
    if (player && playerReady) {
      loadedVideoId = videoId;
      player.cueVideoById({ videoId, startSeconds: start });
      return;
    }
    if (player) return; // Still starting; `onReady` loads whichever video is current.
    loadedVideoId = videoId;
    titleText.textContent = 'Đang tải video…';
    try {
      await loadApi();
    } catch {
      loadedVideoId = null;
      titleText.textContent = 'Không tải được YouTube. Hãy kiểm tra kết nối mạng.';
      return;
    }
    if (hooks.beat().youtube?.videoId !== videoId || !box.isConnected) {
      loadedVideoId = null;
      if (box.isConnected) sync();
      return;
    }
    const mount = el('div');
    frameHolder.replaceChildren(mount);
    player = new window.YT!.Player(mount, {
      host: PLAYER_HOST,
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, start: Math.floor(start), origin: location.origin },
      events: {
        onReady: () => {
          playerReady = true;
          const youtube = hooks.beat().youtube;
          if (youtube && youtube.videoId !== loadedVideoId) sync();
          else if (youtube) player?.setPlaybackRate(youtube.rate);
          syncControls();
        },
        onStateChange: (event: PlayerEvent) => {
          playToggle.textContent = event.data === STATE_PLAYING ? '⏸ Video' : '▶ Video';
          if (event.data === STATE_PLAYING) {
            const youtube = hooks.beat().youtube;
            if (youtube) event.target.setPlaybackRate(youtube.rate);
            releaseWaitingBoard();
            syncControls();
          }
        },
        onError: (event: PlayerEvent) => {
          hooks.message(youTubeError(event.data));
          releaseWaitingBoard();
        },
      },
    });
    loopTimer = window.setInterval(checkLoop, LOOP_CHECK_MS);
  }

  function checkLoop() {
    const youtube = hooks.beat().youtube;
    if (!youtube || !player || !playerReady || youtube.loopB === null) return;
    if (player.getPlayerState() === STATE_PLAYING && player.getCurrentTime() >= youtube.loopB) {
      player.seekTo(youtube.loopA ?? 0, true);
    }
  }

  /** Shows the video of the beat on screen, or the link box if it has none. */
  function sync() {
    const youtube = hooks.beat().youtube;
    form.hidden = Boolean(youtube);
    frameHolder.hidden = !youtube;
    side.hidden = !youtube;
    if (!youtube) {
      destroyPlayer();
      return;
    }
    void ensurePlayer(youtube.videoId, youtube.start);
    syncControls();
  }

  return {
    element: box,
    sync,
    destroy: destroyPlayer,

    /** Board speed follows the video, but only while the two run together. */
    speedFactor(): number {
      const youtube = hooks.beat().youtube;
      return youtube?.linked ? youtube.rate : 1;
    },

    /** Starts the video if it is tied to the board, and calls back once sound is coming. */
    startWithBoard(begin: () => void) {
      const youtube = hooks.beat().youtube;
      if (!youtube?.linked || !player || !playerReady) {
        begin();
        return;
      }
      pendingStart = begin;
      pendingTimer = window.setTimeout(() => {
        hooks.message('Video khởi động chậm nên bảng đã chạy trước, hai bên có thể lệch nhau.');
        releaseWaitingBoard();
      }, VIDEO_START_TIMEOUT_MS);
      player.seekTo(youtube.loopA ?? youtube.start, true);
      player.playVideo();
    },

    stopWithBoard() {
      if (pendingStart) {
        clearTimeout(pendingTimer);
        pendingStart = null;
      }
      if (hooks.beat().youtube?.linked && playerReady) player?.pauseVideo();
    },
  };
}
