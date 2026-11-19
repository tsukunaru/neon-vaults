import test from "node:test";
import assert from "node:assert/strict";
import { buildEndlessRoute } from "../src/hero-preview.js";

test("hero preview route is deterministic, continuous, and has optional branches", () => {
  const first = buildEndlessRoute(180, 42);
  const second = buildEndlessRoute(180, 42);
  assert.deepEqual(first.route, second.route);
  assert.ok(first.branches.length > 0);
  assert.equal(first.route.length, 181);
  for (let index = 1; index < first.route.length; index += 1) {
    const previous = first.route[index - 1];
    const current = first.route[index];
    assert.equal(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y), 1);
  }
});
