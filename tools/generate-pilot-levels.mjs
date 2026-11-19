import { readFile, writeFile } from "node:fs/promises";
import { LEVELS } from "../src/levels.js";
import { generateCandidate } from "../scripts/generate-levels.mjs";
import {
  ANALYSIS_MODEL_VERSION, PILOT_LEVEL_IDS, analyzeDecisionQuality, compareStopGraphs, decisionTargetForLevel, parseLevelIds,
} from "./lib/level-analysis.mjs";

const GENERATOR_VERSION = "pilot-1.0.0";
const valueOf = (name) => process.argv.slice(2).find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const round = (value) => Number(value.toFixed(3));

function candidateScore(id, metrics, expectedOptimal = metrics.optimalPathLength) {
  if (!metrics.solvable || metrics.truncated || metrics.analysisError) return -Infinity;
  const target = decisionTargetForLevel(id);
  const choiceBalance = 1 - Math.min(1, Math.abs(metrics.forcedMoveRatio - 0.45));
  const chaosPenalty = Math.max(0, metrics.averageRationalChoices - 2) * 12;
  return round(40
    + Math.min(metrics.decisionPoints, target + 4) * 5
    - Math.max(0, target - metrics.decisionPoints) * 12
    + choiceBalance * 25
    - metrics.linearityScore * 12
    + Math.min(4, metrics.setupMoveCount) * 2
    + Math.min(5, metrics.stopGraph.cycleRank) * 1.5
    + Math.min(5, metrics.masteryGap || 0) * 2
    + (1 - metrics.randomSafe.successRate) * 5
    + (metrics.greedyExit.success ? -3 : 3)
    - Math.abs(metrics.optimalPathLength - expectedOptimal) * 1.5
    - chaosPenalty);
}

function asciiLevel(level) {
  const grid = level.rows.map((row) => [...row].map((cell) => cell === "#" ? "#" : " "));
  const put = (point, symbol) => { if (point && grid[point[1]]?.[point[0]] !== undefined) grid[point[1]][point[0]] = symbol; };
  for (const point of level.mechanics?.breakables || []) put(point, "B");
  for (const point of level.mechanics?.spikes || []) put(point, "^");
  for (const item of level.mechanics?.timedSpikes || []) put([item.x, item.y], "t");
  for (const item of level.mechanics?.movers || []) { put(item.from, "M"); put(item.to, "m"); }
  for (const item of level.mechanics?.cannons || []) put([item.x, item.y], "C");
  for (const item of level.mechanics?.enemies || []) for (const point of item.path || []) put(point, "X");
  for (const item of level.mechanics?.switches || []) put([item.x, item.y], "s");
  for (const item of level.mechanics?.gates || []) put([item.x, item.y], "G");
  for (const item of level.mechanics?.portals || []) { put(item.a, "P"); put(item.b, "P"); }
  for (const item of level.mechanics?.oneWays || []) put([item.x, item.y], ">");
  for (const item of level.mechanics?.redirects || []) put([item.x, item.y], "R");
  for (const point of level.mechanics?.crumbles || []) put(point, "c");
  for (const item of level.mechanics?.pulses || []) put([item.x, item.y], "~");
  for (const point of level.mechanics?.checkpoints || []) put(point, "K");
  for (const point of level.dots || []) put(point, "o");
  for (const point of level.coins || []) put(point, "$");
  put(level.start, "S");
  put(level.exit, "E");
  return grid.map((row) => row.join("")).join("\n");
}

function findClosestCampaignMatch(metrics, campaign, levelId) {
  let closest = null;
  for (const entry of campaign) {
    const other = entry.metrics;
    if (!other.stopGraph) continue;
    if (Math.abs(metrics.optimalPathLength - other.optimalPathLength) > Math.max(4, metrics.optimalPathLength * 0.3)) continue;
    if (Math.min(metrics.stopGraph.nodes, other.stopGraph.nodes) / Math.max(metrics.stopGraph.nodes, other.stopGraph.nodes) < 0.7) continue;
    const comparison = compareStopGraphs(metrics, other);
    if (!closest || comparison.similarity > closest.similarity) closest = { level: entry.id, ...comparison };
  }
  return closest || { level: levelId, similarity: 0, exactTopology: false };
}

