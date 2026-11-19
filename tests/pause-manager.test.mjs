import test from "node:test";
import assert from "node:assert/strict";
import { PauseManager } from "../src/pause-manager.js";

test("pause manager resumes only after every reason clears", () => {
  const calls = [];
  const game = { pause: () => calls.push("game:stop"), resume: () => calls.push("game:start") };
  const audio = { pause: () => calls.push("audio:stop"), resume: () => calls.push("audio:start") };
  const input = { setEnabled: (enabled) => calls.push(`input:${enabled}`) };
  const adapter = { gameplayStop: () => calls.push("sdk:stop"), gameplayStart: () => calls.push("sdk:start") };
  const manager = new PauseManager({ game, audio, input, adapter, isGameplay: () => true });

  manager.sync();
  manager.set("visibility", true);
  manager.set("ad", true);
  manager.set("visibility", false);
  assert.equal(manager.running, false);
  assert.ok(!calls.includes("sdk:start", calls.indexOf("sdk:stop") + 1));
  manager.set("ad", false);
  assert.equal(manager.running, true);
  assert.deepEqual([...manager.pauseReasons], []);
  assert.equal(calls.filter((call) => call === "sdk:start").length, 2);
});

test("closing an ad cannot resume while visibility or platform pause remains", () => {
  const calls = [];
  const manager = new PauseManager({
    game: { pause: () => calls.push("game:stop"), resume: () => calls.push("game:start") },
    audio: { pause: () => calls.push("audio:stop"), resume: () => calls.push("audio:start") },
    input: { setEnabled: (enabled) => calls.push(`input:${enabled}`) },
    adapter: { gameplayStop: () => calls.push("sdk:stop"), gameplayStart: () => calls.push("sdk:start") },
    isGameplay: () => true,
  });

  manager.sync();
  manager.set("ad", true);
  manager.set("visibility", true);
  manager.set("platform", true);
  manager.set("ad", false);
  assert.equal(manager.running, false);
  assert.equal(calls.filter((call) => call === "sdk:start").length, 1);
  manager.set("visibility", false);
  assert.equal(manager.running, false);
  manager.set("platform", false);
  assert.equal(manager.running, true);
  assert.equal(calls.filter((call) => call === "sdk:start").length, 2);
});
