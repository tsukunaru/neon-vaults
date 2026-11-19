import test from "node:test";
import assert from "node:assert/strict";
import { NeonGame } from "../src/game.js";
import { LEVELS } from "../src/levels.js";
import { SKINS } from "../src/skins.js";

const audio = new Proxy({}, { get: () => () => {} });

function tick(game, seconds = 2) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.016) game.update(0.016);
}

test("tutorial can be completed with two buffered dash gestures", () => {
  let result = null;
  const game = new NeonGame(audio, { onWin: (value) => { result = value; } });
  game.load(LEVELS[0], SKINS[0]);
  assert.equal(game.input("up"), true);
  game.input("right");
  tick(game, 2);
  assert.equal(game.state, "won");
  assert.ok(result);
  assert.equal(result.cores, 3);
  assert.equal(result.coins, 1);
});

test("a lethal collision resolves to the non-violent dead state", () => {
  const level = {
    id: 3, width: 5, height: 5,
    rows: ["#####", "#####", "#...#", "#####", "#####"],
    start: [1, 2], exit: [3, 2], dots: [], coins: [], mechanics: { spikes: [[2, 2]] },
  };
  const game = new NeonGame(audio);
  game.load(level, SKINS[0]); game.input("right"); tick(game, 0.3);
  assert.equal(game.state, "dead");
  assert.ok(game.particles.length > 10);
});

test("breakable blocks open after one impact and remain deterministic", () => {
  const level = {
    id: 60, width: 7, height: 5,
    rows: ["#######", "#######", "#.#...#", "#######", "#######"],
    start: [1, 2], exit: [5, 2], dots: [], coins: [], mechanics: { breakables: [[2, 2]] },
  };
  const game = new NeonGame(audio);
  game.load(level, SKINS[0]);
  assert.equal(game.input("right"), false);
  assert.ok(game.brokenBreakables.has("2,2"));
  assert.equal(game.input("right"), true); tick(game, 1);
  assert.equal(game.state, "won");
});

test("a breakable secret is revealed once and reports its reward", () => {
  let found = null;
  const level = {
    id: 70, width: 7, height: 5,
    rows: ["#######", "#######", "#.#...#", "#######", "#######"],
    start: [1, 2], exit: [5, 2], dots: [], coins: [],
    mechanics: { breakables: [[2, 2]], secrets: [{ id: "70-0", x: 2, y: 2, kind: "cache", coins: 35 }] },
  };
  const game = new NeonGame(audio, { onSecret: (secret) => { found = secret; } });
  game.load(level, SKINS[0]);
  assert.equal(game.input("right"), false);
  assert.equal(found.id, "70-0");
  assert.ok(game.foundSecrets.has("2,2"));
  assert.equal(game.snapshot().bonusMask, 1);
});

test("secret overdrive briefly increases movement speed and is visible in snapshot", () => {
  const level = {
    id: 71, width: 9, height: 5,
    rows: ["#########", "#########", "#.......#", "#########", "#########"],
    start: [1, 2], exit: [7, 2], dots: [], coins: [], mechanics: {},
  };
  const normal = new NeonGame(audio); normal.load(level, SKINS[0]); normal.input("right"); normal.update(0.01);
  const boosted = new NeonGame(audio); boosted.load(level, SKINS[0]); boosted.secretBoostUntil = 8; boosted.input("right"); boosted.update(0.01);
  assert.ok(boosted.player.progress > normal.player.progress);
  assert.ok(boosted.snapshot().boost > 0);
});

test("exit portal stays locked until every required dot is collected", () => {
  let locked = 0;
  const level = {
    id: 2, width: 5, height: 5,
    rows: ["#####", "#.#.#", "#...#", "#####", "#####"],
    start: [1, 2], exit: [3, 2], dots: [[1, 1]], coins: [], mechanics: {},
  };
  const game = new NeonGame(audio, { onPortalLocked: () => { locked += 1; } });
  game.load(level, SKINS[0]); game.input("right"); tick(game, 0.4);
  assert.equal(game.state, "playing");
  assert.equal(locked, 1);
  assert.equal(game.player.x, 2);
  assert.ok(game.portalFlash > 0);
});

