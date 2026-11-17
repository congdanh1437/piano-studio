import { Piano } from './audio';
import { BLACK_KEY_HEIGHT, computerKeyLabels, Key, keyAt, layoutKeys, midiForCode } from './keyboard';
import { createInstruments, DRUM_PADS, EffectsChain, INSTRUMENT_ORDER, Voice } from './instruments';
import {
  BEATS_PER_BAR,
  emptySession,
  InstrumentId,
  Layer,
  LOOP_BAR_CHOICES,
  loopBeats,
  LoopSession,
  notesBetween,
  QUANTIZE_CHOICES,
  TakeRecorder,
  Transport,
} from './loop';
import { loadKeyHints } from './progress';
import { loadLoop, saveLoop } from './storage';

const LOOKAHEAD_SECONDS = 0.15;
const SCHEDULER_MS = 25;
const START_DELAY = 0.1;
const SAVE_DELAY_MS = 500;
const LATENCY_KEY = 'piano-studio.loopLatency';
const SOLFEGE = ['Đô', '', 'Rê', '', 'Mi', 'Fa', '', 'Sol', '', 'La', '', 'Si'];
/** The keyboard shows the notes the computer keys reach: Z row from C3, Q row up to G5. */
const KEYBOARD_SPAN = 31;
const BASE_LOW = 48;

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

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (value: number) => void) {
  const wrap = el('label', 'beat-field');
  const text = el('span', '', label);
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => onInput(Number(input.value)));
  wrap.append(text, input);
  return { wrap, input, text };
}

