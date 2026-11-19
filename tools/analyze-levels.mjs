import { mkdir, writeFile } from "node:fs/promises";
import { LEVELS } from "../src/levels.js";
import {
  ANALYSIS_MODEL_VERSION, PILOT_LEVEL_IDS, analyzeDecisionQuality, compareStopGraphs, decisionTargetForLevel, parseLevelIds,
} from "./lib/level-analysis.mjs";

const valueOf = (name) => process.argv.slice(2).find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
const has = (name) => process.argv.slice(2).includes(name);

function assess(id, metrics) {
  if (!metrics.solvable || metrics.truncated || metrics.analysisError) return { verdict: "REPLACE", flags: ["ANALYSIS_FAILURE"] };
  const flags = [];
  const target = decisionTargetForLevel(id);
  if (metrics.decisionPoints < target) flags.push("LOW_DECISIONS");
  if (metrics.forcedMoveRatio >= 0.85) flags.push("HIGH_FORCED_RATIO");
  else if (metrics.forcedMoveRatio > 0.65) flags.push("ELEVATED_FORCED_RATIO");
  if (metrics.longestForcedRun >= Math.max(4, Math.ceil(metrics.optimalPathLength * 0.5))) flags.push("LONG_FORCED_RUN");
  if (metrics.greedyExit.success && metrics.greedyExit.gapFromOptimal <= 1) flags.push("GREEDY_EXIT_NEAR_OPTIMAL");
  if (metrics.randomSafe.successRate >= 0.55
    && metrics.randomSafe.averageGapFromOptimal <= Math.max(2, metrics.optimalPathLength * 0.2)) flags.push("RANDOM_WALK_FRIENDLY");
  if (id >= 11 && metrics.masteryGap <= 1) flags.push("LOW_MASTERY_GAP");
  if (metrics.topologyApproximation) flags.push("TOPOLOGY_APPROXIMATION");

  if (id > 4 && (metrics.decisionPoints === 0 || metrics.forcedMoveRatio >= 0.85)) return { verdict: "REDESIGN", flags };
  if (flags.some((flag) => ["LOW_DECISIONS", "ELEVATED_FORCED_RATIO", "LONG_FORCED_RUN", "GREEDY_EXIT_NEAR_OPTIMAL", "RANDOM_WALK_FRIENDLY", "LOW_MASTERY_GAP"].includes(flag))) {
    return { verdict: "TUNE", flags };
  }
  return { verdict: "KEEP", flags };
}

const average = (items, selector) => {
  const values = items.map(selector).filter(Number.isFinite);
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)) : null;
};

