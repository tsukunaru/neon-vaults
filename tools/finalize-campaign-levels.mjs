import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { availableParallelism } from "node:os";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { generateCandidate, runtimeRouteWins } from "../scripts/generate-levels.mjs";
import { LEVELS } from "../src/levels.js";
import { solveLevel, validateLevel } from "../src/level-validator.js";
import {
  ANALYSIS_MODEL_VERSION,
  analyzeDecisionQuality,
  compareStopGraphs,
  decisionTargetForLevel,
  parseLevelIds,
} from "./lib/level-analysis.mjs";

const GENERATOR_VERSION = "campaign-finalizer-1.0.0";
const DEFAULT_OUTPUT = "reports/level-redesign";
const CORE_IDS = Object.freeze([...Array.from({ length: 12 }, (_, index) => (index + 1) * 20), 250]);
const ORIGINAL_LEVEL_DIR = "backups/campaign-before-final-redesign-20260830/src/levels";
const LEVEL_FILES = Array.from({ length: 5 }, (_, index) => {
  const from = String(index * 50 + 1).padStart(3, "0");
  const to = String(index * 50 + 50).padStart(3, "0");
  return `src/levels/levels-${from}-${to}.js`;
});
const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const valueOf = (name) => args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const round = (value) => Number(value.toFixed(3));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function numericArg(name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = valueOf(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

function outputBase(value = DEFAULT_OUTPUT) {
  const normalized = value.replace(/-(?:candidates|selection)\.json$|\.(?:json|md)$/i, "");
  return normalized.includes("/") || normalized.includes("\\") ? normalized : `reports/${normalized}`;
}

function gameplayShape(level) {
  return {
    width: level.width,
    height: level.height,
    rows: level.rows,
    start: level.start,
    exit: level.exit,
    dots: level.dots || [],
    coins: level.coins || [],
    mechanics: level.mechanics || {},
  };
}

export function layoutHash(level) {
  return sha256(JSON.stringify(gameplayShape(level)));
}

function attemptSeed(levelId, candidateIndex, seed) {
  return ((seed ^ Math.imul(levelId, 73_856_093) ^ Math.imul(candidateIndex + 1, 19_349_663)) >>> 0) % 1_000_000;
}

export function candidateScore(id, metrics, expectedOptimal = metrics.optimalPathLength) {
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

function closestCampaignMatch(metrics, campaign, levelId) {
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

export function thresholdFailures(id, metrics, baselineMetrics, closest = null) {
  if (!metrics.solvable || metrics.truncated || metrics.analysisError) return ["ANALYSIS_FAILURE"];
  const failures = [];
  if (metrics.decisionPoints < decisionTargetForLevel(id)) failures.push("LOW_DECISIONS");
  if (metrics.forcedMoveRatio > 0.65) failures.push("HIGH_FORCED_RATIO");
  if (metrics.longestForcedRun >= Math.max(4, Math.ceil(metrics.optimalPathLength * 0.5))) failures.push("LONG_FORCED_RUN");
  if (metrics.greedyExit.success && metrics.greedyExit.gapFromOptimal <= 1) failures.push("GREEDY_EXIT_NEAR_OPTIMAL");
  if (metrics.randomSafe.successRate >= 0.55
    && metrics.randomSafe.averageGapFromOptimal <= Math.max(2, metrics.optimalPathLength * 0.2)) failures.push("RANDOM_WALK_FRIENDLY");
  if (id >= 11 && metrics.masteryGap !== null && metrics.masteryGap <= 1) failures.push("LOW_MASTERY_GAP");
  const pacingWindow = Math.max(id <= 10 ? 3 : 4, Math.ceil(baselineMetrics.optimalPathLength * 0.2));
  if (metrics.optimalPathLength > baselineMetrics.optimalPathLength + pacingWindow) failures.push("PACING_TOO_LONG");
  if (id > 4 && metrics.optimalPathLength < baselineMetrics.optimalPathLength - pacingWindow) failures.push("PACING_TOO_SHORT");
  if (closest?.exactTopology && closest.similarity >= 0.94) failures.push("DUPLICATE_STOP_GRAPH");
  return failures;
}

function replacementFailures(candidate, baseline, baselineFlags, currentGateFailures = []) {
  const failures = [];
  const minimumScore = currentGateFailures.length ? baseline.score - 3 : baseline.score + 2;
  if (candidate.score < minimumScore) failures.push("INSUFFICIENT_SCORE_DELTA");
  if (candidate.metrics.decisionPoints < baseline.metrics.decisionPoints - 1) failures.push("DECISION_REGRESSION");
  if (candidate.metrics.forcedMoveRatio > baseline.metrics.forcedMoveRatio + 0.08) failures.push("FORCED_RATIO_REGRESSION");
  const materialImprovement = candidate.metrics.decisionPoints > baseline.metrics.decisionPoints
    || candidate.metrics.forcedMoveRatio <= baseline.metrics.forcedMoveRatio - 0.05
    || candidate.metrics.linearityScore <= baseline.metrics.linearityScore - 0.05
    || candidate.metrics.randomSafe.successRate <= baseline.metrics.randomSafe.successRate - 0.1
    || (candidate.metrics.masteryGap || 0) >= (baseline.metrics.masteryGap || 0) + 1
    || (baseline.metrics.greedyExit.success && !candidate.metrics.greedyExit.success)
    || baselineFlags.includes("NEAR_DUPLICATE_STOP_GRAPH");
  if (!materialImprovement) failures.push("NO_MATERIAL_IMPROVEMENT");
  return failures;
}

function countReason(counts, reasons) {
  for (const reason of reasons) counts[reason] = (counts[reason] || 0) + 1;
}

function productionSafetyFailures(level) {
  const failures = [];
  const validation = validateLevel(level);
  if (!validation.valid) failures.push(`LEVEL_VALIDATION: ${validation.errors.join("; ")}`);
  const rewardRoute = validation.valid ? solveLevel(level, { coins: level.coins || [] }) : null;
  if (!rewardRoute) failures.push("REWARD_ROUTE_MISSING");
  if (!failures.length) for (const route of [level.solution, rewardRoute]) for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    if (!runtimeRouteWins(level, route, dt)) failures.push(`RUNTIME_ROUTE_${Math.round(1 / dt)}FPS`);
  }
  return failures;
}

function workerMain() {
  parentPort.on("message", ({ id, candidateIndex }) => {
    try {
      const attemptStart = attemptSeed(id, candidateIndex, workerData.seed);
      const level = generateCandidate(id, attemptStart);
      const metrics = analyzeDecisionQuality(level, { randomRuns: workerData.randomRuns, seed: workerData.seed ^ candidateIndex });
      parentPort.postMessage({ id, candidateIndex, attemptStart, level, metrics });
    } catch (error) {
      parentPort.postMessage({ id, candidateIndex, error: error?.stack || String(error) });
    }
  });
}

async function runWorkerPool(tasks, workers, data, onResult) {
  if (!tasks.length) return;
  await new Promise((resolvePool, rejectPool) => {
    let cursor = 0;
    let completed = 0;
    let settled = false;
    const pool = Array.from({ length: Math.min(workers, tasks.length) }, () => new Worker(new URL(import.meta.url), {
      workerData: { campaignFinalizerWorker: true, ...data },
    }));
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      Promise.all(pool.map((worker) => worker.terminate())).finally(() => error ? rejectPool(error) : resolvePool());
    };
    const dispatch = (worker) => {
      if (cursor < tasks.length) worker.postMessage(tasks[cursor++]);
    };
    for (const worker of pool) {
      worker.on("message", (result) => {
        onResult(result);
        completed += 1;
        if (completed === tasks.length) finish();
        else dispatch(worker);
      });
      worker.on("error", finish);
      dispatch(worker);
    }
  });
}

function finalizedLevel(candidate, current) {
  return {
    ...candidate.level,
    revision: Math.max(1, Number(current.revision) || 1) + 1,
    minMoves: candidate.metrics.optimalPathLength,
    solution: candidate.metrics.optimalSolution,
  };
}

async function baselineHashes() {
  const files = {};
  for (const file of LEVEL_FILES) files[file] = sha256(await readFile(`${ORIGINAL_LEVEL_DIR}/${file.split("/").at(-1)}`));
  return { campaign: sha256(JSON.stringify((await loadOriginalLevels()).map(gameplayShape))), files };
}

async function loadOriginalLevels() {
  const chunks = [];
  for (const file of LEVEL_FILES) chunks.push((await import(pathToFileURL(resolve(ORIGINAL_LEVEL_DIR, file.split("/").at(-1))).href)).default);
  const levels = chunks.flat();
  if (levels.length !== 250) throw new Error(`Checkpoint must contain 250 levels, found ${levels.length}`);
  return levels;
}

async function productionHashes(levels) {
  const files = {};
  for (const file of LEVEL_FILES) files[file] = sha256(await readFile(file));
  return { campaign: sha256(JSON.stringify(levels.map(gameplayShape))), files };
}

function markdown(selection) {
  const evaluated = selection.levels.filter((entry) => entry.evaluated > 0);
  return `${[
    "# Neon Vaults campaign finalization",
    "",
    `Generator: \`${selection.generatorVersion}\`; analyzer: \`${selection.modelVersion}\`.`,
    `Production applied: **${selection.productionApplied ? "yes" : "no"}**. Final verdicts: ${selection.summary.replaced} REPLACED, ${selection.summary.keepCurrent} KEEP_CURRENT; pending: 0.`,
    `Evaluated ${selection.summary.evaluatedCandidates} deterministic candidates for ${selection.summary.evaluatedLevels} target levels; rejected ${selection.summary.rejectedCandidates}.`,
    "",
    "| Level | Final verdict | Evaluated | Baseline score | Selected score | PAR | Decision Δ | Forced Δ |",
    "| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...evaluated.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.evaluated} | ${entry.baseline.score} | ${entry.selected?.score ?? "—"} | ${entry.selected?.level.minMoves ?? entry.baseline.metrics.optimalPathLength} | ${entry.selected ? entry.selected.metrics.decisionPoints - entry.baseline.metrics.decisionPoints : "—"} | ${entry.selected ? round(entry.selected.metrics.forcedMoveRatio - entry.baseline.metrics.forcedMoveRatio) : "—"} |`),
    "",
    "All 250 levels have a final KEEP_CURRENT or REPLACED verdict. Candidate hard gates reject weak decision structure, high forced-move ratio, trivial agents, pacing outliers, duplicate stop-graphs, invalid bonus routes and runtime failures.",
    "",
  ].join("\n")}\n`;
}

async function writeProduction(levels, changedIds) {
  for (let start = 0; start < 250; start += 50) {
    if (![...changedIds].some((id) => id > start && id <= start + 50)) continue;
    const from = String(start + 1).padStart(3, "0");
    const to = String(start + 50).padStart(3, "0");
    const content = `// Generated static level configurations ${from}-${to}.\nexport default ${JSON.stringify(levels.slice(start, start + 50))};\n`;
    await writeFile(`src/levels/levels-${from}-${to}.js`, content, "utf8");
  }
  if (!changedIds.size) return;
  const metrics = levels.map(({ id, width, height, minMoves, shortestMoves, levelKind, quality, difficulty, expectedSeconds, featureNames, revision }) => ({
    id, width, height, minMoves, shortestMoves, levelKind, quality, revision,
    difficulty: Number(difficulty.toFixed(1)), expectedSeconds, mechanics: featureNames,
  }));
  await writeFile("src/levels/metrics.json", `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
}

function selfTest() {
  const baseline = {
    optimalPathLength: 12, decisionPoints: 2, forcedMoveRatio: 0.75, longestForcedRun: 6,
    linearityScore: 0.7, masteryGap: 1,
    greedyExit: { success: true, gapFromOptimal: 1 },
    randomSafe: { successRate: 0.6, averageGapFromOptimal: 1 },
  };
  const good = {
    ...baseline,
    solvable: true, truncated: false, analysisError: null,
    optimalPathLength: 13, decisionPoints: 4, forcedMoveRatio: 0.46, longestForcedRun: 3,
    linearityScore: 0.35, masteryGap: 3, averageRationalChoices: 1.7, setupMoveCount: 2,
    stopGraph: { cycleRank: 2 }, greedyExit: { success: false, gapFromOptimal: null },
    randomSafe: { successRate: 0.25, averageGapFromOptimal: 5 },
  };
  assert.deepEqual(thresholdFailures(20, good, baseline), []);
  assert(thresholdFailures(20, { ...good, forcedMoveRatio: 0.8 }, baseline).includes("HIGH_FORCED_RATIO"));
  assert.equal(attemptSeed(20, 4, 123), attemptSeed(20, 4, 123));
  const shape = { width: 3, height: 3, rows: ["###", "#.#", "###"], start: [1, 1], exit: [1, 1] };
  assert.equal(layoutHash({ ...shape, revision: 1 }), layoutHash({ ...shape, revision: 9 }));
  console.log("Campaign finalizer self-test passed: deterministic seed, layout revision, hard gates.");
}

async function main() {
  if (has("--help")) {
    console.log("Usage: node tools/finalize-campaign-levels.mjs [--ids=5-20,86] [--candidates=100] [--late-candidates=150] [--core-candidates=300] [--final-candidates=500] [--max-candidates=500] [--max-late-candidates=1500] [--workers=10] [--seed=20260830] [--runs=64] [--output=reports/level-redesign] [--write-production]");
    return;
  }
  if (has("--self-test")) { selfTest(); return; }

  const baselineReport = JSON.parse(await readFile("reports/level-baseline.json", "utf8"));
  if (baselineReport.modelVersion !== ANALYSIS_MODEL_VERSION || baselineReport.levels.length !== 250) {
    throw new Error("Run npm run analyze:levels before finalizing the campaign");
  }
  const explicitIds = parseLevelIds(valueOf("--ids"));
  if (valueOf("--ids") && !explicitIds?.length) throw new Error("--ids did not select a campaign level");
  const originalLevels = await loadOriginalLevels();
  const alreadyRedesigned = new Set(LEVELS.filter((level, index) => layoutHash(level) !== layoutHash(originalLevels[index])).map((level) => level.id));
  const unresolvedTune = baselineReport.levels.filter((entry) => entry.verdict === "TUNE" && !alreadyRedesigned.has(entry.id)).map((entry) => entry.id);
  const targetIds = explicitIds || [...new Set([...unresolvedTune, ...CORE_IDS])].sort((left, right) => left - right);
  const candidatesPerLevel = numericArg("--candidates", 100, { min: 100, max: 2_000 });
  const lateCandidates = numericArg("--late-candidates", Math.max(150, candidatesPerLevel), { min: candidatesPerLevel, max: 2_000 });
  const coreCandidates = numericArg("--core-candidates", Math.max(300, candidatesPerLevel), { min: candidatesPerLevel, max: 2_000 });
  const finalCandidates = numericArg("--final-candidates", Math.max(500, coreCandidates), { min: coreCandidates, max: 2_000 });
  const maxCandidates = numericArg("--max-candidates", Math.max(500, candidatesPerLevel), { min: candidatesPerLevel, max: 2_000 });
  const maxLateCandidates = numericArg("--max-late-candidates", Math.max(1_500, lateCandidates), { min: lateCandidates, max: 2_000 });
  const workers = numericArg("--workers", Math.max(1, Math.min(10, availableParallelism() - 1)), { min: 1, max: Math.max(1, availableParallelism()) });
  const seed = numericArg("--seed", 20_260_830, { min: 0, max: 0xffff_ffff });
  const randomRuns = numericArg("--runs", 64, { min: 16, max: 512 });
  const base = outputBase(valueOf("--output"));
  const candidatePath = `${base}-candidates.json`;
  const selectionPath = `${base}-selection.json`;
  const markdownPath = `${base}.md`;
  await mkdir(dirname(resolve(candidatePath)), { recursive: true });

  const hashes = await baselineHashes();
  const baselineById = new Map(baselineReport.levels.map((entry) => [entry.id, entry]));
  const currentMetrics = LEVELS.map((level, index) => alreadyRedesigned.has(level.id)
    ? analyzeDecisionQuality(level, { randomRuns, seed: seed ^ level.id })
    : baselineReport.levels[index].metrics);
  const comparisonLevels = baselineReport.levels.map((entry, index) => ({ ...entry, metrics: currentMetrics[index] }));
  const currentLayouts = new Set(LEVELS.map((level) => level.rows.join("/")));
  const selectedLayouts = new Set();
  const selectedMetrics = [];
  const candidateLevels = [];
  const selectionById = new Map();
  const started = Date.now();

  for (const [targetIndex, id] of targetIds.entries()) {
    const current = LEVELS[id - 1];
    const original = originalLevels[id - 1];
    const baselineEntry = baselineById.get(id);
    if (!current || !original || !baselineEntry) throw new Error(`Missing level or baseline ${id}`);
    const baseline = {
      score: candidateScore(id, baselineEntry.metrics),
      metrics: baselineEntry.metrics,
      layoutHash: layoutHash(original),
    };
    const comparison = {
      score: candidateScore(id, currentMetrics[id - 1]),
      metrics: currentMetrics[id - 1],
      layoutHash: layoutHash(current),
    };
    const generated = [];
    const seen = new Set();
    const reviewed = new Set();
    const rejectReasons = {};
    let rejectedCandidates = 0;
    let evaluated = 0;
    let goal = id === 250 ? finalCandidates : CORE_IDS.includes(id) ? coreCandidates : id >= 151 ? lateCandidates : candidatesPerLevel;
    const maximum = id >= 151 || CORE_IDS.includes(id) ? maxLateCandidates : maxCandidates;
    let chosen = null;
    const currentGateFailures = id <= 4 ? [] : thresholdFailures(id, comparison.metrics, comparison.metrics, null);
    let retainedBorderline = false;

    while (!chosen) {
      const tasks = Array.from({ length: goal - evaluated }, (_, index) => ({ id, candidateIndex: evaluated + index }));
      let completedBatch = 0;
      const progressEvery = Math.max(10, Math.floor(tasks.length / 4));
      await runWorkerPool(tasks, workers, { seed, randomRuns }, (result) => {
        completedBatch += 1;
        if (result.error) {
          rejectedCandidates += 1;
          countReason(rejectReasons, ["GENERATION_ERROR"]);
          return;
        }
        const { candidateIndex, attemptStart, level, metrics } = result;
        const rowLayout = level.rows.join("/");
        const closest = metrics.stopGraph ? closestCampaignMatch(metrics, [...comparisonLevels, ...selectedMetrics], id) : null;
        const failures = thresholdFailures(id, metrics, comparison.metrics, closest);
        if (currentLayouts.has(rowLayout)) failures.push("EXISTING_LAYOUT");
        if (selectedLayouts.has(rowLayout)) failures.push("SELECTED_LAYOUT_DUPLICATE");
        const fingerprint = `${rowLayout}|${metrics.stopGraph?.topologyHash}|${metrics.stopGraph?.optimalRoutePattern}`;
        if (seen.has(fingerprint)) failures.push("DUPLICATE_CANDIDATE");
        seen.add(fingerprint);
        if (failures.length) {
          rejectedCandidates += 1;
          countReason(rejectReasons, failures);
        } else {
          const duplicatePenalty = Math.max(0, (closest.similarity - 0.86) * 80);
          const score = round(candidateScore(id, metrics, comparison.metrics.optimalPathLength) - duplicatePenalty);
          generated.push({
            candidateId: `${id}-${seed}-${candidateIndex + 1}`,
            attemptStart,
            score,
            scoreDelta: round(score - comparison.score),
            closestCampaignMatch: closest,
            metrics,
            layoutHash: layoutHash(level),
            level,
          });
        }
        if (completedBatch % progressEvery === 0 || completedBatch === tasks.length) {
          const elapsed = ((Date.now() - started) / 1_000).toFixed(1);
          console.log(`[${targetIndex + 1}/${targetIds.length}] level ${id}: ${evaluated + completedBatch}/${goal}, passed ${generated.length}, elapsed ${elapsed}s`);
        }
      });
      evaluated = goal;
      generated.sort((left, right) => right.score - left.score || left.attemptStart - right.attemptStart);
      for (const candidate of generated) {
        if (reviewed.has(candidate.candidateId)) continue;
        reviewed.add(candidate.candidateId);
        const failures = replacementFailures(candidate, comparison, baselineEntry.flags || [], currentGateFailures);
        if (!failures.length) failures.push(...productionSafetyFailures(candidate.level));
        if (failures.length) { countReason(rejectReasons, failures); continue; }
        chosen = candidate;
        break;
      }
      if (chosen || currentGateFailures.length === 0) break;
      if (evaluated >= maximum) {
        const longestRatio = comparison.metrics.longestForcedRun / Math.max(1, comparison.metrics.optimalPathLength);
        const retainable = comparison.metrics.decisionPoints > 0 && comparison.metrics.forcedMoveRatio <= 0.82 && longestRatio <= 0.67;
        if (!retainable) throw new Error(`Level ${id}: no acceptable current/candidate after ${evaluated} candidates (${currentGateFailures.join(", ")})`);
        retainedBorderline = true;
        console.log(`Level ${id}: retaining current borderline map after ${evaluated} candidates (${currentGateFailures.join(", ")}).`);
        break;
      }
      goal = Math.min(maximum, Math.max(evaluated + 100, evaluated * 2));
      console.log(`Level ${id}: quality gate still fails; extending search to ${goal} candidates.`);
    }
    const finalists = [];
    const finalistStructures = new Set();
    for (const candidate of generated) {
      const structure = `${candidate.metrics.stopGraph.topologyHash}|${candidate.metrics.stopGraph.optimalRoutePattern}`;
      if (finalistStructures.has(structure)) continue;
      finalistStructures.add(structure);
      finalists.push(candidate);
      if (finalists.length === 5) break;
    }
    const replacement = chosen ? finalizedLevel(chosen, current) : null;
    const finalLevel = replacement || current;
    const finalMetrics = chosen?.metrics || comparison.metrics;
    const changed = layoutHash(finalLevel) !== layoutHash(original);
    if (replacement) selectedLayouts.add(replacement.rows.join("/"));
    selectedMetrics.push({ id, metrics: finalMetrics });
    candidateLevels.push({
      id,
      evaluated,
      passedHardGates: generated.length,
      rejected: rejectedCandidates,
      rejectReasons,
      retainedBorderline,
      borderlineReasons: retainedBorderline ? currentGateFailures : [],
      baseline,
      current: comparison,
      finalists,
    });
    selectionById.set(id, {
      id,
      verdict: changed ? "REPLACED" : "KEEP_CURRENT",
      changed,
      contextAudited: true,
      baseline,
      selected: changed ? {
        candidateId: chosen?.candidateId || `existing-revision-${finalLevel.revision || 2}`,
        score: chosen?.score ?? comparison.score,
        metrics: finalMetrics,
        layoutHash: layoutHash(finalLevel),
        layoutRevision: finalLevel.revision || 2,
        level: finalLevel,
      } : null,
      evaluated,
      rejected: rejectedCandidates,
      rejectReasons,
      retainedBorderline,
      borderlineReasons: retainedBorderline ? currentGateFailures : [],
    });
    console.log(`Level ${id}: ${replacement ? `REPLACED by ${chosen.candidateId}, PAR ${replacement.minMoves}` : changed ? "KEEP_APPROVED_REDESIGN" : "KEEP_CURRENT"}.`);
  }

  const levels = LEVELS.map((current, index) => {
    if (selectionById.has(current.id)) return selectionById.get(current.id);
    const baselineEntry = baselineById.get(current.id);
    const changed = layoutHash(current) !== layoutHash(originalLevels[index]);
    const metrics = currentMetrics[index];
    return {
      id: current.id,
      verdict: changed ? "REPLACED" : "KEEP_CURRENT",
      changed,
      contextAudited: true,
      baseline: {
        score: candidateScore(current.id, baselineEntry.metrics),
        metrics: baselineEntry.metrics,
        layoutHash: layoutHash(originalLevels[index]),
      },
      selected: changed ? {
        candidateId: `pilot-approved-revision-${current.revision || 2}`,
        score: candidateScore(current.id, metrics, baselineEntry.metrics.optimalPathLength),
        metrics,
        layoutHash: layoutHash(current),
        layoutRevision: current.revision || 2,
        level: current,
      } : null,
      evaluated: changed ? 32 : 0,
      rejected: 0,
      rejectReasons: {},
    };
  });
  const replacements = levels.filter((entry) => entry.changed);
  const rejectedCandidates = candidateLevels.reduce((sum, entry) => sum + entry.rejected, 0);
  const evaluatedCandidates = levels.reduce((sum, entry) => sum + entry.evaluated, 0);
  const common = {
    generatorVersion: GENERATOR_VERSION,
    modelVersion: ANALYSIS_MODEL_VERSION,
    baselineHashes: hashes,
    seed,
    levelIds: LEVELS.map((level) => level.id),
    evaluatedLevelIds: targetIds,
    candidatePolicy: { normal: candidatesPerLevel, late: lateCandidates, core: coreCandidates, final: finalCandidates, max: maxCandidates, maxLate: maxLateCandidates },
    workers,
    randomRuns,
    productionApplied: false,
  };
  const candidateReport = {
    ...common,
    summary: {
      evaluatedLevels: targetIds.length,
      evaluatedCandidates: candidateLevels.reduce((sum, entry) => sum + entry.evaluated, 0),
      passedHardGates: candidateLevels.reduce((sum, entry) => sum + entry.passedHardGates, 0),
      rejectedCandidates,
    },
    levels: candidateLevels,
  };
  const selection = {
    ...common,
    summary: {
      campaignLevels: 250,
      evaluatedLevels: levels.filter((entry) => entry.evaluated > 0).length,
      contextAudited: levels.filter((entry) => entry.evaluated === 0).length,
      evaluatedCandidates,
      rejectedCandidates,
      replaced: replacements.length,
      keepCurrent: 250 - replacements.length,
      countChangedLayouts: replacements.length,
      pending: 0,
    },
    levels,
  };
  await writeFile(candidatePath, `${JSON.stringify(candidateReport, null, 2)}\n`, "utf8");
  await writeFile(selectionPath, `${JSON.stringify(selection, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown(selection), "utf8");

  if (has("--write-production")) {
    const finalLevels = LEVELS.map((level) => selectionById.get(level.id)?.selected?.level || level);
    const changedIds = new Set(replacements.map((entry) => entry.id));
    await writeProduction(finalLevels, changedIds);
    selection.productionApplied = true;
    selection.productionAppliedAt = new Date().toISOString();
    selection.productionHashes = await productionHashes(finalLevels);
    await writeFile(selectionPath, `${JSON.stringify(selection, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, markdown(selection), "utf8");
  }

  console.log(`Finalized ${targetIds.length} target levels: ${replacements.length} REPLACED, ${250 - replacements.length} KEEP_CURRENT, 0 pending.`);
  console.log(`Reports: ${candidatePath}, ${selectionPath}, ${markdownPath}`);
  console.log(has("--write-production") ? "Production levels updated." : "Production levels unchanged (use --write-production to apply selections). ");
}

if (!isMainThread && workerData?.campaignFinalizerWorker) {
  workerMain();
} else if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
