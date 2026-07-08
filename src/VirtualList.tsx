import {
  createMemo,
  createSignal,
  For,
  JSX,
  onCleanup,
  onMount,
  Show,
  type Accessor,
} from "solid-js";
import { prefixSums, windowRange } from "./windowing";

// Nearest scrollable ancestor along `axis`, or null (page scroll).
function findScrollParent(el: HTMLElement, axis: "vertical" | "horizontal"): HTMLElement | null {
  const prop = axis === "vertical" ? "overflowY" : "overflowX";
  let p = el.parentElement;
  while (p) {
    const o = getComputedStyle(p)[prop];
    if (o === "auto" || o === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

export type VirtualListProps<T> = {
  items: T[];
  // Extent of an item along the scroll axis, in px (height if vertical, width if
  // horizontal). Constant or per-item.
  itemSize: number | ((item: T, index: number) => number);
  // Scroll direction. Default "vertical".
  axis?: "vertical" | "horizontal";
  // Extra rows rendered beyond each edge, to hide pop-in while scrolling. Default 4.
  overscan?: number;
  class?: string;
  style?: JSX.CSSProperties;
  // Rendered for an in-view item. `index` is reactive (a row that stays mounted while
  // the window shifts sees its index update without remounting).
  children: (item: T, index: Accessor<number>) => JSX.Element;
  // Optional: render a placeholder for an item that isn't ready yet. Combine with
  // `ready` for async/deferred loading — off-screen items are never asked to load,
  // and a not-yet-ready visible item shows this until it resolves.
  ready?: (item: T, index: number) => boolean;
  fallback?: (item: T, index: Accessor<number>) => JSX.Element;
};

// A virtual list that does NOT own its scroll. It renders a full-size spacer with
// only the in-view items (+ overscan) absolutely positioned inside, and reads the
// scroll position from its nearest scrollable ancestor (or the page). So it drops
// into any existing scroll container without hijacking its styling or handlers, and
// works horizontally or vertically. Items are keyed by identity, so a row that stays
// in view keeps its DOM (and in-row state) as the window slides past it.
export function VirtualList<T>(props: VirtualListProps<T>) {
  let root: HTMLDivElement | undefined;
  let scrollParent: HTMLElement | null = null;
  const axis = () => props.axis ?? "vertical";
  const [tick, setTick] = createSignal(0); // bump on scroll/resize to recompute

  const sizeOf = (item: T, i: number) =>
    typeof props.itemSize === "function" ? props.itemSize(item, i) : props.itemSize;

  const offsets = createMemo(() =>
    prefixSums(props.items.length, (i) => sizeOf(props.items[i], i)),
  );
  const total = () => {
    const o = offsets();
    return o[o.length - 1] || 0;
  };

  const range = createMemo(() => {
    tick(); // recompute on scroll/resize
    const o = offsets();
    const over = props.overscan ?? 4;
    if (!root) return { start: 0, end: Math.min(props.items.length, over * 2) };

    const rr = root.getBoundingClientRect();
    const horiz = axis() === "horizontal";
    const pv = scrollParent
      ? scrollParent.getBoundingClientRect()
      : ({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight } as DOMRect);

    // How far the list's start edge sits above/left of the viewport start edge.
    const scrolled = horiz ? pv.left - rr.left : pv.top - rr.top;
    const viewport = (horiz ? pv.width : pv.height) || 1;
    return windowRange(o, scrolled, viewport, over);
  });

  const windowItems = createMemo(() => props.items.slice(range().start, range().end));

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      setTick((t) => t + 1);
    });
  };
  onMount(() => {
    if (!root) return;
    scrollParent = findScrollParent(root, axis());
    const target: HTMLElement | Window = scrollParent ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    if (scrollParent) ro.observe(scrollParent);
    ro.observe(root);
    setTick((t) => t + 1); // initial measure
    onCleanup(() => {
      target.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    });
  });

  const horiz = () => axis() === "horizontal";

  return (
    <div
      ref={root}
      class={props.class}
      style={{
        position: "relative",
        ...(horiz() ? { width: `${total()}px` } : { height: `${total()}px` }),
        ...(props.style || {}),
      }}
    >
      <For each={windowItems()}>
        {(item, i) => {
          const index = () => range().start + i();
          const pos = () => offsets()[index()];
          const isReady = () => (props.ready ? props.ready(item, index()) : true);
          return (
            <div
              style={
                horiz()
                  ? { position: "absolute", left: `${pos()}px`, top: "0", bottom: "0" }
                  : { position: "absolute", top: `${pos()}px`, left: "0", right: "0" }
              }
            >
              <Show when={isReady()} fallback={props.fallback?.(item, index)}>
                {props.children(item, index)}
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
