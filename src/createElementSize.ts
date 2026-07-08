import { createSignal, createEffect, onCleanup } from "solid-js";

export type Size = { width: number; height: number };

// Reactive content-box size of an element, via ResizeObserver. Cuts the boilerplate
// every viewport consumer otherwise writes to feed an axis's `pixelSize`:
//
//   let el; const size = createElementSize(() => el);
//   <ViewPort axes={{ horizontal: () => ({ ..., pixelSize: size().width }) }}>
//     <div ref={el} ... />
//
// Uses clientWidth/clientHeight (padding-box minus scrollbar), which is what an
// axis pixelSize wants — the space content actually occupies.
export function createElementSize(target: () => HTMLElement | undefined): () => Size {
  const [size, setSize] = createSignal<Size>({ width: 0, height: 0 });

  createEffect(() => {
    const el = target();
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    onCleanup(() => ro.disconnect());
  });

  return size;
}
