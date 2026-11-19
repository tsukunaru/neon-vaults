import test from "node:test";
import assert from "node:assert/strict";
import { compactSave, createDefaultSave, levelRecord, loadLocalSave, mergeSaves, normalizeSave } from "../src/save.js";
import { SKINS, nextChestSkin } from "../src/skins.js";

test("damaged saves recover to a safe guest profile", () => {
  const save = normalizeSave({ unlockedLevel: -20, coins: "oops", ownedSkins: ["bad"], settings: { music: "yes" } });
  assert.equal(save.unlockedLevel, 1);
  assert.equal(save.coins, 0);
  assert.deepEqual(save.ownedSkins, ["spark"]);
  assert.equal(save.settings.music, true);
  assert.equal(save.settings.swipeSensitivity, "normal");
  assert.deepEqual(save.dailyScores, {});
  assert.deepEqual(save.bestTimes, {});
});

test("cloud merge keeps progression but uses the newest complete economy snapshot", () => {
  const local = createDefaultSave();
  Object.assign(local, { updatedAt: 200, unlockedLevel: 30, coins: 120, vaultCoins: 8, chestSerial: 4, vaultChestSerial: 2, cores: { 1: 3 }, ownedSkins: ["spark", "lime"] });
  const cloud = createDefaultSave();
  Object.assign(cloud, { updatedAt: 100, unlockedLevel: 20, coins: 500, vaultCoins: 12, chestSerial: 1, vaultChestSerial: 1, cores: { 2: 2 }, ownedSkins: ["spark", "gold"] });
  const merged = mergeSaves(local, cloud);
  assert.equal(merged.unlockedLevel, 30);
  assert.equal(merged.coins, 120);
  assert.equal(merged.vaultCoins, 8);
  assert.equal(merged.chestSerial, 4);
  assert.equal(merged.vaultChestSerial, 2);
  assert.equal(merged.cores[1], 3);
  assert.equal(merged.cores[2], 2);
  assert.ok(merged.ownedSkins.includes("lime") && merged.ownedSkins.includes("gold"));
});

test("newer cloud economy wins without reviving an older local balance", () => {
  const local = createDefaultSave();
  Object.assign(local, { updatedAt: 100, coins: 900, vaultCoins: 30, chestSerial: 1 });
  const cloud = createDefaultSave();
  Object.assign(cloud, { updatedAt: 300, coins: 75, vaultCoins: 4, chestSerial: 8 });
  const merged = mergeSaves(local, cloud);
  assert.deepEqual([merged.coins, merged.vaultCoins, merged.chestSerial], [75, 4, 8]);
});

test("equal or missing save timestamps prefer local economy unless local is empty", () => {
  const local = { coins: 12, vaultCoins: 3, ownedSkins: ["spark"] };
  const cloud = { coins: 800, vaultCoins: 20, unlockedLevel: 12, ownedSkins: ["spark"] };
  assert.equal(mergeSaves(local, cloud).coins, 12);
  assert.equal(mergeSaves({}, cloud).coins, 800);
});

test("first sync on a device without a stored save keeps the cloud economy", () => {
  const loaded = loadLocalSave({ getItem: () => null });
  const cloud = { updatedAt: Date.now() - 86400000, unlockedLevel: 80, coins: 777, vaultCoins: 12, chestSerial: 6, ownedSkins: ["spark"] };
  const merged = mergeSaves(loaded.present ? loaded.save : {}, cloud);
  assert.equal(loaded.present, false);
  assert.deepEqual([merged.unlockedLevel, merged.coins, merged.vaultCoins, merged.chestSerial], [80, 777, 12, 6]);
});

test("first account sync keeps guest progression but takes the cloud economy", () => {
  const guest = { updatedAt: Date.now(), unlockedLevel: 10, completed: { 9: true }, cores: { 9: 3 }, coins: 5, ownedSkins: ["spark"] };
  const cloud = { updatedAt: 100, unlockedLevel: 80, completed: { 79: true }, cores: { 79: 2 }, coins: 777, vaultCoins: 12, chestSerial: 6, ownedSkins: ["spark"] };
  const merged = mergeSaves(cloud, { ...guest, updatedAt: 0 });
  assert.deepEqual([merged.coins, merged.vaultCoins, merged.chestSerial], [777, 12, 6]);
  assert.equal(merged.unlockedLevel, 80);
  assert.equal(merged.completed[9], true); assert.equal(merged.completed[79], true);
  assert.equal(merged.cores[9], 3); assert.equal(merged.cores[79], 2);
});

