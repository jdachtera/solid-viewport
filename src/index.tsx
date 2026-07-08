// solid-viewport — one viewport core for scrollable/zoomable content: normal lists,
// waveforms, piano rolls, keyboards. An axis maps value space <-> pixel space given a
// scroll position and zoom; a viewport is N named axes. Build virtual lists on real
// DOM scroll (`VirtualList`) or a synthetic pan/zoom surface (`ScrollContainer` +
// `ScrollBar`) — both windowed by the same math.

export { default as createViewPortAxis, clamp } from "./createViewPortAxis";
export type { AxisState, Dimensions, ViewPortAxis } from "./createViewPortAxis";

export { ViewPort, useAxis, useAxes } from "./ViewPort";

export { prefixSums, windowRange } from "./windowing";
export type { Window } from "./windowing";

export { VirtualList } from "./VirtualList";
export type { VirtualListProps } from "./VirtualList";

export { default as ScrollContainer } from "./ScrollContainer";
export type { WheelAction, WheelBehavior } from "./ScrollContainer";
export { default as ScrollBar } from "./ScrollBar";
export { ZoomSlider } from "./ZoomSlider";

export { createElementSize } from "./createElementSize";
export type { Size } from "./createElementSize";
