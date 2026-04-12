import type { Stample } from '../stample-types';
import svgRaw from './stamp.svg?raw';
import sampleUrl from './sample.mp3';

const stample: Stample = {
  name: 'Rowr',
  svgRaw,
  sampleUrl,
  referencePitch: 277,
  shapeAreaCoeff: 1.8,
  gain: 3,
  handles: { n: [832, 746], e: [1331, 886], s: [923, 1699], w: [454, 1306] },
};

export default stample;
