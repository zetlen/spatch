import type { Stample } from '../stample-types';
import svgRaw from './stamp.svg?raw';
import sampleUrl from './sample.mp3';

const stample: Stample = {
  name: 'energy-dome',
  svgRaw,
  sampleUrl,
  referencePitch: 277,
  shapeAreaCoeff: 1.8,
  gainExponent: 1.0,
  formantMaxQ: 4,
  // The dome shape IS its own hull (simple polygon)
  hull: 'M 10,160 L 10,120 L 30,120 L 30,80 L 50,80 L 50,40 L 70,40 L 70,0 L 130,0 L 130,40 L 150,40 L 150,80 L 170,80 L 170,120 L 190,120 L 190,160 Z',
};

export default stample;