function markdown(report) {
  const summary = report.summary;
  const lines = [
    `# Neon Vaults level baseline (${report.scope})`,
    "",
    `Model: \`${report.modelVersion}\`. Production levels changed: **no**.`,
    "",
    `Levels: ${report.levels.length}; KEEP ${summary.verdicts.KEEP || 0}; TUNE ${summary.verdicts.TUNE || 0}; REDESIGN ${summary.verdicts.REDESIGN || 0}; REPLACE ${summary.verdicts.REPLACE || 0}.`,
    "",
    `Average decisionPoints: ${summary.averageDecisionPoints}; forcedMoveRatio: ${summary.averageForcedMoveRatio}; optimalPathLength: ${summary.averageOptimalPathLength}; linearityScore: ${summary.averageLinearityScore}.`,
    "",
    "| Level | Verdict | Optimal | Decisions | Forced | Linear | RandomSafe | GreedyExit | Flags |",
    "| ---: | :--- | ---: | ---: | ---: | ---: | ---: | :---: | :--- |",
    ...report.levels.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.metrics.optimalPathLength ?? "—"} | ${entry.metrics.decisionPoints ?? "—"} | ${entry.metrics.forcedMoveRatio ?? "—"} | ${entry.metrics.linearityScore ?? "—"} | ${entry.metrics.randomSafe?.successRate ?? "—"} | ${entry.metrics.greedyExit?.success ? entry.metrics.greedyExit.dashes : "fail"} | ${entry.flags.join(", ") || "—"} |`),
    "",
    "## Stop-graph similarity warnings",
    "",
    ...(report.similarityWarnings.length
      ? report.similarityWarnings.map((item) => `- ${item.left} ↔ ${item.right}: ${item.similarity}${item.exactTopology ? " (same topology hash)" : ""}`)
      : ["No pairs reached the 0.94 warning threshold."]),
    "",
    "> Topology metrics model permanent walls/spikes, one-way tiles, portals, redirects, switches and gates. Timing, moving hazards, crumbles and mutable breakables remain approximations and still require runtime validation.",
    "",
  ];
  return lines.join("\n");
}

const explicitIds = parseLevelIds(valueOf("--ids"));
const ids = explicitIds || (has("--pilot") ? PILOT_LEVEL_IDS : LEVELS.map((level) => level.id));
const randomRuns = Math.max(1, Math.min(512, Number(valueOf("--runs")) || 128));
const analyzed = ids.map((id) => {
  const level = LEVELS[id - 1];
  if (!level) throw new Error(`Unknown level ${id}`);
  const metrics = analyzeDecisionQuality(level, { randomRuns });
  return { id, mechanics: level.featureNames || [], metrics, ...assess(id, metrics) };
});

const similarityWarnings = [];
for (let left = 0; left < analyzed.length; left += 1) for (let right = left + 1; right < analyzed.length; right += 1) {
  if (!analyzed[left].metrics.stopGraph || !analyzed[right].metrics.stopGraph) continue;
  const comparison = compareStopGraphs(analyzed[left].metrics, analyzed[right].metrics);
  if (comparison.similarity >= 0.94) similarityWarnings.push({ left: analyzed[left].id, right: analyzed[right].id, ...comparison });
}
similarityWarnings.sort((left, right) => right.similarity - left.similarity || left.left - right.left || left.right - right.right);
for (const warning of similarityWarnings) for (const id of [warning.left, warning.right]) {
  const entry = analyzed.find((item) => item.id === id);
  if (!entry.flags.includes("NEAR_DUPLICATE_STOP_GRAPH")) entry.flags.push("NEAR_DUPLICATE_STOP_GRAPH");
  if (entry.verdict === "KEEP") entry.verdict = "TUNE";
}

const verdicts = {};
for (const entry of analyzed) verdicts[entry.verdict] = (verdicts[entry.verdict] || 0) + 1;
const report = {
  modelVersion: ANALYSIS_MODEL_VERSION,
  scope: explicitIds ? "custom" : has("--pilot") ? "pilot" : "campaign",
  productionLevelsChanged: false,
  levelIds: ids,
  randomRuns,
  summary: {
    verdicts,
    averageDecisionPoints: average(analyzed, (entry) => entry.metrics.decisionPoints),
    averageForcedMoveRatio: average(analyzed, (entry) => entry.metrics.forcedMoveRatio),
    averageOptimalPathLength: average(analyzed, (entry) => entry.metrics.optimalPathLength),
    averageLinearityScore: average(analyzed, (entry) => entry.metrics.linearityScore),
    averageRandomSuccessRate: average(analyzed, (entry) => entry.metrics.randomSafe?.successRate),
    greedyExitSuccesses: analyzed.filter((entry) => entry.metrics.greedyExit?.success).length,
    topologyApproximations: analyzed.filter((entry) => entry.metrics.topologyApproximation).length,
  },
  similarityWarnings,
  levels: analyzed,
};

const baseName = valueOf("--output") || (report.scope === "pilot" ? "level-pilot-baseline" : report.scope === "campaign" ? "level-baseline" : "level-custom-baseline");
await mkdir("reports", { recursive: true });
await writeFile(`reports/${baseName}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(`reports/${baseName}.md`, markdown(report), "utf8");
console.log(`${report.scope}: ${analyzed.length} levels; KEEP ${verdicts.KEEP || 0}, TUNE ${verdicts.TUNE || 0}, REDESIGN ${verdicts.REDESIGN || 0}, REPLACE ${verdicts.REPLACE || 0}`);
console.log(`decisionPoints ${report.summary.averageDecisionPoints}; forcedMoveRatio ${report.summary.averageForcedMoveRatio}; optimalPathLength ${report.summary.averageOptimalPathLength}`);
console.log(`Reports: reports/${baseName}.json, reports/${baseName}.md`);
