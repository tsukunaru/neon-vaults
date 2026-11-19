import test from "node:test";
import assert from "node:assert/strict";
import { gradeLevel, parStatus, resolveSelections } from "../tools/report-campaign.mjs";

const metrics = {
  solvable: true, truncated: false, analysisError: null, optimalPathLength: 20,
  decisionPoints: 8, forcedMoveRatio: 0.4, longestForcedRun: 4, masteryGap: 4,
  greedyExit: { success: false, gapFromOptimal: null },
  randomSafe: { successRate: 0.2, averageGapFromOptimal: 8 },
  stopGraph: { topologyHash: "ok" },
};

test("campaign report gates invalid PAR and unresolved TUNE selections", () => {
  const level = { minMoves: 20, shortestMoves: 16, solution: Array(20).fill("up") };
  assert.deepEqual(parStatus(level, metrics), { valid: true, errors: [] });
  assert.equal(gradeLevel(80, metrics, true), "S");
  assert.equal(gradeLevel(80, { ...metrics, forcedMoveRatio: 0.95 }, true), "D");
  assert.equal(gradeLevel(80, metrics, false), "F");

  const baseline = [{ id: 1, verdict: "KEEP" }, { id: 2, verdict: "TUNE" }, { id: 3, verdict: "TUNE" }];
  const manifest = { levels: [{ id: 3, verdict: "REPLACED", changed: true, selected: { level: {} } }] };
  const { selections, errors } = resolveSelections(baseline, manifest);
  assert.deepEqual(selections.map(({ verdict, changed }) => ({ verdict, changed })), [
    { verdict: "KEEP_CURRENT", changed: false },
    { verdict: "PENDING", changed: false },
    { verdict: "REPLACED", changed: true },
  ]);
  assert.deepEqual(errors, []);
});
