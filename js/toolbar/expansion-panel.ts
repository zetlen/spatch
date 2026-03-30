// Expansion-panel.ts — Shared lifecycle and mutex for toolbar expansion panels

import type { SigilStore, UndoManager } from '../state.ts';
import type { Voice } from '../types.ts';
import { createIconButton } from './dom-helpers.ts';

export interface ExpansionPanel {
  open(): void;
  close(): void;
  update(): void;
}

export interface PanelDeps {
  area: HTMLElement;
  store: SigilStore;
  undo: UndoManager;
  getSelectedId: () => string | undefined;
}

export function getSelectedVoice(deps: PanelDeps): Voice | undefined {
  const id = deps.getSelectedId();
  return id ? (deps.store.getVoice(id) ?? undefined) : undefined;
}

// ---- Declarative panel entries ----

export type PanelEntry =
  | { type: 'separator'; className?: string }
  | { type: 'icon'; symbol: string; title: string; key: string; className?: string }
  | { type: 'item'; create(): HTMLElement; key?: string; className?: string };

/**
 * Create an expansion panel from a declarative list of entries.
 *
 * - `entries()` describes the panel contents (icons, separators, custom elements)
 * - `onClick(key)` handles item clicks, delegated via `data-panel-key`
 * - `isActive(key)` syncs `.active` classes
 * - `onUpdate(area)` runs after active sync for additional DOM updates
 * - `onDismiss()` is called after each click — use for close-on-select panels
 * - `onOpen()` is called after the panel is built and visible
 */
export function createExpansionPanel(config: {
  area: HTMLElement;
  entries(): PanelEntry[];
  onClick?(key: string): void;
  isActive?(key: string): boolean;
  onUpdate?(area: HTMLElement): void;
  onDismiss?(): void;
  onOpen?(): void;
}): ExpansionPanel {
  const { area, entries, onClick, isActive, onUpdate, onDismiss, onOpen } = config;
  let isOpen = false;

  // Bind click delegation once per panel, not per open().
  // Guard on isOpen so shared area elements don't cross-dispatch.
  if (onClick) {
    area.addEventListener('click', (e) => {
      if (!isOpen) {
        return;
      }
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-panel-key]');
      if (target?.dataset.panelKey) {
        onClick(target.dataset.panelKey);
        onDismiss?.();
      }
    });
  }

  function build() {
    area.replaceChildren();
    for (const entry of entries()) {
      if (entry.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = entry.className ? `separator ${entry.className}` : 'separator';
        area.append(sep);
      } else if (entry.type === 'icon') {
        const btn = createIconButton({
          className: entry.className ? `action-btn ${entry.className}` : 'action-btn',
          symbol: entry.symbol,
          title: entry.title,
        });
        btn.dataset.panelKey = entry.key;
        area.append(btn);
      } else {
        const el = entry.create();
        if (entry.key) {
          el.dataset.panelKey = entry.key;
        }
        if (entry.className) {
          for (const cls of entry.className.split(' ')) {
            el.classList.add(cls);
          }
        }
        area.append(el);
      }
    }
    syncActive();
  }

  function syncActive() {
    if (isActive) {
      area.querySelectorAll<HTMLElement>('[data-panel-key]').forEach((el) => {
        el.classList.toggle('active', isActive(el.dataset.panelKey!));
      });
    }
    onUpdate?.(area);
  }

  return {
    open() {
      isOpen = true;
      build();
      area.classList.remove('hidden');
      onOpen?.();
    },
    close() {
      isOpen = false;
      area.classList.add('hidden');
      area.replaceChildren();
    },
    update: syncActive,
  };
}

// ---- Long-press binding ----

const LONG_PRESS_MS = 400;

/**
 * Bind long-press detection to a button.
 *
 * Short click calls `onShortClick()`. Long press (400ms) calls
 * `onLongPress()`. Handles pointer capture and cancellation.
 */
export function bindLongPress(
  btn: HTMLElement,
  onShortClick: () => void,
  onLongPress: () => void,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let didLongPress = false;

  btn.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    didLongPress = false;
    btn.setPointerCapture(e.pointerId);
    timer = setTimeout(() => {
      didLongPress = true;
      timer = undefined;
      onLongPress();
    }, LONG_PRESS_MS);
  });

  btn.addEventListener('pointerup', () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      if (!didLongPress) {
        onShortClick();
      }
    }
  });

  btn.addEventListener('pointercancel', () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  });
}

// ---- Panel manager ----

export class PanelManager {
  private _panels = new Map<
    string,
    { panel: ExpansionPanel; trigger: HTMLElement; area: HTMLElement }
  >();
  private _open: string | undefined = undefined;

  constructor() {
    document.addEventListener('click', (e) => {
      if (!this._open) {
        return;
      }
      const entry = this._panels.get(this._open);
      if (!entry) {
        return;
      }
      const target = e.target as Node;
      if (!entry.trigger.contains(target) && !entry.area.contains(target)) {
        this.close();
      }
    });
  }

  register(name: string, panel: ExpansionPanel, trigger: HTMLElement, area: HTMLElement): void {
    this._panels.set(name, { area, panel, trigger });
  }

  toggle(name: string, guard?: () => boolean): void {
    if (guard && !guard()) {
      return;
    }
    if (this._open === name) {
      this.close();
    } else {
      this.close();
      const entry = this._panels.get(name);
      if (entry) {
        this._open = name;
        entry.panel.open();
        this._syncTriggers();
      }
    }
  }

  close(): void {
    if (!this._open) {
      return;
    }
    const entry = this._panels.get(this._open);
    entry?.panel.close();
    this._open = undefined;
    this._syncTriggers();
  }

  get openPanel(): string | undefined {
    return this._open;
  }

  updateOpen(): void {
    if (this._open) {
      this._panels.get(this._open)?.panel.update();
    }
  }

  private _syncTriggers(): void {
    for (const [name, { trigger }] of this._panels) {
      trigger.classList.toggle('active', this._open === name);
    }
  }
}
