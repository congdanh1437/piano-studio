import { ODE_LEFT, ODE_RIGHT, TWINKLE_LEFT, TWINKLE_RIGHT } from './demos';
import { HandMode, PracticeSession } from './practice';
import { voice } from './score';
import { makeSong, Song } from './song';

export interface Lesson {
  id: string;
  level: number;
  title: string;
  goal: string;
  tips: string[];
  song: Song;
  mode: HandMode;
  /** Slowest speed that still earns stars. */
  speed: number;
  /** false means the song does not stop for you: real tempo. */
  wait: boolean;
}

export const LEVELS = [
  { level: 1, name: 'Làm quen phím đàn', detail: 'Tìm nốt, đặt ngón và giữ nhịp' },
  { level: 2, name: 'Giai điệu một tay', detail: 'Chơi trọn bài, phím đen và gam đầu tiên' },
  { level: 3, name: 'Phối hợp hai tay', detail: 'Từ thay phiên đến chơi cùng lúc' },
  { level: 4, name: 'Hợp âm và đệm', detail: 'Ba nốt cùng lúc, vòng hòa âm, đệm rải' },
  { level: 5, name: 'Nâng cao', detail: 'Nhịp thật, gam khó và tác phẩm cổ điển' },
];

const PASS_ACCURACY = 70;

interface Spec {
  level: number;
  title: string;
  goal: string;
  tips: string[];
  bpm: number;
  right?: string;
  left?: string;
  mode: HandMode;
  speed?: number;
  wait?: boolean;
}

function lesson(spec: Spec, index: number): Lesson {
  const id = `lesson-${index + 1}`;
  const notes = [
    ...(spec.right ? voice(spec.right, 'R', spec.bpm) : []),
    ...(spec.left ? voice(spec.left, 'L', spec.bpm) : []),
  ];
  return {
    id,
    level: spec.level,
    title: spec.title,
    goal: spec.goal,
    tips: spec.tips,
    song: makeSong(id, spec.title, notes, true),
    mode: spec.mode,
    speed: spec.speed ?? 1,
    wait: spec.wait ?? true,
  };
}

const repeat = (part: string, times: number) => Array.from({ length: times }, () => part).join(' ');
/** One bar of Bach's C major prelude: two low notes, then six high ones, played twice. */
const preludeRight = (c: string, d: string, e: string) =>
  repeat(`R:0.5 ${c}:0.25 ${d}:0.25 ${e}:0.25 ${c}:0.25 ${d}:0.25 ${e}:0.25`, 2);
const preludeLeft = (a: string, b: string) => repeat(`${a}:0.25 ${b}:0.25 R:1.5`, 2);

const FUR_ELISE_RIGHT =
  'E5:1 D#5:1 E5 D#5 E5 B4 D5 C5 A4:2 R C4 E4 A4 B4:2 R E4 G#4 B4 C5:2 R E4 ' +
  'E5 D#5 E5 D#5 E5 B4 D5 C5 A4:2 R C4 E4 A4 B4:2 R E4 C5 B4 A4:3';
const FUR_ELISE_LEFT = 'R:8 A3:3 R:3 E3:3 R:3 A3:3 R:9 A3:3 R:3 E3:3 R:3 A3:3';

const MINUET_RIGHT =
  'D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 D5 G4 G4 E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 G5 G4 G4 ' +
  'C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 F#4 G4:0.5 A4:0.5 B4:0.5 G4:0.5 A4:3';
const MINUET_LEFT = 'G3+B3+D4:2 A3 B3:3 C4:3 B3:3 A3:3 G3:3 D4 B3 G3 D4 D3 C4';

const CANON_RIGHT = 'F#4+A4+D5:4 E4+A4+C#5:4 F#4+B4+D5:4 F#4+A4+C#5:4 G4+B4+D5:4 F#4+A4+D5:4 G4+B4+D5:4 E4+A4+C#5:4';
const CANON_LEFT = 'D3:4 A3:4 B3:4 F#3:4 G3:4 D3:4 G3:4 A3:4';

