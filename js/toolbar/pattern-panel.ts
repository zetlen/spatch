// pattern-panel.ts — Pattern dropdown panel

import { PATTERN_TYPES, type PatternType } from '../types.ts';
import {
  createExpansionPanel,
  getSelectedVoice,
  type ExpansionPanel,
  type PanelDeps,
} from './expansion-panel.ts';

export function createPatternPanel(deps: PanelDeps, triggerBtn: HTMLElement): ExpansionPanel {
  return createExpansionPanel({
    area: deps.area,
    entries: () =>
      PATTERN_TYPES.map((p) => ({
        type: 'item' as const,
        key: p,
        create() {
          const btn = document.createElement('button');
          btn.className = 'dropdown-item';
          btn.title = p.charAt(0).toUpperCase() + p.slice(1);
          const band = document.createElement('div');
          band.className = `pattern-band pattern-preview-${p}`;
          btn.append(band);
          return btn;
        },
      })),
    isActive(key) {
      const current = getSelectedVoice(deps)?.effect;
      return (key === 'none' && !current) || key === current;
    },
    onClick(key) {
      const sel = getSelectedVoice(deps);
      if (!sel) return;
      deps.undo.snapshot();
      deps.store.updateVoice(sel.id, {
        effect: sel.effect === key ? undefined : (key as PatternType),
      });
    },
    onUpdate() {
      triggerBtn.classList.toggle('has-pattern', getSelectedVoice(deps)?.effect != undefined);
    },
  });
}
