import test from "node:test";
import assert from "node:assert/strict";
import { NeonGame } from "../src/game.js";
import { solveLevel } from "../src/level-validator.js";
import { LEVELS } from "../src/levels.js";
import { SKINS } from "../src/skins.js";

const audio = new Proxy({}, { get: () => () => {} });

function finishDash(game, dt = 1 / 60) {
  for (let frame = 0; game.player.direction && game.state === "playing" && frame < 2_000; frame += 1) game.update(dt);
  assert.equal(game.player.direction, null, `level ${game.level.id} dash did not stop`);
}

function playRoute(level, route, collectCoins = false, dt = 1 / 60) {
  const game = new NeonGame(audio);
  game.load(level, SKINS[0]);
  for (const direction of route) {
    assert.equal(game.input(direction), true, `level ${level.id} rejected ${direction} at ${game.player.x},${game.player.y}`);
    finishDash(game, dt);
    assert.notEqual(game.state, "dead", `level ${level.id} route hit a dynamic hazard at ${Math.round(1 / dt)} FPS`);
  }
  assert.equal(game.state, "won", `level ${level.id} route ended at ${game.player.x},${game.player.y} with ${game.dots.size} dots`);
  if (collectCoins) assert.equal(game.coins.size, 0, `level ${level.id} reward route left ${game.coins.size} coins`);
}

test("all stored campaign routes complete with real hazards enabled", () => {
  for (const level of LEVELS) {
    const rewardRoute = solveLevel(level, { coins: level.coins });
    for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
      playRoute(level, level.solution, false, dt);
      playRoute(level, rewardRoute, true, dt);
    }
  }
});

test("debug invulnerability crosses static hazards without interrupting a dash", () => {
  const level = {
    id: 3, width: 7, height: 5,
    rows: ["#######", "#######", "#.....#", "#######", "#######"],
    start: [1, 2], exit: [5, 2], dots: [], coins: [], mechanics: { spikes: [[3, 2]] },
  };
  const game = new NeonGame(audio);
  game.load(level, SKINS[0]); game.invulnerable = true;
  assert.equal(game.input("right"), true); finishDash(game);
  assert.equal(game.state, "won");
});