const specs: Spec[] = [
  // Level 1
  {
    level: 1, title: 'Tìm nốt Đô giữa', bpm: 70, mode: 'R',
    goal: 'Nhận ra Đô giữa, nốt làm mốc cho mọi bài sau.',
    tips: ['Phím đen xếp thành nhóm 2 và nhóm 3. Đô là phím trắng ngay bên trái nhóm 2 phím đen.', 'Dùng ngón cái tay phải (ngón 1), cổ tay thả lỏng.'],
    right: 'C4:2 R:2 C4:2 R:2 C4:2 R:2 C4:4',
  },
  {
    level: 1, title: 'Đô – Rê – Mi', bpm: 70, mode: 'R',
    goal: 'Dùng ba ngón liên tiếp của tay phải.',
    tips: ['Ngón 1 chơi Đô, ngón 2 chơi Rê, ngón 3 chơi Mi.', 'Khi chơi nốt mới, nhấc ngón trước lên.'],
    right: 'C4 D4 E4:2 E4 D4 C4:2 C4 E4 D4 E4 C4:4',
  },
  {
    level: 1, title: 'Năm ngón tay phải', bpm: 72, mode: 'R',
    goal: 'Đặt năm ngón tay phải lên năm nốt liền nhau.',
    tips: ['Ngón 1 đến ngón 5 đặt trên Đô, Rê, Mi, Fa, Sol và giữ yên vị trí bàn tay.', 'Các ngón hơi cong như đang cầm quả cam nhỏ.'],
    right: 'C4 D4 E4 F4 G4 F4 E4 D4 C4:2 R:2 C4 E4 G4 E4 C4:4',
  },
  {
    level: 1, title: 'Năm ngón tay trái', bpm: 72, mode: 'L',
    goal: 'Đặt năm ngón tay trái lên năm nốt của quãng thấp.',
    tips: ['Ở tay trái, ngón út (ngón 5) chơi Đô và ngón cái (ngón 1) chơi Sol.', 'Tay trái thường yếu hơn, nên đi chậm và đều.'],
    left: 'C3 D3 E3 F3 G3 F3 E3 D3 C3:2 R:2 C3 E3 G3 E3 C3:4',
  },
  {
    level: 1, title: 'Nốt đen, trắng và tròn', bpm: 80, mode: 'R', wait: false, speed: 0.75,
    goal: 'Giữ nhịp đều: nốt đen 1 phách, trắng 2 phách, tròn 4 phách.',
    tips: ['Khối nốt càng dài thì càng phải giữ phím lâu.', 'Đếm thầm "1, 2, 3, 4". Bài này nhạc không dừng lại chờ bạn.'],
    right: 'C4 C4 C4:2 E4 E4 E4:2 G4 G4 G4:2 C4:4',
  },
  // Level 2
  {
    level: 2, title: 'Hot Cross Buns', bpm: 80, mode: 'R',
    goal: 'Chơi bài dân ca đầu tiên chỉ với ba nốt.',
    tips: ['Giữ tay ở vị trí Đô như bài trước.', 'Đoạn giữa có các nốt móc đơn nhanh gấp đôi nốt đen.'],
    right: 'E4 D4 C4:2 E4 D4 C4:2 C4:0.5 C4:0.5 C4:0.5 C4:0.5 D4:0.5 D4:0.5 D4:0.5 D4:0.5 E4 D4 C4:2',
  },
  {
    level: 2, title: 'Mary Had a Little Lamb', bpm: 90, mode: 'R',
    goal: 'Chơi giai điệu dài hơn với nhiều nốt lặp.',
    tips: ['Khi lặp một nốt, nhấc ngón lên hẳn rồi mới nhấn lại.', 'Nghe trước bằng nút "Nghe" nếu chưa quen bài.'],
    right: 'E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:4',
  },
  {
    level: 2, title: 'Twinkle: giai điệu', bpm: 90, mode: 'R', speed: 0.8,
    goal: 'Chơi giai điệu tay phải, app đệm tay trái cho bạn.',
    tips: ['Giai điệu vươn tới La nên ngón út sẽ phải duỗi thêm một chút.', 'Lắng nghe tiếng đệm để cảm nhận nhịp.'],
    right: TWINKLE_RIGHT, left: TWINKLE_LEFT,
  },
  {
    level: 2, title: 'Ode to Joy: giai điệu', bpm: 100, mode: 'R', speed: 0.8,
    goal: 'Chơi giai điệu của Beethoven, có nhịp chấm dôi.',
    tips: ['Nốt Mi chấm dôi dài 1,5 phách, nốt Rê theo sau chỉ nửa phách.'],
    right: ODE_RIGHT, left: ODE_LEFT,
  },
  {
    level: 2, title: 'Phím đen đầu tiên', bpm: 76, mode: 'R',
    goal: 'Chơi Fa thăng, phím đen giữa Fa và Sol.',
    tips: ['Dấu thăng nghĩa là nâng lên nửa cung, tức là phím liền kề bên phải.', 'Đưa bàn tay vào sâu hơn một chút để ngón chạm được phím đen.'],
    right: 'D4 E4 F#4 G4 A4 G4 F#4 E4 D4:2 R:2 D4 F#4 A4 F#4 D4:4',
  },
  {
    level: 2, title: 'Gam Đô trưởng', bpm: 72, mode: 'R',
    goal: 'Đi đủ 8 nốt bằng cách luồn ngón cái.',
    tips: ['Thế ngón đi lên: 1-2-3, luồn ngón cái xuống dưới, rồi 1-2-3-4-5.', 'Đi xuống làm ngược lại: sau ngón 1 thì vắt ngón 3 qua.'],
    right: 'C4 D4 E4 F4 G4 A4 B4 C5 C5 B4 A4 G4 F4 E4 D4 C4:2',
  },
  // Level 3
  {
    level: 3, title: 'Hai tay thay phiên', bpm: 72, mode: 'both',
    goal: 'Chuyển sự chú ý giữa hai tay, mỗi lần một tay.',
    tips: ['Màu xanh là tay phải, màu cam là tay trái.', 'Trên máy tính: tay trái chơi hàng Z, tay phải chơi hàng Q.'],
    right: 'R:2 E4:2 R:2 D4:2 R:2 E4:2 R:2 C4:2',
    left: 'C3:2 R:2 G3:2 R:2 C3:2 R:2 G3:2 R:2',
  },
  {
    level: 3, title: 'Hai tay cùng chiều', bpm: 66, mode: 'both',
    goal: 'Hai tay nhấn cùng lúc và cùng đi lên, đi xuống.',
    tips: ['Hai tay chơi cùng tên nốt nhưng khác số ngón.', 'Khi chế độ chờ bật, cần nhấn đủ cả hai nốt thì bài mới đi tiếp.'],
    right: 'C4 D4 E4 F4 G4 F4 E4 D4 C4:2',
    left: 'C3 D3 E3 F3 G3 F3 E3 D3 C3:2',
  },
  {
    level: 3, title: 'Hai tay ngược chiều', bpm: 66, mode: 'both',
    goal: 'Hai tay dùng cùng số ngón nhưng đi ngược hướng.',
    tips: ['Cả hai ngón cái bắt đầu trước, rồi cùng tiến ra phía ngoài.', 'Bài này thường dễ hơn cùng chiều vì hai tay đối xứng.'],
    right: 'C4 D4 E4 F4 G4 F4 E4 D4 C4:2',
    left: 'G3 F3 E3 D3 C3 D3 E3 F3 G3:2',
  },
  {
    level: 3, title: 'Twinkle: hai tay', bpm: 90, mode: 'both', speed: 0.7,
    goal: 'Tự chơi cả giai điệu lẫn phần đệm.',
    tips: ['Luyện riêng từng tay trước nếu thấy rối.', 'Có thể dùng nút Lặp để tập riêng đoạn khó.'],
    right: TWINKLE_RIGHT, left: TWINKLE_LEFT,
  },
  {
    level: 3, title: 'Ode to Joy: hai tay', bpm: 100, mode: 'both', speed: 0.7,
    goal: 'Giữ nốt trầm tay trái trong khi tay phải tiếp tục đi.',
    tips: ['Tay trái giữ nguyên phím trong cả 4 phách.'],
    right: ODE_RIGHT, left: ODE_LEFT,
  },
  // Level 4
  {
    level: 4, title: 'Hợp âm Đô trưởng', bpm: 66, mode: 'R',
    goal: 'Nhấn ba nốt cùng lúc thật gọn.',
    tips: ['Dùng ngón 1, 3 và 5 cho Đô, Mi, Sol.', 'Cả ba nốt phải vang lên cùng lúc, không rải.'],
    right: 'C4+E4+G4:2 R:2 C4+E4+G4:2 R:2 C4+E4+G4:4',
  },
  {
    level: 4, title: 'Vòng C – F – G', bpm: 66, mode: 'R',
    goal: 'Đổi ba hợp âm cơ bản mà tay gần như không phải rời vị trí.',
    tips: ['Giữ ngón cái trên Đô khi chuyển sang F; chuyển sang G thì ngón cái lùi xuống Si.', 'Ba hợp âm này đủ để đệm rất nhiều bài hát.'],
    right: 'C4+E4+G4:4 C4+F4+A4:4 B3+D4+G4:4 C4+E4+G4:4',
  },
  {
    level: 4, title: 'Vòng nhạc pop: Am – F – C – G', bpm: 72, mode: 'R',
    goal: 'Thuộc vòng hợp âm xuất hiện trong rất nhiều bản pop.',
    tips: ['Tìm nốt chung giữa hai hợp âm liền nhau và giữ yên ngón đó.'],
    right: repeat('A3+C4+E4:4 A3+C4+F4:4 G3+C4+E4:4 G3+B3+D4:4', 2),
  },
  {
    level: 4, title: 'Đệm rải tay trái', bpm: 80, mode: 'L', speed: 0.8,
    goal: 'Rải hợp âm thành từng nốt đều, kiểu đệm của nhạc cổ điển.',
    tips: ['Giữ tay thật nhẹ và đều, nốt thấp nhất vang rõ hơn một chút.'],
    left: repeat('C3:0.5 G3:0.5 E3:0.5 G3:0.5', 2) + ' ' + repeat('F3:0.5 C4:0.5 A3:0.5 C4:0.5', 2) + ' ' + repeat('G3:0.5 D4:0.5 B3:0.5 D4:0.5', 2) + ' ' + repeat('C3:0.5 G3:0.5 E3:0.5 G3:0.5', 2),
  },
  {
    level: 4, title: 'Amazing Grace: giai điệu và đệm', bpm: 80, mode: 'both', speed: 0.8,
    goal: 'Ghép giai điệu tay phải với nốt trầm tay trái trong nhịp 3/4.',
    tips: ['Đếm "1, 2, 3". Bài bắt đầu bằng một phách lấy đà ở tay phải.'],
    right: 'G4 C5:2 E5:0.5 C5:0.5 E5:2 D5 C5:2 A4 G4:2 G4 C5:2 E5:0.5 C5:0.5 E5:2 D5 G5:3',
    left: 'R C3:3 C3:3 F3:3 C3:3 C3:3 C3:3 G3:3',
  },
  // Level 5
  {
    level: 5, title: 'Nhịp thật: Ode to Joy', bpm: 100, mode: 'both', speed: 0.8, wait: false,
    goal: 'Chơi hai tay mà nhạc không dừng lại chờ bạn.',
    tips: ['Nếu lỡ một nốt, bỏ qua và chơi tiếp nốt kế, đừng quay lại.', 'Đây là thói quen quan trọng nhất khi biểu diễn.'],
    right: ODE_RIGHT, left: ODE_LEFT,
  },
  {
    level: 5, title: 'Gam Sol trưởng hai tay', bpm: 66, mode: 'both',
    goal: 'Luồn ngón ở cả hai tay, tại hai vị trí khác nhau.',
    tips: ['Gam Sol trưởng có Fa thăng.', 'Tay phải luồn ngón sau nốt Si, tay trái luồn ngón sau nốt Rê.'],
    right: 'G4 A4 B4 C5 D5 E5 F#5 G5 F#5 E5 D5 C5 B4 A4 G4:2',
    left: 'G3 A3 B3 C4 D4 E4 F#4 G4 F#4 E4 D4 C4 B3 A3 G3:2',
  },
  {
    level: 5, title: 'Gam La thứ hòa âm', bpm: 66, mode: 'R',
    goal: 'Làm quen với màu sắc buồn của giọng thứ.',
    tips: ['Nốt Sol thăng tạo ra quãng rộng đặc trưng trước nốt La cuối.'],
    right: 'A3 B3 C4 D4 E4 F4 G#4 A4 G#4 F4 E4 D4 C4 B3 A3:2',
  },
  {
    level: 5, title: 'Rải hợp âm hai quãng tám', bpm: 72, mode: 'R', speed: 0.8,
    goal: 'Di chuyển cả bàn tay nhanh qua hai quãng tám.',
    tips: ['Thế ngón: 1-2-3, luồn ngón cái, rồi 1-2-3-5.', 'Giữ cổ tay mềm và đưa cánh tay đi theo.'],
    right: 'C3 E3 G3 C4 E4 G4 C5:2 G4 E4 C4 G3 E3 C3:2',
  },
  {
    level: 5, title: 'Minuet cung Sol (Petzold, 8 ô nhịp đầu)', bpm: 100, mode: 'R', speed: 0.7,
    goal: 'Chơi tác phẩm cổ điển thật trong nhịp 3/4.',
    tips: ['Các nốt móc đơn cần đều và nhẹ.', 'Bản này chỉ là đoạn đầu, tay trái do app chơi.'],
    right: MINUET_RIGHT, left: MINUET_LEFT,
  },
  {
    level: 5, title: 'Für Elise (Beethoven, đoạn mở đầu rút gọn)', bpm: 150, mode: 'both', speed: 0.6,
    goal: 'Giữ giai điệu mềm mại với hai nốt Mi và Rê thăng luân phiên.',
    tips: ['Đây là bản rút gọn, tay trái chỉ giữ nốt trầm.', 'Hai nốt đầu chơi rất nhẹ, không nhấn mạnh.'],
    right: FUR_ELISE_RIGHT, left: FUR_ELISE_LEFT,
  },
  {
    level: 5, title: 'Prelude cung Đô (Bach, 4 ô nhịp đầu)', bpm: 60, mode: 'R', speed: 0.7,
    goal: 'Giữ một mẫu rải đều tăm tắp trong khi hòa âm đổi dần.',
    tips: ['Mỗi ô nhịp chỉ lặp một hình nốt, nhận ra hình đó sẽ dễ thuộc hơn.', 'App chơi hai nốt trầm bằng tay trái.'],
    right: [preludeRight('G4', 'C5', 'E5'), preludeRight('A4', 'D5', 'F5'), preludeRight('G4', 'D5', 'F5'), preludeRight('G4', 'C5', 'E5')].join(' '),
    left: [preludeLeft('C4', 'E4'), preludeLeft('C4', 'D4'), preludeLeft('B3', 'D4'), preludeLeft('C4', 'E4')].join(' '),
  },
  {
    level: 5, title: 'Canon cung Rê (Pachelbel, vòng hợp âm)', bpm: 60, mode: 'both', speed: 0.8,
    goal: 'Chuyển 8 hợp âm hai tay trong giọng có hai dấu thăng.',
    tips: ['Giọng Rê trưởng có Fa thăng và Đô thăng.', 'Bản phối đơn giản: tay trái chơi nốt trầm, tay phải chơi hợp âm ba nốt.'],
    right: CANON_RIGHT, left: CANON_LEFT,
  },
  {
    level: 5, title: 'Bài thi cuối: Minuet nhịp thật', bpm: 100, mode: 'R', wait: false,
    goal: 'Chơi đúng tốc độ gốc mà không có chế độ chờ.',
    tips: ['Đạt được bài này nghĩa là bạn đã đi hết lộ trình cơ bản đến nâng cao.'],
    right: MINUET_RIGHT, left: MINUET_LEFT,
  },
];

export const lessons: Lesson[] = specs.map(lesson);

export interface Evaluation {
  /** Empty when the run counts; otherwise why it earned no stars. */
  notCounted: string;
  stars: number;
}

export function evaluate(lesson: Lesson, session: PracticeSession): Evaluation {
  const denied = (notCounted: string): Evaluation => ({ notCounted, stars: 0 });
  if (session.mode !== lesson.mode) return denied('Bạn đã đổi tay luyện so với yêu cầu của bài.');
  if (session.speed < lesson.speed) return denied(`Cần tốc độ từ ${Math.round(lesson.speed * 100)}% trở lên để tính sao.`);
  if (!lesson.wait && session.wait) return denied('Bài này cần tắt "Chờ nốt" để tính sao.');
  if (!session.complete) return denied('Bạn đã tua qua một số nốt.');
  const accuracy = session.accuracy ?? 0;
  const stars = accuracy >= 95 ? 3 : accuracy >= 85 ? 2 : accuracy >= PASS_ACCURACY ? 1 : 0;
  return { notCounted: '', stars };
}
