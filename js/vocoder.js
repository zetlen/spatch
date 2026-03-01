// vocoder.js — Formant-based vocoder pipeline

// Formant frequencies for vowels (F1, F2, F3)
const VOWEL_FORMANTS = {
  a: [800, 1200, 2500],
  e: [350, 2000, 2800],
  i: [270, 2300, 3000],
  o: [500, 900, 2500],
  u: [325, 700, 2500],
};

// Consonant types
const FRICATIVES = new Set('sfvzh'.split(''));
const STOPS = new Set('pbtdkg'.split(''));
const NASALS = new Set('mn'.split(''));

const CHAR_DURATION = 0.15; // seconds per character
const NUM_BANDS = 16;
const BAND_LOW = 100;
const BAND_HIGH = 8000;

// Create a vocoder effect that modulates a carrier oscillator based on text
export function createVocoderChain(audioCtx, text, carrierNode) {
  if (!text || text.length === 0) return null;

  const output = audioCtx.createGain();
  output.gain.value = 0.6;

  // Create bandpass filter bank
  const bands = [];
  for (let i = 0; i < NUM_BANDS; i++) {
    const freq = BAND_LOW * Math.pow(BAND_HIGH / BAND_LOW, i / (NUM_BANDS - 1));
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 4;

    const gain = audioCtx.createGain();
    gain.gain.value = 0;

    carrierNode.connect(filter);
    filter.connect(gain);
    gain.connect(output);

    bands.push({ filter, gain, freq });
  }

  // Schedule gain automation based on text formants
  const now = audioCtx.currentTime;
  const chars = text.toLowerCase().split('');

  for (let ci = 0; ci < chars.length; ci++) {
    const char = chars[ci];
    const time = now + ci * CHAR_DURATION;
    const formants = getFormants(char);

    for (const band of bands) {
      const bandGainValue = formants ? getFormantGain(band.freq, formants) : 0;

      band.gain.gain.setValueAtTime(band.gain.gain.value || 0, time);
      band.gain.gain.linearRampToValueAtTime(bandGainValue, time + 0.02);
      // Hold, then fade
      band.gain.gain.setValueAtTime(bandGainValue, time + CHAR_DURATION - 0.03);
      band.gain.gain.linearRampToValueAtTime(0, time + CHAR_DURATION);
    }
  }

  const totalDuration = chars.length * CHAR_DURATION;

  return { output, duration: totalDuration };
}

function getFormants(char) {
  // Vowels
  if (VOWEL_FORMANTS[char]) return VOWEL_FORMANTS[char];

  // Fricatives: broadband noise-like formants
  if (FRICATIVES.has(char)) return [2500, 4000, 6000];

  // Nasals: low formants
  if (NASALS.has(char)) return [250, 2500, 3000];

  // Stops: very brief transient (handled as silence + burst)
  if (STOPS.has(char)) return null;

  // Other consonants: approximate
  if (char === 'r') return [500, 1500, 2500];
  if (char === 'l') return [350, 1700, 2700];
  if (char === 'w') return [300, 700, 2500];
  if (char === 'y') return [280, 2200, 2900];

  // Space or unknown: silence
  return null;
}

function getFormantGain(bandFreq, formants) {
  // Calculate how much this band should be boosted based on proximity to formant frequencies
  let maxGain = 0;
  for (const f of formants) {
    // Gaussian-like response centered on formant frequency
    const distance = Math.abs(Math.log2(bandFreq / f));
    const gain = Math.exp(-distance * distance * 8);
    maxGain = Math.max(maxGain, gain);
  }
  return maxGain * 0.8;
}
