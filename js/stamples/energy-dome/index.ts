import type { Stample } from '../stample-types';
import svgRaw from './stamp.svg?raw';
import sampleUrl from './sample.mp3';

const stample: Stample = {
  name: 'Whip Crack',
  svgRaw,
  sampleUrl,
  referencePitch: 277,
  shapeAreaCoeff: 1.8,
  gainExponent: 1,
  handles: { n: [79, 0], e: [121, 0], s: [160, 86], w: [40, 86] },
};

export default stample;
