import { createComputed } from "solid-js";
import { createStore } from "solid-js/store";

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

// One scrollable/zoomable dimension. Maps between *value* space (samples, ticks,
// list indices, seconds — whatever the content is measured in) and *pixel* space
// on screen, given a scroll `position` and a `zoom` factor.
//
// This is the shared math that solid-waveform's `useViewPortScaler` and
// solid-pianoroll's `createViewPortDimension` independently reinvented. A viewport
// is just N of these (one per axis): a list needs one, a waveform one, a pianoroll
// two (time + pitch), a grid two.
export type AxisState = {
  // A stable name so `useAxis(name)` can find it in a multi-axis viewport.
  name: string;

  // Scroll position — the value at the left/top edge of the viewport.
  position: number;
  // Total content length in value units. `position` ranges over [0, range - range/zoom].
  range: number;

  // Where the viewport begins on screen (px). Usually 0; non-zero when the axis is
  // inset (e.g. a ruler gutter).
  pixelOffset: number;
  // Viewport extent on screen (px) — the width (horizontal) or height (vertical).
  pixelSize: number;

  // 1 = the whole `range` fits in `pixelSize`. 2 = twice zoomed in, etc.
  zoom: number;
  minZoom?: number;
  maxZoom?: number;

  // Optional controlled callbacks. When present, `onPositionChange`/`onZoomChange`
  // clamp to legal bounds before calling these.
  onPositionChange?: (position: number) => void;
  onZoomChange?: (zoom: number) => void;
};

export type Dimensions = { offset: number; size: number };
export type ViewPortAxis = ReturnType<typeof createViewPortAxis>;

export default function createViewPortAxis(getState: () => AxisState) {
  const build = () => {
    const s = getState();
    const minZoom = s.minZoom ?? 1;
    const maxZoom = s.maxZoom ?? Infinity;

    // value -> pixels in absolute (virtual) space at the current zoom.
    const toPixels = (value: number = s.position) => (value / s.range) * (s.pixelSize * s.zoom);

    // value -> pixels relative to the current scroll position (0 = left/top edge).
    const toPixelOffset = (value: number) => toPixels(value) - toPixels(s.position);

    // pixel offset (relative to the viewport) -> value.
    const toPosition = (offset: number) =>
      s.position + ((offset - s.pixelOffset) / s.pixelSize) * visibleRange();

    // How much of `range` is on screen right now.
    const visibleRange = () => s.range / s.zoom;

    // Largest legal scroll position (content end aligned to viewport end).
    const maxPosition = () => Math.max(0, s.range - s.range / s.zoom);

    // Raw placement of a [position, length) span in viewport px. May be negative or
    // exceed pixelSize (i.e. partly/fully off-screen) — pair with `isVisible`.
    const dimensions = (position: number, length: number): Dimensions => ({
      offset: toPixelOffset(position),
      size: toPixels(length),
    });

    // Placement clipped to the visible box: offset in [0, pixelSize], size trimmed to
    // what's actually on screen. Handy when you draw the span directly (waveform region).
    const clampedDimensions = (position: number, length: number): Dimensions => {
      const left = toPixelOffset(position);
      const width = toPixels(length);
      const offset = clamp(left, 0, s.pixelSize);
      const size = clamp(width - (offset - left), 0, s.pixelSize - offset);
      return { offset, size };
    };

    // Does a span (from `dimensions`) intersect the viewport at all?
    const isVisible = ({ offset, size }: Dimensions) => offset + size > 0 && offset < s.pixelSize;

    // Emit a position change, clamped against LIVE state rather than this snapshot.
    // During a wheel handler the caller sets zoom then position in the same tick; the
    // reactive rebuild hasn't run yet, so a snapshot maxPosition() would still reflect
    // the old zoom and clip an anchored position. getState() sees the just-set signal.
    const emitPosition = (position: number) => {
      const live = getState();
      const max = Math.max(0, live.range - live.range / live.zoom);
      live.onPositionChange?.(clamp(position, 0, max));
    };

    // Programmatic scroll: move the given value to the viewport's start edge.
    const scrollTo = (position: number) => emitPosition(position);

    // Programmatic scroll: put the given value at the viewport centre.
    const center = (position: number) => emitPosition(position - visibleRange() / 2);

    // Programmatic scroll: pan the minimum needed so [position, position+length] is
    // fully on screen (with optional value-space padding). No-op if already visible.
    const ensureVisible = (position: number, length = 0, padding = 0) => {
      const vr = visibleRange();
      const start = s.position;
      const end = start + vr;
      if (position - padding < start) emitPosition(position - padding);
      else if (position + length + padding > end) emitPosition(position + length + padding - vr);
    };

    return {
      ...s,
      minZoom,
      maxZoom,
      onPositionChange: emitPosition,
      onZoomChange: (zoom: number) => {
        const live = getState();
        live.onZoomChange?.(clamp(zoom, live.minZoom ?? 1, live.maxZoom ?? Infinity));
      },
      toPixels,
      toPixelOffset,
      toPosition,
      visibleRange,
      maxPosition,
      dimensions,
      clampedDimensions,
      isVisible,
      scrollTo,
      center,
      ensureVisible,
    };
  };

  const [state, setState] = createStore(build());
  // A computation, not an effect: an effect runs after the render that changed
  // the state, so every pan or zoom drew once with the old axis and again with
  // the new one. Computed, the axis is current within the same update.
  createComputed(() => setState(build()));

  return state;
}