function attemptSeed(levelId, candidateIndex, seed) {
  return ((seed ^ Math.imul(levelId, 73_856_093) ^ Math.imul(candidateIndex + 1, 19_349_663)) >>> 0) % 1_000_000;
}

function markdown(report) {
  const lines = [
    "# Neon Vaults pilot candidates",
    "",
    `Generator: \`${report.generatorVersion}\`; analyzer: \`${report.modelVersion}\`. Production levels changed: **no**.`,
    "",
    `Pilot: ${report.levelIds.join(", ")}. Candidates per level: ${report.candidatesPerLevel}.`,
    "",
    "| Level | Recommendation | Baseline score | Best score | Δ decisions | Δ forced | Duplicate similarity |",
    "| ---: | :--- | ---: | ---: | ---: | ---: | ---: |",
    ...report.levels.map((entry) => {
      const best = entry.candidates[0];
      return `| ${entry.id} | ${entry.recommendation} | ${entry.baseline.score} | ${best?.score ?? "—"} | ${best ? best.metrics.decisionPoints - entry.baseline.metrics.decisionPoints : "—"} | ${best ? round(best.metrics.forcedMoveRatio - entry.baseline.metrics.forcedMoveRatio) : "—"} | ${best?.closestCampaignMatch.similarity ?? "—"} |`;
    }),
    "",
  ];
  for (const entry of report.levels) {
    const best = entry.candidates[0];
    lines.push(`## Level ${entry.id}: ${entry.recommendation}`, "");
    if (!best) {
      lines.push(`No candidate passed hard gates (${entry.rejected} rejected).`, "");
      continue;
    }
    lines.push(`Best ${best.candidateId}: score ${best.score} (${best.scoreDelta >= 0 ? "+" : ""}${best.scoreDelta}); decisions ${entry.baseline.metrics.decisionPoints} → ${best.metrics.decisionPoints}; forced ${entry.baseline.metrics.forcedMoveRatio} → ${best.metrics.forcedMoveRatio}; optimal ${entry.baseline.metrics.optimalPathLength} → ${best.metrics.optimalPathLength}.`, "", "```text", best.ascii, "```", "");
  }
  return `${lines.join("\n")}\n`;
}

const ids = parseLevelIds(valueOf("--ids")) || PILOT_LEVEL_IDS;
const candidatesPerLevel = Math.max(1, Math.min(256, Number(valueOf("--candidates")) || 32));
const seed = Number(valueOf("--seed")) || 20_260_830;
const randomRuns = Math.max(16, Math.min(256, Number(valueOf("--runs")) || 128));
const baselineReport = JSON.parse(await readFile("reports/level-baseline.json", "utf8"));
if (baselineReport.modelVersion !== ANALYSIS_MODEL_VERSION || baselineReport.levels.length !== 250) {
  throw new Error("Run npm run analyze:levels before generating pilot candidates");
}
const campaignLayouts = new Set(LEVELS.map((level) => level.rows.join("/")));
const reportLevels = [];

