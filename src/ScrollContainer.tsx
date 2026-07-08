import { createEffect, ParentProps, Ref } from "solid-js";
import { clamp, ViewPortAxis } from "./createViewPortAxis";
import { useAxes } from "./ViewPort";

// Wheel-zoom feel. Normalize delta to px (wheel events come in px/line/page), clamp
// per event so a single big flick or trackpad-momentum burst can't jump zoom, then
// apply it as an exponential factor (zoom is multiplicative, so equal ticks feel
// equal at any zoom level). Scroll up zooms in.
const WHEEL_LINE_PX = 16;
const WHEEL_MAX_PX = 120;
const WHEEL_ZOOM_K = 0.0015;

// What a wheel event should do. `axis` optionally pins the action to a named axis;
// otherwise it's inferred from the dominant delta (falling back to whichever axis
// exists, so a 1-D surface responds to a plain mouse wheel).
export type WheelAction = { type: "zoom" | "scroll" | "none"; axis?: string };
// A preset name or a resolver that decides per event (e.g. modifier-based).
export type WheelBehavior =
  | "alt-zoom" // default: Alt/Option — or ctrl (Mac trackpad pinch) — zooms; else scrolls
  | "zoom" // always zoom
  | "scroll" // always scroll
  | "none" // ignore the wheel
  | ((event: WheelEvent) => WheelAction);

function resolveWheel(behavior: WheelBehavior | undefined, event: WheelEvent): WheelAction {
  if (typeof behavior === "function") return behavior(event);
  switch (behavior) {
    case "zoom":
      return { type: "zoom" };
    case "scroll":
      return { type: "scroll" };
    case "none":
      return { type: "none" };
    case "alt-zoom":
    default:
      return event.altKey || event.ctrlKey ? { type: "zoom" } : { type: "scroll" };
  }
}

// Wheel delta -> px, normalizing the three deltaModes (pixel/line/page).
function wheelPx(delta: number, deltaMode: number, pageSize: number) {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX; // lines
  if (deltaMode === 2) return delta * pageSize; // pages
  return delta; // pixels
}

// The container scrolls natively (for trackpad/momentum panning) but the visible
// scroll control is the custom <ScrollBar>. Hide the native scrollbar chrome so the
// two don't overlap and so `overflow: scroll` doesn't reserve gutter space that
// would make the viewport narrower than the axis pixelSize.
const SCROLL_CLASS = "sv-scroll-container";
let styleInjected = false;
function ensureScrollbarHidden() {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent =
    `.${SCROLL_CLASS}{scrollbar-width:none;-ms-overflow-style:none;}` +
    `.${SCROLL_CLASS}::-webkit-scrollbar{width:0;height:0;display:none;}`;
  document.head.appendChild(style);
}

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
    // How the wheel behaves. A preset ("alt-zoom" default | "zoom" | "scroll" |
    // "none") or a resolver `(event) => { type, axis? }` for full control (e.g.
    // shift for horizontal, a modifier for zoom). See WheelBehavior.
    wheel?: WheelBehavior;
  }>,
) => {
  let content: HTMLDivElement | undefined;
  let didUpdateScroll = false;
  ensureScrollbarHidden();

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

  // Scroll one axis by a pixel delta, in that axis's value units.
  const scrollAxis = (axis: ViewPortAxis, deltaPx: number) => {
    if (!deltaPx) return false;
    const perPx = axis.visibleRange() / axis.pixelSize;
    axis.onPositionChange?.(axis.position + deltaPx * perPx);
    return true;
  };

  // Zoom one axis, anchored on the pointer: the value under the cursor stays under
  // the cursor. Read it before zooming, then choose the position that restores it at
  // the new zoom.
  const zoomAxis = (axis: ViewPortAxis, deltaPx: number, pointerScreen: number, isH: boolean) => {
    const d = clamp(deltaPx, -WHEEL_MAX_PX, WHEEL_MAX_PX);
    const rect = zoomRect;
    const pointerPx = pointerScreen - (isH ? rect.left : rect.top);
    const valueAtPointer = axis.toPosition(pointerPx);
    const newZoom = clamp(axis.zoom * Math.exp(-d * WHEEL_ZOOM_K), axis.minZoom, axis.maxZoom);
    const newVisibleRange = axis.range / newZoom;
    axis.onZoomChange?.(newZoom);
    axis.onPositionChange?.(
      valueAtPointer - ((pointerPx - axis.pixelOffset) / axis.pixelSize) * newVisibleRange,
    );
  };

  let zoomRect = { left: 0, top: 0 } as DOMRect;

  const handleWheel = (event: WheelEvent) => {
    const action = resolveWheel(props.wheel, event);
    if (action.type === "none") return;

    const hv = h();
    const vv = v();
    const byName = (name?: string) => axes.find((a) => a.name === name);
    // The axis this event targets: an explicit name, else the dominant-delta axis,
    // falling back to whichever axis exists (1-D surfaces, or a mouse wheel that
    // only emits deltaY over a horizontal-only axis).
    const dominantH = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const primary = action.axis
      ? byName(action.axis)
      : (dominantH ? hv : vv) ?? hv ?? vv;
    if (!primary) return;

    const dxPx = wheelPx(event.deltaX, event.deltaMode, hv?.pixelSize ?? primary.pixelSize);
    const dyPx = wheelPx(event.deltaY, event.deltaMode, vv?.pixelSize ?? primary.pixelSize);
    const dominantPx = Math.abs(dxPx) > Math.abs(dyPx) ? dxPx : dyPx;

    if (action.type === "zoom") {
      event.preventDefault();
      zoomRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      // Pointer coordinate is chosen by the axis ORIENTATION, not by which delta
      // dominated: a horizontal axis anchors on clientX even for a vertical wheel.
      const isH = primary === hv;
      zoomAxis(primary, dominantPx, isH ? event.clientX : event.clientY, isH);
      return;
    }

    // Scroll. Map each delta to its natural axis; if neither mapped (1-D routed the
    // wrong way, e.g. deltaY over a horizontal axis), push the dominant delta to the
    // primary axis. preventDefault only when we actually moved something.
    let moved = false;
    if (action.axis) {
      moved = scrollAxis(primary, dominantPx);
    } else {
      if (vv) moved = scrollAxis(vv, dyPx) || moved;
      if (hv) moved = scrollAxis(hv, dxPx) || moved;
      if (!moved) moved = scrollAxis(primary, dominantPx);
    }
    if (moved) event.preventDefault();
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
      class={SCROLL_CLASS}
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
