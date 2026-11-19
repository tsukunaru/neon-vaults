import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LEVELS } from "../src/levels.js";
import {
  ANALYSIS_MODEL_VERSION, analyzeDecisionQuality, compareStopGraphs, decisionTargetForLevel,
} from "./lib/level-analysis.mjs";

const DEFAULT_MANIFEST = "reports/level-redesign-selection.json";
const CORE_IDS = Object.freeze([...Array.from({ length: 12 }, (_, index) => (index + 1) * 20), 250]);
const RANGE_DEFINITIONS = Object.freeze([
  ["1-20", 1, 20], ["21-50", 21, 50], ["51-100", 51, 100],
  ["101-150", 101, 150], ["151-200", 151, 200], ["201-250", 201, 250],
]);
const BASE_FEATURES = new Set(["movement", "dots", "coins", "exit"]);
const GRADE_VALUE = Object.freeze({ F: 0, D: 1, C: 2, B: 3, A: 4, S: 5 });
const round = (value) => Number(value.toFixed(3));
const average = (items, selector) => {
  const values = items.map(selector).filter(Number.isFinite);
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
};

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function layoutPayload(level) {
  return {
    width: level.width, height: level.height, rows: level.rows, start: level.start, exit: level.exit,
    dots: level.dots || [], coins: level.coins || [], mechanics: level.mechanics || {},
  };
}

export function levelLayoutHash(level) {
  return createHash("sha256").update(stableStringify(layoutPayload(level))).digest("hex");
}

function geometryKey(level, transformIndex = 0) {
  const { width, height } = level;
  const transforms = [
    ([x, y]) => [x, y, width, height],
    ([x, y]) => [height - 1 - y, x, height, width],
    ([x, y]) => [width - 1 - x, height - 1 - y, width, height],
    ([x, y]) => [y, width - 1 - x, height, width],
    ([x, y]) => [width - 1 - x, y, width, height],
    ([x, y]) => [x, height - 1 - y, width, height],
    ([x, y]) => [y, x, height, width],
    ([x, y]) => [height - 1 - y, width - 1 - x, height, width],
  ];
  const apply = transforms[transformIndex];
  const points = (items) => items.map((point) => apply(point).slice(0, 2).join(",")).sort().join(";");
  const walls = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (level.rows[y][x] === "#") walls.push([x, y]);
  const [, , transformedWidth, transformedHeight] = apply([0, 0]);
  return `${transformedWidth}x${transformedHeight}|w:${points(walls)}|s:${points([level.start])}|e:${points([level.exit])}|d:${points(level.dots || [])}|c:${points(level.coins || [])}`;
}

function canonicalGeometry(level) {
  return Array.from({ length: 8 }, (_, index) => geometryKey(level, index)).sort()[0];
}

export function parStatus(level, metrics) {
  const errors = [];
  if (!Number.isInteger(level.minMoves) || level.minMoves < 1) errors.push("PAR_NOT_POSITIVE_INTEGER");
  if (!Array.isArray(level.solution) || level.solution.length !== level.minMoves) errors.push("PAR_SOLUTION_LENGTH_MISMATCH");
  if (!Number.isInteger(level.shortestMoves) || level.shortestMoves < 1 || level.shortestMoves > level.minMoves) errors.push("INVALID_SHORTEST_MOVES");
  if (Number.isFinite(metrics.optimalPathLength) && level.minMoves !== metrics.optimalPathLength) errors.push("PAR_NOT_OPTIMAL");
  return { valid: errors.length === 0, errors };
}

