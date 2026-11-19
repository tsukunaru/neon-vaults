import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/levels.js";
import {
  analyzeLevelQuality, bonusCoinReachability, solutionCollectsEveryDot, solveLevel, validateAllLevels, validateLevel,
} from "../src/level-validator.js";
import { levelKindFor, routeMoveTarget } from "../src/config.js";

test("all 250 static layouts are unique and independently solvable", () => {
  assert.equal(LEVELS.length, 250);
  assert.equal(new Set(LEVELS.map((level) => level.rows.join("/"))).size, 250);
  const report = validateAllLevels(LEVELS);
  if (!report.valid) {
    const failures = report.results.filter((result) => !result.valid).slice(0, 10);
    assert.fail(JSON.stringify(failures, null, 2));
  }
  assert.equal(report.passed, 250);
});

test("level ids, milestones, exits, and production metadata are complete", () => {
  LEVELS.forEach((level, index) => {
    assert.equal(level.id, index + 1);
    assert.ok(level.dots.length > 0);
    assert.ok(level.coins.length > 0);
    assert.ok(level.minMoves >= 1);
    assert.ok(level.expectedSeconds >= 10);
    assert.ok(Array.isArray(level.solution) && level.solution.length >= 1);
    assert.equal(solutionCollectsEveryDot(level), true);
    assert.equal(level.levelKind, levelKindFor(level.id));
    assert.equal(level.minMoves, level.solution.length);
    assert.deepEqual(level.quality, analyzeLevelQuality(level));
    assert.ok(level.solution.length >= routeMoveTarget(level.id));
    assert.ok(level.quality.alternativeRoutes >= 0 && level.quality.deadEnds >= 0);
    assert.ok(level.quality.objectiveBranches >= 0 && level.quality.objectiveDetourMoves >= 0);
    assert.ok(level.quality.rewardDetourMoves >= 0 && level.quality.combinedRewardDetourMoves >= 0 && level.quality.meaningfulDecisions >= 0);
    assert.ok(level.quality.trapDensity >= 0 && level.quality.reactionLoad >= 0);
    assert.equal(bonusCoinReachability(level).reachable, true);
  });
  assert.ok(LEVELS[99].mechanics.checkpoints.length > 0);
  assert.ok(LEVELS[249].mechanics.checkpoints.length > 0);
});

test("required routes grow across the campaign", () => {
  const averages = [[2, 20], [51, 100], [101, 150], [201, 250]].map(([from, to]) => {
    const routes = LEVELS.slice(from - 1, to).map((level) => level.solution.length);
    return routes.reduce((sum, value) => sum + value, 0) / routes.length;
  });
  assert.ok(averages[1] > averages[0] + 4, JSON.stringify(averages));
  assert.ok(averages[2] > averages[1] + 4, JSON.stringify(averages));
  assert.ok(averages[3] > averages[2] + 8, JSON.stringify(averages));
  assert.ok(routeMoveTarget(20) > routeMoveTarget(19));
  assert.ok(routeMoveTarget(240) > routeMoveTarget(239));
});

test("tutorial teaches exactly up then right", () => {
  assert.deepEqual(LEVELS[0].solution, ["up", "right"]);
  assert.deepEqual(LEVELS[0].start, [1, 9]);
  assert.deepEqual(LEVELS[0].exit, [7, 5]);
});

test("early campaign introduces mechanics in readable steps", () => {
  assert.deepEqual(LEVELS[1].mechanics, {});
  assert.deepEqual(LEVELS[1].featureNames, ["movement"]);
  assert.ok(LEVELS[2].mechanics.spikes.length > 0);
  assert.equal(LEVELS[9].mechanics.timedSpikes, undefined);
  assert.ok(LEVELS[10].mechanics.timedSpikes.length > 0);
});

const puzzle = (overrides = {}) => ({
  id: 1,
  width: 7,
  height: 7,
  rows: ["#######", "###.###", "###.###", "#...###", "###.###", "###.###", "#######"],
  start: [1, 3],
  exit: [3, 1],
  dots: [[3, 5]],
  coins: [],
  mechanics: {},
  solution: ["right", "down", "up"],
  minMoves: 3,
  ...overrides,
});

test("solver collects required dots before accepting the exit", () => {
  const level = puzzle();
  assert.deepEqual(solveLevel(level), ["right", "down", "up"]);
  assert.equal(solutionCollectsEveryDot(level), true);
  assert.equal(solutionCollectsEveryDot(level, ["right", "up"]), false);
  assert.deepEqual(analyzeLevelQuality(level), {
    routeMoves: 3,
    uniqueCells: 6,
    decisionStops: 1,
    meaningfulDecisions: 1,
    deadEnds: 2,
    alternativeRoutes: 2,
    revisitedStops: 0,
    backtracks: 1,
    objectiveBranches: 1,
    objectiveDetourMoves: 1,
    rewardDetourMoves: 0,
    combinedRewardDetourMoves: 0,
    forcedHazardObjectives: 0,
    trapDensity: 0,
    reactionLoad: 0,
  });
});

