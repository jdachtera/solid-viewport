import { createEffect, ParentProps, Ref } from "solid-js";
import { ViewPortAxis } from "./createViewPortAxis";
import { useAxis } from "./ViewPort";

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
  }>,
) => {
  let content: HTMLDivElement | undefined;
  let didUpdateScroll = false;

  const h = (): ViewPortAxis | undefined => {
    try {
      return useAxis(props.horizontalAxis ?? "horizontal");
    } catch {
      return undefined;
    }
  };
  const v = (): ViewPortAxis | undefined => {
    try {
      return useAxis(props.verticalAxis ?? "vertical");
    } catch {
      return undefined;
    }
  };

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
    if (!event.altKey) return; // plain wheel = scroll (native); alt = zoom
    event.preventDefault();
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const axis = horizontal ? h() : v();
    if (!axis) return;
    const delta = horizontal ? event.deltaX : event.deltaY;
    axis.onZoomChange?.(axis.zoom * (1 + delta / axis.pixelSize));
    axis.onPositionChange?.(Math.min(axis.maxPosition(), axis.position));
  };

  // Push axis position/zoom back into the native scroll offset + content size.
  createEffect(() => {
    if (!content?.parentElement) return;
    const vv = v();
    const hv = h();

    const scrollDivHeight = vv ? vv.zoom * vv.pixelSize : vv;
    const scrollDivWidth = hv ? hv.zoom * hv.pixelSize : hv;
    if (typeof scrollDivHeight === "number") content.style.height = `${scrollDivHeight}px`;
    if (typeof scrollDivWidth === "number") content.style.width = `${scrollDivWidth}px`;

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
      <div ref={content}>
        {/* Sticky inner box keeps the content pinned to the viewport while the outer
            div provides the scroll range. */}
        <div
          style={{
            top: 0,
            left: 0,
            ...(vw() != null ? { height: `${vw()}px` } : {}),
            ...(hw() != null ? { width: `${hw()}px` } : {}),
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
