import test from "node:test";
import assert from "node:assert/strict";
import { staticLayerKey } from "../src/renderer.js";

test("renderer static layer key changes when breakable state changes", () => {
  const game = { level: { id: 4, width: 9, height: 11 }, breakables: new Set(["2,2"]), brokenBreakables: new Set() };
  const layout = { x: 10, y: 20, tile: 24 };
  const initial = staticLayerKey(game, layout);
  game.brokenBreakables.add("2,2");
  assert.notEqual(staticLayerKey(game, layout), initial);
});
