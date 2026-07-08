#!/usr/bin/env python3
"""End-to-end checks for the solid-viewport dev demo (http://localhost:5174).

Run: ~/.local/bin/python3 test/e2e.py
Drives a real Chromium via Playwright and asserts the behaviours we've been fixing:
windowing, no horizontal overscroll, async deferred rows, wheel-zoom sensitivity,
scrollbar visibility, and scrollbar drag mapping (no jump)."""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5174/"
passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))


def strip_state(page):
    el = page.query_selector(".demo-strip")
    return float(el.get_attribute("data-pos")), float(el.get_attribute("data-zoom"))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 900})
    page.goto(URL, wait_until="networkidle")

    # ---- VirtualList: windowing ----
    print("\nVirtualList")
    total_rows = 50_000
    rendered = len(page.query_selector_all(".demo-row"))
    check("windows the DOM (few rows, not 50k)", 0 < rendered < 200, f"{rendered} rows in DOM")

    scroller = page.query_selector(".demo-list-scroll")
    first_before = page.query_selector(".demo-row").inner_text()
    scroller.evaluate("el => el.scrollTop = 4000")
    page.wait_for_timeout(200)
    first_after = page.query_selector(".demo-row").inner_text()
    check("rows update on scroll", first_before != first_after, f"{first_before!r} -> {first_after!r}")

    # ---- no horizontal overscroll ----
    ov = scroller.evaluate("el => ({sw: el.scrollWidth, cw: el.clientWidth})")
    check("no horizontal overflow", ov["sw"] <= ov["cw"], f"scrollWidth {ov['sw']} vs client {ov['cw']}")

    # ---- async deferred loading ----
    scroller.evaluate("el => el.scrollTop = 100000")  # into the >=1000 (deferred) zone
    page.wait_for_timeout(50)
    loading_seen = any("loading" in r.inner_text() for r in page.query_selector_all(".demo-row"))
    page.wait_for_timeout(1200)
    loading_gone = not any("loading" in r.inner_text() for r in page.query_selector_all(".demo-row"))
    check("deferred rows show a placeholder then resolve", loading_seen and loading_gone,
          f"placeholder seen={loading_seen}, resolved={loading_gone}")

    # ---- Zoom axis ----
    print("\nScrollContainer + ScrollBar")
    strip = page.query_selector(".demo-strip")
    box = strip.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    left_x, right_x = box["x"] + 6, box["x"] + box["width"] - 6

    pos0, zoom0 = strip_state(page)
    check("starts at pos 0, zoom 1", abs(pos0) < 1e-6 and abs(zoom0 - 1) < 1e-6, f"pos={pos0}, zoom={zoom0}")

    # Plain wheel (no modifier) = scroll, NOT zoom. At zoom 1 there's nothing to pan,
    # so both stay put — the point is that zoom must not change.
    page.mouse.move(cx, cy)
    page.mouse.wheel(0, -120)
    page.wait_for_timeout(80)
    _, zoom_plain = strip_state(page)
    check("plain wheel does not zoom", abs(zoom_plain - 1) < 1e-6, f"zoom={zoom_plain}")

    # Alt+wheel zooms. One firm notch = a modest step, not a jump.
    page.keyboard.down("Alt")
    page.mouse.move(cx, cy)
    page.mouse.wheel(0, -120)
    page.wait_for_timeout(80)
    _, zoom1 = strip_state(page)
    check("alt+wheel zooms in", zoom1 > zoom0, f"zoom {zoom0} -> {zoom1}")
    check("zoom not too sensitive (<1.5x per notch)", 1.02 < zoom1 < 1.5, f"factor {zoom1/zoom0:.3f}")

    # ---- Anchor on the pointer ----
    # Zoom with the cursor at the LEFT edge: the value there (~current position) must
    # stay, so position barely moves.
    page.mouse.move(left_x, cy)
    pos_l0, _ = strip_state(page)
    page.mouse.wheel(0, -120)
    page.wait_for_timeout(60)
    pos_l1, _ = strip_state(page)
    check("zoom anchored at left edge keeps position", abs(pos_l1 - pos_l0) < 50,
          f"pos {pos_l0:.1f} -> {pos_l1:.1f}")
    # Zoom with the cursor at the RIGHT edge: position must move right (the right-hand
    # value stays under the cursor as the view narrows).
    page.mouse.move(right_x, cy)
    pos_r0, _ = strip_state(page)
    page.mouse.wheel(0, -120)
    page.wait_for_timeout(60)
    pos_r1, _ = strip_state(page)
    check("zoom anchored at right edge moves position right", pos_r1 > pos_r0 + 10,
          f"pos {pos_r0:.1f} -> {pos_r1:.1f}")

    # Zoom in more so the scrollbar has room, then verify it's visible.
    for _ in range(6):
        page.mouse.move(cx, cy)
        page.mouse.wheel(0, -120)
        page.wait_for_timeout(30)
    page.keyboard.up("Alt")
    _, zoomN = strip_state(page)

    # ---- Plain wheel pans once zoomed in ----
    pos_pan0, zoom_pan0 = strip_state(page)
    page.mouse.move(cx, cy)
    page.mouse.wheel(0, 120)
    page.wait_for_timeout(60)
    pos_pan1, zoom_pan1 = strip_state(page)
    check("plain wheel pans when zoomed", pos_pan1 > pos_pan0, f"pos {pos_pan0:.0f} -> {pos_pan1:.0f}")
    check("panning does not change zoom", abs(zoom_pan1 - zoom_pan0) < 1e-6, f"zoom {zoom_pan0:.2f} -> {zoom_pan1:.2f}")
    bar = page.query_selector(".sv-scrollbar[data-direction=horizontal]")
    vis = bar.evaluate("el => getComputedStyle(el).visibility") if bar else "missing"
    barbox = bar.bounding_box() if bar else None
    within = barbox and barbox["x"] >= box["x"] - 1 and (barbox["x"] + barbox["width"]) <= (box["x"] + box["width"] + 1)
    check("scrollbar visible once zoomed", vis == "visible", f"visibility={vis}, zoom={zoomN:.1f}")
    check("scrollbar within the container (no overflow)", bool(within),
          f"bar={barbox and (round(barbox['x']), round(barbox['width']))}, container x={round(box['x'])}..{round(box['x']+box['width'])}")

    # ---- Scrollbar drag: must map proportionally, not jump ----
    pos_before, _ = strip_state(page)
    bb = bar.bounding_box()
    grab_x = bb["x"] + bb["width"] / 2  # grab the middle
    grab_y = bb["y"] + bb["height"] / 2
    drag_px = 40
    page.mouse.move(grab_x, grab_y)
    page.mouse.down()
    page.mouse.move(grab_x + drag_px, grab_y, steps=5)
    page.mouse.up()
    page.wait_for_timeout(80)
    pos_after, _ = strip_state(page)

    # Expected: a 40px thumb move over a track of (pixelSize - thumb) maps to
    # (40/(pixelSize-thumb)) * maxPosition. We just assert it moved right, stayed in
    # range, and did NOT slam to the maximum (the "jump" bug).
    max_pos = 10_000 - 10_000 / zoomN
    moved = pos_after - pos_before
    check("drag moves position in drag direction", moved > 0, f"pos {pos_before:.0f} -> {pos_after:.0f}")
    check("drag does not jump to the end", pos_after < max_pos * 0.9,
          f"pos_after {pos_after:.0f} vs max {max_pos:.0f}")
    # Proportionality: a small 40px drag should be a small fraction of the range.
    check("drag is proportional (small drag = small move)", 0 < moved < max_pos * 0.5,
          f"moved {moved:.0f} of max {max_pos:.0f}")

    # ---- Gap features (fresh page each, clean zoom=1) ----
    print("\nGap features")

    def fresh_strip():
        page.goto(URL, wait_until="networkidle")
        s = page.query_selector(".demo-strip")
        b = s.bounding_box()
        return b, (b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)

    def set_range(selector, value):
        page.query_selector(selector).evaluate(
            "(el, v) => { el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); }", value)

    def alt_notch(center, n=1, dy=-120):
        page.keyboard.down("Alt")
        page.mouse.move(*center)
        for _ in range(n):
            page.mouse.wheel(0, dy)
            page.wait_for_timeout(40)
        page.keyboard.up("Alt")

    # ZoomSlider drives zoom.
    b, c = fresh_strip()
    set_range(".demo-zoom-slider", 5)
    page.wait_for_timeout(60)
    _, zs = strip_state(page)
    check("ZoomSlider sets zoom", abs(zs - 5) < 0.5, f"zoom={zs:.2f}")

    # Sensitivity: a higher setting zooms more per identical notch.
    b, c = fresh_strip()
    alt_notch(c)
    _, z_low = strip_state(page)
    b, c = fresh_strip()
    set_range(".demo-sensitivity", 4)
    page.wait_for_timeout(40)
    alt_notch(c)
    _, z_high = strip_state(page)
    check("higher sensitivity zooms more per notch", z_high > z_low + 0.1,
          f"sens1 -> {z_low:.3f}, sens4 -> {z_high:.3f}")

    # Invert: with invert on, an up-notch (which normally zooms in) zooms OUT.
    b, c = fresh_strip()
    alt_notch(c, n=4)  # zoom in first so there's room to go down
    _, z_pre = strip_state(page)
    page.query_selector(".demo-invert").check()
    alt_notch(c, n=1)
    _, z_post = strip_state(page)
    check("invert flips zoom direction", z_post < z_pre, f"{z_pre:.2f} -> {z_post:.2f} (up-notch)")

    # ensureVisible: reveal a value that's off-screen when zoomed in.
    b, c = fresh_strip()
    alt_notch(c, n=10)  # zoom in hard so tick 8000 is off-screen at pos 0
    pos_ev, zoom_ev = strip_state(page)
    visible_range = 10_000 / zoom_ev
    off_before = not (pos_ev <= 8000 <= pos_ev + visible_range)
    page.query_selector(".demo-scrollto").click()
    page.wait_for_timeout(80)
    pos_ev2, zoom_ev2 = strip_state(page)
    vr2 = 10_000 / zoom_ev2
    on_after = pos_ev2 <= 8000 <= pos_ev2 + vr2
    check("ensureVisible reveals an off-screen value", off_before and on_after,
          f"off_before={off_before}, pos {pos_ev:.0f}->{pos_ev2:.0f}, range {vr2:.0f}")

    # ScrollBar responds to a touch (pointer) drag, not just mouse.
    b, c = fresh_strip()
    alt_notch(c, n=6)
    page.keyboard.up("Alt")
    tbar = page.query_selector(".sv-scrollbar[data-direction=horizontal]")
    tb = tbar.bounding_box()
    pos_t0, _ = strip_state(page)
    page.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2)  # ensure not on an end
    page.evaluate(
        """([x, y, x2]) => {
            const el = document.querySelector('.sv-scrollbar[data-direction=horizontal]');
            const opt = (t, cx) => ({bubbles:true, cancelable:true, pointerId:1, pointerType:'touch', clientX:cx, clientY:y, button:0});
            el.dispatchEvent(new PointerEvent('pointerdown', opt('down', x)));
            window.dispatchEvent(new PointerEvent('pointermove', opt('move', x2)));
            window.dispatchEvent(new PointerEvent('pointerup', opt('up', x2)));
        }""",
        [tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2, tb["x"] + tb["width"] / 2 + 40],
    )
    page.wait_for_timeout(60)
    pos_t1, _ = strip_state(page)
    check("scrollbar responds to touch (pointer) drag", pos_t1 > pos_t0, f"pos {pos_t0:.0f} -> {pos_t1:.0f}")

    browser.close()

print(f"\n{len(passed)} passed, {len(failed)} failed")
if failed:
    print("FAILED:", ", ".join(failed))
    sys.exit(1)
