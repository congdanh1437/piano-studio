import { backupFileName, createBackup, DeviceData, fromBase64, parseBackup, planMerge } from './backup';
import { loadStars, saveAllStars } from './progress';
import { loadAllAudio, loadAudioIds, loadBeats, loadSongs, saveAudio, saveBeat, saveSong } from './storage';

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

async function deviceData(): Promise<DeviceData> {
  const [songs, beats, audioIds] = await Promise.all([loadSongs(), loadBeats(), loadAudioIds()]);
  return { songs, beats, stars: loadStars(), audioIds: audioIds.map(String) };
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * The backup and restore section. After a restore, `onRestored` redraws the screen
 * with the summary, which the new section shows as `notice`.
 */
export function backupSection(onRestored: (summary: string) => void, notice = ''): HTMLElement {
  const section = el('section', 'backup');
  const includeAudio = el('input');
  includeAudio.type = 'checkbox';
  includeAudio.checked = true;
  const audioLabel = el('label', 'backup-check');
  audioLabel.append(includeAudio, el('span', '', 'Kèm file MP3 đã nhập (file sao lưu sẽ lớn hơn)'));
  const message = el('p', 'muted', notice);
  message.setAttribute('role', 'status');

  const exportButton = button('Tạo bản sao lưu', async () => {
    exportButton.disabled = true;
    message.textContent = 'Đang gom dữ liệu…';
    try {
      const data = await deviceData();
      const audio = includeAudio.checked ? await loadAllAudio() : [];
      const text = JSON.stringify(createBackup(data, audio));
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = el('a');
      link.href = url;
      link.download = backupFileName();
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      message.textContent = `Đã tạo bản sao lưu ${megabytes(text.length)}: ${data.songs.length} bài, ${data.beats.length} beat, ` +
        `${Object.keys(data.stars).length} bài học có sao, ${audio.length} file MP3.`;
    } catch {
      message.textContent = 'Không tạo được bản sao lưu.';
    }
    exportButton.disabled = false;
  }, 'btn btn-primary');

  const input = el('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.hidden = true;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    message.textContent = 'Đang đọc bản sao lưu…';
    try {
      const { backup, skipped } = parseBackup(await file.text());
      const plan = planMerge(await deviceData(), backup);
      for (const song of plan.songs) await saveSong(song);
      for (const audio of plan.audio) await saveAudio({ id: audio.id, name: audio.name, data: fromBase64(audio.data) });
      for (const beat of plan.beats) await saveBeat(beat);
      saveAllStars(plan.stars);
      const parts = [`${plan.songs.length} bài`, `${plan.beats.length} beat`, `${plan.audio.length} file MP3`];
      let summary = `Đã khôi phục: ${parts.join(', ')}; sao bài học đã được gộp.`;
      if (plan.keptNewer > 0) summary += ` Giữ nguyên ${plan.keptNewer} beat vì bản trên máy này mới hơn.`;
      if (skipped > 0) summary += ` Bỏ qua ${skipped} mục bị hỏng.`;
      onRestored(summary);
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Không đọc được bản sao lưu.';
    }
  });

  const actions = el('div', 'beat-bar');
  actions.append(exportButton, button('Khôi phục từ file', () => input.click()), input);
  section.append(
    el('h2', '', 'Sao lưu và chuyển máy'),
    el('p', 'muted', 'Dữ liệu chỉ lưu trên thiết bị này. Tạo bản sao lưu để giữ an toàn, hoặc mở file đó trên máy khác để chuyển sang. Khôi phục chỉ thêm vào, không xóa gì trên máy.'),
    audioLabel,
    actions,
    message,
  );
  return section;
}