export function gradeLevel(id, metrics, validPar = true) {
  if (!validPar || !metrics.solvable || metrics.truncated || metrics.analysisError || !metrics.stopGraph) return "F";
  if (id <= 4) return metrics.optimalPathLength <= 3 ? "A" : "B";
  const target = decisionTargetForLevel(id);
  const longestRatio = metrics.longestForcedRun / Math.max(1, metrics.optimalPathLength);
  const greedyEasy = metrics.greedyExit?.success && metrics.greedyExit.gapFromOptimal <= 1;
  const randomEasy = metrics.randomSafe?.successRate >= 0.55
    && metrics.randomSafe.averageGapFromOptimal <= Math.max(2, metrics.optimalPathLength * 0.2);
  if (metrics.decisionPoints === 0 || metrics.forcedMoveRatio >= 0.9 || longestRatio >= 0.75) return "D";
  if (metrics.decisionPoints < Math.max(1, target - 3) || metrics.forcedMoveRatio > 0.82 || longestRatio > 0.67) return "C";
  if (metrics.decisionPoints >= target + 2 && metrics.forcedMoveRatio <= 0.55 && longestRatio <= 0.35
    && !greedyEasy && metrics.randomSafe.successRate < 0.35 && (metrics.masteryGap || 0) >= 2) return "S";
  if (metrics.decisionPoints >= target && metrics.forcedMoveRatio <= 0.67 && longestRatio <= 0.5 && !(greedyEasy && randomEasy)) return "A";
  return "B";
}

function mechanicsOf(level) {
  const features = (level.featureNames || []).filter((name) => !BASE_FEATURES.has(name));
  if (features.length) return [...new Set(features)].sort();
  return Object.entries(level.mechanics || {}).filter(([, value]) => Array.isArray(value) && value.length).map(([name]) => name).sort();
}

export function classifyArchetype(level, metrics) {
  const mechanics = mechanicsOf(level);
  if (level.id <= 4 || level.levelKind === "tutorial") return "ONBOARDING";
  if (CORE_IDS.includes(level.id)) return "VAULT_CORE";
  if (mechanics.includes("portals")) return "PORTAL_LOGIC";
  if (mechanics.some((name) => ["switches", "gates", "timedGates"].includes(name))) return "ORDER_LOGIC";
  if (mechanics.includes("oneWays")) return "ONE_WAY_LOGIC";
  if (mechanics.includes("redirects")) return "REDIRECT_LOGIC";
  if (mechanics.some((name) => ["breakables", "crumbles"].includes(name))) return "DESTRUCTIVE_PATH";
  const timingMechanics = mechanics.filter((name) => ["timedSpikes", "movers", "cannons", "enemies", "pulses"].includes(name));
  if (timingMechanics.length >= 2
    || (level.quality?.reactionLoad || 0) >= 4) return "TIMING_GAUNTLET";
  if (timingMechanics.length) return "TIMING_WINDOW";
  if ((level.coins || []).length >= 2 && (metrics.masteryGap || 0) >= 3) return "COLLECTOR";
  if (metrics.revisitedStops >= 4) return "LOOP_NETWORK";
  if ((metrics.stopGraph?.cycleRank || 0) >= 8) return "HUB_NETWORK";
  if (metrics.decisionPoints >= decisionTargetForLevel(level.id) + 3) return "CROSSROADS";
  if (metrics.setupMoveCount >= Math.ceil(metrics.optimalPathLength * 0.4)) return "POSITIONING";
  if ((metrics.masteryGap || 0) >= 3) return "OPTIMAL_ROUTE";
  if (metrics.forcedMoveRatio > 0.72) return "PRECISION_CORRIDOR";
  return "ROUTE_PUZZLE";
}

function levelSignature(level, metrics, archetype) {
  const idea = {
    ONBOARDING: "Learn one clear slide rule",
    VAULT_CORE: "Combine the sector mechanics across several planned stages",
    PORTAL_LOGIC: "Use a portal stop to enter the otherwise unreachable lane",
    ORDER_LOGIC: "Trigger the route control before crossing its gate",
    ONE_WAY_LOGIC: "Choose the entry direction before committing to the one-way lane",
    REDIRECT_LOGIC: "Approach the redirect from the setup position that preserves the route",
    DESTRUCTIVE_PATH: "Open the destructive path without losing the return route",
    TIMING_GAUNTLET: "Plan the route, then cross overlapping hazard windows",
    TIMING_WINDOW: "Reach a safe stop and time the next dash",
    COLLECTOR: "Take the optional reward detour and reconnect to the exit route",
    LOOP_NETWORK: "Use the loop to revisit a useful stop from a new state",
    HUB_NETWORK: "Return through the hub after completing an outer branch",
    CROSSROADS: "Read the crossroads and choose the branch that preserves progress",
    POSITIONING: "Move away from the exit first to create the required stopping angle",
    OPTIMAL_ROUTE: "Finish safely, then optimize the shorter mastery route",
    PRECISION_CORRIDOR: "Commit to the corridor only after choosing the correct setup",
    ROUTE_PUZZLE: "Build the exit route from wall-to-wall stopping positions",
  }[archetype];
  const mechanics = mechanicsOf(level);
  return `${idea}; ${metrics.decisionPoints} decisions, ${metrics.setupMoveCount} setup moves, PAR ${metrics.optimalPathLength}${mechanics.length ? `, ${mechanics.join("+")}` : ""}.`;
}

