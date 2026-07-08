// Windowing: turn a scroll position + item sizes into the slice of items that are
// on screen (+ overscan), and where each sits. This is what a virtual list needs;
// it's the same "which spans intersect the viewport" question `isVisible` answers,
// specialised to a contiguous, sorted run of items so we can binary-search it.

// Prefix sums of item sizes. `offsets[i]` = start position of item i, `offsets[n]`
// = total content size. Pass a `size(i)` fn so heterogeneous item sizes are cheap.
export function prefixSums(count: number, size: (index: number) => number): Float64Array {
  const arr = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) arr[i + 1] = arr[i] + size(i);
  return arr;
}

export type Window = { start: number; end: number };

// Given prefix `offsets`, the scrolled distance from content start to viewport start
// (`scrolled`), the viewport extent (`viewport`), and `overscan` rows of slack on
// each side, return the [start, end) index range to render. Binary-searches the
// first visible item, then walks to the last.
export function windowRange(
  offsets: Float64Array,
  scrolled: number,
  viewport: number,
  overscan = 4,
): Window {
  const n = offsets.length - 1;
  if (n <= 0) return { start: 0, end: 0 };

  const top = Math.max(0, scrolled);
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= top) lo = mid + 1;
    else hi = mid;
  }
  const start = Math.max(0, lo - overscan);

  let end = start;
  const bottom = top + Math.max(0, viewport);
  while (end < n && offsets[end] < bottom) end++;
  end = Math.min(n, end + overscan);

  return { start, end };
}
