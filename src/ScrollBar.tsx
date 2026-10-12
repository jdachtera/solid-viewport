import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { clamp } from "./createViewPortAxis";
import { useAxis } from "./ViewPort";

// A combined scroll + zoom bar for one axis. Dragging the middle scrolls; dragging
// either end resizes the thumb, i.e. zooms (grab-and-stretch). Auto-hides unless the
// pointer is near the track. Lifted from solid-pianoroll's ScrollZoombar and rebound
// to the generic ViewPort axis API.
const ScrollBar = (props: {
  // Physical orientation of the bar.
  direction: "horizontal" | "vertical";
  // Axis name to control (defaults to the direction).
  axis?: string;
  // Minimum thumb extent (px) and minimum item size the zoom-end allows (px).
  minThumb?: number;
}) => {
  let ref: HTMLDivElement | undefined;
  const axis = createMemo(() => useAxis(props.axis ?? props.direction));
  const minThumb = () => props.minThumb ?? 40;
  const dragHandleSize = 10;

  const size = createMemo(() => Math.max(axis().pixelSize / axis().zoom, minThumb()));
  const scrollPercentage = createMemo(() => {
    const max = axis().maxPosition();
    return max > 0 ? axis().position / max : 0;
  });
  const offset = createMemo(() => scrollPercentage() * (axis().pixelSize - size()));

  // Grab point within the thumb (px from the thumb's start edge) + thumb geometry at
  // mousedown, so a drag preserves where you grabbed rather than snapping.
  const [grab, setGrab] = createSignal<number>(Infinity);
  const [hoverInThumb, setHoverInThumb] = createSignal<number>(Infinity);
  const [startSize, setStartSize] = createSignal(0);
  const [startOffset, setStartOffset] = createSignal(0);
  const [dragHandle, setDragHandle] = createSignal<"start" | "middle" | "end">();

  const parallelOf = (e: { clientX: number; clientY: number }) =>
    props.direction === "horizontal" ? e.clientX : e.clientY;

  // Screen coordinate of the track's start edge. The track is the thumb's
  // offsetParent (the positioned container the bar lives in) — measured live so it
  // survives layout/scroll changes. This is what was missing: the old code used the
  // axis pixelOffset (0) as the origin, so the cursor mapped to an absolute screen
  // position and the thumb jumped.
  const trackStart = () => {
    const parent = ref?.offsetParent as HTMLElement | null;
    const rect = parent?.getBoundingClientRect();
    if (!rect) return 0;
    return props.direction === "horizontal" ? rect.left : rect.top;
  };

  const setPositionFromThumbOffset = (thumbOffset: number, thumbSize: number) => {
    const denom = axis().pixelSize - thumbSize;
    const amount = clamp(denom > 0 ? thumbOffset / denom : 0, 0, 1);
    axis().onPositionChange?.(amount * axis().maxPosition());
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!ref) return;

    if (dragHandle()) {
      event.preventDefault();
      const track = axis().pixelSize;
      const pointerInTrack = parallelOf(event) - trackStart();

      if (dragHandle() === "middle") {
        setPositionFromThumbOffset(pointerInTrack - grab(), size());
      } else if (dragHandle() === "end") {
        // Left edge stays put; the right edge follows the cursor → resize = zoom.
        const right = clamp(pointerInTrack, startOffset() + minThumb(), track);
        const newZoom = clamp(track / (right - startOffset()), axis().minZoom, axis().maxZoom);
        axis().onZoomChange?.(newZoom);
        setPositionFromThumbOffset(startOffset(), track / newZoom);
      } else {
        // Right edge stays put; the left edge follows the cursor.
        const rightFixed = startOffset() + startSize();
        const left = clamp(pointerInTrack, 0, rightFixed - minThumb());
        const newZoom = clamp(track / (rightFixed - left), axis().minZoom, axis().maxZoom);
        axis().onZoomChange?.(newZoom);
        setPositionFromThumbOffset(left, track / newZoom);
      }
    } else {
      // Not dragging: track where the cursor sits within the thumb, for the resize
      // cursor hint on the ends.
      const rect = ref.getBoundingClientRect();
      const start = props.direction === "horizontal" ? rect.left : rect.top;
      setHoverInThumb(parallelOf(event) - start);
    }
  };

  onMount(() => window.addEventListener("pointermove", handlePointerMove));
  onCleanup(() => window.removeEventListener("pointermove", handlePointerMove));

  const handlePointerDown = (event: PointerEvent) => {
    if (!ref) return;
    const rect = ref.getBoundingClientRect();
    const start = props.direction === "horizontal" ? rect.left : rect.top;
    const inThumb = parallelOf(event) - start;

    // Capture so the drag keeps tracking even if the pointer (finger/mouse) leaves
    // the thin bar — the same reason we listen on window, now touch-capable.
    ref.setPointerCapture?.(event.pointerId);
    setGrab(inThumb);
    setStartSize(size());
    setStartOffset(offset());
    setDragHandle(
      inThumb < dragHandleSize ? "start" : inThumb > size() - dragHandleSize ? "end" : "middle",
    );

    const up = () => {
      setDragHandle(undefined);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointerup", up);
  };

  const cursors: Record<string, string> = {
    "vertical-start": "n-resize",
    "vertical-end": "s-resize",
    "horizontal-start": "w-resize",
    "horizontal-end": "e-resize",
  };
  const cursor = createMemo(() => {
    if (hoverInThumb() < dragHandleSize) return cursors[`${props.direction}-start`];
    if (hoverInThumb() > size() - dragHandleSize) return cursors[`${props.direction}-end`];
    return "pointer";
  });

  // Only worth showing when there's something to scroll/zoom.
  const active = createMemo(() => axis().zoom > 1.0001);

  return (
    <div
      ref={ref}
      class="sv-scrollbar"
      data-direction={props.direction}
      style={{
        visibility: active() ? "visible" : "hidden",
        "pointer-events": active() ? "all" : "none",
        "z-index": 3,
        cursor: cursor(),
        position: "absolute",
        "border-radius": "8px",
        // Themeable from any ancestor; the default is what it always was.
        background: "var(--sv-scrollbar-thumb, #666)",
        "touch-action": "none",
        ...(props.direction === "horizontal"
          ? { bottom: 0, height: "12px", width: `${size()}px`, left: `${offset()}px` }
          : { right: 0, width: "12px", height: `${size()}px`, top: `${offset()}px` }),
      }}
      onPointerDown={handlePointerDown}
    />
  );
};

export default ScrollBar;
