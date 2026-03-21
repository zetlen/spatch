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
  /** Simplified SVG path string tracing the silhouette outline.
   *  Used for selection marching ants and hit-testing. Coordinates are
   *  in the same space as the stamp SVG's viewBox.
   *  MUST use only M, L, Z commands (no curves or arcs) — the coordinate
   *  transformer in stamp.ts assumes alternating x,y number pairs. */
  hull: string;
}
