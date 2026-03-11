// blend-panel.ts — Blend mode expansion panel
// Icon references for sprite scanner: #tabler-diamond #tabler-skull #tabler-spiral

import type { BlendMode } from '../types.ts';
import { DEFAULT_BLEND } from '../effects.ts';
import {
  createExpansionPanel,
  getSelectedVoice,
  type ExpansionPanel,
  type PanelDeps,
} from './expansion-panel.ts';

export function createBlendPanel(deps: PanelDeps): ExpansionPanel {
  return createExpansionPanel({
    area: deps.area,
    entries: () => [
      { type: 'icon', symbol: 'tabler-diamond', title: 'Screen', key: 'screen' },
      { type: 'icon', symbol: 'tabler-skull', title: 'Multiply', key: 'multiply' },
      { type: 'icon', symbol: 'tabler-spiral', title: 'Difference', key: 'difference' },
    ],
    isActive: (key) => (getSelectedVoice(deps)?.blend ?? DEFAULT_BLEND) === key,
    onClick(key) {
      const voice = getSelectedVoice(deps);
      if (!voice) return;
      deps.undo.snapshot();
      deps.store.updateVoice(voice.id, { blend: key as BlendMode });
    },
  });
}
