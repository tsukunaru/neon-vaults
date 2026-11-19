import test from "node:test";
import assert from "node:assert/strict";
import { nextSafeMove } from "../src/assist.js";
import { NeonGame } from "../src/game.js";
import { LEVELS } from "../src/levels.js";
import { SKINS } from "../src/skins.js";

const audio = new Proxy({}, { get: () => () => {} });

test("adaptive assist reuses the level solver and returns a safe opening dash", () => {
  const game = new NeonGame(audio);
  game.load(LEVELS[24], SKINS[0]);
  assert.equal(nextSafeMove(game), LEVELS[24].solution[0]);
  game.player.direction = "up";
  assert.equal(nextSafeMove(game), null);
});
