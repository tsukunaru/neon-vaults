import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS } from "../src/levels.js";
import {
  DAILY_SCORE_BASE, bestDailyResult, dailyDayIndex, dailyEntriesForDay, dailyExtraData,
  dailyLeaderboardScore, dailyLevelForDay, dailyScore, parseDailyEntry, recordDailyScore,
} from "../src/daily.js";

test("daily level is deterministic and uses a real solvable layout", () => {
  const first = dailyLevelForDay("2026-08-28", LEVELS);
  const second = dailyLevelForDay("2026-08-28", LEVELS);
  assert.equal(first.dailySourceId, second.dailySourceId);
  assert.equal(first.daily, true);
  assert.ok(first.rows.length > 0 && first.solution.length > 0);
});

test("daily scores keep the ten best attempts", () => {
  let scores = {};
  for (let index = 0; index < 12; index += 1) scores = recordDailyScore(scores, "2026-08-28", { cores: 1, dots: 1, coins: index, time: 10 });
  assert.equal(scores["2026-08-28"].length, 10);
  assert.ok(scores["2026-08-28"][0].score >= scores["2026-08-28"][9].score);
  assert.ok(dailyScore({ cores: 3, dots: 10, coins: 2, time: 1 }) > dailyScore({ cores: 1, dots: 1, coins: 0, time: 20 }));
});

test("daily leaderboard resubmits the stored best result", () => {
  const day = "2026-08-28";
  let scores = recordDailyScore({}, day, { cores: 3, dots: 10, coins: 2, time: 1 });
  const best = bestDailyResult(scores, day);
  scores = recordDailyScore(scores, day, { cores: 0, dots: 1, coins: 0, time: 60 });
  assert.deepEqual(bestDailyResult(scores, day), best);
});

test("daily leaderboard namespaces scores by UTC day", () => {
  assert.equal(dailyDayIndex("2025-01-01"), 0);
  assert.equal(dailyDayIndex("2025-01-02"), 1);
  assert.equal(dailyLeaderboardScore("2025-01-02", 1234), DAILY_SCORE_BASE + 1234);
  assert.equal(dailyLeaderboardScore("not-a-day", DAILY_SCORE_BASE + 5), DAILY_SCORE_BASE - 1);
});

test("daily leaderboard accepts only valid current-day version 2 data", () => {
  const day = "2026-08-29";
  const score = dailyScore({ cores: 3, dots: 7, coins: 1, time: 12.5 });
  const valid = {
    rank: 4,
    score: dailyLeaderboardScore(day, score),
    extraData: dailyExtraData(day, { time: 12.5, cores: 3 }, score),
    player: { publicName: "Spark" },
  };
  assert.deepEqual(parseDailyEntry(valid, day), { rank: 4, name: "Spark", score, time: 12.5, cores: 3 });
  assert.equal(parseDailyEntry({ ...valid, extraData: "{" }, day), null);
  assert.equal(parseDailyEntry({ ...valid, extraData: dailyExtraData("2026-08-28", { time: 1, cores: 1 }, score) }, day), null);
  assert.equal(parseDailyEntry({ ...valid, score: valid.score + 1 }, day), null);
  assert.deepEqual(dailyEntriesForDay({ entries: [valid, { score: 1, extraData: "old" }] }, day).map((entry) => entry.score), [score]);
});
