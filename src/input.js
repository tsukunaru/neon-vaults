import { KEY_DIRECTIONS } from "./config.js";

const LEGACY_KEY_DIRECTIONS = {
  37: "left", 38: "up", 39: "right", 40: "down",
  65: "left", 68: "right", 83: "down", 87: "up",
};

function matchingTouch(touches, id) {
  for (let index = 0; index < touches.length; index += 1) {
    if (touches[index].identifier === id) return touches[index];
  }
  return null;
}

export class InputController {
  constructor(element, onDirection, threshold = 18) {
    this.element = element;
    this.onDirection = onDirection;
    this.threshold = threshold;
    this.pointer = null;
    this.enabled = true;
    this.keydown = (event) => {
      const direction = KEY_DIRECTIONS[event.code] || LEGACY_KEY_DIRECTIONS[event.keyCode];
      if (!this.enabled || !direction) return;
      event.preventDefault();
      this.onDirection(direction, "keyboard");
    };
    this.begin = (id, x, y) => {
      if (!this.enabled || this.pointer) return false;
      this.pointer = { id, x, y };
      return true;
    };
    this.complete = (id, x, y, source) => {
      if (!this.enabled || !this.pointer || this.pointer.id !== id) return;
      const dx = x - this.pointer.x;
      const dy = y - this.pointer.y;
      this.pointer = null;
      if (Math.hypot(dx, dy) < this.threshold) return;
      this.onDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"), source);
    };
    this.pointerdown = (event) => {
      if (!this.enabled || event.button > 0) return;
      if (this.begin(event.pointerId, event.clientX, event.clientY)) this.element.setPointerCapture?.(event.pointerId);
    };
    this.pointerup = (event) => this.complete(event.pointerId, event.clientX, event.clientY, "pointer");
    this.touchstart = (event) => {
      const touch = event.changedTouches[0];
      if (touch) this.begin(touch.identifier, touch.clientX, touch.clientY);
    };
    this.touchend = (event) => {
      if (!this.pointer) return;
      const touch = matchingTouch(event.changedTouches, this.pointer.id);
      if (touch) this.complete(touch.identifier, touch.clientX, touch.clientY, "touch");
    };
    this.touchmove = (event) => { if (this.enabled && this.pointer) event.preventDefault(); };
    this.mousedown = (event) => { if (event.button <= 0) this.begin(0, event.clientX, event.clientY); };
    this.mouseup = (event) => this.complete(0, event.clientX, event.clientY, "mouse");
    this.cancel = () => { this.pointer = null; };
    window.addEventListener("keydown", this.keydown, { passive: false });
    if (window.PointerEvent) {
      this.inputMode = "pointer";
      element.addEventListener("pointerdown", this.pointerdown, { passive: true });
      element.addEventListener("pointerup", this.pointerup, { passive: true });
      element.addEventListener("pointercancel", this.cancel, { passive: true });
    } else if ("ontouchstart" in window) {
      this.inputMode = "touch";
      element.addEventListener("touchstart", this.touchstart, { passive: true });
      element.addEventListener("touchmove", this.touchmove, { passive: false });
      element.addEventListener("touchend", this.touchend, { passive: true });
      element.addEventListener("touchcancel", this.cancel, { passive: true });
    } else {
      this.inputMode = "mouse";
      element.addEventListener("mousedown", this.mousedown, { passive: true });
      window.addEventListener("mouseup", this.mouseup, { passive: true });
    }
  }

  setEnabled(enabled) { this.enabled = Boolean(enabled); if (!enabled) this.cancel(); }
  setThreshold(threshold) { this.threshold = Math.max(8, Number(threshold) || 18); }

  destroy() {
    window.removeEventListener("keydown", this.keydown);
    if (this.inputMode === "pointer") {
      this.element.removeEventListener("pointerdown", this.pointerdown);
      this.element.removeEventListener("pointerup", this.pointerup);
      this.element.removeEventListener("pointercancel", this.cancel);
    } else if (this.inputMode === "touch") {
      this.element.removeEventListener("touchstart", this.touchstart);
      this.element.removeEventListener("touchmove", this.touchmove, { passive: false });
      this.element.removeEventListener("touchend", this.touchend);
      this.element.removeEventListener("touchcancel", this.cancel);
    } else {
      this.element.removeEventListener("mousedown", this.mousedown);
      window.removeEventListener("mouseup", this.mouseup);
    }
  }
}
