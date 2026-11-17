import { Piano } from './audio';
import {
  Beat,
  beatFromPreset,
  beatToMidi,
  copyBar,
  DRUMS,
  emptyBeat,
  isOn,
  MAX_BARS,
  MELODY_ROWS,
  nearestStep,
  newBeatId,
  Part,
  PRESETS,
  rowMidi,
  rowsAtStep,
  ScaleName,
  setStep,
  stepCount,
  STEPS_PER_BAR,
  stepDuration,
  stepTime,
} from './beat';
import { importAudioFile } from './beatImportView';
import { createYouTubePanel } from './youtubePanel';
import { loadKeyHints } from './progress';
import { Bus, createBus, playRow, renderWav } from './sounds';
import { deleteAudio, deleteBeat, loadAudio, loadBeats, saveBeat } from './storage';

const NOTE_NAMES = ['Đô', 'Đô#', 'Rê', 'Rê#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const VIEWS: [Part, string][] = [['drums', 'Trống'], ['bass', 'Bass'], ['lead', 'Giai điệu']];
const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_MS = 25;
const SAVE_DELAY_MS = 400;

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

function slider(min: number, max: number, step: number, value: number, onInput: (value: number) => void) {
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => onInput(Number(input.value)));
  return input;
}

function labelled(text: HTMLElement | string, control: HTMLElement) {
  const label = el('label', 'beat-field');
  label.append(typeof text === 'string' ? el('span', '', text) : text, control);
  return label;
}