function readLatency(fallback: number): number {
  try {
    const saved = Number(localStorage.getItem(LATENCY_KEY));
    return localStorage.getItem(LATENCY_KEY) !== null && Number.isFinite(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function writeLatency(ms: number) {
  try {
    localStorage.setItem(LATENCY_KEY, String(ms));
  } catch {
    // The setting just won't be remembered.
  }
}

const isLayer = (value: unknown): value is Layer =>
  typeof value === 'object' && value !== null && Array.isArray((value as Layer).notes) && INSTRUMENT_ORDER.includes((value as Layer).instrument);

export async function mountLiveLoop(root: HTMLElement, piano: Piano): Promise<() => void> {
  const saved = await loadLoop().catch(() => undefined);
  const session: LoopSession = emptySession();
  if (saved) {
    session.bpm = saved.bpm;
    session.bars = saved.bars;
    session.layers = saved.layers.filter(isLayer);
    session.fx = { ...session.fx, ...saved.fx };
  }

  piano.unlock();
  const ctx = piano.context();
  const instruments = createInstruments(piano);
  const fx = new EffectsChain(ctx);
  fx.output.connect(ctx.destination);
  const recorderOutput = ctx.createMediaStreamDestination();
  fx.output.connect(recorderOutput);
  const meter = ctx.createAnalyser();
  meter.fftSize = 512;
  fx.output.connect(meter);
  const liveGain = ctx.createGain();
  liveGain.connect(fx.input);
  const layerGains = new Map<string, GainNode>();

  let instrument: InstrumentId = 'piano';
  let octave = 0;
  let grid = 0.25;
  let metronomeOn = true;
  let countInOn = true;
  let latencyMs = readLatency(Math.min(250, piano.latencyMs ?? 40));
  const showKeys = loadKeyHints();

  let transport: Transport | null = null;
  let scheduledUntil = 0;
  let timer = 0;
  let frame = 0;
  let take: TakeRecorder | null = null;
  let pending: { voice: Voice; at: number }[] = [];
  const live = new Map<string, { voice: Voice; midi: number }>();
  let saveTimer = 0;
  let performance: MediaRecorder | null = null;
  let performanceStarted = 0;

  const persist = () => {
    session.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveLoop(session).catch(() => {}), SAVE_DELAY_MS);
  };

  function gainFor(layer: Layer): GainNode {
    let gain = layerGains.get(layer.id);
    if (!gain) {
      gain = ctx.createGain();
      gain.connect(fx.input);
      layerGains.set(layer.id, gain);
    }
    gain.gain.value = layer.volume;
    return gain;
  }

  // ---------- Playback ----------

  function click(time: number, accent: boolean) {
    const osc = ctx.createOscillator();
    osc.frequency.value = accent ? 1600 : 1100;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(accent ? 0.3 : 0.18, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    // Straight to the speakers: the click guides the player but stays out of recordings.
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function schedule() {
    if (!transport) return;
    const horizon = ctx.currentTime + LOOKAHEAD_SECONDS;
    for (const { layer, note, time } of notesBetween(session.layers, transport, scheduledUntil, horizon)) {
      const voice = instruments[layer.instrument].play(ctx, gainFor(layer), note.midi, note.velocity, time);
      const end = time + (note.length * 60) / transport.bpm;
      voice.stop(end);
      pending.push({ voice, at: end });
    }
    // Clicks: always during the count-in, otherwise only with the metronome on.
    const first = Math.ceil(transport.elapsed(scheduledUntil) - 1e-9);
    const last = transport.elapsed(horizon);
    for (let beat = first; beat < last; beat++) {
      if (beat < 0 || metronomeOn) click(transport.start + (beat * 60) / transport.bpm, ((beat % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR === 0);
    }
    scheduledUntil = horizon;
    pending = pending.filter((p) => p.at > ctx.currentTime);
  }

  function start() {
    if (transport) return;
    const countBeats = countInOn ? BEATS_PER_BAR : 0;
    const now = ctx.currentTime + START_DELAY;
    transport = new Transport(now + (countBeats * 60) / session.bpm, session.bpm, loopBeats(session));
    scheduledUntil = now;
    schedule();
    timer = window.setInterval(schedule, SCHEDULER_MS);
    syncTransport();
  }

  function stop() {
    if (take) finishTake();
    clearInterval(timer);
    timer = 0;
    transport = null;
    const now = ctx.currentTime;
    for (const p of pending) p.voice.stop(now);
    pending = [];
    syncTransport();
  }

  // ---------- Recording ----------

  function beginTake() {
    if (!transport) start();
    const layer: Layer = { id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, instrument, notes: [], muted: false, volume: 0.9 };
    session.layers.push(layer);
    take = new TakeRecorder(layer, transport!, grid, latencyMs / 1000, instrument === 'drums');
    renderLayers();
    syncTransport();
  }

  function finishTake() {
    if (!take) return;
    take.releaseAll(ctx.currentTime);
    const layer = take.layer;
    take = null;
    // A take with nothing played leaves no empty layer behind.
    if (layer.notes.length === 0) session.layers = session.layers.filter((l) => l !== layer);
    persist();
    renderLayers();
    syncTransport();
  }

  function toggleRecord() {
    if (take) finishTake();
    else beginTake();
  }

  function noteOn(key: string, midi: number) {
    noteOff(key);
    const now = ctx.currentTime;
    const voice = instruments[instrument].play(ctx, liveGain, midi, 0.85, now);
    live.set(key, { voice, midi });
    if (take) {
      take.noteOn(midi, 0.85, now);
      updateNoteCount();
    }
    pressedMidis.add(midi);
  }

  /** Keeps the recording layer's note count current while playing, without redrawing the list. */
  function updateNoteCount() {
    if (!take) return;
    const index = session.layers.indexOf(take.layer);
    const count = layerList.children[index]?.querySelector('.loop-layer-count');
    if (count) count.textContent = `${take.layer.notes.length} nốt`;
  }

  function noteOff(key: string) {
    const held = live.get(key);
    if (!held) return;
    live.delete(key);
    const now = ctx.currentTime;
    held.voice.stop(now);
    if (take) {
      take.noteOff(held.midi, now);
      updateNoteCount();
    }
    if (![...live.values()].some((v) => v.midi === held.midi)) pressedMidis.delete(held.midi);
  }

  function releaseAllLive() {
    for (const key of [...live.keys()]) noteOff(key);
  }

  function setInstrument(next: InstrumentId) {
    if (next === instrument) return;
    releaseAllLive();
    const wasRecording = Boolean(take);
    // Switching sound mid-take starts a fresh layer, so you can keep building without stopping.
    if (wasRecording) finishTake();
    instrument = next;
    if (wasRecording) beginTake();
    renderSurface();
    syncInstrument();
  }

  // ---------- Controls ----------

  const playButton = button('▶ Phát', () => (transport ? stop() : start()), 'btn btn-primary btn-play');
  const recordButton = button('● Thu lớp mới', toggleRecord);
  const undoButton = button('Hoàn tác lớp', () => {
    if (take) finishTake();
    const removed = session.layers.pop();
    if (removed) {
      layerGains.get(removed.id)?.disconnect();
      layerGains.delete(removed.id);
    }
    persist();
    renderLayers();
    syncTransport();
  });
  const clearButton = button('Xóa hết', () => {
    if (session.layers.length === 0 || !confirm('Xóa tất cả các lớp đã thu?')) return;
    stop();
    for (const gain of layerGains.values()) gain.disconnect();
    layerGains.clear();
    session.layers = [];
    persist();
    renderLayers();
    syncTransport();
  }, 'btn btn-quiet');

  const bpmControl = slider(`Tốc độ ${session.bpm} BPM`, 60, 180, 1, session.bpm, (value) => {
    if (transport) transport.setBpm(ctx.currentTime, value);
    session.bpm = value;
    bpmControl.text.textContent = `Tốc độ ${value} BPM`;
    fx.setDelay(session.fx.delay, value);
    persist();
  });

  const barsSelect = el('select', 'beat-select');
  barsSelect.setAttribute('aria-label', 'Độ dài vòng lặp');
  barsSelect.append(...LOOP_BAR_CHOICES.map((n) => new Option(`Vòng ${n} ô nhịp`, String(n))));
  barsSelect.value = String(session.bars);
  barsSelect.addEventListener('change', () => {
    session.bars = Number(barsSelect.value);
    if (transport) {
      stop();
      start();
    }
    persist();
    drawTimeline();
  });

  const gridSelect = el('select', 'beat-select');
  gridSelect.setAttribute('aria-label', 'Căn nhịp khi thu');
  gridSelect.append(...QUANTIZE_CHOICES.map((q) => new Option(q.label, String(q.grid))));
  gridSelect.value = String(grid);
  gridSelect.addEventListener('change', () => {
    grid = Number(gridSelect.value);
  });

  const metronomeButton = button('Máy đếm nhịp: Bật', () => {
    metronomeOn = !metronomeOn;
    syncTransport();
  });
  const countInButton = button('Đếm vào: Bật', () => {
    countInOn = !countInOn;
    syncTransport();
  });

  const latencyControl = slider(`Bù trễ ${latencyMs} ms`, 0, 300, 5, latencyMs, (value) => {
    latencyMs = value;
    latencyControl.text.textContent = `Bù trễ ${value} ms`;
    writeLatency(value);
  });
  latencyControl.wrap.title = 'Nếu nốt thu được luôn bị muộn so với nhịp, hãy tăng số này; nếu bị sớm, hãy giảm.';

  const performanceButton = button('⏺ Thu màn biểu diễn', () => togglePerformance());
  const status = el('span', 'beat-status');
  status.setAttribute('role', 'status');

  function togglePerformance() {
    if (performance) {
      performance.stop();
      return;
    }
    const type = typeof MediaRecorder === 'undefined'
      ? undefined
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    if (!type) {
      status.textContent = 'Trình duyệt này không hỗ trợ thu âm thanh.';
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(recorderOutput.stream, { mimeType: type });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      performance = null;
      const blob = new Blob(chunks, { type });
      const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const url = URL.createObjectURL(blob);
      const link = el('a');
      link.href = url;
      link.download = `live-loop-${stamp}.${extension}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      status.textContent = `Đã lưu bản thu ${(blob.size / 1024 / 1024).toFixed(1)} MB.`;
      syncTransport();
    };
    recorder.start(1000);
    performance = recorder;
    performanceStarted = ctx.currentTime;
    status.textContent = '';
    syncTransport();
  }

  const instrumentGroup = el('div', 'segmented loop-instruments');
  instrumentGroup.setAttribute('role', 'group');
  instrumentGroup.setAttribute('aria-label', 'Nhạc cụ');
  const instrumentButtons = INSTRUMENT_ORDER.map((id) => {
    const node = button(instruments[id].name, () => setInstrument(id), 'seg');
    node.dataset.instrument = id;
    node.style.setProperty('--dot', instruments[id].color);
    instrumentGroup.append(node);
    return node;
  });

  const filterControl = slider('Filter', 0, 1, 0.01, session.fx.filter, (value) => {
    session.fx.filter = value;
    fx.setFilter(value);
    persist();
  });
  const delayControl = slider('Delay', 0, 1, 0.01, session.fx.delay, (value) => {
    session.fx.delay = value;
    fx.setDelay(value, session.bpm);
    persist();
  });
  const reverbControl = slider('Reverb', 0, 1, 0.01, session.fx.reverb, (value) => {
    session.fx.reverb = value;
    fx.setReverb(value);
    persist();
  });
  filterControl.wrap.classList.add('loop-filter');
  // After sweeping the filter down for a breakdown, one tap brings the full sound back.
  const springBack = button('Mở filter', () => {
    filterControl.input.value = '1';
    session.fx.filter = 1;
    fx.setFilter(1);
    persist();
  }, 'btn btn-quiet');
  fx.setFilter(session.fx.filter);
  fx.setDelay(session.fx.delay, session.bpm);
  fx.setReverb(session.fx.reverb);

  const meterBar = el('div', 'loop-meter');
  const meterFill = el('div', 'loop-meter-fill');
  meterBar.append(meterFill);
  meterBar.setAttribute('aria-hidden', 'true');

  // ---------- Layers and timeline ----------

  const layerList = el('ol', 'loop-layers');
  const timeline = el('canvas', 'loop-timeline');
  const timelineCtx = timeline.getContext('2d')!;

  function renderLayers() {
    layerList.replaceChildren();
    if (session.layers.length === 0) {
      layerList.append(el('li', 'muted loop-empty', 'Chưa có lớp nào. Bấm "Thu lớp mới", chờ đếm vào rồi chơi.'));
    }
    session.layers.forEach((layer, index) => {
      const item = el('li', 'loop-layer');
      const info = instruments[layer.instrument];
      const recording = take?.layer === layer;
      const name = el('span', 'loop-layer-name', `${index + 1}. ${info.name}${recording ? ' (đang thu)' : ''}`);
      name.style.setProperty('--dot', info.color);
      const mute = button('M', () => {
        layer.muted = !layer.muted;
        mute.setAttribute('aria-pressed', String(layer.muted));
        persist();
      }, 'beat-mute');
      mute.setAttribute('aria-pressed', String(layer.muted));
      mute.setAttribute('aria-label', `Tắt tiếng lớp ${index + 1}`);
      const volume = el('input');
      volume.type = 'range';
      volume.min = '0';
      volume.max = '1';
      volume.step = '0.05';
      volume.value = String(layer.volume);
      volume.setAttribute('aria-label', `Âm lượng lớp ${index + 1}`);
      volume.addEventListener('input', () => {
        layer.volume = Number(volume.value);
        const gain = layerGains.get(layer.id);
        if (gain) gain.gain.value = layer.volume;
        persist();
      });
      const remove = button('✕', () => {
        if (take?.layer === layer) finishTake();
        session.layers = session.layers.filter((l) => l !== layer);
        layerGains.get(layer.id)?.disconnect();
        layerGains.delete(layer.id);
        persist();
        renderLayers();
      }, 'beat-mute');
      remove.setAttribute('aria-label', `Xóa lớp ${index + 1}`);
      item.append(name, el('span', 'muted loop-layer-count', `${layer.notes.length} nốt`), mute, volume, remove);
      layerList.append(item);
    });
    barsSelect.disabled = session.layers.length > 0;
    barsSelect.title = barsSelect.disabled ? 'Xóa hết các lớp để đổi độ dài vòng lặp.' : '';
    undoButton.disabled = session.layers.length === 0;
    drawTimeline();
  }

  function drawTimeline() {
    const rect = timeline.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (timeline.width !== Math.round(rect.width * dpr) || timeline.height !== Math.round(rect.height * dpr)) {
      timeline.width = Math.round(rect.width * dpr);
      timeline.height = Math.round(rect.height * dpr);
    }
    const g = timelineCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = rect.width;
    const height = rect.height;
    const beats = loopBeats(session);
    g.fillStyle = '#11141c';
    g.fillRect(0, 0, width, height);
    for (let beat = 0; beat <= beats; beat++) {
      g.fillStyle = beat % BEATS_PER_BAR === 0 ? '#59606f' : '#2a3040';
      g.fillRect((beat / beats) * width, 0, beat % BEATS_PER_BAR === 0 ? 2 : 1, height);
    }
    const lanes = Math.max(1, session.layers.length);
    const lane = height / lanes;
    session.layers.forEach((layer, i) => {
      g.globalAlpha = layer.muted ? 0.25 : 0.9;
      g.fillStyle = instruments[layer.instrument].color;
      for (const note of layer.notes) {
        const x = (note.at / beats) * width;
        const w = Math.max(2, (note.length / beats) * width);
        g.fillRect(x, i * lane + 2, Math.min(w, width - x), Math.max(2, lane - 4));
        if (x + w > width) g.fillRect(0, i * lane + 2, x + w - width, Math.max(2, lane - 4));
      }
    });
    g.globalAlpha = 1;
    if (transport) {
      const elapsed = transport.elapsed(ctx.currentTime);
      if (elapsed < 0) {
        g.fillStyle = '#f5f1e6';
        g.font = '700 22px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`Đếm vào ${Math.ceil(-elapsed)}`, width / 2, height / 2);
      } else {
        const x = ((elapsed % beats) / beats) * width;
        g.fillStyle = take ? '#ef6461' : '#f5f1e6';
        g.fillRect(x - 1, 0, 3, height);
      }
    }
  }

  // ---------- Playing surface ----------

  const surface = el('div', 'loop-surface');
  const keysCanvas = el('canvas', 'loop-keys');
  const keysCtx = keysCanvas.getContext('2d')!;
  const pads = el('div', 'loop-pads');
  let keys: Key[] = [];
  const pressedMidis = new Set<number>();
  const pointers = new Map<number, string>();

  const rangeLow = () => BASE_LOW + octave * 12;
  const octaveDown = button('◀ Quãng thấp', () => shiftOctave(-1));
  const octaveUp = button('Quãng cao ▶', () => shiftOctave(1));
  const octaveLabel = el('span', 'muted');

  function shiftOctave(by: number) {
    const next = Math.max(-2, Math.min(2, octave + by));
    if (next === octave) return;
    releaseAllLive();
    octave = next;
    layoutKeyboard();
  }

  function layoutKeyboard() {
    const rect = keysCanvas.getBoundingClientRect();
    keys = layoutKeys({ lo: rangeLow(), hi: rangeLow() + KEYBOARD_SPAN }, rect.width);
    octaveLabel.textContent = `Đô thấp nhất: Đô ${rangeLow() / 12 - 1}`;
  }

  function drawKeyboard() {
    const rect = keysCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (keysCanvas.width !== Math.round(rect.width * dpr) || keysCanvas.height !== Math.round(rect.height * dpr)) {
      keysCanvas.width = Math.round(rect.width * dpr);
      keysCanvas.height = Math.round(rect.height * dpr);
      layoutKeyboard();
    }
    const g = keysCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const height = rect.height;
    const labels = showKeys ? computerKeyLabels(octave) : new Map<number, string>();
    const color = instruments[instrument].color;
    g.textAlign = 'center';
    for (const key of keys) {
      if (key.black) continue;
      g.fillStyle = pressedMidis.has(key.midi) ? color : '#f5f1e6';
      g.fillRect(key.x, 0, key.w, height);
      g.fillStyle = '#b9b4a6';
      g.fillRect(key.x + key.w - 1, 0, 1, height);
      g.fillStyle = '#6d6a60';
      g.font = `${key.midi % 12 === 0 ? 700 : 500} ${Math.min(13, key.w * 0.36)}px system-ui, sans-serif`;
      g.fillText(SOLFEGE[key.midi % 12], key.x + key.w / 2, height - 8);
      const label = labels.get(key.midi);
      if (label && key.w > 18) {
        g.fillStyle = '#1b1e27';
        g.font = `700 ${Math.min(13, key.w * 0.4)}px system-ui, sans-serif`;
        g.fillText(label, key.x + key.w / 2, height - 28);
      }
    }
    for (const key of keys) {
      if (!key.black) continue;
      g.fillStyle = pressedMidis.has(key.midi) ? color : '#1b1e27';
      g.fillRect(key.x, 0, key.w, height * BLACK_KEY_HEIGHT);
      const label = labels.get(key.midi);
      if (label && key.w > 14) {
        g.fillStyle = '#f5f1e6';
        g.font = `700 ${Math.min(12, key.w * 0.45)}px system-ui, sans-serif`;
        g.fillText(label, key.x + key.w / 2, height * BLACK_KEY_HEIGHT - 10);
      }
    }
  }

  const keyFromPointer = (event: PointerEvent) => {
    const rect = keysCanvas.getBoundingClientRect();
    return keyAt(keys, event.clientX - rect.left, event.clientY - rect.top, rect.height);
  };
  keysCanvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const midi = keyFromPointer(event);
    if (midi === null) return;
    keysCanvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, `p${event.pointerId}`);
    noteOn(`p${event.pointerId}`, midi);
  });
  keysCanvas.addEventListener('pointermove', (event) => {
    const key = pointers.get(event.pointerId);
    if (!key) return;
    const midi = keyFromPointer(event);
    if (midi !== null && live.get(key)?.midi !== midi) noteOn(key, midi);
  });
  const endPointer = (event: PointerEvent) => {
    const key = pointers.get(event.pointerId);
    if (!key) return;
    pointers.delete(event.pointerId);
    noteOff(key);
  };
  keysCanvas.addEventListener('pointerup', endPointer);
  keysCanvas.addEventListener('pointercancel', endPointer);
  keysCanvas.addEventListener('contextmenu', (event) => event.preventDefault());

  for (const drum of DRUM_PADS) {
    const padButton = el('button', 'loop-pad');
    padButton.type = 'button';
    padButton.dataset.midi = String(drum.midi);
    padButton.append(el('span', '', drum.name));
    if (showKeys) padButton.append(el('kbd', '', drum.keyLabel));
    padButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      noteOn(`pad${event.pointerId}`, drum.midi);
      padButton.classList.add('is-hit');
    });
    const release = (event: PointerEvent) => {
      noteOff(`pad${event.pointerId}`);
      padButton.classList.remove('is-hit');
    };
    padButton.addEventListener('pointerup', release);
    padButton.addEventListener('pointercancel', release);
    padButton.addEventListener('pointerleave', release);
    padButton.addEventListener('contextmenu', (event) => event.preventDefault());
    pads.append(padButton);
  }

  const octaveBar = el('div', 'beat-bar');
  octaveBar.append(octaveDown, octaveLabel, octaveUp);
  surface.append(octaveBar, keysCanvas, pads);

  function renderSurface() {
    const drums = instrument === 'drums';
    keysCanvas.hidden = drums;
    octaveBar.hidden = drums;
    pads.hidden = !drums;
    if (!drums) layoutKeyboard();
  }

  // ---------- Status ----------

  function syncTransport() {
    playButton.textContent = transport ? '■ Dừng' : '▶ Phát';
    recordButton.textContent = take ? '■ Kết thúc lớp' : '● Thu lớp mới';
    recordButton.classList.toggle('is-recording', Boolean(take));
    recordButton.setAttribute('aria-pressed', String(Boolean(take)));
    metronomeButton.textContent = `Máy đếm nhịp: ${metronomeOn ? 'Bật' : 'Tắt'}`;
    metronomeButton.setAttribute('aria-pressed', String(metronomeOn));
    countInButton.textContent = `Đếm vào: ${countInOn ? 'Bật' : 'Tắt'}`;
    countInButton.setAttribute('aria-pressed', String(countInOn));
    performanceButton.textContent = performance ? '■ Dừng thu biểu diễn' : '⏺ Thu màn biểu diễn';
    performanceButton.classList.toggle('is-recording', Boolean(performance));
    undoButton.disabled = session.layers.length === 0;
  }

  function syncInstrument() {
    for (const node of instrumentButtons) node.setAttribute('aria-pressed', String(node.dataset.instrument === instrument));
  }

  const levels = new Float32Array(512);
  function animate() {
    drawTimeline();
    if (!keysCanvas.hidden) drawKeyboard();
    meter.getFloatTimeDomainData(levels);
    let peak = 0;
    for (const v of levels) peak = Math.max(peak, Math.abs(v));
    meterFill.style.width = `${Math.min(100, peak * 100)}%`;
    meterFill.classList.toggle('is-hot', peak > 0.95);
    if (performance) {
      const seconds = Math.floor(ctx.currentTime - performanceStarted);
      performanceButton.textContent = `■ Dừng thu (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})`;
    }
    frame = requestAnimationFrame(animate);
  }

  // ---------- Keyboard ----------

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLSelectElement) return;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      if (focused instanceof HTMLElement) focused.blur();
      if (event.code === 'Space') {
        if (transport) stop();
        else start();
      } else toggleRecord();
      return;
    }
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      if (focused instanceof HTMLInputElement) return;
      event.preventDefault();
      shiftOctave(event.code === 'ArrowLeft' ? -1 : 1);
      return;
    }
    const midi = instrument === 'drums'
      ? DRUM_PADS.find((d) => d.code === event.code)?.midi ?? null
      : midiForCode(event.code, octave);
    if (midi === null || midi === undefined) return;
    event.preventDefault();
    noteOn(`k${event.code}`, midi);
    if (instrument === 'drums') pads.querySelector(`[data-midi="${midi}"]`)?.classList.add('is-hit');
  };
  const onKeyUp = (event: KeyboardEvent) => {
    const held = live.get(`k${event.code}`);
    if (held && instrument === 'drums') pads.querySelector(`[data-midi="${held.midi}"]`)?.classList.remove('is-hit');
    noteOff(`k${event.code}`);
  };
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') {
      releaseAllLive();
      if (transport) stop();
      if (performance) performance.stop();
    }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('visibilitychange', onVisibility);
  const resize = new ResizeObserver(() => {
    if (!keysCanvas.hidden) layoutKeyboard();
  });
  resize.observe(keysCanvas);

  // ---------- Page ----------

  const transportBar = el('div', 'beat-bar');
  transportBar.append(playButton, recordButton, undoButton, clearButton, bpmControl.wrap, barsSelect, gridSelect, metronomeButton, countInButton);
  const fxBar = el('div', 'beat-bar');
  fxBar.append(filterControl.wrap, springBack, delayControl.wrap, reverbControl.wrap, latencyControl.wrap, performanceButton, meterBar, status);
  const middle = el('div', 'loop-middle');
  middle.append(layerList, timeline);
  const hint = showKeys
    ? el('p', 'muted', 'Space: phát/dừng · Enter: thu/kết thúc lớp · ←/→: đổi quãng · Phím Z, Q… để chơi, như ở phần học.')
    : el('p', 'muted', 'Đổi nhạc cụ trong lúc thu sẽ tự sang lớp mới, nên bạn có thể dựng bài liên tục.');
  root.append(transportBar, instrumentGroup, fxBar, middle, hint, surface);

  renderSurface();
  syncInstrument();
  renderLayers();
  syncTransport();
  frame = requestAnimationFrame(animate);

  return () => {
    releaseAllLive();
    if (transport) stop();
    if (performance) performance.stop();
    cancelAnimationFrame(frame);
    clearTimeout(saveTimer);
    void saveLoop(session).catch(() => {});
    resize.disconnect();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('visibilitychange', onVisibility);
    // Let effect tails ring out before disconnecting the chain.
    setTimeout(() => {
      fx.output.disconnect();
      liveGain.disconnect();
      for (const gain of layerGains.values()) gain.disconnect();
    }, 3000);
  };
}