test("solver models switches and does not treat lethal spikes as stopping walls", () => {
  const switched = puzzle({
    mechanics: {
      switches: [{ x: 3, y: 5, group: "a", timed: true }],
      gates: [{ x: 3, y: 2, group: "a", timed: true, duration: 3.6 }],
    },
  });
  assert.deepEqual(solveLevel(switched), ["right", "down", "up"]);

  const lethal = puzzle({
    width: 7,
    height: 5,
    rows: ["#######", "##.####", "##.####", "#...###", "#######"],
    start: [1, 3],
    exit: [2, 1],
    dots: [],
    mechanics: { spikes: [[3, 3]] },
    solution: ["right", "up"],
  });
  assert.equal(solveLevel(lethal), null);
  assert.equal(solutionCollectsEveryDot(lethal), false);
});

test("every bonus coin must be collectible without abandoning level completion", () => {
  const reachable = puzzle({ dots: [[2, 3]], coins: [[3, 5]], solution: ["right", "down", "up"] });
  assert.deepEqual(bonusCoinReachability(reachable), {
    reachable: true,
    combinedReachable: true,
    unreachable: [],
    detourMoves: [1],
    minimumDetourMoves: 1,
    combinedDetourMoves: 1,
    truncated: false,
  });

  const isolated = puzzle({
    rows: ["#######", "###.#.#", "###.###", "#...###", "###.###", "###.###", "#######"],
    dots: [[2, 3]],
    coins: [[5, 1]],
    solution: ["right", "up"],
  });
  assert.deepEqual(bonusCoinReachability(isolated).unreachable, [[5, 1]]);
  assert.match(validateLevel(isolated).errors.join("\n"), /bonus coin is not collectible/);

  const mutuallyExclusive = puzzle({
    width: 9,
    height: 11,
    rows: ["#########", "#.......#", "#.#####.#", "#...#.#.#", "#.#.#...#", "#.#.#.#.#", "###.#.#.#", "#...#.#.#", "#.#.#.#.#", "#.#.....#", "#########"],
    start: [1, 9],
    exit: [7, 9],
    dots: [[3, 9]],
    coins: [[5, 9], [2, 1]],
    mechanics: { oneWays: [{ x: 7, y: 3, dir: "down" }, { x: 7, y: 4, dir: "down" }, { x: 1, y: 7, dir: "up" }] },
    solution: [],
  });
  const combined = bonusCoinReachability(mutuallyExclusive);
  assert.deepEqual(combined.unreachable, []);
  assert.equal(combined.combinedReachable, false);
  assert.equal(combined.reachable, false);

  const lethalReward = puzzle({ dots: [[2, 3]], coins: [[3, 5]], mechanics: { spikes: [[3, 5]] }, solution: ["right", "up"] });
  assert.match(validateLevel(lethalReward).errors.join("\n"), /bonus coin on permanent spike/);
});

test("linearity rules use objective branches and required detours", () => {
  const linear = puzzle({
    id: 5,
    width: 7,
    height: 3,
    rows: ["#######", "#.....#", "#######"],
    start: [1, 1],
    exit: [5, 1],
    dots: [[3, 1]],
    solution: ["right"],
    minMoves: 1,
  });
  const errors = validateLevel(linear).errors.join("\n");
  assert.match(errors, /objective branches/);
  assert.match(errors, /meaningful detour/);
});

test("validator rejects malformed mechanic coordinates and timing", () => {
  const malformed = puzzle({
    mechanics: {
      breakables: [[3, 3]],
      pulses: [{ x: 3, y: 5, period: 0 }],
      cannons: [{ x: 99, y: 99, dir: "sideways", period: -1 }],
      movers: [{ from: [3, 3], to: [30, 30], period: 0 }],
      enemies: [{ path: [[3, 3]], period: 2 }],
      gates: [{ x: 3, y: 2, group: "missing", timed: true, duration: 0 }],
    },
  });
  const errors = validateLevel(malformed).errors.join("\n");
  assert.match(errors, /breakable must replace a wall/);
  assert.match(errors, /pulse has an invalid period/);
  assert.match(errors, /cannon is out of bounds/);
  assert.match(errors, /cannon has an invalid direction/);
  assert.match(errors, /mover end is out of bounds/);
  assert.match(errors, /enemy has an invalid path/);
  assert.match(errors, /gate without switch/);
  assert.match(errors, /timed gate has an invalid duration/);
});
