import { readFile } from "node:fs/promises";
import { LEVELS } from "../src/levels.js";
import { runtimeRouteWins } from "../scripts/generate-levels.mjs";
import { solveLevel, validateLevel } from "../src/level-validator.js";
import { ANALYSIS_MODEL_VERSION, PILOT_LEVEL_IDS } from "./lib/level-analysis.mjs";

const report = JSON.parse(await readFile("reports/level-pilot-candidates.json", "utf8"));
const errors = [];
const productionLayouts = new Set(LEVELS.map((level) => level.rows.join("/")));
const candidateLayouts = new Set();
let candidates = 0;
let runtimeRoutes = 0;
const check = (condition, message) => { if (!condition) errors.push(message); };

check(report.modelVersion === ANALYSIS_MODEL_VERSION, "analysis model version mismatch");
check(report.productionLevelsChanged === false, "report claims production levels changed");
check(JSON.stringify(report.levelIds) === JSON.stringify(PILOT_LEVEL_IDS), "pilot level IDs changed");
check(report.levels.length === PILOT_LEVEL_IDS.length, "pilot report must contain 20 levels");

for (const entry of report.levels) {
  check(entry.candidates.length === 3, `level ${entry.id} must retain three finalists`);
  for (const candidate of entry.candidates) {
    candidates += 1;
    const level = candidate.level;
    const layout = level.rows.join("/");
    const validation = validateLevel(level);
    check(validation.valid, `${candidate.candidateId}: ${validation.errors.join("; ")}`);
    check(!productionLayouts.has(layout), `${candidate.candidateId}: duplicates a production layout`);
    check(!candidateLayouts.has(layout), `${candidate.candidateId}: duplicates another finalist`);
    candidateLayouts.add(layout);
    check(candidate.metrics.decisionPoints > 0, `${candidate.candidateId}: no decision points`);
    check(candidate.metrics.forcedMoveRatio < 0.85, `${candidate.candidateId}: forced ratio gate failed`);
    const maximumLength = entry.baseline.metrics.optimalPathLength
      + Math.max(entry.id <= 10 ? 3 : 4, Math.ceil(entry.baseline.metrics.optimalPathLength * 0.2));
    check(candidate.metrics.optimalPathLength <= maximumLength, `${candidate.candidateId}: pacing gate failed`);
    const rewardRoute = solveLevel(level, { coins: level.coins || [] });
    for (const route of [level.solution, rewardRoute]) for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
      runtimeRoutes += 1;
      check(Array.isArray(route) && runtimeRouteWins(level, route, dt), `${candidate.candidateId}: runtime route failed at ${Math.round(1 / dt)} FPS`);
    }
  }
}

if (errors.length) {
  errors.slice(0, 20).forEach((error) => console.error(`FAIL: ${error}`));
  if (errors.length > 20) console.error(`...and ${errors.length - 20} more`);
  process.exitCode = 1;
} else {
  console.log(`Pilot validation passed: ${candidates}/${candidates} finalists, ${runtimeRoutes}/${runtimeRoutes} runtime routes, 20/20 reference levels, production unchanged.`);
}
