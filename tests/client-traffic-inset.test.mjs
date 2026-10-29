// macOS draws the traffic lights INSIDE the window (titleBarStyle hiddenInset,
// lights at 16,18), and DSH publishes the room they need as
// --dsh-frame-top-clearance (48px on darwin). Both of our left rails keep that
// room unconditionally, the way DSH's own sidebar holds a 52px top strip, so
// the rail never has to move and can never be caught out by the fullscreen
// transition. Only padding moves; the rail's background still meets the edge.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SOURCE = fs.readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

test("both rails reserve the macOS window-button strip", () => {
  for (const rail of [".fw-nav", ".fz-side"]) {
    const sel = `[data-platform=darwin] ${rail}`;
    const re = new RegExp(sel.replace(/[[\].]/g, c => "\\" + c) + "\\{padding-top:var\\(--dsh-frame-top-clearance,48px\\)\\}");
    assert.match(SOURCE, re, `${rail} must keep the traffic-light strip clear`);
  }
});

test("the reservation is platform-scoped, not global", () => {
  // Other platforms have no in-window buttons, so they must not lose 48px.
  const PREFIX = "[data-platform=darwin] ";
  const uses = [...SOURCE.matchAll(/[^\n{}]*?\.(?:fw-nav|fz-side)\{padding-top:var\(--dsh-frame-top-clearance/g)];
  assert.ok(uses.length >= 2, "both rails declare the reservation");
  for (const use of uses) {
    // The matched selector must carry the platform attribute; a bare `.fw-nav`
    // selector would pad every platform.
    assert.ok(use[0].startsWith(PREFIX), `unscoped rail padding: ${JSON.stringify(use[0].slice(0, 40))}`);
  }
});

test("the rail only pads on top, so its background still reaches the edge", () => {
  for (const rail of [".fw-nav", ".fz-side"]) {
    const re = new RegExp("\\[data-platform=darwin\\] " + rail.replace(".", "\\.") + "\\{([^}]*)\\}");
    const body = SOURCE.match(re)?.[1] ?? "";
    assert.match(body, /^padding-top:/, "only padding-top may be set here");
    assert.doesNotMatch(body, /padding-left|padding-right|padding-bottom/, "sides keep their own spacing");
  }
});

test("no layout measurement is used, so a transition cannot leave the rail behind", () => {
  // The previous version measured the rail's position and needed observers to
  // notice the fullscreen animation; reading a stale mid-animation position is
  // exactly what made the rail wait for a click. Constant padding has no timing.
  assert.ok(!/useTrafficLightInset/.test(SOURCE), "the measuring hook is gone");
  assert.ok(!/traffic-safe/.test(SOURCE), "the toggled class is gone");
  // No measuring of the rail itself. (The calendar fits its year to the card
  // with a ResizeObserver; that is a local concern, not the rail's position,
  // and cannot leave the rail behind during the fullscreen transition.)
  assert.ok(!/(?:Resize|Mutation)Observer[^;\n]*fw-nav|fw-nav[^;\n]*(?:Resize|Mutation)Observer/.test(SOURCE), "no rail position observers remain");
});
