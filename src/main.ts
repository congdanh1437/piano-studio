import { Piano } from './audio';
import { backupSection } from './backupView';
import { mountBeatMaker } from './beatView';
import { demoSongs } from './demos';
import { computerKeyLabels, fitOctaveShift, fitRange, keyAt, Key, layoutKeys, midiForCode, Range } from './keyboard';
import { evaluate, Lesson, lessons, LEVELS } from './lessons';
import { HandMode, LEAD_IN, PracticeSession } from './practice';
import { loadKeyHints, loadStars, saveKeyHints, saveStars } from './progress';
import { draw } from './render';
import { parseMidi, Song } from './song';
import { deleteSong, loadSongs, saveSong } from './storage';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const piano = new Piano();

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

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const starText = (stars: number) => '★'.repeat(stars) + '☆'.repeat(3 - stars);

function starsNode(stars: number) {
  const node = el('span', 'stars', starText(stars));
  node.setAttribute('aria-label', `${stars} trên 3 sao`);
  return node;
}

// ---------- Home ----------

let leaveScreen: (() => void) | null = null;

function homeShell(active: 'lessons' | 'library' | 'beats') {
  leaveScreen?.();
  leaveScreen = null;
  app.replaceChildren();
  const page = el('main', active === 'beats' ? 'home home-beats' : 'home');
  const header = el('header', 'home-head');
  const tabs = el('nav', 'segmented');
  tabs.setAttribute('aria-label', 'Mục chính');
  const lessonsTab = button('Bài học', showLessons, 'seg');
  const libraryTab = button('Thư viện', () => void showLibrary(), 'seg');
  const beatsTab = button('Làm beat', () => void showBeats(), 'seg');
  lessonsTab.setAttribute('aria-pressed', String(active === 'lessons'));
  libraryTab.setAttribute('aria-pressed', String(active === 'library'));
  beatsTab.setAttribute('aria-pressed', String(active === 'beats'));
  tabs.append(lessonsTab, libraryTab, beatsTab);
  header.append(el('h1', '', 'Piano Studio'), tabs);
  page.append(header);
  app.append(page);
  return page;
}

async function showBeats() {
  const page = homeShell('beats');
  const leave = await mountBeatMaker(page, piano);
  // The user may have switched tab while saved beats were loading.
  if (page.isConnected) leaveScreen = leave;
  else leave();
}

function startLesson(lesson: Lesson) {
  piano.unlock();
  showPlayer(lesson.song, lesson);
}

function showLessons() {
  const page = homeShell('lessons');
  const stars = loadStars();
  const passed = lessons.filter((l) => (stars[l.id] ?? 0) > 0).length;
  const next = lessons.find((l) => !stars[l.id]);

  const summary = el('section', 'next-up');
  const summaryText = el('div');
  summaryText.append(
    el('p', 'muted', `Đã qua ${passed}/${lessons.length} bài`),
    el('h2', '', next ? next.title : 'Bạn đã hoàn thành cả lộ trình!'),
  );
  const meter = el('div', 'meter');
  const meterFill = el('div', 'meter-fill');
  meterFill.style.width = `${(passed / lessons.length) * 100}%`;
  meter.append(meterFill);
  summary.append(summaryText);
  if (next) summary.append(button(passed === 0 ? 'Bắt đầu học' : 'Học tiếp', () => startLesson(next), 'btn btn-primary'));
  page.append(summary, meter);

  for (const { level, name, detail } of LEVELS) {
    const section = el('section', 'level');
    const inLevel = lessons.filter((l) => l.level === level);
    const done = inLevel.filter((l) => stars[l.id]).length;
    const head = el('div', 'level-head');
    const heading = el('h2', '', `Cấp ${level}: ${name}`);
    head.append(heading, el('span', 'muted', `${done}/${inLevel.length}`));
    const list = el('ol', 'lesson-list');
    for (const lesson of inLevel) {
      const item = el('li');
      const open = button('', () => startLesson(lesson), lesson === next ? 'lesson is-next' : 'lesson');
      const text = el('span', 'lesson-text');
      text.append(el('span', 'song-title', lesson.title), el('span', 'muted', lesson.goal));
      open.append(el('span', 'lesson-number', String(lessons.indexOf(lesson) + 1)), text, starsNode(stars[lesson.id] ?? 0));
      item.append(open);
      list.append(item);
    }
    section.append(head, el('p', 'muted', detail), list);
    page.append(section);
  }
}