test("the final three dots receive an idle hint", () => {
  const level = {
    id: 8, width: 5, height: 5,
    rows: ["#####", "#...#", "#...#", "#...#", "#####"],
    start: [1, 3], exit: [3, 1], dots: [[2, 2], [3, 2], [3, 1]], coins: [], mechanics: {},
  };
  let hints = 0;
  const game = new NeonGame(audio, { onHint: () => { hints += 1; } });
  game.load(level, SKINS[0]); tick(game, 7);
  assert.ok(game.hintDot);
  assert.equal(hints, 1);
});

test("checkpoint restores collected route state after death", () => {
  const level = {
    id: 20, width: 7, height: 5,
    rows: ["#######", "#######", "#.....#", "#######", "#######"],
    start: [1, 2], exit: [1, 2], dots: [[2, 2]], coins: [[2, 2]], mechanics: { checkpoints: [[3, 2]], spikes: [[5, 2]] },
  };
  const game = new NeonGame(audio);
  game.load(level, SKINS[0]); game.input("right"); tick(game, 0.5);
  assert.equal(game.state, "dead");
  assert.equal(game.respawnFromCheckpoint(), true);
  assert.deepEqual([game.player.x, game.player.y], [3, 2]);
  assert.equal(game.collectedDots, 1);
  assert.equal(game.dots.size, 0);
  assert.equal(game.snapshot().bonusMask, 1);
});

test("coin-aware completion rates against the exact collected bonus mask", () => {
  const level = {
    id: 9, width: 3, height: 3, rows: ["###", "#.#", "###"], start: [1, 1], exit: [1, 1],
    dots: [], coins: [[1, 1]], mechanics: {}, minMoves: 8, optimalDashesByBonusMask: [8, 10],
  };
  let result;
  const game = new NeonGame(audio, { onWin: (value) => { result = value; } });
  game.load(level, SKINS[0]); game.bonusMask = 1; game.dashCount = 10; game.win();
  assert.equal(result.standardPar, 8);
  assert.equal(result.par, 10);
  assert.equal(result.cores, 3);
  game.load(level, SKINS[0]); game.bonusMask = 1; game.dashCount = 15; game.win();
  assert.equal(result.cores, 1);
});

test("core rating rewards an efficient dash route", () => {
  const level = { id: 9, width: 3, height: 3, rows: ["###", "#.#", "###"], start: [1, 1], exit: [1, 1], dots: [], coins: [], mechanics: {}, minMoves: 4 };
  let result;
  const game = new NeonGame(audio, { onWin: (value) => { result = value; } });
  game.load(level, SKINS[0]); game.dashCount = 5; game.win();
  assert.equal(result.cores, 2);
  game.load(level, SKINS[0]); game.dashCount = 7; game.win();
  assert.equal(result.cores, 1);
});

test("a completed level exports a compact personal route", () => {
  const level = { id: 9, width: 5, height: 3, rows: ["#####", "#...#", "#####"], start: [1, 1], exit: [3, 1], dots: [], coins: [], mechanics: {}, minMoves: 1 };
  let result;
  const game = new NeonGame(audio, { onWin: (value) => { result = value; } });
  game.load(level, SKINS[0]); game.input("right"); tick(game, 0.5);
  assert.deepEqual(result.route.directions, ["right"]);
  assert.equal(result.route.totalDashes, 1);
  assert.equal(result.route.timings.length, 1);
});

