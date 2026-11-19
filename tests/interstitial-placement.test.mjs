import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("NEXT requests interstitial without an artificial delay or warning", () => {
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const start = source.indexOf("if (adDue)");
  const end = source.indexOf("playLevel(completed + 1)", start);
  const placement = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(placement, /await adapter\.fullscreen\(\)/);
  assert.doesNotMatch(placement, /setTimeout|countdown|ad-warning/i);
});
