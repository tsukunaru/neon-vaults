import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LEVELS } from "../src/levels.js";
import { layoutHash } from "../tools/finalize-campaign-levels.mjs";

const [baseline, manifest, pilot, report] = await Promise.all([
  "reports/level-baseline.json",
  "reports/level-redesign-selection.json",
  "reports/level-pilot-approved.json",
  "reports/final-campaign-report.json",
].map(async (path) => JSON.parse(await readFile(path, "utf8"))));

test("production campaign exactly matches all approved redesign revisions", () => {
  assert.equal(manifest.productionApplied, true);
  assert.equal(manifest.levels.length, 250);
  assert.equal(manifest.summary.pending, 0);
  assert.equal(manifest.summary.countChangedLayouts, manifest.levels.filter((entry) => entry.changed).length);
  assert.ok(manifest.summary.countChangedLayouts > 0);

  for (const entry of manifest.levels) {
    const level = LEVELS[entry.id - 1];
    assert.ok(["KEEP_CURRENT", "REPLACED"].includes(entry.verdict), `level ${entry.id} has ${entry.verdict}`);
    if (entry.changed) {
      assert.equal(entry.verdict, "REPLACED");
      assert.equal(layoutHash(level), layoutHash(entry.selected.level), `level ${entry.id} production mismatch`);
      assert.equal(level.revision, entry.selected.layoutRevision, `level ${entry.id} revision mismatch`);
      assert.ok(level.revision >= 2);
    } else {
      assert.equal(entry.verdict, "KEEP_CURRENT");
      assert.equal(layoutHash(level), entry.baseline.layoutHash, `level ${entry.id} changed without approval`);
    }
  }
});

test("every original TUNE level and every Vault Core received a final automated review", () => {
  const pilotIds = new Set(pilot.levels.map((entry) => entry.id));
  for (const baselineEntry of baseline.levels.filter((entry) => entry.verdict === "TUNE")) {
    const entry = manifest.levels[baselineEntry.id - 1];
    assert.ok(entry.evaluated >= 100 || (pilotIds.has(entry.id) && entry.evaluated >= 32), `level ${entry.id} evaluated ${entry.evaluated}`);
  }
  for (const id of [...Array.from({ length: 12 }, (_, index) => (index + 1) * 20), 250]) {
    assert.ok(manifest.levels[id - 1].evaluated >= (id === 250 ? 500 : 300), `Vault Core ${id} search too small`);
  }
});

test("final quality report has valid PAR, no pending approvals, and no D/F maps", () => {
  assert.equal(report.gate.passed, true, report.gate.errors.join("\n"));
  assert.deepEqual(report.pendingIds, []);
  assert.deepEqual(report.invalidParIds, []);
  assert.deepEqual(report.lowGradeIds, []);
  assert.equal(report.summary.contextWarnings.unresolved, 0);
  assert.equal(report.warnings.mirrors.length, 0);
  assert.equal(report.warnings.nearDuplicates.length, 0);
});
