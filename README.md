# solid-viewport

One viewport core for scrollable & zoomable content in [Solid](https://www.solidjs.com/) — virtual lists, waveforms, piano rolls, keyboards. It unifies the ad-hoc viewport math that `solid-waveform` and `solid-pianoroll` each reinvented.

## The idea

An **axis** maps *value space* (samples, ticks, list indices, seconds — whatever the content is measured in) to *pixel space* on screen, given a scroll `position` and a `zoom`. A **viewport** is just N named axes: a list needs one, a waveform one, a piano roll two (time + pitch).

Everything else is built on that:

- **`VirtualList`** — a virtual list on real DOM scroll. Drops into any existing scroll container, horizontal or vertical, variable item sizes, async/deferred items. Use for normal lists, search results, table rows.
- **`ScrollContainer` + `ScrollBar`** — a synthetic pan/zoom surface. Owns the scroll, sizes a spacer to `zoom × pixelSize`, and lets you window content with `axis.isVisible(...)`. Use for waveforms, piano rolls, timelines, keyboards.

Both are windowed by the same `createViewPortAxis` / `windowRange` math.

## Install

```sh
pnpm add solid-viewport
```

## VirtualList

```tsx
import { VirtualList } from "solid-viewport";

<div style={{ height: "360px", overflow: "auto" }}>
  <VirtualList items={rows} itemSize={(r) => r.height} overscan={6}>
    {(row, index) => <Row row={row} index={index()} />}
  </VirtualList>
</div>;
```

- `items` — the array.
- `itemSize` — px extent along the scroll axis; a constant or `(item, i) => number`.
- `axis` — `"vertical"` (default) or `"horizontal"`.
- `overscan` — extra rows off each edge (default 4).
- `ready` / `fallback` — optional async deferred loading: off-screen items are never asked to load; a not-yet-`ready` visible item renders `fallback` until it resolves.

It does **not** own the scroll — it reads its nearest scrollable ancestor, so it composes with whatever container and styling you already have.

## Axes & synthetic scroll

```tsx
import { ViewPort, ScrollContainer, ScrollBar, useAxis } from "solid-viewport";

<ViewPort
  axes={{
    horizontal: () => ({
      position: pos(),
      range: totalTicks,
      pixelOffset: 0,
      pixelSize: width(),
      zoom: zoom(),
      minZoom: 1,
      maxZoom: 500,
      onPositionChange: setPos,
      onZoomChange: setZoom,
    }),
  }}
>
  <ScrollContainer>
    <Content />
  </ScrollContainer>
  <ScrollBar direction="horizontal" />
</ViewPort>;

// inside Content:
const axis = useAxis("horizontal");
const dims = () => axis.dimensions(note.start, note.length); // { offset, size } in px
// render only when axis.isVisible(dims())
```

### Axis API

`createViewPortAxis(getState)` (and `useAxis(name)`) expose:

| method | purpose |
| --- | --- |
| `toPixels(value)` | value → absolute px at current zoom |
| `toPixelOffset(value)` | value → px relative to scroll position |
| `toPosition(offset)` | px offset → value |
| `dimensions(pos, len)` | `{ offset, size }` — raw placement (may be off-screen) |
| `clampedDimensions(pos, len)` | placement clipped to the viewport box |
| `isVisible(dims)` | does a span intersect the viewport? |
| `visibleRange()` | how much of `range` is on screen |
| `maxPosition()` | largest legal scroll position |
| `scrollTo(value)` | move `value` to the viewport's start edge |
| `center(value)` | put `value` at the viewport centre |
| `ensureVisible(pos, len?, pad?)` | pan the minimum so `[pos, pos+len]` is on screen |

## Wheel behaviour

`<ScrollContainer>` props:

- `wheel` — preset `"alt-zoom"` (default: Alt/Option or ctrl-pinch zooms, else scrolls) · `"zoom"` · `"scroll"` · `"none"` · or a resolver `(event) => ({ type: "zoom" | "scroll" | "none", axis? })` for full control (shift-for-horizontal, per-axis, custom modifiers).
- `zoomSensitivity` (default 1) / `invertZoom` — zoom feel; wire these to a user preference.
- `momentum` (default true) — pan via native scroll for trackpad inertia; the 1-D case a native scroll can't reach falls back to a manual pan.

## Zoom slider

```tsx
import { ZoomSlider } from "solid-viewport";
<ZoomSlider direction="horizontal" />   // a range input bound to the axis's zoom
```

## Measuring

`createElementSize(() => el)` gives a reactive `{ width, height }` (ResizeObserver) to feed an axis's `pixelSize`:

```tsx
let el; const size = createElementSize(() => el);
// ...pixelSize: size().width
<div ref={el} />
```

## License

MIT © jdachtera