function normalizeVerdict(value) {
  if (["KEEP", "KEEP_CURRENT"].includes(value)) return "KEEP_CURRENT";
  if (["REPLACED", "REPLACE"].includes(value)) return "REPLACED";
  return "PENDING";
}

export function resolveSelections(baselineLevels, manifest) {
  const errors = [];
  const entries = new Map();
  for (const entry of manifest?.levels || []) {
    if (!Number.isInteger(entry.id) || entry.id < 1 || entry.id > 250) { errors.push(`Invalid manifest level id: ${entry.id}`); continue; }
    if (entries.has(entry.id)) errors.push(`Duplicate manifest level id: ${entry.id}`);
    entries.set(entry.id, entry);
  }
  const selections = baselineLevels.map((baseline) => {
    const entry = entries.get(baseline.id);
    if (!entry) return {
      id: baseline.id,
      verdict: baseline.verdict === "KEEP" ? "KEEP_CURRENT" : "PENDING",
      changed: false,
      source: baseline.verdict === "KEEP" ? "baseline" : "missing",
      manifestEntry: null,
    };
    const verdict = normalizeVerdict(entry.verdict || entry.recommendation);
    const changed = entry.changed === true;
    if (verdict === "REPLACED" && !changed) errors.push(`Level ${entry.id}: REPLACED must have changed=true`);
    if (verdict === "KEEP_CURRENT" && changed) errors.push(`Level ${entry.id}: KEEP_CURRENT must have changed=false`);
    if (verdict === "REPLACED" && !entry.selected?.level) errors.push(`Level ${entry.id}: REPLACED is missing selected.level`);
    return { id: baseline.id, verdict, changed, source: "manifest", manifestEntry: entry };
  });
  return { selections, errors };
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function forcedDistribution(items, selector) {
  const buckets = { "0-0.2": 0, "0.2-0.4": 0, "0.4-0.6": 0, "0.6-0.8": 0, "0.8-1.0": 0 };
  for (const item of items) {
    const value = selector(item);
    const key = value < 0.2 ? "0-0.2" : value < 0.4 ? "0.2-0.4" : value < 0.6 ? "0.4-0.6" : value < 0.8 ? "0.6-0.8" : "0.8-1.0";
    buckets[key] += 1;
  }
  return buckets;
}

function buildSimilarityWarnings(entries) {
  const mirrorWarnings = [];
  const nearDuplicateWarnings = [];
  const geometry = entries.map((entry) => ({ id: entry.id, raw: geometryKey(entry.level), canonical: canonicalGeometry(entry.level), hash: entry.layoutHash }));
  for (let left = 0; left < entries.length; left += 1) for (let right = left + 1; right < entries.length; right += 1) {
    const a = entries[left]; const b = entries[right];
    if (geometry[left].hash === geometry[right].hash) mirrorWarnings.push({ type: "EXACT_LAYOUT_DUPLICATE", levels: [a.id, b.id] });
    else if (geometry[left].canonical === geometry[right].canonical) mirrorWarnings.push({ type: "MIRROR_LAYOUT", levels: [a.id, b.id] });
    if (Math.abs(a.metrics.optimalPathLength - b.metrics.optimalPathLength) > Math.max(4, a.metrics.optimalPathLength * 0.3)) continue;
    const comparison = compareStopGraphs(a.metrics, b.metrics);
    if (comparison.similarity >= 0.94) nearDuplicateWarnings.push({
      type: "NEAR_DUPLICATE_STOP_GRAPH", levels: [a.id, b.id], ...comparison,
    });
  }
  nearDuplicateWarnings.sort((left, right) => right.similarity - left.similarity || left.levels[0] - right.levels[0]);
  return { mirrorWarnings, nearDuplicateWarnings };
}

function buildContextWarnings(entries) {
  const warnings = [];
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]; const current = entries[index];
    if (current.metrics.optimalPathLength >= previous.metrics.optimalPathLength * 1.65
      && current.metrics.optimalPathLength - previous.metrics.optimalPathLength >= 10) warnings.push({
      type: "ABRUPT_ROUTE_SPIKE", levels: [previous.id, current.id],
      detail: `${previous.metrics.optimalPathLength} -> ${current.metrics.optimalPathLength}`,
    });
    if (previous.metrics.optimalPathLength >= current.metrics.optimalPathLength * 1.65
      && previous.metrics.optimalPathLength - current.metrics.optimalPathLength >= 10) warnings.push({
      type: "ABRUPT_ROUTE_DROP", levels: [previous.id, current.id],
      detail: `${previous.metrics.optimalPathLength} -> ${current.metrics.optimalPathLength}`,
    });
    if (previous.metrics.decisionPoints - current.metrics.decisionPoints >= 4
      && current.metrics.forcedMoveRatio - previous.metrics.forcedMoveRatio >= 0.15) warnings.push({
      type: "DECISION_COLLAPSE", levels: [previous.id, current.id],
      detail: `decisions ${previous.metrics.decisionPoints} -> ${current.metrics.decisionPoints}; forced ${previous.metrics.forcedMoveRatio} -> ${current.metrics.forcedMoveRatio}`,
    });
  }
  for (let start = 0; start < entries.length;) {
    let end = start + 1;
    while (end < entries.length && entries[end].archetype === entries[start].archetype) end += 1;
    if (end - start >= 6) warnings.push({
      type: "ARCHETYPE_STREAK", levels: entries.slice(start, end).map((entry) => entry.id),
      detail: `${entries[start].archetype} x${end - start}`,
    });
    start = end;
  }
  for (let left = 0; left < entries.length; left += 1) for (let right = left + 1; right < Math.min(entries.length, left + 6); right += 1) {
    const comparison = compareStopGraphs(entries[left].metrics, entries[right].metrics);
    if (comparison.similarity >= 0.9) warnings.push({
      type: "NEIGHBOUR_TOPOLOGY_REPEAT", levels: [entries[left].id, entries[right].id], ...comparison,
    });
  }
  return warnings;
}

