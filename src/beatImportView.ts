import { Piano } from './audio';
import { Beat, STEPS_PER_BAR } from './beat';
import { analyzeAudio, beatFromTranscription, estimateBpm, findDownbeat, Transcription, transcribe } from './beatImport';
import { saveAudio } from './storage';
import { button, canvasBox, el } from './ui';

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const BAR_CHOICES = [1, 2, 4];
const MARKERS: { row: string; label: string; color: string }[] = [
  { row: 'kick', label: 'Trống cái', color: '#4fd1c5' },
  { row: 'snare', label: 'Snare', color: '#f2c14e' },
  { row: 'hat', label: 'Hi-hat', color: '#9aa5bd' },
  { row: 'open', label: 'Hi-hat mở', color: '#b79cf5' },
  { row: 'bass', label: 'Bass', color: '#f6a04d' },
];


function toMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

export interface ImportResult {
  beat: Beat;
  buffer: AudioBuffer;
}

/**
 * Reads an audio file, lets the user check the tempo and pick a section, and
 * resolves with a new beat, or null if they cancel. `onProgress` reports each stage.
 */
export async function importAudioFile(
  file: File,
  host: HTMLElement,
  piano: Piano,
  onProgress: (message: string) => void,
): Promise<ImportResult | null> {
  if (file.size > MAX_FILE_BYTES) throw new Error('File lớn hơn 100 MB. Hãy cắt ngắn đoạn beat rồi nhập lại.');
  onProgress('Đang đọc file…');
  const data = await file.arrayBuffer();
  let buffer: AudioBuffer;
  try {
    // Decoding empties the array it is given, and the original is still needed for saving.
    buffer = await piano.context().decodeAudioData(data.slice(0));
  } catch {
    throw new Error('Không đọc được file này. Hãy thử file MP3 hoặc WAV khác.');
  }
  onProgress('Đang tìm nhịp…');
  await new Promise((resolve) => setTimeout(resolve, 30)); // Lets the message appear first.
  const mono = toMono(buffer);
  const analysis = analyzeAudio(mono, buffer.sampleRate);
  if (!analysis.hasRhythm) throw new Error('File này gần như không có tiếng.');
  onProgress('');

  const name = file.name.replace(/\.[^.]+$/, '') || 'Beat nhập';
  let bpm = estimateBpm(analysis);
  let bars = 2;
  let start = findDownbeat(analysis, bpm);
  let result: Transcription = transcribe(analysis, { bpm, start, bars });
  let preview: AudioBufferSourceNode | null = null;

  return new Promise((resolve) => {
    const panel = el('div', 'import-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Nhập beat từ file');

    const stopPreview = () => {
      preview?.stop();
      preview = null;
      previewButton.textContent = '▶ Nghe đoạn này';
    };
    const startPreview = () => {
      const ctx = piano.context();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = start;
      source.loopEnd = Math.min(buffer.duration, start + sectionSeconds());
      source.connect(ctx.destination);
      source.start(ctx.currentTime, start);
      preview = source;
      previewButton.textContent = '■ Dừng nghe';
    };
    const sectionSeconds = () => (bars * STEPS_PER_BAR * 60) / bpm / 4;
    const beatSeconds = () => 60 / bpm;

    const close = (value: ImportResult | null) => {
      stopPreview();
      panel.remove();
      resolve(value);
    };

    const previewButton = button('▶ Nghe đoạn này', () => {
      if (preview) stopPreview();
      else startPreview();
    });

    const bpmInput = el('input', 'import-bpm');
    bpmInput.type = 'number';
    bpmInput.min = '40';
    bpmInput.max = '240';
    bpmInput.step = '0.5';
    bpmInput.setAttribute('aria-label', 'Tốc độ BPM');
    bpmInput.addEventListener('change', () => {
      const value = Number(bpmInput.value);
      if (value >= 40 && value <= 240) setBpm(value);
      else bpmInput.value = String(bpm);
    });
    const halve = button('÷2', () => setBpm(Math.max(40, bpm / 2)));
    const double = button('×2', () => setBpm(Math.min(240, bpm * 2)));
    halve.setAttribute('aria-label', 'Giảm một nửa tốc độ');
    double.setAttribute('aria-label', 'Tăng gấp đôi tốc độ');

    const barSelect = el('select', 'beat-select');
    barSelect.setAttribute('aria-label', 'Số ô nhịp');
    barSelect.append(...BAR_CHOICES.map((n) => new Option(`${n} ô nhịp`, String(n))));
    barSelect.value = String(bars);
    barSelect.addEventListener('change', () => {
      bars = Number(barSelect.value);
      update();
    });

    const position = el('input');
    position.type = 'range';
    position.min = '0';
    position.step = '0.01';
    position.setAttribute('aria-label', 'Vị trí đoạn trong bài');
    position.addEventListener('input', () => {
      // Moves in whole beats, so the section stays lined up with the detected grid.
      const moved = Math.round((Number(position.value) - start) / beatSeconds());
      if (moved !== 0) moveBy(moved);
    });
    const earlier = button('− 1 phách', () => moveBy(-1));
    const later = button('+ 1 phách', () => moveBy(1));
    // The automatic guess can land off the beat, which only a step-sized move can fix.
    const earlierStep = button('− 1 bước', () => moveBy(-0.25));
    const laterStep = button('+ 1 bước', () => moveBy(0.25));

    const { box: canvasHolder, canvas } = canvasBox('import-canvas');
    const summary = el('p', 'muted');
    summary.setAttribute('role', 'status');
    const timeLabel = el('span', 'muted');

    const apply = button('Đưa lên bảng', async () => {
      apply.disabled = true;
      const audioId = `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const beat = beatFromTranscription(result, { name, audioId, bpm, start, bars });
      // The beat is still useful if the recording can't be stored, so this isn't fatal.
      await saveAudio({ id: audioId, name, data }).catch(() => {
        onProgress('Không lưu được MP3 gốc: lớp phát kèm sẽ mất khi tải lại trang.');
      });
      close({ beat, buffer });
    }, 'btn btn-primary');

    function moveBy(beats: number) {
      const next = start + beats * beatSeconds();
      if (next < 0 || next >= buffer.duration) {
        position.value = String(start);
        return;
      }
      start = next;
      update();
    }

    function setBpm(value: number) {
      bpm = value;
      start = findDownbeat(analysis, bpm);
      update();
    }

    function update() {
      result = transcribe(analysis, { bpm, start, bars });
      bpmInput.value = String(bpm);
      position.max = String(buffer.duration);
      position.value = String(start);
      timeLabel.textContent = `Bắt đầu ở giây ${start.toFixed(1)}`;
      const counts = MARKERS.map(({ row, label }) => {
        const count = row === 'bass' ? result.bass.length : result.drums[row].length;
        return count > 0 ? `${count} ${label}` : '';
      }).filter(Boolean);
      summary.textContent = counts.length > 0
        ? `Tìm thấy: ${counts.join(', ')}. Swing ${Math.round(result.swing * 100)}%.`
        : 'Không tìm thấy nhịp rõ trong đoạn này. Hãy thử đoạn khác hoặc chỉnh BPM.';
      apply.disabled = counts.length === 0;
      if (preview) {
        stopPreview();
        startPreview();
      }
      drawSection();
    }

    function drawSection() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const width = rect.width;
      const height = rect.height;
      const rowHeight = 18;
      const waveHeight = height - rowHeight * MARKERS.length;
      ctx.fillStyle = '#11141c';
      ctx.fillRect(0, 0, width, height);

      const steps = bars * STEPS_PER_BAR;
      for (let step = 0; step <= steps; step++) {
        const isBar = step % STEPS_PER_BAR === 0;
        if (step % 4 !== 0) continue;
        ctx.fillStyle = isBar ? '#59606f' : '#2a3040';
        ctx.fillRect((step / steps) * width, 0, isBar ? 2 : 1, height);
      }

      const first = Math.floor(start * buffer.sampleRate);
      const samples = Math.floor(sectionSeconds() * buffer.sampleRate);
      const perColumn = Math.max(1, Math.floor(samples / width));
      ctx.fillStyle = '#7f8aa3';
      for (let x = 0; x < width; x++) {
        let top = 0;
        const from = first + x * perColumn;
        // Skipping samples keeps redraws instant, and is close enough for a picture.
        for (let i = 0; i < perColumn; i += Math.ceil(perColumn / 40)) top = Math.max(top, Math.abs(mono[from + i] ?? 0));
        const size = Math.max(1, top * waveHeight);
        ctx.fillRect(x, (waveHeight - size) / 2, 1, size);
      }

      ctx.textBaseline = 'middle';
      ctx.font = '11px system-ui, sans-serif';
      const cell = width / steps;
      MARKERS.forEach(({ row, label, color }, index) => {
        const y = waveHeight + index * rowHeight;
        const on = row === 'bass' ? result.bass.map((b) => b.step) : result.drums[row];
        ctx.fillStyle = color;
        for (const step of on) {
          ctx.beginPath();
          ctx.roundRect(step * cell + 1, y + 2, Math.max(4, cell - 2), rowHeight - 4, 3);
          ctx.fill();
        }
        // A backing keeps the name readable when a hit lands underneath it.
        ctx.fillStyle = 'rgba(17, 20, 28, 0.8)';
        ctx.fillRect(0, y + 1, ctx.measureText(label).width + 8, rowHeight - 2);
        ctx.fillStyle = '#f5f1e6';
        ctx.fillText(label, 4, y + rowHeight / 2);
      });
    }

    const heading = el('h2', '', `Nhập beat: ${name}`);
    const note = el('p', 'muted', 'Đây là kết quả ước đoán. Hàng Trống cái nên có nốt ở vạch đầu ô nhịp; nếu không, hãy dịch từng bước hoặc từng phách. Nếu vòng lặp nghe bị vấp, hãy chỉnh BPM. Sau đó bạn có thể sửa từng ô trên bảng.');
    const controls = el('div', 'beat-bar');
    const bpmGroup = el('div', 'beat-bar');
    bpmGroup.append(el('span', 'muted', 'BPM'), bpmInput, halve, double);
    controls.append(bpmGroup, barSelect, previewButton);
    const movement = el('div', 'import-position');
    movement.append(earlier, earlierStep, position, laterStep, later, timeLabel);
    const actions = el('div', 'overlay-actions');
    actions.append(button('Hủy', () => close(null), 'btn btn-quiet'), apply);
    panel.append(heading, note, controls, movement, canvasHolder, summary, actions);
    host.append(panel);
    update();
  });
}
