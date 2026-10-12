import { createSignal, For, Index, JSX } from "solid-js";
import {
  createElementSize,
  ScrollBar,
  ScrollContainer,
  useAxis,
  ViewPort,
  VirtualList,
  ZoomSlider,
} from "../src";
import type { Pinch, WheelBehavior } from "../src";
import "./App.css";

// ---------------------------------------------------------------------------
// VirtualList: 50k rows with varied heights, to show that windowing keeps the DOM
// tiny. Rows past the first 1000 "stream in" on first sight.

const ROWS = Array.from({ length: 50_000 }, (_, i) => ({
  id: i,
  label: `Row ${i.toLocaleString()}`,
  height: 28 + (i % 5) * 10,
}));

function ListDemo() {
  const [ready, setReady] = createSignal(new Set<number>());
  const isReady = (r: (typeof ROWS)[number]) => r.id < 1000 || ready().has(r.id);
  const request = (id: number) =>
    setTimeout(() => setReady((s) => new Set(s).add(id)), 250 + (id % 7) * 60);

  return (
    <div class="demo-list-scroll">
      <VirtualList
        class="demo-list"
        items={ROWS}
        itemSize={(r) => r.height}
        overscan={6}
        ready={isReady}
        fallback={(r) => {
          request(r.id);
          return <div class="demo-row demo-row-loading">loading {r.label}…</div>;
        }}
      >
        {(r, index) => (
          <div class="demo-row" classList={{ "demo-row-alt": index() % 2 === 1 }}>
            <span>{r.label}</span>
            <span class="muted">{r.height}px</span>
          </div>
        )}
      </VirtualList>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One axis: 10,000 ticks laid out horizontally, only the visible ones rendered.

function ZoomDemo() {
  const [position, setPosition] = createSignal(0);
  const [zoom, setZoom] = createSignal(1);
  const [sensitivity, setSensitivity] = createSignal(1);
  const [invert, setInvert] = createSignal(false);
  const [wheelMode, setWheelMode] = createSignal<WheelBehavior>("alt-zoom");
  const RANGE = 10_000;

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
        class="demo-strip stage"
        data-pos={position()}
        data-zoom={zoom()}
      >
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
      <p class="demo-caption stats">
        <Stat label="position" value={position().toFixed(0)} />
        <Stat label="zoom" value={`${zoom().toFixed(1)}×`} />
        <Stat label="visible" value={`${(RANGE / zoom()).toFixed(0)} ticks`} />
      </p>
    </ViewPort>
  );
}

// Lives inside <ViewPort>, so useAxis resolves here at render and the button can
// call it from a handler.
function Controls(props: {
  sensitivity: number;
  setSensitivity: (n: number) => void;
  invert: boolean;
  setInvert: (b: boolean) => void;
  wheelMode: WheelBehavior;
  setWheelMode: (m: WheelBehavior) => void;
}) {
  const axis = useAxis("horizontal");
  return (
    <div class="controls">
      <label class="control">
        <span>Wheel</span>
        <select
          class="demo-wheel"
          value={String(props.wheelMode)}
          onChange={(e) => props.setWheelMode(e.currentTarget.value as WheelBehavior)}
        >
          <option value="alt-zoom">alt-zoom — Alt or pinch zooms</option>
          <option value="zoom">zoom — always zooms</option>
          <option value="zoom-pan">zoom-pan — Y zooms, X pans</option>
          <option value="scroll">scroll only</option>
        </select>
      </label>
      <label class="control">
        <span>Zoom</span>
        <ZoomSlider class="demo-zoom-slider" />
      </label>
      <label class="control">
        <span>Sensitivity — {props.sensitivity}×</span>
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
      <label class="control check">
        <input
          class="demo-invert"
          type="checkbox"
          checked={props.invert}
          onChange={(e) => props.setInvert(e.currentTarget.checked)}
        />
        <span>Invert zoom</span>
      </label>
      <button class="demo-scrollto button" onClick={() => axis.ensureVisible(8000, 100, 200)}>
        Reveal tick 8000
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
            class="tick"
            classList={{ "tick-major": i() % 10 === 0 }}
            style={{
              display: axis.isVisible({ offset: dims().offset, size: 40 }) ? "block" : "none",
              left: `${dims().offset}px`,
            }}
          >
            {i() % 10 === 0 ? i() : ""}
          </span>
        );
      }}
    </Index>
  );
}