function rangeSummary(entries, [name, from, to]) {
  const levels = entries.filter((entry) => entry.id >= from && entry.id <= to);
  return {
    name, from, to, levels: levels.length, grades: countBy(levels, (entry) => entry.grade),
    baselineGrades: countBy(levels, (entry) => entry.baselineGrade),
    changed: levels.filter((entry) => entry.changed).length,
    averageDecisionPoints: average(levels, (entry) => entry.metrics.decisionPoints),
    averageForcedMoveRatio: average(levels, (entry) => entry.metrics.forcedMoveRatio),
    averageOptimalPathLength: average(levels, (entry) => entry.metrics.optimalPathLength),
    averageGradeDelta: average(levels, (entry) => GRADE_VALUE[entry.grade] - GRADE_VALUE[entry.baselineGrade]),
  };
}

export async function buildCampaignReport({ levels, baseline, manifest = null, randomRuns = 128 }) {
  if (levels.length !== 250 || baseline.levels?.length !== 250) throw new Error("Campaign and baseline must contain exactly 250 levels");
  const { selections, errors: manifestErrors } = resolveSelections(baseline.levels, manifest);
  const selectionById = new Map(selections.map((entry) => [entry.id, entry]));
  const baselineById = new Map(baseline.levels.map((entry) => [entry.id, entry]));
  const entries = levels.map((level) => {
    const metrics = analyzeDecisionQuality(level, { randomRuns });
    const par = parStatus(level, metrics);
    const baselineEntry = baselineById.get(level.id);
    const selection = selectionById.get(level.id);
    const layoutHash = levelLayoutHash(level);
    const archetype = metrics.stopGraph ? classifyArchetype(level, metrics) : "INVALID";
    const grade = gradeLevel(level.id, metrics, par.valid);
    const baselineGrade = gradeLevel(level.id, baselineEntry.metrics, true);
    const entryErrors = [];
    if (selection.verdict === "REPLACED" && selection.manifestEntry?.selected?.level
      && levelLayoutHash(selection.manifestEntry.selected.level) !== layoutHash) entryErrors.push("PRODUCTION_DOES_NOT_MATCH_SELECTED_LEVEL");
    return {
      id: level.id, verdict: selection.verdict, changed: selection.changed, selectionSource: selection.source,
      revision: level.revision || 1, grade, baselineGrade,
      gradeDelta: GRADE_VALUE[grade] - GRADE_VALUE[baselineGrade],
      archetype, signature: metrics.stopGraph ? levelSignature(level, metrics, archetype) : "INVALID",
      layoutHash, mechanics: mechanicsOf(level), levelKind: level.levelKind,
      par: { configured: level.minMoves, optimal: metrics.optimalPathLength, ...par },
      metrics, baselineMetrics: baselineEntry.metrics, warnings: [], errors: entryErrors,
      level,
    };
  });
  const { mirrorWarnings, nearDuplicateWarnings } = buildSimilarityWarnings(entries);
  const contextWarnings = buildContextWarnings(entries);
  for (const warning of contextWarnings) {
    const related = warning.levels.map((id) => entries[id - 1]).filter(Boolean);
    warning.resolved = related.every((entry) => ["S", "A"].includes(entry.grade) && entry.metrics.forcedMoveRatio <= 0.67);
    warning.disposition = warning.resolved
      ? warning.type === "ABRUPT_ROUTE_DROP" ? "ACCEPTED_RECOVERY_LEVEL" : "ACCEPTED_DIFFICULTY_WAVE"
      : "REQUIRES_REVIEW";
  }
  for (const warning of [...mirrorWarnings, ...nearDuplicateWarnings, ...contextWarnings]) for (const id of warning.levels) {
    const entry = entries[id - 1];
    if (entry && !entry.warnings.includes(warning.type)) entry.warnings.push(warning.type);
  }
  const invalidParIds = entries.filter((entry) => !entry.par.valid).map((entry) => entry.id);
  const lowGradeIds = entries.filter((entry) => ["D", "F"].includes(entry.grade)).map((entry) => entry.id);
  const pendingIds = entries.filter((entry) => entry.verdict === "PENDING").map((entry) => entry.id);
  const entryErrors = entries.flatMap((entry) => entry.errors.map((error) => `Level ${entry.id}: ${error}`));
  const gateErrors = [...manifestErrors, ...entryErrors];
  if (baseline.modelVersion !== ANALYSIS_MODEL_VERSION) gateErrors.push(`Baseline model ${baseline.modelVersion} != ${ANALYSIS_MODEL_VERSION}`);
  if (invalidParIds.length) gateErrors.push(`Invalid PAR: ${invalidParIds.join(", ")}`);
  if (lowGradeIds.length) gateErrors.push(`D/F grades: ${lowGradeIds.join(", ")}`);
  if (pendingIds.length) gateErrors.push(`Pending verdicts: ${pendingIds.join(", ")}`);
  const changedIds = entries.filter((entry) => entry.changed).map((entry) => entry.id);
  const unchangedIds = entries.filter((entry) => !entry.changed && entry.verdict === "KEEP_CURRENT").map((entry) => entry.id);
  const unresolvedContext = contextWarnings.filter((warning) => !warning.resolved);
  if (unresolvedContext.length) gateErrors.push(`Unresolved campaign context warnings: ${unresolvedContext.map((warning) => warning.levels.join("-")).join(", ")}`);
  return {
    reportVersion: 1, modelVersion: ANALYSIS_MODEL_VERSION, generatedAt: new Date().toISOString(),
    gate: { passed: gateErrors.length === 0, errors: gateErrors },
    manifest: { present: Boolean(manifest), version: manifest?.version ?? null },
    summary: {
      levels: entries.length, grades: countBy(entries, (entry) => entry.grade),
      baselineGrades: countBy(entries, (entry) => entry.baselineGrade),
      verdicts: countBy(entries, (entry) => entry.verdict), changed: changedIds.length,
      unchanged: unchangedIds.length, pending: pendingIds.length,
      averageDecisionPoints: average(entries, (entry) => entry.metrics.decisionPoints),
      averageForcedMoveRatio: average(entries, (entry) => entry.metrics.forcedMoveRatio),
      averageOptimalPathLength: average(entries, (entry) => entry.metrics.optimalPathLength),
      averageGradeDelta: average(entries, (entry) => entry.gradeDelta),
      before: {
        averageDecisionPoints: average(entries, (entry) => entry.baselineMetrics.decisionPoints),
        averageForcedMoveRatio: average(entries, (entry) => entry.baselineMetrics.forcedMoveRatio),
        averageOptimalPathLength: average(entries, (entry) => entry.baselineMetrics.optimalPathLength),
        forcedMoveDistribution: forcedDistribution(entries, (entry) => entry.baselineMetrics.forcedMoveRatio),
      },
      after: {
        averageDecisionPoints: average(entries, (entry) => entry.metrics.decisionPoints),
        averageForcedMoveRatio: average(entries, (entry) => entry.metrics.forcedMoveRatio),
        averageOptimalPathLength: average(entries, (entry) => entry.metrics.optimalPathLength),
        forcedMoveDistribution: forcedDistribution(entries, (entry) => entry.metrics.forcedMoveRatio),
      },
      contextWarnings: { total: contextWarnings.length, resolved: contextWarnings.length - unresolvedContext.length, unresolved: unresolvedContext.length },
    },
    changedIds, unchangedIds, pendingIds, invalidParIds, lowGradeIds,
    ranges: RANGE_DEFINITIONS.map((range) => rangeSummary(entries, range)),
    vaultCores: CORE_IDS.map((id) => {
      const entry = entries[id - 1];
      return {
        id, status: ["D", "F"].includes(entry.grade) || !entry.par.valid ? "FAIL" : entry.grade === "C" ? "REVIEW" : "PASS",
        grade: entry.grade, baselineGrade: entry.baselineGrade, verdict: entry.verdict,
        changed: entry.changed, par: entry.par, archetype: entry.archetype, mechanics: entry.mechanics, warnings: entry.warnings,
      };
    }),
    warnings: { mirrors: mirrorWarnings, nearDuplicates: nearDuplicateWarnings, context: contextWarnings },
    worstOutliers: [...entries].sort((left, right) => right.metrics.forcedMoveRatio - left.metrics.forcedMoveRatio
      || left.metrics.decisionPoints - right.metrics.decisionPoints).slice(0, 10).map((entry) => ({
      id: entry.id, grade: entry.grade, archetype: entry.archetype,
      forcedMoveRatio: entry.metrics.forcedMoveRatio, decisionPoints: entry.metrics.decisionPoints,
      longestForcedRun: entry.metrics.longestForcedRun, optimalPathLength: entry.metrics.optimalPathLength,
    })),
    levels: entries.map(({ level, ...entry }) => entry),
  };
}

