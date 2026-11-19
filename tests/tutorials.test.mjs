import test from "node:test";
import assert from "node:assert/strict";
import { STRINGS } from "../src/i18n.js";
import { MECHANIC_TUTORIALS, mechanicTutorial, mechanicTutorialsForLevel, nextMechanicTutorial } from "../src/tutorials.js";

test("all required mechanics have compact RU and EN tutorial copy", () => {
  assert.equal(MECHANIC_TUTORIALS.length, 15);
  assert.equal(new Set(MECHANIC_TUTORIALS.map((item) => item.key)).size, 15);
  for (const tutorial of MECHANIC_TUTORIALS) for (const language of ["ru", "en"]) {
    assert.ok(STRINGS[language][tutorial.titleKey]);
    assert.ok(STRINGS[language][tutorial.bodyKey]);
    assert.ok(STRINGS[language][tutorial.bodyKey].length <= 120);
  }
});

test("level tutorials are shown once and hidden secrets stay secret", () => {
  const level = { mechanics: { spikes: [[2, 2]], timedSpikes: [{ x: 3, y: 3 }], secrets: [{ x: 1, y: 1 }] } };
  assert.equal(nextMechanicTutorial(level, {})?.key, "spikes");
  assert.deepEqual(mechanicTutorialsForLevel(level, { spikes: true }).map((item) => item.key), ["timedSpikes"]);
  assert.equal(mechanicTutorial("secrets")?.icon, "✦");
});

test("timed gates are detected from their timed switch pair", () => {
  const level = { mechanics: { switches: [{ timed: true }], gates: [{ timed: true }] } };
  assert.deepEqual(mechanicTutorialsForLevel(level).map((item) => item.key), ["switches", "timedGates"]);
});