test("version 1 saves migrate without losing progress, records, skins, or settings", () => {
  const migrated = normalizeSave({
    version: 1, unlockedLevel: 87, completed: { 86: true }, cores: { 86: 3 }, bestTimes: { 86: 12.4 },
    coins: 41, vaultCoins: 7, ownedSkins: ["spark", "gold"], equippedSkin: "gold",
    stats: { deaths: 9, completions: 30 }, settings: { language: "ru", reducedMotion: true }, updatedAt: 123,
  });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.unlockedLevel, 87);
  assert.equal(migrated.cores[86], 3);
  assert.equal(migrated.bestTimes[86], 12.4);
  assert.ok(migrated.ownedSkins.includes("gold"));
  assert.equal(migrated.settings.language, "ru");
  assert.equal(migrated.settings.languagePlatform, null);
  assert.equal(migrated.settings.reducedMotion, true);
  assert.deepEqual(migrated.bestDashes, {});
});

test("level revisions hide stale route records without losing progression", () => {
  const migrated = normalizeSave({
    version: 2, unlockedLevel: 88, completed: { 12: true }, cores: { 12: 3 },
    bestTimes: { 12: 4.2 }, bestDashes: { 12: 2 },
    routeGhosts: { 12: { directions: ["right", "down"], completionTime: 4.2 } },
    ownedSkins: ["spark", "gold"],
  });
  assert.equal(levelRecord(migrated, { id: 12 }).bestDashes, 2);
  assert.deepEqual(levelRecord(migrated, { id: 12, revision: 2 }), {
    revision: 2, compatible: false, bestDashes: undefined, bestTime: undefined, ghost: null,
  });
  assert.equal(migrated.completed[12], true);
  assert.equal(migrated.cores[12], 3);
  assert.ok(migrated.ownedSkins.includes("gold"));
});

test("cloud merge never lets an older layout record beat a newer revision", () => {
  const oldLayout = { bestTimes: { 12: 2 }, bestDashes: { 12: 1 }, routeGhosts: { 12: { directions: ["up"], completionTime: 2 } } };
  const newLayout = { levelRevisions: { 12: 2 }, bestTimes: { 12: 9 }, bestDashes: { 12: 7 }, routeGhosts: { 12: { directions: ["left", "down"], completionTime: 9 } } };
  const merged = mergeSaves(oldLayout, newLayout);
  assert.equal(merged.levelRevisions[12], 2);
  assert.equal(merged.bestDashes[12], 7);
  assert.equal(merged.bestTimes[12], 9);
  assert.deepEqual(merged.routeGhosts[12].directions, ["left", "down"]);
});

test("route ghosts are bounded, validated, and merged by best route", () => {
  const local = normalizeSave({ routeGhosts: { 4: { directions: ["up", "right", "down"], timings: [100, 220, 310], completionTime: 3.2 } } });
  const cloud = normalizeSave({ routeGhosts: { 4: { directions: ["up", "right"], timings: [110, 260], completionTime: 4.1 }, 999: { directions: ["left"] } } });
  const merged = mergeSaves(local, cloud);
  assert.equal(merged.routeGhosts[4].totalDashes, 2);
  assert.equal(merged.routeGhosts[999], undefined);
  assert.deepEqual(normalizeSave({ routeGhosts: { 2: { directions: ["up", "bad"], timings: [5, 2] } } }).routeGhosts[2].directions, ["up"]);
});

