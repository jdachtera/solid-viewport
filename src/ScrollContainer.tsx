import { batch, createEffect, JSX, onCleanup, ParentProps, Ref } from "solid-js";
import { clamp, ViewPortAxis } from "./createViewPortAxis";
import { useAxes } from "./ViewPort";

// Wheel-zoom feel. Normalize delta to px (wheel events come in px/line/page), clamp
// per event so a single big flick or trackpad-momentum burst can't jump zoom, then
// apply it as an exponential factor (zoom is multiplicative, so equal ticks feel
// equal at any zoom level). Scroll up zooms in.
const WHEEL_LINE_PX = 16;
const WHEEL_MAX_PX = 120;
const WHEEL_ZOOM_K = 0.0015;
// A trackpad pinch arrives as a ctrl+wheel with small pixel deltas (a few px per
// event, where a mouse notch is ~100), so at the wheel rate it would barely zoom.
const PINCH_ZOOM_K = 0.01;

// Browsers stop laying out elements somewhere past ~17M px (Firefox) to ~33M px
// (Chrome), and a deep zoom of a long axis (a waveform at sample level) asks for
// far more. The scroll spacer is capped below that; scrolling stays proportional.
const DEFAULT_MAX_SCROLL_SIZE = 10_000_000;

// Below this the fingers are close enough that the spread ratio is mostly noise, and
// a touch pinch that starts there would jump the zoom by a wild factor.
const MIN_PINCH_SPREAD_PX = 20;

// What a wheel event should do. `axis` optionally pins the action to a named axis
// (otherwise inferred from the dominant delta, falling back to whichever axis
// exists). `from` picks which delta component drives it: "dominant" (default), the
// horizontal "x", or the vertical "y" — so one event can zoom on Y while panning on
// X (return several actions).
export type WheelAction = {
  type: "zoom" | "scroll" | "none";
  axis?: string;
  from?: "x" | "y" | "dominant";
};
// A preset name or a resolver that decides per event (e.g. modifier-based). A
// resolver may return several actions to apply at once.
export type WheelBehavior =
  | "alt-zoom" // default: Alt/Option zooms the dominant axis; ctrl (trackpad pinch) zooms all; else scrolls
  | "zoom" // always zoom (dominant delta)
  | "scroll" // always scroll
  | "zoom-pan" // deltaY zooms + deltaX pans, same axis, no modifier (waveform/pianoroll)
  | "none" // ignore the wheel
  | ((event: WheelEvent) => WheelAction | WheelAction[]);

// Preset -> actions. Presets that reference "the horizontal axis" get its resolved
// name so a zoom-pan surface pins both actions to it.
function presetActions(
  behavior: Exclude<WheelBehavior, Function>,
  event: WheelEvent,
  hName: string,
  vName: string,
  pinchAxes: PinchAxes,
): WheelAction[] {
  switch (behavior) {
    case "zoom":
      return [{ type: "zoom" }];
    case "scroll":
      return [{ type: "scroll" }];
    case "none":
      return [];
    case "zoom-pan":
      return [
        { type: "zoom", axis: hName, from: "y" },
        { type: "scroll", axis: hName, from: "x" },
      ];
    case "alt-zoom":
    default:
      // Chrome, Edge and Firefox deliver a trackpad pinch as a ctrl+wheel carrying
      // one scalar (deltaY), not a spread per axis, so it zooms every bound axis
      // together. An axis the surface doesn't have is skipped.
      if (event.ctrlKey) {
        const zooms: WheelAction[] = [];
        if (pinchAxes.horizontal) zooms.push({ type: "zoom", axis: hName, from: "y" });
        if (pinchAxes.vertical) zooms.push({ type: "zoom", axis: vName, from: "y" });
        return zooms.length ? zooms : [{ type: "zoom" }];
      }
      return event.altKey ? [{ type: "zoom" }] : [{ type: "scroll" }];
  }
}

