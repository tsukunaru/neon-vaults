import test from "node:test";
import assert from "node:assert/strict";
import { InputController } from "../src/input.js";

class FakeTarget {
  constructor() { this.listeners = {}; this.options = {}; this.captures = []; }
  addEventListener(type, listener, options) { (this.listeners[type] ||= []).push(listener); this.options[type] = options; }
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== listener); }
  emit(type, event = {}) { (this.listeners[type] || []).slice().forEach((listener) => listener(event)); }
  setPointerCapture(id) { this.captures.push(id); }
}

test("pointer-capable browsers do not also bind the touch fallback", () => {
  const previousWindow = globalThis.window;
  const fakeWindow = new FakeTarget();
  fakeWindow.PointerEvent = class {};
  globalThis.window = fakeWindow;
  try {
    const element = new FakeTarget();
    const directions = [];
    const input = new InputController(element, (...args) => directions.push(args));
    let prevented = 0;
    fakeWindow.emit("keydown", { keyCode: 37, preventDefault: () => { prevented += 1; } });
    element.emit("pointerdown", { button: 0, pointerId: 4, clientX: 5, clientY: 5 });
    element.emit("pointerup", { pointerId: 4, clientX: 45, clientY: 5 });
    element.emit("touchstart", { changedTouches: [{ identifier: 4, clientX: 5, clientY: 5 }] });
    element.emit("touchend", { changedTouches: [{ identifier: 4, clientX: 45, clientY: 5 }] });
    assert.deepEqual(directions, [["left", "keyboard"], ["right", "pointer"]]);
    assert.equal(prevented, 1);
    assert.deepEqual(element.captures, [4]);
    input.destroy();
  } finally {
    globalThis.window = previousWindow;
  }
});

test("touch fallback emits one swipe when Pointer Events are unavailable", () => {
  const previousWindow = globalThis.window;
  const fakeWindow = new FakeTarget();
  fakeWindow.ontouchstart = null;
  globalThis.window = fakeWindow;
  try {
    const element = new FakeTarget();
    const directions = [];
    const input = new InputController(element, (...args) => directions.push(args));
    let prevented = 0;
    element.emit("touchstart", { changedTouches: [{ identifier: 7, clientX: 20, clientY: 40 }] });
    element.emit("touchmove", { preventDefault: () => { prevented += 1; } });
    element.emit("touchend", { changedTouches: [{ identifier: 7, clientX: 20, clientY: 5 }] });
    element.emit("pointerdown", { button: 0, pointerId: 7, clientX: 20, clientY: 40 });
    element.emit("pointerup", { pointerId: 7, clientX: 20, clientY: 5 });
    assert.deepEqual(directions, [["up", "touch"]]);
    assert.equal(prevented, 1);
    assert.equal(element.options.touchmove.passive, false);
    input.destroy();
    element.emit("touchmove", { preventDefault: () => { prevented += 1; } });
    assert.equal(prevented, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});
