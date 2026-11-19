import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/levels.js";
import { solveBonusMasks } from "../src/level-validator.js";
import { bonusObjectives, coresForDashes, effectivePar } from "../src/rating.js";

const corridor = (rows, overrides = {}) => ({
  id: 1,
  width: rows[0].length,
  height: rows.length,
  rows,
  start: [1, 2],
  exit: [rows[0].length - 2, 2],
  dots: [],
  coins: [],
  mechanics: {},
  ...overrides,
});

test("rating helpers keep bonus order and apply the original core thresholds", () => {
  const level = {
    coins: [[2, 3], [4, 5]],
    mechanics: { secrets: [
      { x: 6, y: 7, kind: "cache", coins: 25, vaultCoins: 0 },
      { x: 8, y: 9, kind: "boost", coins: 0, vaultCoins: 0, effect: "overdrive" },
      { x: 10, y: 11, kind: "crystal", coins: 0, vaultCoins: 1 },
    ] },
  };
  assert.deepEqual(bonusObjectives(level), [
    { x: 2, y: 3, type: "coin" },
    { x: 4, y: 5, type: "coin" },
    { x: 6, y: 7, type: "secret" },
    { x: 10, y: 11, type: "secret" },
  ]);
  assert.deepEqual([coresForDashes(10, 10), coresForDashes(13, 10), coresForDashes(14, 10)], [3, 2, 1]);
  assert.equal(effectivePar({ optimalDashesByBonusMask: [4, null, 7], minMoves: 5 }, 2), 7);
  assert.equal(effectivePar({ optimalDashesByBonusMask: [4, null, 7], minMoves: 5 }, 1), 5);
  assert.equal(effectivePar({ minMoves: 6 }, 3), 6);
});

test("bonus solver counts a stationary break impact as an action but not a dash", () => {
  const level = corridor(["#######", "#######", "#.#...#", "#######", "#######"], {
    coins: [[4, 2]],
    mechanics: {
      breakables: [[2, 2]],
      secrets: [{ id: "test-secret", x: 2, y: 2, kind: "cache", coins: 25, vaultCoins: 0 }],
    },
  });
  const result = solveBonusMasks(level);
  assert.deepEqual(result.optimalDashesByBonusMask, [null, null, null, 1]);
  assert.deepEqual(result.standardSolution, ["right"]);
  assert.deepEqual(result.bonusSolutionsByMask[3].actions, [
    { direction: "right", counted: false },
    { direction: "right", counted: true },
  ]);
});

test("bonus solver counts a moving dash that stops after breaking a wall", () => {
  const level = corridor(["########", "########", "#..#...#", "########", "########"], {
    coins: [[5, 2]],
    mechanics: {
      breakables: [[3, 2]],
      secrets: [{ id: "test-secret", x: 3, y: 2, kind: "crystal", coins: 0, vaultCoins: 1 }],
    },
  });
  const result = solveBonusMasks(level);
  assert.equal(result.optimalDashesByBonusMask[3], 2);
  assert.deepEqual(result.bonusSolutionsByMask[3].actions, [
    { direction: "right", counted: true },
    { direction: "right", counted: true },
  ]);
});

test("bonus solver remembers a crumble after leaving it", () => {
  const rows = ["#######", "###.###", "###.###", "#...###", "###.###", "###.###", "#######"];
  const open = corridor(rows, { exit: [3, 1], dots: [[3, 5]] });
  assert.ok(solveBonusMasks(open).standardSolution);
  assert.equal(solveBonusMasks({ ...open, mechanics: { crumbles: [[3, 3]] } }).standardSolution, null);
});

test("all static bonus pars exactly match bounded solver results", () => {
  let standard = 0;
  let full = 0;
  for (const level of LEVELS) {
    const objectives = bonusObjectives(level);
    const result = solveBonusMasks(level);
    const fullMask = (2 ** objectives.length) - 1;
    assert.equal(result.truncated, false, `level ${level.id} search truncated`);
    assert.ok(result.standardSolution, `level ${level.id} has no standard completion`);
    assert.deepEqual(level.optimalDashesByBonusMask, result.optimalDashesByBonusMask, `level ${level.id} has stale static pars`);
    standard += 1;
    if (result.optimalDashesByBonusMask[fullMask] != null) full += 1;

    result.bonusSolutionsByMask.forEach((witness, mask) => {
      assert.equal(result.optimalDashesByBonusMask[mask], witness?.dashes ?? null, `level ${level.id}, mask ${mask}`);
      if (!witness) return;
      assert.equal(witness.bonusMask, mask);
      assert.equal(witness.dashes, witness.actions.filter((action) => action.counted).length);
      assert.deepEqual(witness.directions, witness.actions.filter((action) => action.counted).map((action) => action.direction));
      assert.equal(effectivePar(level, mask), witness.dashes);
      assert.equal(coresForDashes(witness.dashes, effectivePar(level, mask)), 3);
    });
  }
  assert.equal(Math.max(...LEVELS.map((level) => bonusObjectives(level).length)), 4);
  assert.deepEqual([standard, full], [250, 250]);
});
