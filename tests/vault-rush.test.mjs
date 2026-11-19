import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/levels.js";
import {
  completeVaultRushRoom, continueVaultRush, createVaultRushRun, failVaultRush,
  tickVaultRush, vaultRushRoom, VAULT_RUSH_START_TIME,
} from "../src/vault-rush.js";

test("Vault Rush selects deterministic, validated campaign rooms by security band", () => {
  const run = createVaultRushRun(12345);
  const first = vaultRushRoom(run, LEVELS);
  assert.equal(first.id, vaultRushRoom(run, LEVELS).id);
  assert.ok(first.id >= 1 && first.id <= 19);
  assert.equal(first.rush, true);
  const late = vaultRushRoom({ ...run, room: 18, securityLevel: 7 }, LEVELS);
  assert.ok(late.id >= 121 && late.id <= 139);
  assert.ok(late.solution.length > 0);
});

test("Vault Rush rewards efficient rooms and raises security every three rooms", () => {
  let run = createVaultRushRun(7);
  for (let room = 0; room < 3; room += 1) run = completeVaultRushRoom(run, { dots: 8, coins: 1, cores: 3, dashes: 5, par: 5, time: 8 });
  assert.equal(run.room, 3);
  assert.equal(run.securityLevel, 2);
  assert.equal(run.multiplier, 1.75);
  assert.equal(run.streak, 3);
  assert.ok(run.score > 0);
  assert.ok(run.timeRemaining > VAULT_RUSH_START_TIME);
});

test("Vault Rush ends safely on timer or death and permits only one explicit continue", () => {
  const timed = tickVaultRush(createVaultRushRun(1), VAULT_RUSH_START_TIME + 1);
  assert.equal(timed.endReason, "timer");
  assert.equal(timed.timeRemaining, 0);
  const dead = failVaultRush(tickVaultRush(createVaultRushRun(2), 41));
  const continued = continueVaultRush(dead);
  assert.equal(continued.ended, false);
  assert.equal(continued.timeRemaining, 12);
  assert.equal(continued.continueUsed, true);
  assert.deepEqual(continueVaultRush(failVaultRush(continued)), failVaultRush(continued));
});
