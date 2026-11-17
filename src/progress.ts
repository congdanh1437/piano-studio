const STARS_KEY = 'piano-studio.stars';
const HINTS_KEY = 'piano-studio.keyHints';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the app still works, it just won't remember.
  }
}

export function loadStars(): Record<string, number> {
  try {
    return JSON.parse(read(STARS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Keeps the best result, so a worse retry never takes stars away. */
export function saveStars(lessonId: string, stars: number) {
  const all = loadStars();
  if (stars > (all[lessonId] ?? 0)) {
    all[lessonId] = stars;
    write(STARS_KEY, JSON.stringify(all));
  }
}

/** Replaces all stars at once; used when restoring a backup, which never lowers them. */
export function saveAllStars(stars: Record<string, number>) {
  write(STARS_KEY, JSON.stringify(stars));
}

/** On by default where there is a mouse or trackpad, which means a computer keyboard too. */
export function loadKeyHints(): boolean {
  const saved = read(HINTS_KEY);
  return saved === null ? matchMedia('(any-pointer: fine)').matches : saved === '1';
}

export function saveKeyHints(on: boolean) {
  write(HINTS_KEY, on ? '1' : '0');
}
