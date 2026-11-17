/** Small building blocks shared by every screen, so controls look and behave the same everywhere. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export interface Switch {
  element: HTMLButtonElement;
  set(on: boolean): void;
}

/** An on/off switch: the label stays put and the knob shows the state. */
export function switchControl(label: string, on: boolean, onChange: (on: boolean) => void): Switch {
  const element = el('button', 'switch');
  element.type = 'button';
  element.setAttribute('role', 'switch');
  element.append(el('span', 'switch-track'), el('span', 'switch-label', label));
  let state = on;
  const set = (value: boolean) => {
    state = value;
    element.setAttribute('aria-checked', String(value));
  };
  element.addEventListener('click', () => {
    set(!state);
    onChange(state);
  });
  set(on);
  return { element, set };
}

export interface Slider {
  element: HTMLLabelElement;
  input: HTMLInputElement;
  /** Sets the slider and its readout without calling `onInput`. */
  set(value: number): void;
}

/** A slider with its current value written next to the name. */
export function sliderField(
  label: string,
  options: { min: number; max: number; step: number; value: number; format?: (value: number) => string; wide?: boolean },
  onInput: (value: number) => void,
): Slider {
  const format = options.format ?? ((v: number) => String(v));
  const element = el('label', options.wide ? 'field field-wide' : 'field');
  const head = el('span', 'field-head');
  const readout = el('span', 'field-value');
  head.append(el('span', '', label), readout);
  const input = el('input');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  const set = (value: number) => {
    input.value = String(value);
    readout.textContent = format(value);
  };
  input.addEventListener('input', () => {
    readout.textContent = format(Number(input.value));
    onInput(Number(input.value));
  });
  set(options.value);
  element.append(head, input);
  return { element, input, set };
}

const openPopovers = new Set<HTMLDetailsElement>();
document.addEventListener('pointerdown', (event) => {
  for (const details of openPopovers) {
    if (!details.contains(event.target as Node)) details.open = false;
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') for (const details of openPopovers) details.open = false;
});

/**
 * A button that opens a small panel below it. Only one is open at a time, and it
 * closes on a tap elsewhere or Escape.
 */
export function popover(label: string, content: Node[], className = ''): { element: HTMLDetailsElement; close(): void } {
  const details = el('details', `popover ${className}`.trim());
  const summary = el('summary', 'btn', label);
  const panel = el('div', 'popover-panel');
  panel.append(...content);
  details.append(summary, panel);
  details.addEventListener('toggle', () => {
    if (!details.open) {
      openPopovers.delete(details);
      return;
    }
    for (const other of openPopovers) if (other !== details) other.open = false;
    openPopovers.add(details);
    // Keep the panel on screen when the button sits near the right edge.
    panel.classList.remove('align-end');
    if (panel.getBoundingClientRect().right > window.innerWidth - 8) panel.classList.add('align-end');
  });
  return { element: details, close: () => (details.open = false) };
}

export interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
}

/** A popover holding a list of actions, optionally split into titled groups. */
export function menu(label: string, groups: { title?: string; items: MenuItem[] }[]): HTMLDetailsElement {
  const content: Node[] = [];
  const result = popover(label, content, 'menu');
  for (const group of groups) {
    const section = el('div', 'menu-group');
    if (group.title) section.append(el('p', 'menu-title', group.title));
    for (const item of group.items) {
      section.append(button(item.label, () => {
        result.close();
        item.run();
      }, item.danger ? 'menu-item is-danger' : 'menu-item'));
    }
    result.element.querySelector('.popover-panel')!.append(section);
  }
  return result.element;
}

const TIP_KEY = 'piano-studio.tipsSeen';

function seenTips(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TIP_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** A short how-to shown the first few visits to a screen until the user dismisses it. */
export function tip(id: string, title: string, steps: string[]): HTMLElement | null {
  if (seenTips().includes(id)) return null;
  const box = el('aside', 'tip');
  box.setAttribute('aria-label', title);
  const list = el('ol');
  for (const step of steps) list.append(el('li', '', step));
  const close = button('Đã hiểu', () => {
    try {
      localStorage.setItem(TIP_KEY, JSON.stringify([...seenTips(), id]));
    } catch {
      // Without storage the tip simply shows again next time.
    }
    box.remove();
  }, 'btn btn-quiet');
  const head = el('div', 'tip-head');
  head.append(el('strong', '', title), close);
  box.append(head, list);
  return box;
}

/** A canvas that fills its box without its pixel size feeding back into the layout. */
export function canvasBox(className: string): { box: HTMLDivElement; canvas: HTMLCanvasElement } {
  const box = el('div', `canvas-box ${className}`);
  const canvas = el('canvas');
  box.append(canvas);
  return { box, canvas };
}

export function saveFile(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = el('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