for (const id of ids) {
  const baselineEntry = baselineReport.levels.find((entry) => entry.id === id);
  const baselineScore = candidateScore(id, baselineEntry.metrics);
  const generated = [];
  const seen = new Set();
  let rejected = 0;
  for (let candidateIndex = 0; candidateIndex < candidatesPerLevel; candidateIndex += 1) {
    const attemptStart = attemptSeed(id, candidateIndex, seed);
    const level = generateCandidate(id, attemptStart);
    const layout = level.rows.join("/");
    const metrics = analyzeDecisionQuality(level, { randomRuns, seed: seed ^ candidateIndex });
    const closestCampaignMatch = metrics.stopGraph ? findClosestCampaignMatch(metrics, baselineReport.levels, id) : null;
    const rejectReasons = [];
    if (!metrics.solvable || metrics.truncated || metrics.analysisError) rejectReasons.push("ANALYSIS_FAILURE");
    if (campaignLayouts.has(layout)) rejectReasons.push("EXISTING_LAYOUT");
    if (metrics.decisionPoints === 0) rejectReasons.push("NO_DECISIONS");
    if (metrics.forcedMoveRatio >= 0.85) rejectReasons.push("HIGH_FORCED_RATIO");
    if (metrics.optimalPathLength > baselineEntry.metrics.optimalPathLength
      + Math.max(id <= 10 ? 3 : 4, Math.ceil(baselineEntry.metrics.optimalPathLength * 0.2))) rejectReasons.push("PACING_OUTLIER");
    if (closestCampaignMatch?.exactTopology && closestCampaignMatch.similarity >= 0.94) rejectReasons.push("DUPLICATE_STOP_GRAPH");
    const fingerprint = `${layout}|${metrics.stopGraph?.topologyHash}|${metrics.stopGraph?.optimalRoutePattern}`;
    if (seen.has(fingerprint)) rejectReasons.push("DUPLICATE_CANDIDATE");
    seen.add(fingerprint);
    if (rejectReasons.length) { rejected += 1; continue; }

    const duplicatePenalty = Math.max(0, (closestCampaignMatch.similarity - 0.86) * 80);
    const score = round(candidateScore(id, metrics, baselineEntry.metrics.optimalPathLength) - duplicatePenalty);
    generated.push({
      candidateId: `${id}-${seed}-${candidateIndex + 1}`,
      attemptStart,
      score,
      scoreDelta: round(score - baselineScore),
      closestCampaignMatch,
      metrics,
      ascii: asciiLevel(level),
      level,
    });
  }
  generated.sort((left, right) => right.score - left.score || left.attemptStart - right.attemptStart);
  const candidates = [];
  const structures = new Set();
  for (const candidate of generated) {
    const structure = `${candidate.metrics.stopGraph.topologyHash}|${candidate.metrics.stopGraph.optimalRoutePattern}`;
    if (structures.has(structure)) continue;
    structures.add(structure);
    candidates.push(candidate);
    if (candidates.length === 3) break;
  }
  const best = candidates[0];
  const measurableImprovement = best && best.score >= baselineScore + 2
    && (best.metrics.decisionPoints > baselineEntry.metrics.decisionPoints || best.metrics.forcedMoveRatio < baselineEntry.metrics.forcedMoveRatio);
  reportLevels.push({
    id,
    recommendation: measurableImprovement ? "REVIEW_CANDIDATES" : "KEEP_CURRENT",
    evaluated: candidatesPerLevel,
    rejected,
    baseline: { score: baselineScore, metrics: baselineEntry.metrics },
    candidates,
  });
  console.log(`Level ${id}: ${candidates.length} finalists from ${candidatesPerLevel}; ${reportLevels.at(-1).recommendation}`);
}

const improved = reportLevels.filter((entry) => entry.recommendation === "REVIEW_CANDIDATES");
const report = {
  generatorVersion: GENERATOR_VERSION,
  modelVersion: ANALYSIS_MODEL_VERSION,
  productionLevelsChanged: false,
  seed,
  candidatesPerLevel,
  randomRuns,
  levelIds: ids,
  summary: {
    levels: reportLevels.length,
    reviewCandidates: improved.length,
    keepCurrent: reportLevels.length - improved.length,
    averageDecisionDelta: improved.length ? round(improved.reduce((sum, entry) => sum + entry.candidates[0].metrics.decisionPoints - entry.baseline.metrics.decisionPoints, 0) / improved.length) : 0,
    averageForcedRatioDelta: improved.length ? round(improved.reduce((sum, entry) => sum + entry.candidates[0].metrics.forcedMoveRatio - entry.baseline.metrics.forcedMoveRatio, 0) / improved.length) : 0,
  },
  levels: reportLevels,
};
await writeFile("reports/level-pilot-candidates.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile("reports/level-pilot-candidates.md", markdown(report), "utf8");
console.log(`Pilot complete: ${improved.length}/${reportLevels.length} levels have measurable candidates for human review.`);
console.log("Production level files were not changed.");
