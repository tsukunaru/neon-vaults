import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { LEVELS } from "../src/levels.js";
import { analyzeLevelQuality, solveLevel, validateLevel } from "../src/level-validator.js";
import { runtimeRouteWins } from "../scripts/generate-levels.mjs";
import { layoutHash } from "./finalize-campaign-levels.mjs";

const report = JSON.parse(await readFile("reports/level-pilot-candidates.json", "utf8"));
const selected = new Map();

for (const entry of report.levels) {
  if (entry.recommendation === "KEEP_CURRENT") continue;
  const candidate = entry.candidates[0];
  if (!candidate) throw new Error(`Level ${entry.id}: approved pilot candidate is missing`);
  const solution = solveLevel(candidate.level);
  const rewardRoute = solveLevel(candidate.level, { coins: candidate.level.coins || [] });
  const level = {
    ...candidate.level,
    revision: 2,
    solution,
    minMoves: solution?.length,
  };
  level.quality = analyzeLevelQuality(level);
  const validation = validateLevel(level);
  if (!validation.valid || !rewardRoute) throw new Error(`Level ${entry.id}: ${validation.errors.join("; ") || "missing reward route"}`);
  for (const route of [solution, rewardRoute]) for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    if (!runtimeRouteWins(level, route, dt)) throw new Error(`Level ${entry.id}: runtime route failed at ${Math.round(1 / dt)} FPS`);
  }
  selected.set(entry.id, { candidateId: candidate.candidateId, score: candidate.score, level });
}

const levels = LEVELS.map((level) => selected.get(level.id)?.level || level);
if (new Set(levels.map((level) => level.rows.join("/"))).size !== 250) throw new Error("Pilot selection introduced a duplicate layout");

for (let start = 0; start < 250; start += 50) {
  if (![...selected].some(([id]) => id > start && id <= start + 50)) continue;
  const from = String(start + 1).padStart(3, "0");
  const to = String(start + 50).padStart(3, "0");
  await writeFile(`src/levels/levels-${from}-${to}.js`, `// Generated static level configurations ${from}-${to}.\nexport default ${JSON.stringify(levels.slice(start, start + 50))};\n`, "utf8");
}

const metrics = levels.map(({ id, width, height, minMoves, shortestMoves, levelKind, quality, difficulty, expectedSeconds, featureNames, revision }) => ({
  id, width, height, minMoves, shortestMoves, levelKind, quality, ...(revision ? { revision } : {}),
  difficulty: Number(difficulty.toFixed(1)), expectedSeconds, mechanics: featureNames,
}));
await writeFile("src/levels/metrics.json", `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const approval = {
  version: 1,
  source: "reports/level-pilot-candidates.json",
  changedIds: [...selected.keys()],
  keptIds: report.levels.filter((entry) => !selected.has(entry.id)).map((entry) => entry.id),
  levels: report.levels.map((entry) => {
    const choice = selected.get(entry.id);
    return {
      id: entry.id,
      verdict: choice ? "REPLACED" : "KEEP_CURRENT",
      candidateId: choice?.candidateId || null,
      score: choice?.score ?? entry.baseline.score,
      layoutHash: layoutHash(choice?.level || LEVELS[entry.id - 1]),
      revision: choice?.level.revision || 1,
    };
  }),
  campaignHash: sha256(JSON.stringify(levels.map((level) => ({ id: level.id, hash: layoutHash(level) })))),
};
await writeFile("reports/level-pilot-approved.json", `${JSON.stringify(approval, null, 2)}\n`, "utf8");
console.log(`Pilot integrated: ${selected.size} replaced, ${report.levels.length - selected.size} kept; runtime routes passed at 30/60/120 FPS.`);
