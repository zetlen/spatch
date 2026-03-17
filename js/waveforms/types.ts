// types.ts — Interfaces for the waveform strategy registry.
//
// WaveformStrategy consolidates all per-waveform dispatch (rendering, audio,
// serialization, state creation) into a single object per waveform.
// AudioVoice is the uniform interface returned by buildAudioGraph, replacing
// the old discriminated union. AudioSharedNodes is the common plumbing built
// before strategy delegation.

import type { BlendMode, HandleType, Voice, VoiceBase, WaveformType } from '../types.ts';

/** Shared audio nodes built by voice-builder.ts before delegating to a strategy. */
export interface AudioSharedNodes {
  ctx: AudioContext;
  gain: GainNode;
  formantF1: BiquadFilterNode;
  formantF2: BiquadFilterNode;
  formantMixer: GainNode;
  brightness: BiquadFilterNode;
  panner: StereoPannerNode;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  effectDispose: (() => void) | undefined;
  currentEffect: string | undefined;
  currentBlend: BlendMode;
  currentBorder: string | undefined;
  currentFillKey: string | undefined;
  /** Initial warmth value for the sine saturation shaper; sourced from vibe at build time. */
  warmth: number;
}

/** Uniform audio voice interface with bound methods. Replaces the old discriminated union. */
export interface AudioVoice {
  // Shared fields (same as old AudioVoiceBase)
  shapeId: string;
  gain: GainNode;
  outputNode: StereoPannerNode;
  panner: StereoPannerNode;
  formantF1: BiquadFilterNode;
  formantF2: BiquadFilterNode;
  formantMixer: GainNode;
  brightness: BiquadFilterNode;
  warmthShaper: WaveShaperNode | undefined;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  effectDispose: (() => void) | undefined;
  currentEffect: string | undefined;
  currentBlend: BlendMode;
  currentBorder: string | undefined;
  currentFillKey: string | undefined;
  hasSweep: boolean;
  lastX: number;
  lastY: number;
  lastSize: number;

  // Bound by strategy -- no external dispatch needed
  start(time: number): void;
  stop(time: number): void;
  updateParams(voice: Voice, now: number): void;
  /** Sync strategy-specific params when global vibe changes (e.g. warmth shaper). */
  syncGlobalParams(vibeParams: { warmth: number }, now: number): void;
  getModulatorNode(): OscillatorNode;
  getCarrierFrequencyParams(): AudioParam[];
}

/** Strategy interface: all per-waveform behavior in one object. */
export interface WaveformStrategy {
  // ---- Identity ----
  readonly waveform: WaveformType;
  /** Geometric shape name: 'circle', 'square', 'triangle'. */
  readonly shapeName: string;
  /** SVG element tag: 'circle', 'rect', 'polygon'. */
  readonly svgTag: string;
  /** Whether this waveform has a timbre parameter (rotation). */
  readonly hasTimbre: boolean;
  /** Rotation period in degrees per full timbre sweep (0 = no rotation). */
  readonly rotationPeriod: number;
  /** Index in the serialization bitfield (0, 1, 2...). */
  readonly serializationIndex: number;
  /** OscillatorType used for the border octave oscillator. */
  readonly oscillatorType: OscillatorType;
  /** Geometric area coefficient: PI for circle, 4 for square, 3*sqrt(3)/4 for triangle. */
  readonly shapeAreaCoeff: number;
  /** Maximum formant Q (4 for sine, 8 for harmonics-rich waveforms). */
  readonly formantMaxQ: number;

  // ---- Rendering ----
  /** Compute SVG attributes for the shape element. */
  svgAttrs(voice: Voice): Record<string, string>;
  /** Create and return a new SVG shape element for the voice. */
  createSvgElement(voice: Voice): SVGElement;
  /** Update an existing SVG shape element to match the voice. */
  updateSvgElement(el: SVGElement, voice: Voice): void;
  /** Return resize handle positions for the voice shape. */
  handlePositions(voice: Voice): [HandleType, number, number][];

  // ---- Audio ----
  /** Build the waveform-specific audio graph and return an AudioVoice. */
  buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice;

  // ---- State ----
  /** Create a Voice from a VoiceBase (adds waveform-specific fields like timbre). */
  createVoice(base: VoiceBase): Voice;

  // ---- Serialization ----
  /** Pack waveform-specific extra bytes (e.g. timbre). Returns empty string if none. */
  packExtra(voice: Voice): string;
  /** Unpack waveform-specific extra bytes. Returns fields and number of chars consumed. */
  unpackExtra(str: string, idx: number): { fields: Record<string, unknown>; bytesRead: number };
}
