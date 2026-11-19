import test from "node:test";
import assert from "node:assert/strict";
import { allowsNativeInteraction, shouldPreventOverscroll } from "../src/viewport.js";

function target(scroller = null, editable = false) {
  return { closest: (selector) => selector.startsWith("input") ? (editable ? {} : null) : scroller };
}

test("native form controls keep their own touch interaction", () => {
  assert.equal(allowsNativeInteraction(target(null, true)), true);
  assert.equal(shouldPreventOverscroll(target(null, true), 20), false);
});

test("root gestures and scroll-boundary pull gestures are blocked", () => {
  assert.equal(shouldPreventOverscroll(target(), 20), true);
  assert.equal(shouldPreventOverscroll(target({ scrollHeight: 100, clientHeight: 100, scrollTop: 0 }), 20), true);
  assert.equal(shouldPreventOverscroll(target({ scrollHeight: 300, clientHeight: 100, scrollTop: 0 }), 20), true);
  assert.equal(shouldPreventOverscroll(target({ scrollHeight: 300, clientHeight: 100, scrollTop: 200 }), -20), true);
});

test("internal screens can scroll away from their boundaries", () => {
  const scroller = { scrollHeight: 300, clientHeight: 100, scrollTop: 80 };
  assert.equal(shouldPreventOverscroll(target(scroller), 20), false);
  assert.equal(shouldPreventOverscroll(target(scroller), -20), false);
});