// ---------------------------------------------------------------------------
// Two axes: a timeline of 64 bars by 24 lanes, with a bar ruler pinned above the
// lanes (verticalInset) and pinch zoom on either or both axes.

const BARS = 64;
const LANES = 24;
const RULER = 28;
const CLIPS = (() => {
  // Deterministic pseudo-random clips so the demo looks the same every load.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 220 }, (_, id) => {
    const lane = Math.floor(rand() * LANES);
    const start = Math.floor(rand() * (BARS - 2) * 4) / 4;
    const length = 0.5 + Math.floor(rand() * 8) / 2;
    return { id, lane, start, length: Math.min(length, BARS - start), hue: (lane * 37) % 360 };
  });
})();

function TimelineDemo() {
  const [x, setX] = createSignal({ position: 0, zoom: 4 });
  const [y, setY] = createSignal({ position: 0, zoom: 1.5 });
  const [pinch, setPinch] = createSignal<Pinch>("both");

  let stageEl: HTMLDivElement | undefined;
  const size = createElementSize(() => stageEl);

  return (
    <ViewPort
      axes={{
        horizontal: () => ({
          position: x().position,
          range: BARS,
          pixelOffset: 0,
          pixelSize: size().width || 800,
          zoom: x().zoom,
          minZoom: 1,
          maxZoom: 32,
          onPositionChange: (position) => setX((s) => ({ ...s, position })),
          onZoomChange: (zoom) => setX((s) => ({ ...s, zoom })),
        }),
        vertical: () => ({
          position: y().position,
          range: LANES,
          pixelOffset: RULER,
          pixelSize: Math.max(1, (size().height || 320) - RULER),
          zoom: y().zoom,
          minZoom: 1,
          maxZoom: 6,
          onPositionChange: (position) => setY((s) => ({ ...s, position })),
          onZoomChange: (zoom) => setY((s) => ({ ...s, zoom })),
        }),
      }}
    >
      <div ref={stageEl} class="demo-timeline stage">
        <ScrollContainer verticalInset={RULER} pinch={pinch()}>
          <Ruler />
          <Lanes />
        </ScrollContainer>
        <ScrollBar direction="horizontal" />
        <ScrollBar direction="vertical" />
      </div>
      <div class="controls">
        <div class="control">
          <span>Pinch zooms</span>
          <Segmented
            value={String(pinch())}
            options={[
              ["both", "Both"],
              ["horizontal", "Time"],
              ["vertical", "Lanes"],
              ["false", "Off"],
            ]}
            onChange={(v) => setPinch(v === "false" ? false : (v as Pinch))}
          />
        </div>
        <button
          class="button"
          onClick={() => {
            setX({ position: 0, zoom: 1 });
            setY({ position: 0, zoom: 1 });
          }}
        >
          Fit all
        </button>
      </div>
      <p class="stats">
        <Stat label="bars" value={`${x().position.toFixed(1)} – ${(x().position + BARS / x().zoom).toFixed(1)}`} />
        <Stat label="time zoom" value={`${x().zoom.toFixed(1)}×`} />
        <Stat label="lane zoom" value={`${y().zoom.toFixed(1)}×`} />
      </p>
    </ViewPort>
  );
}

