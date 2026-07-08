import { createMemo, JSX } from "solid-js";
import { useAxis } from "./ViewPort";

// A range input bound to an axis's zoom, between its min/maxZoom. Vertical
// orientation flips the axis so dragging up zooms in. If the axis has no finite
// maxZoom, pass an explicit `max`.
export function ZoomSlider(props: {
  axis?: string;
  direction?: "horizontal" | "vertical";
  max?: number;
  step?: number;
  class?: string;
  style?: JSX.CSSProperties;
}) {
  const axis = createMemo(() => useAxis(props.axis ?? props.direction));
  const max = () => {
    const m = props.max ?? axis().maxZoom;
    return Number.isFinite(m) ? m : Math.max(axis().minZoom * 100, 100);
  };
  const vertical = () => props.direction === "vertical";

  return (
    <input
      class={props.class}
      type="range"
      min={axis().minZoom}
      max={max()}
      step={props.step ?? 0.01}
      value={axis().zoom}
      onInput={(e) => axis().onZoomChange?.(e.currentTarget.valueAsNumber)}
      style={{
        ...(vertical() ? { "writing-mode": "vertical-lr", direction: "rtl" } : {}),
        ...(props.style || {}),
      }}
    />
  );
}
