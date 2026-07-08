import { createSignal, Index } from "solid-js";
import { ScrollBar, ScrollContainer, ViewPort, useAxis, VirtualList } from "../src";

// 50k rows with varied heights, to show that windowing keeps the DOM tiny.
const ROWS = Array.from({ length: 50_000 }, (_, i) => ({
  id: i,
  label: `Row ${i}`,
  height: 28 + (i % 5) * 10,
}));

function ListDemo() {
  const [ready, setReady] = createSignal(new Set<number>());
  // Pretend rows 0-999 are loaded; the rest "stream in" on first sight.
  const isReady = (r: (typeof ROWS)[number]) => r.id < 1000 || ready().has(r.id);
  const request = (id: number) =>
    setTimeout(() => setReady((s) => new Set(s).add(id)), 250 + (id % 7) * 60);

  return (
    <div
      style={{
        height: "360px",
        "overflow-y": "auto",
        "overflow-x": "hidden",
        "overscroll-behavior": "contain",
        border: "1px solid #333",
        "border-radius": "6px",
      }}
    >
      <VirtualList
        items={ROWS}
        itemSize={(r) => r.height}
        overscan={6}
        ready={isReady}
        fallback={(r) => {
          request(r.id);
          return (
            <div style={{ padding: "6px 10px", color: "#666", "font-style": "italic" }}>
              loading {r.label}…
            </div>
          );
        }}
      >
        {(r, index) => (
          <div
            style={{
              "box-sizing": "border-box",
              padding: "6px 10px",
              "border-bottom": "1px solid #222",
              background: index() % 2 ? "#141414" : "#181818",
            }}
          >
            {r.label} · {r.height}px
          </div>
        )}
      </VirtualList>
    </div>
  );
}

// A synthetic zoom/pan axis: 10,000 ticks laid out horizontally, only the visible
// ones rendered. Alt+wheel or drag the scrollbar ends to zoom.
function ZoomDemo() {
  const [position, setPosition] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [width, setWidth] = createSignal(800);
  const RANGE = 10_000;

  return (
    <ViewPort
      axes={{
        horizontal: () => ({
          position: position(),
          range: RANGE,
          pixelOffset: 0,
          pixelSize: width(),
          zoom: zoom(),
          minZoom: 1,
          maxZoom: 500,
          onPositionChange: setPosition,
          onZoomChange: setZoom,
        }),
      }}
    >
      <div
        ref={(el) => {
          const ro = new ResizeObserver(() => setWidth(el.clientWidth));
          ro.observe(el);
        }}
        style={{ position: "relative", height: "120px", border: "1px solid #333", "border-radius": "6px" }}
      >
        <ScrollContainer>
          <Ticks />
        </ScrollContainer>
        <ScrollBar direction="horizontal" />
      </div>
      <p style={{ color: "#888", "font-size": "12px" }}>
        pos {position().toFixed(0)} · zoom {zoom().toFixed(1)}× — alt+wheel to zoom
      </p>
    </ViewPort>
  );
}

function Ticks() {
  const axis = useAxis("horizontal");
  const ticks = Array.from({ length: 10_000 }, (_, i) => i);
  return (
    <Index each={ticks}>
      {(i) => {
        const dims = () => axis.dimensions(i(), 1);
        return (
          <span
            style={{
              display: axis.isVisible({ offset: dims().offset, size: 40 }) ? "block" : "none",
              position: "absolute",
              left: `${dims().offset}px`,
              top: 0,
              bottom: 0,
              "border-left": i() % 10 === 0 ? "1px solid #6df" : "1px solid #333",
              "padding-left": "3px",
              color: "#888",
              "font-size": "10px",
            }}
          >
            {i() % 10 === 0 ? i() : ""}
          </span>
        );
      }}
    </Index>
  );
}

export default function App() {
  return (
    <div
      style={{
        "font-family": "system-ui, sans-serif",
        color: "#ddd",
        background: "#0e0e0e",
        "min-height": "100vh",
        padding: "24px",
        display: "flex",
        "flex-direction": "column",
        gap: "24px",
        "max-width": "900px",
        margin: "0 auto",
      }}
    >
      <h1 style={{ "font-size": "20px" }}>solid-viewport</h1>
      <section>
        <h2 style={{ "font-size": "14px", color: "#6df" }}>VirtualList — 50k rows, async deferred</h2>
        <ListDemo />
      </section>
      <section>
        <h2 style={{ "font-size": "14px", color: "#6df" }}>ScrollContainer + ScrollBar — zoom/pan axis</h2>
        <ZoomDemo />
      </section>
    </div>
  );
}
