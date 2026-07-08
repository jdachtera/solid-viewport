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

  const [parallelOffset, setParallelOffset] = createSignal<number>(Infinity);
  const [startSize, setStartSize] = createSignal(0);
  const [startOffset, setStartOffset] = createSignal(0);
  const [dragHandle, setDragHandle] = createSignal<"start" | "middle" | "end">();

  const parallelOf = (e: { clientX: number; clientY: number }) =>
    props.direction === "horizontal" ? e.clientX : e.clientY;

  const handleMouseMove = (event: MouseEvent) => {
    if (!ref) return;
    const parallel = parallelOf(event);

    if (dragHandle()) {
      event.preventDefault();
      event.stopPropagation();
      const relative = parallel - parallelOffset() - axis().pixelOffset;

      if (dragHandle() === "middle") {
        const track = axis().pixelSize - size();
        const amount = clamp(track > 0 ? relative / track : 0, 0, 1);
        axis().onPositionChange?.(amount * axis().maxPosition());
      } else {
        const diff =
          dragHandle() === "start" ? startOffset() - relative : relative - startOffset();
        const newSize = Math.max(minThumb(), startSize() + diff);
        const newOffset = dragHandle() === "start" ? relative : startOffset();
        const newZoom = axis().pixelSize / newSize;
        const track = axis().pixelSize - newSize;
        const newPosition = (track > 0 ? newOffset / track : 0) * axis().maxPosition();
        axis().onZoomChange?.(clamp(newZoom, 1, axis().pixelSize / minThumb()));
        axis().onPositionChange?.(clamp(newPosition, 0, axis().maxPosition()));
      }
    } else if (ref) {
      setStartSize(size());
      setStartOffset(offset());
      const rect = ref.getBoundingClientRect();
      const pr = props.direction === "horizontal" ? rect.left : rect.top;
      setParallelOffset(parallel - pr);
    }
  };

  onMount(() => window.addEventListener("mousemove", handleMouseMove));
  onCleanup(() => window.removeEventListener("mousemove", handleMouseMove));

  const handleMouseDown = (event: MouseEvent) => {
    if (!ref) return;
    const rect = ref.getBoundingClientRect();
    const pr = props.direction === "horizontal" ? rect.left : rect.top;
    setParallelOffset(parallelOf(event) - pr);

    setDragHandle(
      parallelOffset() < dragHandleSize
        ? "start"
        : parallelOffset() > size() - dragHandleSize
          ? "end"
          : "middle",
    );

    const up = () => {
      setDragHandle(undefined);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mouseup", up);
  };

  const cursors: Record<string, string> = {
    "vertical-start": "n-resize",
    "vertical-end": "s-resize",
    "horizontal-start": "w-resize",
    "horizontal-end": "e-resize",
  };
  const cursor = createMemo(() => {
    if (parallelOffset() < dragHandleSize) return cursors[`${props.direction}-start`];
    if (parallelOffset() > size() - dragHandleSize) return cursors[`${props.direction}-end`];
    return "pointer";
  });

  // Only worth showing when there's something to scroll/zoom.
  const active = createMemo(() => axis().zoom > 1.0001);

  return (
    <div
      ref={ref}
      style={{
        visibility: active() ? "visible" : "hidden",
        "pointer-events": active() ? "all" : "none",
        "z-index": 3,
        cursor: cursor(),
        position: "absolute",
        "border-radius": "8px",
        background: "#666",
        ...(props.direction === "horizontal"
          ? { bottom: 0, height: "12px", width: `${size()}px`, left: `${offset()}px` }
          : { right: 0, width: "12px", height: `${size()}px`, top: `${offset()}px` }),
      }}
      onMouseDown={handleMouseDown}
    />
  );
};

export default ScrollBar;