test("personal ghost replays without collisions or changing player state", () => {
  const level = { id: 9, width: 5, height: 3, rows: ["#####", "#...#", "#####"], start: [1, 1], exit: [3, 1], dots: [], coins: [], mechanics: {}, minMoves: 1 };
  const game = new NeonGame(audio);
  game.load(level, SKINS[0], { directions: ["right"], timings: [0] });
  tick(game, 0.5);
  assert.equal(game.ghost.active, false);
  assert.deepEqual([game.player.x, game.player.y], [1, 1]);
  assert.equal(game.state, "playing");
});

test("personal ghost crosses a breakable opened by an unrecorded impact", () => {
  const level = {
    id: 60, width: 7, height: 5,
    rows: ["#######", "#######", "#.#...#", "#######", "#######"],
    start: [1, 2], exit: [5, 2], dots: [], coins: [], mechanics: { breakables: [[2, 2]] },
  };
  let result;
  const run = new NeonGame(audio, { onWin: (value) => { result = value; } }); run.load(level, SKINS[0]);
  assert.equal(run.input("right"), false); assert.equal(run.input("right"), true); tick(run, 1);
  const route = result.route;
  assert.deepEqual(route.directions, ["right"]);
  const replay = new NeonGame(audio); replay.load(level, SKINS[0], route); tick(replay, 1);
  assert.equal(replay.ghost.x, 5); assert.equal(replay.ghost.active, false);
});

test("one-way cells reject the wrong direction and allow the marked direction", () => {
  const base = {
    id: 71, width: 7, height: 5,
    rows: ["#######", "#######", "#.....#", "#######", "#######"],
    exit: [5, 2], dots: [], coins: [], mechanics: { oneWays: [{ x: 2, y: 2, dir: "right" }] },
  };
  const blocked = new NeonGame(audio); blocked.load({ ...base, start: [3, 2] }, SKINS[0]);
  assert.equal(blocked.input("left"), false);
  assert.deepEqual([blocked.player.x, blocked.player.y], [3, 2]);
  const allowed = new NeonGame(audio); allowed.load({ ...base, start: [1, 2] }, SKINS[0]);
  assert.equal(allowed.input("right"), true); tick(allowed, 0.5);
  assert.equal(allowed.state, "won");
});

test("switches open gates during the same dash", () => {
  const level = {
    id: 86, width: 7, height: 5,
    rows: ["#######", "#######", "#.....#", "#######", "#######"],
    start: [1, 2], exit: [5, 2], dots: [], coins: [],
    mechanics: { switches: [{ x: 2, y: 2, group: "a" }], gates: [{ x: 3, y: 2, group: "a" }] },
  };
  const game = new NeonGame(audio); game.load(level, SKINS[0]);
  assert.equal(game.input("right"), true); tick(game, 0.5);
  assert.ok(game.openGroups.has("a"));
  assert.equal(game.state, "won");
});

test("portals teleport, stop the current dash, and preserve completion", () => {
  const level = {
    id: 101, width: 7, height: 5,
    rows: ["#######", "#.....#", "#.....#", "#######", "#######"],
    start: [1, 2], exit: [5, 1], dots: [], coins: [],
    mechanics: { portals: [{ a: [3, 2], b: [1, 1], color: "cyan" }] },
  };
  const game = new NeonGame(audio); game.load(level, SKINS[0]);
  game.input("right"); tick(game, 0.5);
  assert.deepEqual([game.player.x, game.player.y], [1, 1]);
  assert.equal(game.state, "playing");
  game.input("right"); tick(game, 0.5);
  assert.equal(game.state, "won");
});

test("redirects turn an active dash without adding a move", () => {
  const level = {
    id: 161, width: 5, height: 5,
    rows: ["#####", "###.#", "###.#", "#...#", "#####"],
    start: [1, 3], exit: [3, 1], dots: [], coins: [],
    mechanics: { redirects: [{ x: 3, y: 3, dir: "up" }] }, minMoves: 1,
  };
  const game = new NeonGame(audio); game.load(level, SKINS[0]);
  game.input("right"); tick(game, 0.5);
  assert.equal(game.state, "won");
  assert.equal(game.dashCount, 1);
});