// Which axes a pinch (touch or trackpad) zooms.
export type PinchAxes = { horizontal: boolean; vertical: boolean };
export type Pinch = boolean | "both" | "horizontal" | "vertical";
const pinchAxesOf = (pinch: Pinch | undefined): PinchAxes =>
  pinch === "horizontal"
    ? { horizontal: true, vertical: false }
    : pinch === "vertical"
    ? { horizontal: false, vertical: true }
    : pinch === false
    ? { horizontal: false, vertical: false }
    : { horizontal: true, vertical: true };

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
// under the pointer's dominant delta, a trackpad pinch zooms every axis, and a touch
// pinch zooms each axis by the finger spread along it. This is the model
// waveform/pianoroll use — continuous pan/zoom over a large virtual space with
// `isVisible` windowing inside.
//
// Pass the axis names to bind. Either may be omitted for a 1-D surface.
//
// Pointer anchoring (wheel zoom, pinch) is worked out from this container's own
// box, so it holds whatever coordinate space the axis's `pixelOffset` is in — the
// container's (0) or the screen's (an element's client rect).
const ScrollContainer = (
  props: ParentProps<{
    ref?: Ref<HTMLDivElement>;
    class?: string;
    style?: JSX.CSSProperties;
    horizontalAxis?: string;
    verticalAxis?: string;
    // How the wheel behaves. A preset ("alt-zoom" default | "zoom" | "scroll" |
    // "none") or a resolver `(event) => { type, axis? }` for full control (e.g.
    // shift for horizontal, a modifier for zoom). See WheelBehavior.
    wheel?: WheelBehavior;
    // Wheel-zoom feel. sensitivity scales the zoom rate (1 = default); invertZoom
    // flips the direction (default: scroll up zooms in).
    zoomSensitivity?: number;
    invertZoom?: boolean;
    // When a wheel event pans an axis the browser can natively scroll, let it (for
    // trackpad momentum) instead of applying the pan manually. Default true. Manual
    // pan is always used for the 1-D case a native scroll can't reach (e.g. a
    // vertical wheel over a horizontal-only axis).
    momentum?: boolean;
    // Which axes a pinch zooms: a two-finger touch pinch (each axis by the spread
    // along it, the content under the fingers following them) and, in "alt-zoom",
    // a trackpad pinch. true / "both" (default), "horizontal", "vertical", or false
    // (touch pinch off; a trackpad pinch then zooms the dominant axis).
    pinch?: Pinch;
    // Show the browser's own scrollbars instead of hiding them for <ScrollBar>.
    // Default false.
    nativeScrollbars?: boolean;
    // Pixels of fixed content at the top of the visible box, above the vertical
    // axis's own area — e.g. a time ruler over a piano roll's notes. The visible box
    // is the axis's pixelSize plus this; the axis maps only its own part.
    verticalInset?: number;
    // Cap on the scroll spacer's size per axis, in px (default 10,000,000). Beyond
    // it the native scrollbar maps proportionally onto a larger range per px.
    maxScrollSize?: number;
  }>,
) => {
  let content: HTMLDivElement | undefined;
  let didUpdateScroll = false;
  ensureScrollbarHidden();

  const inset = () => props.verticalInset ?? 0;

  // Resolve axes here, during render, where the reactive owner (and thus the
  // ViewPort context) exists. Event handlers run WITHOUT an owner, so calling
  // useAxis() inside them would read the empty default context and find nothing.
  const axes = useAxes();
  const hName = () => props.horizontalAxis ?? "horizontal";
  const vName = () => props.verticalAxis ?? "vertical";
  const h = (): ViewPortAxis | undefined => axes.find((a) => a.name === hName());
  const v = (): ViewPortAxis | undefined => axes.find((a) => a.name === vName());

  // How far each axis scrolls, in px: exactly what the effect below lays out, so a
  // scroll and the position it was set from agree. Measured from the DOM instead,
  // it would also count the inset (and any gutter), and scrolling to the end would
  // never reach the axis's last values.
  const scrollSize = (axis: ViewPortAxis) =>
    Math.max(
      axis.pixelSize,
      Math.min(axis.zoom * axis.pixelSize, props.maxScrollSize ?? DEFAULT_MAX_SCROLL_SIZE),
    );
  const scrollRange = (axis: ViewPortAxis) => scrollSize(axis) - axis.pixelSize;

  const handleScroll = (event: { currentTarget: HTMLDivElement }) => {
    if (didUpdateScroll) {
      didUpdateScroll = false;
      return;
    }
    const { scrollTop, scrollLeft } = event.currentTarget;
    const vv = v();
    const hv = h();
    if (vv) {
      const denom = scrollRange(vv);
      if (denom > 0) vv.onPositionChange?.(vv.maxPosition() * (scrollTop / denom));
    }
    if (hv) {
      const denom = scrollRange(hv);
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

  // A screen coordinate as a fraction of the axis's visible area (0 = its start
  // edge, 1 = its end), measured against this container's box.
  const fractionAt = (axis: ViewPortAxis, pointerScreen: number, rect: DOMRect) => {
    const start = axis === h() ? rect.left : rect.top + inset();
    return (pointerScreen - start) / axis.pixelSize;
  };

  // Zoom one axis to `newZoom` and put the value `anchor` at `fraction` of the visible
  // area. With anchor = the value under the pointer now, the pointer stays put; with
  // the value from the start of a gesture, the same call also pans.
  const zoomAnchored = (axis: ViewPortAxis, newZoom: number, fraction: number, anchor: number) => {
    if (!Number.isFinite(newZoom) || newZoom <= 0) return;
    // Clamped here rather than left to the axis: the position below is worked out
    // from this zoom, so a zoom the axis then refused would leave the anchor drifting.
    const zoom = clamp(newZoom, axis.minZoom, axis.maxZoom);
    // One update for both, or the content renders at the new zoom and the old
    // position before rendering again at the new position.
    batch(() => {
      axis.onZoomChange?.(zoom);
      axis.onPositionChange?.(anchor - fraction * (axis.range / zoom));
    });
  };

  // Wheel zoom on one axis, anchored on the pointer: the value under the cursor stays
  // under the cursor.
  const zoomAxis = (
    axis: ViewPortAxis,
    deltaPx: number,
    pointerScreen: number,
    rect: DOMRect,
    k: number,
  ) => {
    const d = clamp(deltaPx, -WHEEL_MAX_PX, WHEEL_MAX_PX);
    const fraction = fractionAt(axis, pointerScreen, rect);
    const anchor = axis.position + fraction * axis.visibleRange();
    const sens = props.zoomSensitivity && props.zoomSensitivity > 0 ? props.zoomSensitivity : 1;
    const dir = props.invertZoom ? 1 : -1;
    zoomAnchored(axis, axis.zoom * Math.exp(dir * d * k * sens), fraction, anchor);
  };

  // The container's box, read at most once per gesture. Reading it on every wheel
  // event forced a synchronous layout of everything the previous event had just
  // moved, which with many children is most of what a zoom step costs. A pause
  // between events starts a new gesture, which picks up any page scroll since.
  let cachedRect: DOMRect | undefined;
  let lastWheelAt = 0;
  const containerRect = (element: HTMLElement) => {
    const now = performance.now();
    if (!cachedRect || now - lastWheelAt > 150) cachedRect = element.getBoundingClientRect();
    lastWheelAt = now;
    return cachedRect;
  };

  const handleWheel = (event: WheelEvent) => {
    const behavior = props.wheel ?? "alt-zoom";
    const actions =
      typeof behavior === "function"
        ? ([] as WheelAction[]).concat(behavior(event))
        : presetActions(behavior, event, hName(), vName(), pinchAxesOf(props.pinch));
    if (!actions.length) return;

    const hv = h();
    const vv = v();
    const byName = (name?: string) => axes.find((a) => a.name === name);
    const dominantH = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const dxPx = wheelPx(event.deltaX, event.deltaMode, hv?.pixelSize ?? vv?.pixelSize ?? 1);
    const dyPx = wheelPx(event.deltaY, event.deltaMode, vv?.pixelSize ?? hv?.pixelSize ?? 1);
    const dominantPx = Math.abs(dxPx) > Math.abs(dyPx) ? dxPx : dyPx;
    // The delta component an action reads.
    const deltaFor = (from?: "x" | "y" | "dominant") =>
      from === "x" ? dxPx : from === "y" ? dyPx : dominantPx;
    const pinching = event.ctrlKey && event.deltaMode === 0;

    let prevented = false;
    const prevent = () => {
      if (!prevented) {
        event.preventDefault();
        prevented = true;
      }
    };

    // Zooms on several axes (a trackpad pinch) are independent, so they apply as
    // one update. Anything else runs in order: a zoom-pan's pan reads the position
    // its zoom just set, which a batch would hold back until the end.
    const applyAll = actions.every(({ type }) => type === "zoom")
      ? batch
      : (fn: () => void) => fn();
    applyAll(() => {
      for (const action of actions) {
        if (action.type === "none") continue;
        const delta = deltaFor(action.from);
        if (!delta) continue; // this component didn't move

        // Target axis: explicit name, else the dominant-delta axis, falling back to
        // whichever exists (1-D surfaces, or a wheel that only emits deltaY over a
        // horizontal-only axis).
        const axis = action.axis ? byName(action.axis) : (dominantH ? hv : vv) ?? hv ?? vv;
        if (!axis) continue;

        if (action.type === "zoom") {
          prevent();
          const rect = containerRect(event.currentTarget as HTMLElement);
          // Pointer coord is chosen by axis ORIENTATION, not delta direction: a
          // horizontal axis anchors on clientX even for a vertical wheel.
          const isH = axis === hv;
          zoomAxis(
            axis,
            delta,
            isH ? event.clientX : event.clientY,
            rect,
            pinching ? PINCH_ZOOM_K : WHEEL_ZOOM_K,
          );
        } else {
          // Scroll. If the browser can natively scroll this (no explicit axis, a delta
          // the axis orientation matches) and momentum is on, let native handle it for
          // trackpad inertia — handleScroll syncs position. Otherwise pan manually.
          const momentum = props.momentum ?? true;
          const nativeCanScroll =
            !action.axis && ((!!event.deltaY && !!vv) || (!!event.deltaX && !!hv));
          if (momentum && nativeCanScroll && actions.length === 1) continue; // native + sync
          if (scrollAxis(axis, delta)) prevent();
        }
      }
    });
  };

  /* Touch pinch.
   *
   * Identified by arity: one finger is a pan, which native scrolling already does
   * well; two are a pinch. Each axis zooms by the finger spread along it, so a
   * sideways pinch asks for more of the horizontal axis and a vertical one for more
   * of the vertical — two unrelated axes (time and pitch) shouldn't share one
   * distance. Zoom is computed against the spread at the START of the gesture so a
   * slow pinch can't accumulate drift, and the values under the starting midpoint
   * stay under the moving midpoint, which is what makes a two-finger drag pan.
   *
   * Pointer ends are heard on the window, not this element: a finger lifted
   * elsewhere (or released from capture by a child) would otherwise leave a stale
   * entry, and the next single touch would count as the second finger of a pinch. */
  const activePointers = new Map<number, { x: number; y: number }>();
  type AxisPinch = { axis: ViewPortAxis; spread: number; zoom: number; anchor: number };
  let pinchStart: { h?: AxisPinch; v?: AxisPinch } | undefined;

  const pointerSpread = () => {
    const [first, second] = [...activePointers.values()];
    if (!first || !second) return undefined;
    return {
      x: Math.abs(first.x - second.x),
      y: Math.abs(first.y - second.y),
      midX: (first.x + second.x) / 2,
      midY: (first.y + second.y) / 2,
    };
  };

  let rectAtPinch = { left: 0, top: 0 } as DOMRect;
  let pinchEnabled: PinchAxes = { horizontal: true, vertical: true };

  const beginPinch = (element: HTMLElement) => {
    const spread = pointerSpread();
    if (!spread) return;
    rectAtPinch = element.getBoundingClientRect();
    const start = (axis: ViewPortAxis | undefined, along: number, mid: number) =>
      axis && {
        axis,
        spread: Math.max(along, MIN_PINCH_SPREAD_PX),
        zoom: axis.zoom,
        anchor: axis.position + fractionAt(axis, mid, rectAtPinch) * axis.visibleRange(),
      };
    pinchStart = {
      h: pinchEnabled.horizontal ? start(h(), spread.x, spread.midX) : undefined,
      v: pinchEnabled.vertical ? start(v(), spread.y, spread.midY) : undefined,
    };
  };

  const endPointer = (event: PointerEvent) => {
    activePointers.delete(event.pointerId);
    // Lifting one finger of two ends the pinch rather than re-baselining it, so the
    // remaining finger goes back to panning instead of dragging the zoom.
    if (activePointers.size < 2) pinchStart = undefined;
    if (activePointers.size === 0) {
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
    }
  };

  const handlePointerDown = (event: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (event.pointerType === "mouse" || props.pinch === false) return;
    const axesOn = pinchAxesOf(props.pinch);
    pinchEnabled = axesOn;
    if (activePointers.size === 0) {
      window.addEventListener("pointerup", endPointer);
      window.addEventListener("pointercancel", endPointer);
    }
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 2) beginPinch(event.currentTarget);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size !== 2 || !pinchStart) return;

    const spread = pointerSpread();
    if (!spread) return;
    event.preventDefault();

    const apply = (pinch: AxisPinch | undefined, along: number, mid: number) => {
      if (!pinch) return;
      zoomAnchored(
        pinch.axis,
        (pinch.zoom * Math.max(along, MIN_PINCH_SPREAD_PX)) / pinch.spread,
        fractionAt(pinch.axis, mid, rectAtPinch),
        pinch.anchor,
      );
    };
    const { h: hPinch, v: vPinch } = pinchStart;
    batch(() => {
      apply(hPinch, spread.x, spread.midX);
      apply(vPinch, spread.y, spread.midY);
    });
  };

  onCleanup(() => {
    window.removeEventListener("pointerup", endPointer);
    window.removeEventListener("pointercancel", endPointer);
  });

  // Push axis position/zoom back into the native scroll offset + content size.
  createEffect(() => {
    if (!content?.parentElement) return;
    const vv = v();
    const hv = h();

    // An axis that's present sizes its dimension to zoom * pixelSize (the scroll
    // range), plus any fixed inset. An absent axis fills the viewport (100%) so 1-D
    // use doesn't collapse.
    const scrollDivHeight = vv ? scrollSize(vv) + inset() : undefined;
    const scrollDivWidth = hv ? scrollSize(hv) : undefined;
    content.style.height = scrollDivHeight != null ? `${scrollDivHeight}px` : "100%";
    content.style.width = scrollDivWidth != null ? `${scrollDivWidth}px` : "100%";

    let scrollTop: number | undefined;
    let scrollLeft: number | undefined;
    if (vv) {
      const max = vv.maxPosition();
      scrollTop = (max > 0 ? vv.position / max : 0) * scrollRange(vv);
    }
    if (hv) {
      const max = hv.maxPosition();
      scrollLeft = (max > 0 ? hv.position / max : 0) * scrollRange(hv);
    }

    didUpdateScroll = true;
    content.parentElement.scrollTo({
      top: scrollTop ?? content.parentElement.scrollTop,
      left: scrollLeft ?? content.parentElement.scrollLeft,
    });
  });

  const vh = () => {
    const size = v()?.pixelSize;
    return size != null ? size + inset() : undefined;
  };
  const hw = () => h()?.pixelSize;

  return (
    <div
      ref={props.ref}
      class={[props.nativeScrollbars ? "" : SCROLL_CLASS, props.class ?? ""]
        .filter(Boolean)
        .join(" ")}
      style={{
        height: "100%",
        width: "100%",
        overflow: "scroll",
        "pointer-events": "auto",
        // One finger still scrolls natively; two are the pinch above, not the
        // browser's page zoom.
        "touch-action": "pan-x pan-y",
        ...props.style,
      }}
      onScroll={handleScroll}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    >
      <div ref={content} style={{ height: "100%", width: "100%" }}>
        {/* Sticky inner box keeps the content pinned to the viewport while the outer
            div provides the scroll range. An absent axis fills the viewport. */}
        <div
          style={{
            top: 0,
            left: 0,
            height: vh() != null ? `${vh()}px` : "100%",
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
