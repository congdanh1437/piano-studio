# Piano Studio

App học piano chạy trên trình duyệt, dùng được trên tablet Android và laptop.

## Chạy

```bash
npm install
npm run dev
```

- Trên máy tính: mở `http://localhost:5173`.
- Trên tablet cùng Wi-Fi: mở `http://<IP-máy-tính>:5173` bằng Chrome.
- Chạy test: `npm test`. Build bản phát hành: `npm run build`.

Chức năng cài như app, dùng offline và giữ màn hình sáng chỉ hoạt động qua HTTPS, tức là bản đã được đưa lên hosting.

## Đưa lên GitHub Pages

File `.github/workflows/deploy.yml` tự chạy test, build và đăng app mỗi khi đẩy code lên nhánh `main`. Cách bật:

1. Tạo repo trên GitHub rồi đẩy code lên. Lưu ý: GitHub Pages miễn phí chỉ dùng được với repo **công khai**, nghĩa là ai cũng xem được code.
2. Trong repo, vào **Settings → Pages → Source** và chọn **GitHub Actions**.
3. Sau lần đẩy code tiếp theo, app có ở `https://<tên-tài-khoản>.github.io/<tên-repo>/`.

Danh sách cần kiểm tra khi thử trên tablet nằm trong `docs/kiem-tra-tablet.md`.

## Sao lưu dữ liệu

Bài đã nhập, beat, sao bài học và file MP3 chỉ lưu trong trình duyệt của từng thiết bị, và mỗi địa chỉ (ví dụ `localhost` và địa chỉ hosting) có kho dữ liệu riêng. Vào tab "Thư viện" → "Tạo bản sao lưu" để lưu ra file, rồi "Khôi phục từ file" trên máy khác. Khôi phục chỉ thêm vào: beat trùng thì giữ bản sửa mới hơn, sao bài học thì giữ kết quả cao hơn.

## Cách chơi

- Lộ trình: tab "Bài học" có 30 bài chia 5 cấp. Mỗi bài có hướng dẫn và được chấm tối đa 3 sao; đạt từ 70% là qua bài. Tiến độ lưu riêng trên từng thiết bị.
- Tablet: chơi trực tiếp trên phím cảm ứng, hỗ trợ nhiều ngón.
- Laptop: chữ cần nhấn hiện ngay trên phím đàn và nốt rơi. Tay trái dùng hàng `Z X C V…` (phím đen `S D G H J`), tay phải dùng hàng `Q W E R…` (phím đen `2 3 5 6 7`); `Q` luôn là Đô giữa khi bài nằm trong quãng thường dùng. `←` `→` đổi quãng tám, `Space` để chạy hoặc dừng.
- Làm beat: tab "Làm beat". Bấm hoặc kéo trên bảng để bật nốt cho Trống, Bass, Giai điệu; tối đa 4 ô nhịp. Beat tự lưu trên thiết bị và xuất được WAV hoặc MIDI. Trên laptop, `Z X C A S D F` gõ trống; bật "Thu" khi đang phát để ghi nhịp gõ vào bảng.
- Nhập beat: trong tab "Làm beat", bấm "Nhập MP3". App ước đoán BPM, trống và bass rồi cho bạn chỉnh trước khi đưa lên bảng; file gốc có thể phát kèm để so sánh. Kết quả tốt nhất với beat không lời, và cần nghe lại để sửa. File xuất chỉ gồm phần trên bảng, không gồm MP3 gốc.
- Làm beat theo YouTube: trong tab "Làm beat", dán link video để nghe ngay trong app. Có lặp đoạn A–B, giảm tốc, gõ tay để tìm BPM, và chạy cùng bảng để gõ lại nhịp bằng "Thu". App không tải và không đọc được âm thanh của video, nên không tự tìm nhịp như với file MP3. Cần có mạng, và một số video không cho nhúng.
- Bài của bạn: tab "Thư viện", bấm "Nhập bài". App nhận file MIDI và bản nhạc MusicXML (`.musicxml`, `.xml`, `.mxl`, ví dụ xuất từ MuseScore). Bè piano có 2 khuông được chia thành tay phải và tay trái; dấu lặp và các nhánh 1, 2 được chơi đúng thứ tự, nhưng chưa xử lý được D.C. và D.S. Bài được lưu ngay trên thiết bị đó.

## Cấu trúc code

| File | Vai trò |
|---|---|
| `src/beat.ts` | Dữ liệu beat, nhịp, beat mẫu, xuất WAV và MIDI |
| `src/sounds.ts` | Tổng hợp âm trống, bass, giai điệu |
| `src/beatView.ts` | Màn hình làm beat |
| `src/beatImport.ts` | Phân tích file nhạc: BPM, trống, bass, giọng |
| `src/beatImportView.ts` | Màn hình nhập và chỉnh file nhạc |
| `src/backup.ts` | Tạo, kiểm tra và gộp bản sao lưu |
| `src/backupView.ts` | Phần sao lưu trong tab Thư viện |
| `src/youtube.ts` | Đọc link YouTube, gõ tìm BPM |
| `src/youtubePanel.ts` | Khung video YouTube và các nút điều khiển |
| `src/lessons.ts` | Giáo trình 5 cấp và cách chấm sao |
| `src/score.ts` | Đọc ký hiệu bản nhạc viết tay trong giáo trình |
| `src/practice.ts` | Luật luyện tập: chờ nốt, chấm điểm, lặp đoạn |
| `src/song.ts` | Đọc file MIDI, tách tay trái và tay phải |
| `src/musicxml.ts` | Đọc bản nhạc MusicXML và file nén `.mxl` |
| `src/keyboard.ts` | Bố trí phím theo quãng của bài, xác định phím được chạm |
| `src/audio.ts` | Âm thanh piano |
| `src/render.ts` | Vẽ nốt rơi và bàn phím |
| `src/main.ts` | Giao diện và điều khiển |

## Ghi công

Âm piano dùng bộ mẫu Salamander Grand Piano của Alexander Holm (CC-BY 3.0), được tải khi mở bài lần đầu từ `tonejs.github.io`.