async function showLibrary(notice = '') {
  const page = homeShell('library');
  const intro = el('div', 'library-intro');
  intro.append(el('p', 'muted', 'Luyện tự do các bài bạn muốn. Nhập file MIDI để thêm bài.'));

  const input = el('input');
  input.type = 'file';
  input.accept = '.mid,.midi,audio/midi,audio/x-midi';
  input.hidden = true;
  const message = el('p', 'message');
  message.setAttribute('role', 'status');
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const id = `song-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await saveSong(parseMidi(await file.arrayBuffer(), id, file.name.replace(/\.midi?$/i, '')));
      await showLibrary();
    } catch (error) {
      message.textContent = `Không mở được "${file.name}": ${error instanceof Error ? error.message : 'file lỗi'}`;
    }
  });
  intro.append(button('Nhập file MIDI', () => input.click(), 'btn btn-primary'), input);

  const list = el('ul', 'song-list');
  const imported = await loadSongs().catch(() => [] as Song[]);
  for (const song of [...imported, ...demoSongs]) {
    const item = el('li', 'song');
    const open = button('', () => {
      piano.unlock();
      showPlayer(song);
    }, 'song-open');
    const hands = new Set(song.notes.map((n) => n.hand)).size === 2 ? 'Hai tay' : 'Một tay';
    open.append(
      el('span', 'song-title', song.title),
      el('span', 'muted', `${formatTime(song.duration)} · ${song.notes.length} nốt · ${hands}${song.builtIn ? ' · Bài mẫu' : ''}`),
    );
    item.append(open);
    if (!song.builtIn) {
      item.append(button('Xóa', async () => {
        if (confirm(`Xóa "${song.title}" khỏi thư viện?`)) {
          await deleteSong(song.id);
          await showLibrary();
        }
      }, 'btn btn-quiet'));
    }
    list.append(item);
  }
  page.append(intro, message, list, backupSection((summary) => void showLibrary(summary), notice));
}

// ---------- Player ----------

function showPlayer(song: Song, lesson?: Lesson) {
  app.replaceChildren();
  const hasBothHands = new Set(song.notes.map((n) => n.hand)).size === 2;
  const startMode: HandMode = lesson?.mode ?? (song.notes.some((n) => n.hand === 'R') ? 'R' : 'L');
  let session = new PracticeSession(song, startMode);
  session.speed = lesson?.speed ?? 1;
  session.wait = lesson?.wait ?? true;

  let keys: Key[] = [];
  let range: Range = { lo: 60, hi: 84 };
  let octaveShift = 0;
  let hintsOn = loadKeyHints();
  let keyLabels = new Map<number, string>();
  let width = 0;
  let height = 0;
  let keyboardHeight = 0;
  let frame = 0;
  let last = performance.now();
  let lastPanelUpdate = 0;
  let loopStart: number | null = null;
  let showIntro = Boolean(lesson);
  let wakeLock: { release(): Promise<void> } | null = null;

  const pressed = new Map<number, 'hit' | 'wrong' | 'free'>();
  const pointers = new Map<number, number>();
  const heldKeys = new Map<string, number>();

  // Controls
  const bar = el('div', 'toolbar');
  const back = button(lesson ? '‹ Bài học' : '‹ Thư viện', () => leave(), 'btn btn-quiet');
  const title = el('strong', 'player-title', song.title);
  const play = button('Bắt đầu', () => togglePlay(), 'btn btn-primary btn-play');
  const restart = button('Từ đầu', () => {
    showIntro = false;
    session.restart();
    syncControls();
  });

  const handGroup = el('div', 'segmented');
  handGroup.setAttribute('role', 'group');
  handGroup.setAttribute('aria-label', 'Tay luyện tập');
  const modes: [HandMode, string][] = [
    ['R', 'Tay phải'],
    ['L', 'Tay trái'],
    ['both', 'Hai tay'],
    ['listen', 'Nghe'],
  ];
  const handButtons = modes
    .filter(([mode]) => hasBothHands || mode === 'listen' || song.notes.some((n) => n.hand === mode))
    .map(([mode, label]) => {
      const node = button(label, () => setMode(mode), 'seg');
      node.dataset.mode = mode;
      handGroup.append(node);
      return node;
    });

  const waitButton = button('Chờ nốt: Bật', () => {
    session.wait = !session.wait;
    syncControls();
  });

  const hintButton = button('Chữ phím: Bật', () => {
    hintsOn = !hintsOn;
    saveKeyHints(hintsOn);
    refreshLabels();
    syncControls();
  });

  const speedLabel = el('label', 'speed');
  const speedText = el('span', '', `Tốc độ ${Math.round(session.speed * 100)}%`);
  const speed = el('input');
  speed.type = 'range';
  speed.min = '25';
  speed.max = '150';
  speed.step = '5';
  speed.value = String(Math.round(session.speed * 100));
  speed.addEventListener('input', () => {
    session.speed = Number(speed.value) / 100;
    speedText.textContent = `Tốc độ ${speed.value}%`;
  });
  speedLabel.append(speedText, speed);

  const loopButton = button('Lặp: Đặt A', () => {
    if (session.loop) {
      session.loop = null;
      loopStart = null;
    } else if (loopStart === null) {
      loopStart = session.t;
    } else if (session.t > loopStart) {
      session.loop = { a: loopStart, b: session.t };
      session.seek(loopStart);
    }
    syncControls();
  });

  const stats = el('span', 'stats');
  stats.setAttribute('aria-live', 'off');
  bar.append(back, title, play, restart, handGroup, waitButton, hintButton, speedLabel, loopButton, stats);

  const progress = el('input', 'progress');
  progress.type = 'range';
  progress.min = String(LEAD_IN);
  progress.max = String(song.duration);
  progress.step = '0.1';
  progress.setAttribute('aria-label', 'Vị trí trong bài');
  progress.addEventListener('input', () => session.seek(Number(progress.value)));

  const stage = el('div', 'stage');
  const canvas = el('canvas');
  const overlay = el('div', 'overlay');
  overlay.hidden = true;
  stage.append(canvas, overlay);
  const context = canvas.getContext('2d', { alpha: false })!;

  const page = el('main', 'player');
  page.append(bar, progress, stage);
  app.append(page);

  // Layout
  function measure() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    keyboardHeight = Math.max(130, Math.min(height * 0.36, 300));
    keys = layoutKeys(range, width);
  }

  const playableNotes = () => song.notes.filter((n) => session.mode === 'listen' || session.isUserNote(n));

  function refreshLabels() {
    keyLabels = hintsOn ? computerKeyLabels(octaveShift) : new Map();
  }

  function fitKeyboard() {
    const playable = playableNotes();
    range = fitRange(playable);
    keys = layoutKeys(range, width);
    octaveShift = fitOctaveShift(playable);
    refreshLabels();
  }

  function setMode(mode: HandMode) {
    const next = new PracticeSession(song, mode);
    next.wait = session.wait;
    next.speed = session.speed;
    next.loop = session.loop;
    next.seek(session.t);
    next.playing = session.playing;
    session = next;
    releaseAll();
    fitKeyboard();
    syncControls();
  }

  function togglePlay() {
    piano.unlock();
    showIntro = false;
    if (session.finished) session.restart();
    else session.playing = !session.playing;
    syncControls();
  }

  function renderIntro(current: Lesson) {
    const tips = el('ul', 'tips');
    for (const tip of current.tips) tips.append(el('li', '', tip));
    const needs = [`Tốc độ ${Math.round(current.speed * 100)}%`, current.wait ? 'Bài chờ bạn đánh đúng' : 'Nhịp thật, không chờ', 'Đạt từ 70% để qua bài'];
    const actions = el('div', 'overlay-actions');
    actions.append(button('Bắt đầu', () => togglePlay(), 'btn btn-primary'));
    if (hasBothHands || current.mode !== 'listen') {
      actions.append(button('Nghe mẫu trước', () => {
        setMode('listen');
        togglePlay();
      }));
    }
    const nodes: Node[] = [
      el('p', 'muted', `Cấp ${current.level} · Bài ${lessons.indexOf(current) + 1}/${lessons.length}`),
      el('h2', '', current.title),
      el('p', '', current.goal),
      tips,
      el('p', 'muted', needs.join(' · ')),
    ];
    if (hintsOn) nodes.push(el('p', 'muted', 'Bàn phím máy tính: hàng Z cho quãng thấp, hàng Q cho quãng cao, phím số và hàng A cho phím đen.'));
    overlay.replaceChildren(...nodes, actions);
  }

  function renderResult() {
    const accuracy = session.accuracy;
    const score = el('p', '', `Đúng ${session.hits} · Lỡ ${session.misses} · Sai ${session.wrong}`);
    const actions = el('div', 'overlay-actions');
    if (!lesson) {
      actions.append(button('Luyện lại', () => togglePlay(), 'btn btn-primary'));
      overlay.replaceChildren(el('h2', '', accuracy === null ? 'Hết bài' : `Chính xác ${accuracy}%`), score, actions);
      return;
    }
    const { stars, notCounted } = evaluate(lesson, session);
    if (stars > 0) saveStars(lesson.id, stars);
    const next = lessons[lessons.indexOf(lesson) + 1];
    const retry = button('Luyện lại', () => {
      if (session.mode !== lesson.mode) setMode(lesson.mode);
      togglePlay();
    }, stars > 0 && next ? 'btn' : 'btn btn-primary');
    actions.append(retry);
    if (next) actions.append(button(`Bài tiếp: ${next.title}`, () => {
      leave(false);
      startLesson(next);
    }, stars > 0 ? 'btn btn-primary' : 'btn'));
    const heading = session.mode === 'listen' ? 'Bạn vừa nghe mẫu' : stars > 0 ? 'Qua bài!' : 'Chưa qua bài';
    const advice = session.mode === 'listen'
      ? 'Giờ hãy tự chơi: bấm Luyện lại.'
      : notCounted || (stars > 0 ? '' : 'Cần đạt từ 70%. Thử giảm tốc độ để luyện rồi quay lại tốc độ yêu cầu.');
    overlay.replaceChildren(
      el('h2', '', heading),
      starsNode(stars),
      el('p', '', accuracy === null ? '' : `Chính xác ${accuracy}%`),
      score,
      ...(advice ? [el('p', 'muted', advice)] : []),
      actions,
    );
  }

  function syncControls() {
    play.textContent = session.finished ? 'Chơi lại' : session.playing ? 'Tạm dừng' : session.t > LEAD_IN ? 'Tiếp tục' : 'Bắt đầu';
    waitButton.textContent = `Chờ nốt: ${session.wait ? 'Bật' : 'Tắt'}`;
    waitButton.setAttribute('aria-pressed', String(session.wait));
    waitButton.disabled = session.mode === 'listen';
    hintButton.textContent = `Chữ phím: ${hintsOn ? 'Bật' : 'Tắt'}`;
    hintButton.setAttribute('aria-pressed', String(hintsOn));
    for (const node of handButtons) {
      node.setAttribute('aria-pressed', String(node.dataset.mode === session.mode));
    }
    loopButton.textContent = session.loop ? 'Bỏ lặp' : loopStart === null ? 'Lặp: Đặt A' : 'Lặp: Đặt B';
    overlay.hidden = !(session.finished || showIntro);
    if (showIntro && lesson) renderIntro(lesson);
    else if (session.finished) renderResult();
    updatePanel();
  }

  function updatePanel() {
    progress.value = String(session.t);
    const accuracy = session.accuracy === null ? '–' : `${session.accuracy}%`;
    const latency = piano.latencyMs === null ? '–' : `${piano.latencyMs} ms`;
    const sound = piano.samplesLoaded < piano.samplesTotal ? ` · Âm mẫu ${piano.samplesLoaded}/${piano.samplesTotal}` : '';
    stats.textContent = `Điểm ${accuracy} · Trễ ${latency}${sound}`;
  }

  // Playing keys
  function keyDown(midi: number, velocity = 0.8) {
    piano.noteOn(midi, velocity);
    pressed.set(midi, session.press(midi));
  }

  function keyUp(midi: number) {
    const stillHeld = [...pointers.values(), ...heldKeys.values()].includes(midi);
    if (stillHeld) return;
    piano.noteOff(midi);
    pressed.delete(midi);
  }

  function releaseAll() {
    pointers.clear();
    heldKeys.clear();
    pressed.clear();
    piano.stopAll();
  }

  const keyFromEvent = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return keyAt(keys, event.clientX - rect.left, event.clientY - rect.top - (height - keyboardHeight), keyboardHeight);
  };

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    piano.unlock();
    const midi = keyFromEvent(event);
    if (midi === null) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, midi);
    keyDown(midi);
  });

  // Sliding a finger along the keys plays each one it reaches.
  canvas.addEventListener('pointermove', (event) => {
    const current = pointers.get(event.pointerId);
    if (current === undefined) return;
    const midi = keyFromEvent(event);
    if (midi === null || midi === current) return;
    pointers.set(event.pointerId, midi);
    keyUp(current);
    keyDown(midi);
  });

  const pointerEnd = (event: PointerEvent) => {
    const midi = pointers.get(event.pointerId);
    if (midi === undefined) return;
    pointers.delete(event.pointerId);
    keyUp(midi);
  };
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const focused = document.activeElement;
    if (event.code === 'Space') {
      event.preventDefault();
      // A focused button would also treat Space as a click and undo this toggle.
      if (focused instanceof HTMLElement) focused.blur();
      togglePlay();
      return;
    }
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      if (focused instanceof HTMLInputElement) return; // Arrows are moving a slider.
      event.preventDefault();
      releaseAll();
      octaveShift = Math.max(-3, Math.min(3, octaveShift + (event.code === 'ArrowLeft' ? -1 : 1)));
      refreshLabels();
      return;
    }
    const midi = midiForCode(event.code, octaveShift);
    if (midi === null) return;
    event.preventDefault();
    piano.unlock();
    heldKeys.set(event.code, midi);
    keyDown(midi);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    const midi = heldKeys.get(event.code);
    if (midi === undefined) return;
    heldKeys.delete(event.code);
    keyUp(midi);
  };

  // Keep the screen on during practice where the browser allows it (HTTPS only).
  const requestWakeLock = () => {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    nav.wakeLock?.request('screen').then((lock) => (wakeLock = lock)).catch(() => {});
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') requestWakeLock();
    else {
      session.playing = false;
      releaseAll();
      syncControls();
    }
  };

  function loop(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const wasFinished = session.finished;
    for (const note of session.tick(dt)) {
      piano.playFor(note.midi, note.velocity, note.duration / session.speed);
    }
    draw(context, { width, height, keyboardHeight, keys, pressed, keyLabels }, session);
    if (session.finished !== wasFinished) syncControls();
    else if (now - lastPanelUpdate > 200) {
      lastPanelUpdate = now;
      updatePanel();
    }
    frame = requestAnimationFrame(loop);
  }

  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(stage);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('visibilitychange', onVisibility);

  function leave(goHome = true) {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('visibilitychange', onVisibility);
    void wakeLock?.release();
    releaseAll();
    if (!goHome) return;
    if (lesson) showLessons();
    else void showLibrary();
  }

  measure();
  fitKeyboard();
  requestWakeLock();
  syncControls();
  frame = requestAnimationFrame(loop);
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

showLessons();