function saveFile(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = el('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fileName = (beat: Beat) => beat.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'beat';

/** Builds the beat maker inside `root` and returns what stops it when leaving the screen. */
export async function mountBeatMaker(root: HTMLElement, piano: Piano): Promise<() => void> {
  const saved = await loadBeats().catch(() => [] as Beat[]);
  let beats = saved.sort((a, b) => b.updatedAt - a.updatedAt);
  if (beats.length === 0) {
    beats = [beatFromPreset(PRESETS[0])];
    void saveBeat(beats[0]).catch(() => {});
  }
  let beat = beats[0];
  let view: Part = 'drums';
  let bar = 0;
  let recording = false;
  const showKeys = loadKeyHints();

  // Playback
  let timer = 0;
  let frame = 0;
  let nextStep = 0;
  let loopStart = 0;
  let bus: Bus | null = null;
  let scheduled: { time: number; step: number }[] = [];
  let shownStep = -1;
  let saveTimer = 0;
  let waitingForVideo = false;

  // The imported recording, kept decoded so it can start exactly on the loop.
  const recordings = new Map<string, AudioBuffer>();
  let backingOutput: GainNode | null = null;
  let backingSources: AudioBufferSourceNode[] = [];

  function backingGain(ctx: AudioContext) {
    if (!backingOutput) {
      backingOutput = ctx.createGain();
      backingOutput.connect(ctx.destination);
    }
    return backingOutput;
  }

  function applyBackingLevel() {
    if (backingOutput) backingOutput.gain.value = beat.backing?.on ? beat.backing.volume : 0;
  }

  function startBacking(ctx: AudioContext, time: number) {
    const backing = beat.backing;
    const recording = backing && recordings.get(backing.audioId);
    if (!backing || !recording) return;
    const source = ctx.createBufferSource();
    source.buffer = recording;
    // A changed tempo speeds up the recording too, so the two stay together.
    source.playbackRate.value = boardBpm() / backing.bpm;
    source.connect(backingGain(ctx));
    applyBackingLevel();
    source.start(time, backing.start, stepCount(beat) * stepDuration(backing.bpm));
    backingSources = [...backingSources.slice(-3), source];
  }

  function stopBacking() {
    for (const source of backingSources) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    backingSources = [];
  }

  async function loadRecording(forBeat: Beat) {
    const id = forBeat.backing?.audioId;
    if (!id || recordings.has(id)) return;
    try {
      const stored = await loadAudio(id);
      if (stored) recordings.set(id, await piano.context().decodeAudioData(stored.data));
    } catch {
      // The grid still plays; the comparison layer just stays silent.
    }
    syncBacking();
  }

  /** Removes a stored recording once no beat points at it. */
  function forgetRecording(id: string | undefined) {
    if (!id || beats.some((b) => b.backing?.audioId === id)) return;
    recordings.delete(id);
    void deleteAudio(id).catch(() => {});
  }

  const persist = () => {
    beat.updatedAt = Date.now();
    clearTimeout(saveTimer);
    const toSave = beat;
    saveTimer = window.setTimeout(() => {
      saveBeat(toSave).catch(() => {
        status.textContent = 'Không lưu được beat trên thiết bị này.';
      });
    }, SAVE_DELAY_MS);
  };

  function audio() {
    const ctx = piano.context();
    if (!bus) bus = createBus(ctx, beat);
    return { ctx, bus };
  }

  function schedule() {
    const { ctx, bus: output } = audio();
    const steps = stepCount(beat);
    const horizon = ctx.currentTime + LOOKAHEAD_SECONDS;
    for (;;) {
      const step = nextStep % steps;
      const time = loopStart + stepTime(nextStep, boardBpm(), beat.swing);
      if (time >= horizon) break;
      if (step === 0) startBacking(ctx, time);
      for (const row of rowsAtStep(beat, step)) playRow(ctx, output, beat, row, time);
      scheduled.push({ time, step });
      nextStep++;
    }
    scheduled = scheduled.slice(-16);
  }

  function showPlayhead() {
    const now = piano.context().currentTime;
    let current = -1;
    for (const entry of scheduled) if (entry.time <= now) current = entry.step;
    if (current !== shownStep) {
      shownStep = current;
      // While recording, follow the music so each tap lands where it can be seen.
      const playingBar = Math.floor(current / STEPS_PER_BAR);
      if (recording && current >= 0 && playingBar !== bar) {
        bar = playingBar;
        renderGrid();
      }
      grid.querySelectorAll('.is-now').forEach((node) => node.classList.remove('is-now'));
      grid.querySelectorAll(`[data-step="${current}"]`).forEach((node) => node.classList.add('is-now'));
    }
    frame = requestAnimationFrame(showPlayhead);
  }

  const isPlaying = () => timer !== 0;

  function play() {
    if (waitingForVideo) return;
    const { ctx } = audio();
    waitingForVideo = true;
    playButton.textContent = '… Chờ video';
    youtubePanel.startWithBoard(() => {
      waitingForVideo = false;
      nextStep = 0;
      scheduled = [];
      loopStart = ctx.currentTime + 0.06;
      schedule();
      timer = window.setInterval(schedule, SCHEDULER_MS);
      frame = requestAnimationFrame(showPlayhead);
      syncTransport();
    });
  }

  function stop() {
    clearInterval(timer);
    cancelAnimationFrame(frame);
    stopBacking();
    youtubePanel.stopWithBoard();
    waitingForVideo = false;
    timer = 0;
    shownStep = -1;
    grid.querySelectorAll('.is-now').forEach((node) => node.classList.remove('is-now'));
    syncTransport();
  }

  /** Tempo changes keep the playhead where it is instead of jumping. */
  function changeTiming(apply: () => void) {
    const before = boardBpm();
    apply();
    const after = boardBpm();
    if (isPlaying() && after !== before) {
      const now = piano.context().currentTime;
      const position = (now - loopStart) / stepDuration(before);
      loopStart = now - position * stepDuration(after);
      if (beat.backing) for (const source of backingSources) source.playbackRate.value = after / beat.backing.bpm;
    }
  }

  function setBpm(bpm: number) {
    changeTiming(() => {
      beat.bpm = bpm;
    });
    persist();
  }

  // Controls
  const nameInput = el('input', 'beat-name');
  nameInput.type = 'text';
  nameInput.maxLength = 60;
  nameInput.setAttribute('aria-label', 'Tên beat');
  nameInput.addEventListener('input', () => {
    beat.name = nameInput.value;
    persist();
    refreshBeatList();
  });

  const beatSelect = el('select', 'beat-select');
  beatSelect.setAttribute('aria-label', 'Beat đã lưu');
  beatSelect.addEventListener('change', () => {
    const chosen = beats.find((b) => b.id === beatSelect.value);
    if (chosen) openBeat(chosen);
  });

  const presetSelect = el('select', 'beat-select');
  presetSelect.setAttribute('aria-label', 'Tạo từ beat mẫu');
  presetSelect.append(new Option('Tạo từ mẫu…', ''), ...PRESETS.map((p) => new Option(p.name, p.name)));
  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.name === presetSelect.value);
    presetSelect.value = '';
    if (preset) addBeat(beatFromPreset(preset));
  });

  const togglePlayback = () => (isPlaying() || waitingForVideo ? stop() : play());
  const playButton = button('▶ Phát', togglePlayback, 'btn btn-primary btn-play');
  const recordButton = button('● Thu', () => {
    recording = !recording;
    syncTransport();
  });

  const bpmValue = el('span');
  const bpmInput = slider(60, 180, 1, beat.bpm, (value) => {
    setBpm(value);
    bpmValue.textContent = `Tốc độ ${value} BPM`;
  });
  const swingValue = el('span');
  const swingInput = slider(0, 0.6, 0.05, beat.swing, (value) => {
    beat.swing = value;
    swingValue.textContent = `Swing ${Math.round(value * 100)}%`;
    persist();
  });

  const rootSelect = el('select', 'beat-select');
  rootSelect.setAttribute('aria-label', 'Giọng');
  rootSelect.append(...NOTE_NAMES.map((name, i) => new Option(name, String(i))));
  rootSelect.addEventListener('change', () => {
    beat.root = Number(rootSelect.value);
    persist();
    renderGrid();
  });
  const scaleSelect = el('select', 'beat-select');
  scaleSelect.setAttribute('aria-label', 'Thể');
  scaleSelect.append(new Option('Thứ', 'minor'), new Option('Trưởng', 'major'));
  scaleSelect.addEventListener('change', () => {
    beat.scale = scaleSelect.value as ScaleName;
    persist();
    renderGrid();
  });

  const mixInputs = {} as Record<Part, HTMLInputElement>;
  const mix = el('div', 'beat-mix');
  for (const [part, label] of VIEWS) {
    mixInputs[part] = slider(0, 1, 0.05, beat.mix[part], (value) => {
      beat.mix[part] = value;
      if (bus) bus.parts[part].gain.value = value;
      persist();
    });
    mix.append(labelled(label, mixInputs[part]));
  }

  const status = el('span', 'beat-status');
  status.setAttribute('role', 'status');

  // Listening along to a YouTube video
  const youtubePanel = createYouTubePanel({
    beat: () => beat,
    changed: persist,
    message: (text) => {
      status.textContent = text;
    },
    tempo: (bpm) => {
      setBpm(bpm);
      bpmInput.value = String(bpm);
      bpmValue.textContent = `Tốc độ ${bpm} BPM`;
    },
    timing: changeTiming,
  });

  function boardBpm() {
    return beat.bpm * youtubePanel.speedFactor();
  }

  // Comparing with the imported recording
  const backingBox = el('div', 'beat-bar');
  const backingToggle = button('MP3 gốc: Bật', () => {
    if (!beat.backing) return;
    beat.backing.on = !beat.backing.on;
    applyBackingLevel();
    syncBacking();
    persist();
  });
  const backingVolume = slider(0, 1, 0.05, 0.8, (value) => {
    if (!beat.backing) return;
    beat.backing.volume = value;
    applyBackingLevel();
    persist();
  });
  const backingRemove = button('Bỏ MP3', () => {
    const id = beat.backing?.audioId;
    if (isPlaying()) stop();
    beat.backing = undefined;
    forgetRecording(id);
    syncBacking();
    persist();
  }, 'btn btn-quiet');
  backingBox.append(backingToggle, labelled('Âm lượng MP3', backingVolume), backingRemove);

  function syncBacking() {
    const backing = beat.backing;
    backingBox.hidden = !backing;
    if (!backing) return;
    backingToggle.textContent = recordings.has(backing.audioId) ? `MP3 gốc: ${backing.on ? 'Bật' : 'Tắt'}` : 'MP3 gốc: Đang tải…';
    backingToggle.setAttribute('aria-pressed', String(backing.on));
    backingVolume.value = String(backing.volume);
  }

  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = '.mp3,.wav,.m4a,.ogg,audio/*';
  fileInput.hidden = true;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (isPlaying() || waitingForVideo) stop();
    importButton.disabled = true;
    try {
      const imported = await importAudioFile(file, root, piano, (message) => {
        status.textContent = message;
      });
      if (imported) {
        recordings.set(imported.beat.backing!.audioId, imported.buffer);
        addBeat(imported.beat);
        status.textContent = 'Đã nhập. Bấm Phát để nghe cùng MP3 gốc. File xuất chỉ gồm phần trên bảng.';
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Không nhập được file này.';
    }
    importButton.disabled = false;
  });
  const importButton = button('Nhập MP3', () => fileInput.click());

  const exportWav = button('Xuất WAV', async () => {
    exportWav.disabled = true;
    status.textContent = 'Đang xuất WAV…';
    try {
      saveFile(await renderWav(beat), 'audio/wav', `${fileName(beat)}.wav`);
      status.textContent = 'Đã xuất WAV.';
    } catch {
      status.textContent = 'Không xuất được WAV.';
    }
    exportWav.disabled = false;
  });
  const exportMidi = button('Xuất MIDI', () => {
    saveFile(new Uint8Array(beatToMidi(beat)), 'audio/midi', `${fileName(beat)}.mid`);
    status.textContent = 'Đã xuất MIDI.';
  });

  const newButton = button('Beat mới', () => addBeat(emptyBeat(`Beat ${beats.length + 1}`)));
  const copyButton = button('Nhân bản', () => addBeat({ ...structuredClone(beat), id: newBeatId(), name: `${beat.name} (bản sao)` }));
  const deleteButton = button('Xóa', async () => {
    if (!confirm(`Xóa "${beat.name}"?`)) return;
    clearTimeout(saveTimer);
    await deleteBeat(beat.id).catch(() => {});
    beats = beats.filter((b) => b.id !== beat.id);
    forgetRecording(beat.backing?.audioId);
    if (beats.length === 0) beats = [emptyBeat('Beat 1')];
    openBeat(beats[0]);
    persist();
  }, 'btn btn-quiet');

  // Part tabs and bar pages
  const viewTabs = el('div', 'segmented');
  viewTabs.setAttribute('role', 'group');
  viewTabs.setAttribute('aria-label', 'Phần đang sửa');
  const viewButtons = VIEWS.map(([part, label]) => {
    const node = button(label, () => {
      view = part;
      renderGrid();
    }, 'seg');
    node.dataset.part = part;
    viewTabs.append(node);
    return node;
  });

  const barTabs = el('div', 'segmented');
  barTabs.setAttribute('role', 'group');
  barTabs.setAttribute('aria-label', 'Ô nhịp đang sửa');
  const addBar = button('+ Ô nhịp', () => {
    copyBar(beat, beat.bars - 1);
    beat.bars++;
    bar = beat.bars - 1;
    persist();
    renderGrid();
  });
  const removeBar = button('− Ô nhịp', () => {
    beat.bars--;
    bar = Math.min(bar, beat.bars - 1);
    if (isPlaying()) {
      stop();
      play();
    }
    persist();
    renderGrid();
  }, 'btn btn-quiet');

  const grid = el('div', 'beat-grid');

  const rowsForView = () => {
    if (view === 'drums') return DRUMS.map((d) => ({ id: d.id, name: d.name, keyLabel: d.keyLabel }));
    return Array.from({ length: MELODY_ROWS }, (_, i) => MELODY_ROWS - 1 - i).map((degree) => ({
      id: `${view}${degree}`,
      name: NOTE_NAMES[rowMidi(beat, view as 'bass' | 'lead', degree) % 12],
      keyLabel: '',
    }));
  };

  function renderGrid() {
    grid.replaceChildren();
    grid.dataset.part = view;
    for (const node of viewButtons) node.setAttribute('aria-pressed', String(node.dataset.part === view));

    barTabs.replaceChildren(
      ...Array.from({ length: beat.bars }, (_, i) => {
        const node = button(`Ô ${i + 1}`, () => {
          bar = i;
          renderGrid();
        }, 'seg');
        node.setAttribute('aria-pressed', String(i === bar));
        return node;
      }),
    );
    addBar.disabled = beat.bars >= MAX_BARS;
    removeBar.disabled = beat.bars <= 1;

    const first = bar * STEPS_PER_BAR;
    for (const row of rowsForView()) {
      const head = el('div', 'beat-row-head');
      const pad = button('', () => hitPad(row.id), 'beat-pad');
      pad.append(el('span', '', row.name));
      if (showKeys && row.keyLabel) pad.append(el('kbd', '', row.keyLabel));
      const mute = button('M', () => {
        beat.muted = beat.muted.includes(row.id) ? beat.muted.filter((m) => m !== row.id) : [...beat.muted, row.id];
        mute.setAttribute('aria-pressed', String(beat.muted.includes(row.id)));
        persist();
      }, 'beat-mute');
      mute.setAttribute('aria-label', `Tắt tiếng ${row.name}`);
      mute.setAttribute('aria-pressed', String(beat.muted.includes(row.id)));
      head.append(pad, mute);
      grid.append(head);

      for (let i = 0; i < STEPS_PER_BAR; i++) {
        const step = first + i;
        const cell = el('button', i % 4 === 0 ? 'cell beat-start' : 'cell');
        cell.type = 'button';
        cell.dataset.row = row.id;
        cell.dataset.step = String(step);
        cell.setAttribute('aria-label', `${row.name}, nhịp ${Math.floor(i / 4) + 1}, bước ${i % 4 + 1}`);
        cell.setAttribute('aria-pressed', String(isOn(beat, row.id, step)));
        grid.append(cell);
      }
    }
  }

  function syncTransport() {
    playButton.textContent = isPlaying() ? '■ Dừng' : '▶ Phát';
    recordButton.setAttribute('aria-pressed', String(recording));
    recordButton.classList.toggle('is-recording', recording);
  }

  function syncFields() {
    nameInput.value = beat.name;
    bpmInput.value = String(beat.bpm);
    bpmValue.textContent = `Tốc độ ${beat.bpm} BPM`;
    swingInput.value = String(beat.swing);
    swingValue.textContent = `Swing ${Math.round(beat.swing * 100)}%`;
    rootSelect.value = String(beat.root);
    scaleSelect.value = beat.scale;
    for (const [part] of VIEWS) mixInputs[part].value = String(beat.mix[part]);
    syncBacking();
    refreshBeatList();
  }

  function refreshBeatList() {
    beatSelect.replaceChildren(...beats.map((b) => new Option(b.name || 'Chưa đặt tên', b.id)));
    beatSelect.value = beat.id;
  }

  function openBeat(next: Beat) {
    if (isPlaying() || waitingForVideo) stop();
    beat = next;
    bar = 0;
    if (bus) for (const [part] of VIEWS) bus.parts[part].gain.value = beat.mix[part];
    applyBackingLevel();
    syncFields();
    renderGrid();
    youtubePanel.sync();
    void loadRecording(next);
  }

  function addBeat(next: Beat) {
    beats = [next, ...beats];
    openBeat(next);
    persist();
  }

  // Playing and recording pads
  function hitPad(row: string) {
    const { ctx, bus: output } = audio();
    playRow(ctx, output, beat, row, ctx.currentTime);
    if (!recording || !isPlaying()) return;
    const step = nearestStep(ctx.currentTime, scheduled);
    if (step === null) return;
    setStep(beat, row, step, true);
    grid.querySelector(`[data-row="${row}"][data-step="${step}"]`)?.setAttribute('aria-pressed', 'true');
    persist();
  }

  // Painting: press a cell, then slide across others to give them the same value.
  let painting: boolean | null = null;

  function paint(cell: HTMLElement) {
    const { row, step } = cell.dataset;
    if (!row || step === undefined || painting === null) return;
    if (isOn(beat, row, Number(step)) === painting) return;
    setStep(beat, row, Number(step), painting);
    cell.setAttribute('aria-pressed', String(painting));
    if (painting && !isPlaying()) {
      const { ctx, bus: output } = audio();
      playRow(ctx, output, beat, row, ctx.currentTime);
    }
    persist();
  }

  grid.addEventListener('pointerdown', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.cell');
    if (!cell) return;
    event.preventDefault();
    painting = cell.getAttribute('aria-pressed') !== 'true';
    paint(cell);
  });
  grid.addEventListener('pointermove', (event) => {
    if (painting === null) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const cell = target?.closest<HTMLElement>('.cell');
    if (cell) paint(cell);
  });
  // A click with no pointer behind it comes from the keyboard (Enter on a focused cell).
  grid.addEventListener('click', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.cell');
    if (!cell || event.detail !== 0) return;
    painting = cell.getAttribute('aria-pressed') !== 'true';
    paint(cell);
    painting = null;
  });
  const endPaint = () => {
    painting = null;
  };
  window.addEventListener('pointerup', endPaint);
  window.addEventListener('pointercancel', endPaint);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const focused = document.activeElement;
    if (root.querySelector('.import-panel')) return;
    if (focused instanceof HTMLSelectElement || (focused instanceof HTMLInputElement && (focused.type === 'text' || focused.type === 'url'))) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (focused instanceof HTMLElement) focused.blur();
      togglePlayback();
      return;
    }
    const drum = DRUMS.find((d) => d.code === event.code);
    if (drum) {
      event.preventDefault();
      hitPad(drum.id);
    }
  };
  const onVisibility = () => {
    if (document.visibilityState !== 'visible' && (isPlaying() || waitingForVideo)) stop();
  };
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', onVisibility);

  // Page
  const row1 = el('div', 'beat-bar');
  row1.append(playButton, recordButton, labelled(bpmValue, bpmInput), labelled(swingValue, swingInput), rootSelect, scaleSelect, mix);
  const row2 = el('div', 'beat-bar');
  row2.append(beatSelect, nameInput, presetSelect, importButton, fileInput, newButton, copyButton, deleteButton, exportWav, exportMidi, status);
  const row3 = el('div', 'beat-bar');
  row3.append(viewTabs, barTabs, addBar, removeBar);
  if (showKeys) row3.append(el('span', 'muted', 'Space: phát/dừng · Z X C A S D F: gõ trống'));
  root.append(row2, row1, youtubePanel.element, backingBox, row3, grid);

  syncFields();
  renderGrid();
  syncTransport();
  youtubePanel.sync();
  void loadRecording(beat);

  return () => {
    if (isPlaying() || waitingForVideo) stop();
    if (saveTimer) {
      clearTimeout(saveTimer);
      void saveBeat(beat).catch(() => {});
    }
    youtubePanel.destroy();
    window.removeEventListener('pointerup', endPaint);
    window.removeEventListener('pointercancel', endPaint);
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
