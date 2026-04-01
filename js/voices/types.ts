// Types.ts — Delegate interfaces for the voice registry.
//
// A voice is three projections of the same identity:
//   UI        — SVG rendering, selection handles, gesture eligibility
//   Player    — Web Audio graph construction and parameter updates
//   Serializer — bidirectional Voice ↔ register-string codec
//
// The registry wires these together per voice type. See registry.ts.

import type { Voice, VoiceBase, WaveformType } from '../types.ts';

// ---- Audio interfaces (moved from waveforms/types.ts) ----

/** Shared audio nodes built by voice-builder.ts before delegating to a player. */
export interface AudioSharedNodes {
  ctx: AudioContext;
  gain: GainNode;
  f1: BiquadFilterNode;
  f2: BiquadFilterNode;
  formantMixer: GainNode;
  brightness: BiquadFilterNode;
  panner: StereoPannerNode;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  effectDispose: (() => void) | undefined;
  currentEffect: string | undefined;
  currentBorder: string | undefined;
  currentFillKey: string | undefined;
  /** Initial warmth value for the sine saturation shaper. */
  warmth: number;
}

/** Uniform audio voice interface with bound methods. */
export interface AudioVoice {
  shapeId: string;
  gain: GainNode;
  outputNode: StereoPannerNode;
  panner: StereoPannerNode;
  f1: BiquadFilterNode;
  f2: BiquadFilterNode;
  formantMixer: GainNode;
  brightness: BiquadFilterNode;
  warmthShaper: WaveShaperNode | undefined;
  octaveOsc: OscillatorNode | undefined;
  octaveGainNode: GainNode | undefined;
  effectDispose: (() => void) | undefined;
  currentEffect: string | undefined;
  currentBorder: string | undefined;
  currentFillKey: string | undefined;
  hasSweep: boolean;
  lastX: number;
  lastY: number;
  lastSize: number;
  start(time: number): void;
  onDecay?(time: number): void;
  onRelease?(time: number): void;
  stop(time: number): void;
  updateParams(voice: Voice, now: number): void;
  syncGlobalParams(vibeParams: { warmth: number }, now: number): void;
  getModulatorNode(): OscillatorNode;
  getCarrierFrequencyParams(): AudioParam[];
}

// ---- Delegate interfaces ----

/** SVG rendering, selection handles, hit areas, gesture eligibility. */
export interface VoiceUI {
  readonly svgTag: string;
  readonly shapeName: string;
  createSvgElement(voice: Voice): SVGElement;
  updateSvgElement(el: SVGElement, voice: Voice): void;
  createSelectionElement?(voice: Voice): SVGElement;
  selectionHandles(voice: Voice): SVGElement[];
}

/** Audio graph construction. The returned AudioVoice is the live mutation
 *  handle — start, stop, updateParams, getModulatorNode, etc. */
export interface VoicePlayer {
  readonly oscillatorType: OscillatorType;
  readonly shapeAreaCoeff: number;
  readonly gainExponent: number;
  buildAudioGraph(ctx: AudioContext, voice: Voice, shared: AudioSharedNodes): AudioVoice;
}

/** Bidirectional Voice ↔ register-string codec. The serializer owns the
 *  register layout; serialize.ts owns the global framing (version, scene,
 *  envelope). */
export interface VoiceSerializer {
  /** Number of B64 register chars for a solid-fill voice. */
  readonly solidWidth: number;
  /** Number of B64 register chars for a gradient-fill voice. */
  readonly gradientWidth: number;
  /** Pack a Voice into a register string. Length depends on fill mode. */
  pack(voice: Voice): string;
  /** Unpack a register string into a Voice.
   *  Receives only this voice's register slice, not the full URL. */
  unpack(registers: string, waveform: WaveformType): Voice;
}

/** One row in the voice registry table. */
export interface VoiceRegistryEntry {
  readonly waveform: WaveformType;
  /** Stable numeric ID used in the type header byte during serialization. */
  readonly id: number;
  /** Bijection constant: degrees per full visual rotation cycle.
   *  0 means no rotation (sine, stamp). Read by both UI and audio mapping. */
  readonly rotationPeriod: number;
  readonly ui: VoiceUI;
  readonly player: VoicePlayer;
  readonly serializer: VoiceSerializer;
  /** Which optional toolbar panels this voice type uses. */
  readonly panels: {
    readonly border: boolean;
    readonly pattern: boolean;
    readonly stample: boolean;
  };
  /** Create a Voice from a VoiceBase, adding waveform-specific fields. */
  createVoice(base: VoiceBase): Voice;
}
