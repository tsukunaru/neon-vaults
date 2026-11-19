import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDecisionQuality, compareStopGraphs } from "../tools/lib/level-analysis.mjs";

const level = (overrides = {}) => ({
  id: 5,
  width: 5,
  height: 5,
  rows: ["#####", "#...#", "###.#", "###.#", "#####"],
  start: [1, 1],
  exit: [3, 3],
  dots: [],
  coins: [],
  mechanics: {},
  ...overrides,
});

test("decision metrics expose a forced slide corridor", () => {
  const metrics = analyzeDecisionQuality(level(), { randomRuns: 32, seed: 1 });
  assert.deepEqual(metrics.optimalSolution, ["right", "down"]);
  assert.equal(metrics.optimalPathLength, 2);
  assert.equal(metrics.decisionPoints, 0);
  assert.equal(metrics.forcedMoveRatio, 1);
  assert.equal(metrics.linearityScore, 1);
  assert.deepEqual(metrics.greedyExit, { success: true, dashes: 2, gapFromOptimal: 0, stopped: false });
});

test("state-aware graph keeps a collected dot and opened gate in the solution state", () => {
  const metrics = analyzeDecisionQuality(level({
    width: 7,
    height: 7,
    rows: ["#######", "###.###", "###.###", "#...###", "###.###", "###.###", "#######"],
    start: [1, 3],
    exit: [3, 1],
    dots: [[3, 5]],
    mechanics: {
      switches: [{ x: 3, y: 5, group: "a" }],
      gates: [{ x: 3, y: 2, group: "a" }],
    },
  }), { randomRuns: 32, seed: 2 });
  assert.deepEqual(metrics.optimalSolution, ["right", "down", "up"]);
  assert.equal(metrics.optimalPathLength, 3);
  assert.equal(metrics.decisionPoints, 0);
  assert.equal(metrics.forcedMoveRatio, 1);
  assert.equal(metrics.stateGraph.productiveStates, 3);
});

test("RandomSafe is reproducible and stop-graph comparison normalizes mirrored routes", () => {
  const original = analyzeDecisionQuality(level(), { randomRuns: 64, seed: 42 });
  const repeated = analyzeDecisionQuality(level(), { randomRuns: 64, seed: 42 });
  const mirrored = analyzeDecisionQuality(level({
    rows: ["#####", "#...#", "#.###", "#.###", "#####"],
    start: [3, 1],
    exit: [1, 3],
  }), { randomRuns: 64, seed: 42 });
  assert.deepEqual(repeated.randomSafe, original.randomSafe);
  assert.deepEqual(compareStopGraphs(original, mirrored), { similarity: 1, exactTopology: true });
});