function formatIds(ids) { return ids.length ? ids.join(", ") : "none"; }

function markdown(report, manifestPath) {
  const lines = [
    "# Neon Vaults final campaign report", "",
    `Production gate: **${report.gate.passed ? "PASS" : "FAIL"}**. Analyzer: \`${report.modelVersion}\`. Manifest: \`${manifestPath}\` (${report.manifest.present ? "loaded" : "missing"}).`, "",
    `Changed (${report.changedIds.length}): ${formatIds(report.changedIds)}.`, "",
    `Unchanged (${report.unchangedIds.length}): ${formatIds(report.unchangedIds)}.`, "",
    `Pending (${report.pendingIds.length}): ${formatIds(report.pendingIds)}.`, "",
    `Grades: ${Object.entries(report.summary.grades).map(([grade, count]) => `${grade} ${count}`).join("; ")}. Baseline: ${Object.entries(report.summary.baselineGrades).map(([grade, count]) => `${grade} ${count}`).join("; ")}.`, "",
    "## Before / after", "",
    "| Metric | Before | After |",
    "| :--- | ---: | ---: |",
    `| Average decisionPoints | ${report.summary.before.averageDecisionPoints} | ${report.summary.after.averageDecisionPoints} |`,
    `| Average forcedMoveRatio | ${report.summary.before.averageForcedMoveRatio} | ${report.summary.after.averageForcedMoveRatio} |`,
    `| Average optimalPathLength | ${report.summary.before.averageOptimalPathLength} | ${report.summary.after.averageOptimalPathLength} |`,
    `| Forced distribution | ${JSON.stringify(report.summary.before.forcedMoveDistribution)} | ${JSON.stringify(report.summary.after.forcedMoveDistribution)} |`, "",
    "## Campaign ranges", "",
    "| Range | Grades | Baseline | Changed | Decisions | Forced | Optimal | Grade delta |",
    "| :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: |",
    ...report.ranges.map((range) => `| ${range.name} | ${JSON.stringify(range.grades)} | ${JSON.stringify(range.baselineGrades)} | ${range.changed} | ${range.averageDecisionPoints} | ${range.averageForcedMoveRatio} | ${range.averageOptimalPathLength} | ${range.averageGradeDelta} |`),
    "", "## Vault Cores", "",
    "| Level | Status | Grade | Baseline | Verdict | Changed | PAR | Mechanics | Warnings |",
    "| ---: | :--- | :---: | :---: | :--- | :---: | :---: | :--- | :--- |",
    ...report.vaultCores.map((core) => `| ${core.id} | ${core.status} | ${core.grade} | ${core.baselineGrade} | ${core.verdict} | ${core.changed ? "yes" : "no"} | ${core.par.configured}/${core.par.optimal} | ${core.mechanics.join(", ") || "clean"} | ${core.warnings.join(", ") || "—"} |`),
    "", "## Similarity and context warnings", "",
    `Mirrors/exact layouts: ${report.warnings.mirrors.length}; near-duplicate stop graphs: ${report.warnings.nearDuplicates.length}; context: ${report.warnings.context.length}.`, "",
    ...[...report.warnings.mirrors, ...report.warnings.nearDuplicates, ...report.warnings.context].map((warning) => `- ${warning.type} [${warning.levels.join(", ")}]${warning.similarity === undefined ? "" : ` similarity=${warning.similarity}`}${warning.detail ? `: ${warning.detail}` : ""}${warning.disposition ? ` — ${warning.disposition}` : ""}`),
    "", "## Worst remaining metric outliers", "",
    ...report.worstOutliers.map((entry) => `- Level ${entry.id}: ${entry.grade}, ${entry.archetype}, forced=${entry.forcedMoveRatio}, decisions=${entry.decisionPoints}, longest=${entry.longestForcedRun}/${entry.optimalPathLength}.`),
    "", "## All levels", "",
    "| ID | Verdict | Grade | Before | Archetype | Decisions | Forced | Optimal/PAR | Signature | Warnings |",
    "| ---: | :--- | :---: | :---: | :--- | ---: | ---: | :---: | :--- | :--- |",
    ...report.levels.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.grade} | ${entry.baselineGrade} | ${entry.archetype} | ${entry.metrics.decisionPoints ?? "—"} | ${entry.metrics.forcedMoveRatio ?? "—"} | ${entry.metrics.optimalPathLength ?? "—"}/${entry.par.configured} | \`${entry.signature}\` | ${entry.warnings.join(", ") || "—"} |`),
  ];
  if (report.gate.errors.length) lines.push("", "## Gate failures", "", ...report.gate.errors.map((error) => `- ${error}`));
  return `${lines.join("\n")}\n`;
}

