import { createSignal, Index } from "solid-js";
import {
  createElementSize,
  ScrollBar,
  ScrollContainer,
  useAxis,
  ViewPort,
  VirtualList,
  ZoomSlider,
} from "../src";
import type { WheelBehavior } from "../src";

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
      class="demo-list-scroll"
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
        class="demo-list"
        items={ROWS}
        itemSize={(r) => r.height}
        overscan={6}
        ready={isReady}
        fallback={(r) => {
          request(r.id);
          return (
            <div class="demo-row" style={{ padding: "6px 10px", color: "#666", "font-style": "italic" }}>
              loading {r.label}…
            </div>
          );
        }}
      >
        {(r, index) => (
          <div
            class="demo-row"
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
  const [sensitivity, setSensitivity] = createSignal(1);
  const [invert, setInvert] = createSignal(false);
  const [wheelMode, setWheelMode] = createSignal<WheelBehavior>("alt-zoom");
  const RANGE = 10_000;

  // Measured pixelSize via the library helper (gap #3) instead of a hand-rolled RO.
  let stripEl: HTMLDivElement | undefined;
  const size = createElementSize(() => stripEl);

  return (
    <ViewPort
      axes={{
        horizontal: () => ({
          position: position(),
          range: RANGE,
          pixelOffset: 0,
          pixelSize: size().width || 800,
          zoom: zoom(),
          minZoom: 1,
          maxZoom: 500,
          onPositionChange: setPosition,
          onZoomChange: setZoom,
        }),
      }}
    >
      <div
        ref={stripEl}
        class="demo-strip"
        data-pos={position()}
        data-zoom={zoom()}
        style={{ position: "relative", height: "120px", border: "1px solid #333", "border-radius": "6px" }}
      >
        {/* wheel mode + zoomSensitivity + invertZoom wired to demo controls below. */}
        <ScrollContainer wheel={wheelMode()} zoomSensitivity={sensitivity()} invertZoom={invert()}>
          <Ticks />
        </ScrollContainer>
        <ScrollBar direction="horizontal" />
      </div>
      <Controls
        sensitivity={sensitivity()}
        setSensitivity={setSensitivity}
        invert={invert()}
        setInvert={setInvert}
        wheelMode={wheelMode()}
        setWheelMode={setWheelMode}
      />
      <p class="demo-caption" style={{ color: "#888", "font-size": "12px" }}>
        pos {position().toFixed(0)} · zoom {zoom().toFixed(1)}× · sens {sensitivity()} · mode{" "}
        {String(wheelMode())} · anchored on the cursor · scrollbar drag (ends to zoom)
      </p>
    </ViewPort>
  );
}

// Lives inside <ViewPort>, so useAxis resolves here at render — the ensureVisible
// button can then call it from a handler. Exercises ZoomSlider + scrollTo/ensureVisible.
function Controls(props: {
  sensitivity: number;
  setSensitivity: (n: number) => void;
  invert: boolean;
  setInvert: (b: boolean) => void;
  wheelMode: WheelBehavior;
  setWheelMode: (m: WheelBehavior) => void;
}) {
  const axis = useAxis("horizontal");
  const labelStyle = {
    display: "flex",
    "align-items": "center",
    gap: "6px",
    "font-size": "12px",
    color: "#aaa",
  } as const;
  return (
    <div style={{ display: "flex", "align-items": "center", gap: "12px", "flex-wrap": "wrap" }}>
      <label style={labelStyle}>
        wheel
        <select
          class="demo-wheel"
          value={String(props.wheelMode)}
          onChange={(e) => props.setWheelMode(e.currentTarget.value as WheelBehavior)}
        >
          <option value="alt-zoom">alt-zoom (Alt/pinch zooms)</option>
          <option value="zoom">zoom (no key)</option>
          <option value="zoom-pan">zoom-pan (Y zooms, X pans)</option>
          <option value="scroll">scroll only</option>
        </select>
      </label>
      <label style={labelStyle}>
        zoom <ZoomSlider class="demo-zoom-slider" style={{ width: "160px" }} />
      </label>
      <label style={labelStyle}>
        sensitivity
        <input
          class="demo-sensitivity"
          type="range"
          min="0.25"
          max="10"
          step="0.25"
          value={props.sensitivity}
          onInput={(e) => props.setSensitivity(e.currentTarget.valueAsNumber)}
        />
      </label>
      <label style={labelStyle}>
        <input
          class="demo-invert"
          type="checkbox"
          checked={props.invert}
          onChange={(e) => props.setInvert(e.currentTarget.checked)}
        />
        invert
      </label>
      <button class="demo-scrollto" onClick={() => axis.ensureVisible(8000, 100, 200)}>
        reveal tick 8000
      </button>
    </div>
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