test("crumbled cells become solid after Spark leaves them", () => {
  const level = {
    id: 181, width: 5, height: 5,
    rows: ["#####", "#...#", "###.#", "#...#", "#####"],
    start: [1, 3], exit: [1, 1], dots: [], coins: [], mechanics: { crumbles: [[3, 3]] },
  };
  const game = new NeonGame(audio); game.load(level, SKINS[0]);
  game.input("right"); tick(game, 0.3); game.input("up"); tick(game, 0.3);
  assert.ok(game.crumbleBlocked.has("3,3"));
  game.input("down"); tick(game, 0.3);
  assert.deepEqual([game.player.x, game.player.y], [3, 2]);
});

test("timed spikes expose a safe phase and a lethal phase", () => {
  const level = {
    id: 11, width: 7, height: 5,
    rows: ["#######", "#######", "#.....#", "#######", "#######"],
    start: [1, 2], exit: [5, 2], dots: [], coins: [], mechanics: { timedSpikes: [{ x: 3, y: 2, period: 2, phase: 0 }] },
  };
  const lethal = new NeonGame(audio); lethal.load(level, SKINS[0]); lethal.input("right"); tick(lethal, 0.3);
  assert.equal(lethal.state, "dead");
  const safe = new NeonGame(audio); safe.load(level, SKINS[0]); safe.elapsed = 1.2; safe.input("right"); tick(safe, 0.3);
  assert.equal(safe.state, "won");
});

test("movers, sentinels, pulses, and cannon shots all trigger hazards", () => {
  const base = {
    id: 201, width: 7, height: 5,
    rows: ["#######", "#######", "#.....#", "#######", "#######"],
    start: [3, 2], exit: [5, 2], dots: [], coins: [],
  };
  for (const mechanics of [
    { movers: [{ from: [3, 2], to: [3, 2], period: 2, phase: 0 }] },
    { enemies: [{ path: [[3, 2], [3, 2]], period: 2, phase: 0 }] },
    { pulses: [{ x: 3, y: 2, period: 2, phase: 0 }] },
  ]) {
    const game = new NeonGame(audio); game.load({ ...base, mechanics }, SKINS[0]); game.checkDynamicHazards();
    assert.equal(game.state, "dead");
  }
  const cannon = new NeonGame(audio);
  cannon.load({ ...base, mechanics: { cannons: [{ x: 3, y: 2, dir: "right", period: 2, phase: 0 }] } }, SKINS[0]);
  cannon.elapsed = 0.2; cannon.updateCannons(); cannon.checkDynamicHazards();
  assert.equal(cannon.projectiles.length, 1);
  assert.equal(cannon.state, "dead");
});

test("expired frame effects are compacted without replacing their arrays", () => {
  const level = {
    id: 1, width: 7, height: 5,
    rows: ["#######", "#######", "#.....#", "#######", "#######"],
    start: [1, 2], exit: [5, 2], dots: [], coins: [], mechanics: {},
  };
  const game = new NeonGame(audio); game.load(level, SKINS[0]);
  game.projectiles.push({ x: 2, y: 2, dx: 0, dy: 0, life: 1 }, { x: 2, y: 2, dx: 0, dy: 0, life: 0 });
  game.particles.push({ x: 2, y: 2, vx: 0, vy: 0, life: 1 }, { x: 2, y: 2, vx: 0, vy: 0, life: 0 });
  game.trails.push({ life: 1 }, { life: 0 });
  const projectiles = game.projectiles; const particles = game.particles; const trails = game.trails;
  game.updateProjectiles(0.01); game.updateParticles(0.01);
  assert.equal(game.projectiles, projectiles); assert.equal(game.projectiles.length, 1);
  assert.equal(game.particles, particles); assert.equal(game.particles.length, 1);
  assert.equal(game.trails, trails); assert.equal(game.trails.length, 1);
});
