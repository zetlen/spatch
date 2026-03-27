/** A stample definition: SVG silhouette + audio sample + tuning parameters.
 *  Each stample directory exports one of these as its default export. */
export interface Stample {
  name: string;
  /** Raw SVG source (imported via ?raw). */
  svgRaw: string;
  /** Audio sample URL (Vite-resolved). */
  sampleUrl: string;
  referencePitch: number;
  shapeAreaCoeff: number;
  gainExponent: number;
  formantMaxQ: number;
  /** Optional SVG path string overriding the stamp's own path for selection
   *  marching ants and hit-testing. If omitted, the path `d` attribute is
   *  extracted from the stamp SVG automatically. Useful when the stamp path
   *  is too detailed and a simplified outline is preferred. */
  hull?: string;
  /** Optional explicit handle positions in viewBox coordinates.
   *  Overrides the automatic tip-finding algorithm. */
  handles?: { n: [number, number]; e: [number, number]; s: [number, number]; w: [number, number] };
}
