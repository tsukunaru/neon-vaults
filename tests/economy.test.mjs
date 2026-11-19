import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/levels.js";
import { regularChestPrice, vaultChestPrice } from "../src/skins.js";

test("chest prices stay inside the intended progression cadence", () => {
  const averageLevelCoins = LEVELS.reduce((sum, level) => sum + level.coins.length * 12 + 5, 0) / LEVELS.length;
  assert.ok(regularChestPrice(1) / averageLevelCoins >= 8 && regularChestPrice(1) / averageLevelCoins <= 12);
  assert.ok(vaultChestPrice(0) >= 20 && vaultChestPrice(11) <= 31);
});
