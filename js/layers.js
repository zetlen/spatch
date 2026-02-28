// layers.js — Layer ordering helpers
// Most layer logic is in state.js (moveLayer, bringToFront, sendToBack)
// This module provides the EQ shelving calculation used by the audio engine

export function getLayerGainBoost(layerIndex, totalLayers) {
  if (totalLayers <= 1) return { type: 'flat', boost: 0 };
  const normalized = layerIndex / (totalLayers - 1);
  if (normalized > 0.5) {
    return { type: 'highshelf', freq: 3000, boost: (normalized - 0.5) * 6 };
  } else {
    return { type: 'lowshelf', freq: 300, boost: (0.5 - normalized) * 6 };
  }
}