async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function main() {
  const valueOf = (name) => process.argv.slice(2).find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
  const baselinePath = valueOf("--baseline") || "reports/level-baseline.json";
  const manifestPath = valueOf("--manifest") || DEFAULT_MANIFEST;
  const output = valueOf("--output") || "reports/final-campaign-report";
  const randomRuns = Math.max(16, Math.min(512, Number(valueOf("--runs")) || 128));
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const manifest = await readOptionalJson(manifestPath);
  const report = await buildCampaignReport({ levels: LEVELS, baseline, manifest, randomRuns });
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(`${output}.md`, markdown(report, manifestPath), "utf8");
  console.log(`Campaign: ${report.summary.levels}; changed ${report.summary.changed}; unchanged ${report.summary.unchanged}; pending ${report.summary.pending}`);
  console.log(`Grades: ${Object.entries(report.summary.grades).map(([grade, count]) => `${grade}=${count}`).join(" ")}`);
  console.log(`Warnings: mirrors=${report.warnings.mirrors.length} near=${report.warnings.nearDuplicates.length} context=${report.warnings.context.length}`);
  console.log(`Production gate: ${report.gate.passed ? "PASS" : "FAIL"}`);
  if (!report.gate.passed) {
    for (const error of report.gate.errors) console.error(error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