// The bar numbers, pinned in the inset above the lanes.
function Ruler() {
  const h = useAxis("horizontal");
  return (
    <div class="ruler" style={{ height: `${RULER}px` }}>
      <Index each={Array.from({ length: BARS }, (_, i) => i)}>
        {(bar) => {
          const dims = () => h.dimensions(bar(), 1);
          return (
            <span
              class="ruler-bar"
              style={{
                display: h.isVisible(dims()) ? "block" : "none",
                left: `${dims().offset}px`,
                width: `${dims().size}px`,
              }}
            >
              {bar() + 1}
            </span>
          );
        }}
      </Index>
    </div>
  );
}

function Lanes() {
  const h = useAxis("horizontal");
  const v = useAxis("vertical");
  return (
    <div class="lanes" style={{ top: `${RULER}px` }}>
      <Index each={Array.from({ length: LANES }, (_, i) => i)}>
        {(lane) => {
          const dims = () => v.dimensions(lane(), 1);
          return (
            <div
              class="lane"
              classList={{ "lane-alt": lane() % 2 === 1 }}
              style={{
                display: v.isVisible(dims()) ? "block" : "none",
                top: `${dims().offset}px`,
                height: `${dims().size}px`,
              }}
            />
          );
        }}
      </Index>
      <For each={CLIPS}>
        {(clip) => {
          const hd = () => h.dimensions(clip.start, clip.length);
          const vd = () => v.dimensions(clip.lane, 1);
          return (
            <div
              class="clip"
              style={{
                display: h.isVisible(hd()) && v.isVisible(vd()) ? "block" : "none",
                left: `${hd().offset}px`,
                width: `${hd().size}px`,
                top: `${vd().offset + 2}px`,
                height: `${Math.max(0, vd().size - 4)}px`,
                "--clip-hue": String(clip.hue),
              }}
            />
          );
        }}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Stat(props: { label: string; value: string }) {
  return (
    <span class="stat">
      <span class="muted">{props.label}</span> <span class="mono">{props.value}</span>
    </span>
  );
}

function Segmented(props: {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div class="segmented">
      <For each={props.options}>
        {([value, label]) => (
          <button
            class="seg"
            classList={{ "seg-active": props.value === value }}
            onClick={() => props.onChange(value)}
          >
            {label}
          </button>
        )}
      </For>
    </div>
  );
}

function Panel(props: { title: string; hint: JSX.Element; children: JSX.Element }) {
  return (
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">{props.title}</h2>
        <span class="panel-hint">{props.hint}</span>
      </div>
      {props.children}
    </section>
  );
}

export default function App() {
  return (
    <div class="app">
      <header class="header">
        <h1 class="title">Solid Viewport</h1>
        <p class="subtitle">
          One viewport core for scrollable &amp; zoomable content in SolidJS — virtual lists,
          timelines, waveforms, piano rolls.
        </p>
      </header>

      <Panel
        title="VirtualList"
        hint="50,000 rows of varied height, rendered in a window; rows past 1,000 load on first sight"
      >
        <ListDemo />
      </Panel>

      <Panel
        title="ScrollContainer + ScrollBar · one axis"
        hint="10,000 ticks · wheel per the mode below · drag the scrollbar's ends to zoom"
      >
        <ZoomDemo />
      </Panel>

      <Panel
        title="Two axes · ruler inset · pinch"
        hint="64 bars × 24 lanes · Alt+wheel zooms one axis, a trackpad or touch pinch zooms per the setting"
      >
        <TimelineDemo />
      </Panel>

      <footer class="footer">
        <a href="https://github.com/jdachtera/solid-viewport" target="_blank">
          GitHub
        </a>
        <a href="https://www.npmjs.com/package/solid-viewport" target="_blank">
          npm
        </a>
        <span class="muted footer-note">
          Used by{" "}
          <a href="https://solid-waveform.netlify.app/" target="_blank">
            solid-waveform
          </a>{" "}
          and{" "}
          <a href="https://solid-pianoroll.netlify.app/" target="_blank">
            solid-pianoroll
          </a>
        </span>
      </footer>
    </div>
  );
}