test("worst-case cloud payload stays below the platform safety budget", () => {
  const raw = createDefaultSave();
  const ids = Array.from({ length: 250 }, (_, index) => index + 1);
  raw.completed = Object.fromEntries(ids.map((id) => [id, true]));
  raw.cores = Object.fromEntries(ids.map((id) => [id, 3]));
  raw.bestDots = Object.fromEntries(ids.map((id) => [id, 10000]));
  raw.bestTimes = Object.fromEntries(ids.map((id) => [id, 99999]));
  raw.bestDashes = Object.fromEntries(ids.map((id) => [id, 10000]));
  raw.levelRevisions = Object.fromEntries(ids.map((id) => [id, 10000]));
  raw.ownedSkins = SKINS.map((skin) => skin.id); raw.favoriteSkins = [...raw.ownedSkins];
  raw.routeGhosts = Object.fromEntries(ids.map((id) => [id, {
    directions: Array(96).fill("right"), timings: Array.from({ length: 96 }, (__, dash) => dash * 500), completionTime: 99999,
  }]));
  raw.analytics = {
    events: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`event_${index}`, 100000000])),
    levels: Object.fromEntries(ids.map((id) => [id, { attempts: 1000000, wins: 1000000, deaths: 1000000, dashes: 10000000, restarts: 1000000 }])),
  };
  raw.secretRewards = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [
    `level:${"a".repeat(50)}${index}:${"b".repeat(50)}${index}`, true,
  ]));
  raw.dailyScores = Object.fromEntries(Array.from({ length: 365 }, (_, index) => {
    const day = new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10);
    return [day, Array.from({ length: 10 }, (__, score) => ({ score: 99999999 - score, time: 99999, cores: 3, at: 9999999999999 - score }))];
  }));
  const payload = compactSave(normalizeSave(raw));
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 180000);
  assert.equal(Object.keys(payload.dailyScores).length, 45);
  assert.equal(Object.keys(payload.secretRewards).length, 500);
  assert.equal(normalizeSave(payload).routeGhosts[1].directions.length, 96);
});

test("cloud merge keeps the fastest completion time", () => {
  const local = createDefaultSave(); local.bestTimes = { 4: 18.4 };
  const cloud = createDefaultSave(); cloud.bestTimes = { 4: 21.2, 5: 14 };
  const merged = mergeSaves(local, cloud);
  assert.equal(merged.bestTimes[4], 18.4);
  assert.equal(merged.bestTimes[5], 14);
});

test("reward history is bounded, validated, and survives cloud merge", () => {
  const local = createDefaultSave();
  local.rewardLog = [{ type: "ad", coins: 50, vaultCoins: 0, at: 20 }, { type: "bad", coins: "oops", at: 10 }];
  const cloud = createDefaultSave();
  cloud.rewardLog = [{ type: "sector", coins: 250, vaultCoins: 5, at: 30 }];
  const merged = mergeSaves(local, cloud);
  assert.equal(merged.rewardLog.length, 2);
  assert.equal(merged.rewardLog[0].type, "sector");
  assert.equal(merged.rewardLog[1].type, "ad");
  assert.equal(normalizeSave({ rewardLog: [{ type: "ad", coins: 4, at: 1 }, { type: "bad", coins: 8, at: 2 }] }).rewardLog.length, 1);
});

test("secret reward claims normalize and merge safely", () => {
  const local = normalizeSave({ secretRewards: { "level:70:70-0": true, "bad": true } });
  const cloud = normalizeSave({ secretRewards: { "daily:2026-08-28:70-0": true } });
  const merged = mergeSaves(local, cloud);
  assert.deepEqual(Object.keys(merged.secretRewards).sort(), ["daily:2026-08-28:70-0", "level:70:70-0"]);
});

test("analytics counters are bounded and keep per-level signals", () => {
  const save = normalizeSave({
    analytics: {
      events: { level_start: 4, death: 2, "<script>": 90 },
      levels: { 7: { attempts: 3, wins: 1, deaths: 2, dashes: 12, restarts: 1 }, 999: { attempts: 4 } },
    },
  });
  assert.deepEqual(save.analytics.events, { level_start: 4, death: 2 });
  assert.deepEqual(save.analytics.levels[7], { attempts: 3, wins: 1, deaths: 2, dashes: 12, restarts: 1 });
  assert.equal(save.analytics.levels[999], undefined);
});

test("both chest pools are duplicate-free and exclude the final reward", () => {
  const owned = ["spark"];
  for (const pool of ["regular", "vault"]) {
    let serial = 0;
    while (true) {
      const skin = nextChestSkin(owned, serial++, pool);
      if (!skin) break;
      assert.ok(!owned.includes(skin.id));
      assert.equal(skin.pool, pool);
      owned.push(skin.id);
    }
  }
  assert.equal(owned.length, SKINS.filter((skin) => !skin.finalOnly && !skin.sectorOnly).length);
});

test("each sector has one unique skin outside chest pools", () => {
  const sectorSkins = SKINS.filter((skin) => skin.sectorOnly);
  assert.equal(sectorSkins.length, 13);
  assert.deepEqual(sectorSkins.map((skin) => skin.sector), [...Array(13).keys()]);
  assert.ok(sectorSkins.every((skin) => skin.pool === "sector"));
});

test("every skin has a distinct named visual effect", () => {
  assert.equal(new Set(SKINS.map((skin) => skin.effect)).size, SKINS.length);
});
