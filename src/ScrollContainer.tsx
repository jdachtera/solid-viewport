import { createEffect, ParentProps, Ref } from "solid-js";
import { ViewPortAxis } from "./createViewPortAxis";
import { useAxes } from "./ViewPort";

// A synthetic scroll+zoom surface driven by ViewPort axes. Unlike `VirtualList`
// (which rides real DOM scroll), this OWNS the scroll: it sizes an inner div to
// zoom * pixelSize so the native scrollbar has room, maps scroll offset -> axis
// `position`, and maps axis position back to scrollTo(). Alt+wheel zooms the axis
// under the pointer's dominant delta. This is the model waveform/pianoroll use —
// continuous pan/zoom over a large virtual space with `isVisible` windowing inside.
//
// Pass the axis names to bind. Either may be omitted for a 1-D surface.
const ScrollContainer = (
  props: ParentProps<{
    ref?: Ref<HTMLDivElement>;
    horizontalAxis?: string;
    verticalAxis?: string;
    // When wheel scrolling zooms instead of pans. "alt" (default) = only while the
    // Alt/Option key is held (plain wheel pans natively); "always" = every wheel
    // event zooms; "never" = wheel never zooms.
    wheelZoom?: "alt" | "always" | "never";
  }>,
) => {
  let content: HTMLDivElement | undefined;
  let didUpdateScroll = false;

  // Resolve axes here, during render, where the reactive owner (and thus the
  // ViewPort context) exists. Event handlers run WITHOUT an owner, so calling
  // useAxis() inside them would read the empty default context and find nothing.
  const axes = useAxes();
  const h = (): ViewPortAxis | undefined =>
    axes.find((a) => a.name === (props.horizontalAxis ?? "horizontal"));
  const v = (): ViewPortAxis | undefined =>
    axes.find((a) => a.name === (props.verticalAxis ?? "vertical"));

  const handleScroll = (event: { currentTarget: HTMLDivElement }) => {
    if (didUpdateScroll) {
      didUpdateScroll = false;
      return;
    }
    const { scrollTop, scrollLeft, scrollWidth, scrollHeight } = event.currentTarget;
    const vv = v();
    const hv = h();
    if (vv) {
      const denom = scrollHeight - vv.pixelSize;
      if (denom > 0) vv.onPositionChange?.(vv.maxPosition() * (scrollTop / denom));
    }
    if (hv) {
      const denom = scrollWidth - hv.pixelSize;
      if (denom > 0) hv.onPositionChange?.(hv.maxPosition() * (scrollLeft / denom));
    }
  };

  const handleWheel = (event: WheelEvent) => {
    const mode = props.wheelZoom ?? "alt";
    if (mode === "never") return;
    if (mode === "alt" && !event.altKey) return; // plain wheel = scroll (native)
    const hv = h();
    const vv = v();
    // Zoom the axis matching the dominant delta direction, but fall back to
    // whichever axis exists (a 1-D surface has only one, and a mouse wheel emits
    // deltaY even when the sole axis is horizontal).
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const axis = (horizontal ? hv : vv) ?? hv ?? vv;
    if (!axis) return;
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    axis.onZoomChange?.(axis.zoom * (1 + delta / axis.pixelSize));
    axis.onPositionChange?.(Math.min(axis.maxPosition(), axis.position));
  };

  // Push axis position/zoom back into the native scroll offset + content size.
  createEffect(() => {
    if (!content?.parentElement) return;
    const vv = v();
    const hv = h();

    // An axis that's present sizes its dimension to zoom * pixelSize (the scroll
    // range). An absent axis fills the viewport (100%) so 1-D use doesn't collapse.
    const scrollDivHeight = vv ? vv.zoom * vv.pixelSize : undefined;
    const scrollDivWidth = hv ? hv.zoom * hv.pixelSize : undefined;
    content.style.height = scrollDivHeight != null ? `${scrollDivHeight}px` : "100%";
    content.style.width = scrollDivWidth != null ? `${scrollDivWidth}px` : "100%";

    let scrollTop: number | undefined;
    let scrollLeft: number | undefined;
    if (vv && typeof scrollDivHeight === "number") {
      const max = vv.maxPosition();
      scrollTop = (max > 0 ? vv.position / max : 0) * (scrollDivHeight - vv.pixelSize);
    }
    if (hv && typeof scrollDivWidth === "number") {
      const max = hv.maxPosition();
      scrollLeft = (max > 0 ? hv.position / max : 0) * (scrollDivWidth - hv.pixelSize);
    }

    didUpdateScroll = true;
    content.parentElement.scrollTo({
      top: scrollTop ?? content.parentElement.scrollTop,
      left: scrollLeft ?? content.parentElement.scrollLeft,
    });
  });

  const vw = () => v()?.pixelSize;
  const hw = () => h()?.pixelSize;

  return (
    <div
      ref={props.ref}
      style={{
        height: "100%",
        width: "100%",
        overflow: "scroll",
        "pointer-events": "auto",
      }}
      onScroll={handleScroll}
      onWheel={handleWheel}
    >
      <div ref={content} style={{ height: "100%", width: "100%" }}>
        {/* Sticky inner box keeps the content pinned to the viewport while the outer
            div provides the scroll range. An absent axis fills the viewport. */}
        <div
          style={{
            top: 0,
            left: 0,
            height: vw() != null ? `${vw()}px` : "100%",
            width: hw() != null ? `${hw()}px` : "100%",
            position: "sticky",
            overflow: "hidden",
          }}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
};

export default ScrollContainer;
