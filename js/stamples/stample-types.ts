/** A stample definition: SVG silhouette + audio sample + tuning parameters.
 *  Each stample directory exports one of these as its default export. */
export interface Stample {
  /** Display name shown in the stample picker tooltip. */
  name: string;
  /** Raw SVG markup (imported via `?raw`). The first `<path>` is extracted
   *  as the silhouette for selection outline, hit-testing, and overlap
   *  detection. Fill attributes are stripped at mount so the path inherits
   *  the voice color. */
  svgRaw: string;
  /** Audio sample URL (Vite-resolved from `./sample.mp3`). */
  sampleUrl: string;
  /** Fundamental frequency of the sample in Hz. Controls pitch mapping:
   *  playback rate = target frequency / referencePitch. */
  referencePitch: number;
  /** Multiplier for the shape's visual area → audio gain curve.
   *  Higher values make the voice louder at the same size. */
  shapeAreaCoeff: number;
  /** Linear output-gain multiplier applied between the buffer source and
   *  the shared voice gain node. Compensates for quiet sample recordings.
   *  Default 1. */
  gain?: number;
  /** Explicit resize-handle positions in the SVG's viewBox coordinates.
   *  If omitted, handles are auto-detected from the silhouette path by
   *  finding distance-from-centroid peaks in each cardinal direction. */
  handles?: { n: [number, number]; e: [number, number]; s: [number, number]; w: [number, number] };
}
