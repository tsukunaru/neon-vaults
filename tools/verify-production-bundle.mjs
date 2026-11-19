import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const MANIFEST = "reports/level-redesign-selection.json";
const BUNDLE = "dist/game.js";
const CHECKPOINT = "backups/campaign-before-final-redesign-20260830/game.js";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const check = (condition, message) => { if (!condition) throw new Error(message); };

const [manifest, bundle] = await Promise.all([
  readFile(MANIFEST, "utf8").then(JSON.parse),
  readFile(BUNDLE, "utf8"),
]);
const levels = manifest.levels;
check(Array.isArray(levels) && levels.length === 250, "selection manifest must contain 250 final levels");
check(new Set(levels.map(({ id }) => id)).size === 250 && levels.every(({ id }) => Number.isInteger(id) && id >= 1 && id <= 250), "selection manifest level ids must be unique 1..250");
check(levels.every(({ verdict }) => verdict === "KEEP_CURRENT" || verdict === "REPLACED"), "selection manifest contains a pending or invalid verdict");
check(manifest.summary?.pending === 0, "selection manifest summary has pending levels");

const replaced = levels.filter(({ verdict }) => verdict === "REPLACED");
check(replaced.length > 0 && replaced.length === manifest.summary?.replaced, "REPLACED count disagrees with selection manifest summary");
check(replaced.length === manifest.summary?.countChangedLayouts, "changed-layout count disagrees with selection manifest summary");
for (const entry of replaced) {
  const rows = entry.selected?.level?.rows;
  check(Array.isArray(rows) && rows.length > 0, `level ${entry.id} has no selected production rows`);
  check(bundle.includes(JSON.stringify(rows)), `level ${entry.id} selected rows are missing from dist/game.js`);
}

const bundleHash = sha256(bundle);
let checkpointHash = null;
try {
  checkpointHash = sha256(await readFile(CHECKPOINT));
  check(bundleHash !== checkpointHash, "dist/game.js is identical to the pre-redesign checkpoint");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

console.log(`Production bundle verified: 250 verdicts, ${replaced.length} replaced layouts, 0 pending, SHA-256 ${bundleHash}${checkpointHash ? ` (checkpoint ${checkpointHash})` : ""}.`);
