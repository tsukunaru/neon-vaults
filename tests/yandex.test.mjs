import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { YandexAdapter } from "../src/yandex.js";

test("SDK initialization waits for the asynchronous Yandex loader", async () => {
  const previous = { window: global.window, document: global.document, location: global.location };
  const sdk = { getPlayer: async () => null };
  global.window = {};
  global.location = { hostname: "app-1.games.s3.yandex.net" };
  global.document = {
    scripts: [{ src: "https://app-1.games.s3.yandex.net/sdk.js" }],
    head: { appendChild: () => assert.fail("existing SDK loader must be reused") },
    createElement: () => assert.fail("existing SDK loader must be reused"),
  };
  const exposeSdk = setTimeout(() => { global.window.YaGames = { init: async () => sdk }; }, 20);
  try {
    const adapter = await YandexAdapter.create({ sdkTimeout: 250 });
    assert.equal(adapter.ysdk, sdk);
    assert.equal(adapter.local, false);
  } finally {
    clearTimeout(exposeSdk);
    global.window = previous.window;
    global.document = previous.document;
    global.location = previous.location;
  }
});

test("cloud save debounce stays below the platform write-rate ceiling", () => {
  assert.ok(CONFIG.cloudSaveDelay >= 3100);
  assert.match(CONFIG.dailyLeaderboard, /^[a-zA-Z0-9]+$/);
  assert.match(CONFIG.rushLeaderboard, /^[a-zA-Z0-9]+$/);
});

test("leaderboard adapter uses the current SDK surface", async () => {
  const calls = [];
  const adapter = new YandexAdapter({
    isAvailableMethod: async () => true,
    leaderboards: {
      setScore: async (...args) => calls.push(["set", ...args]),
      getEntries: async (...args) => ({ entries: [{ score: 7 }], args }),
    },
  });
  adapter.player = { isAuthorized: () => true };
  assert.equal(await adapter.submitLeaderboard("daily", 42, "2026-08-28"), true);
  assert.equal((await adapter.loadLeaderboard("daily")).entries[0].score, 7);
  assert.deepEqual(calls, [["set", "daily", 42, "2026-08-28"]]);
});

test("guest leaderboard calls stay local and never open authorization", async () => {
  let leaderboardCalls = 0;
  let authCalls = 0;
  const adapter = new YandexAdapter({
    auth: { openAuthDialog: async () => { authCalls += 1; } },
    leaderboards: {
      setScore: async () => { leaderboardCalls += 1; },
      getEntries: async () => { leaderboardCalls += 1; },
    },
  });
  adapter.player = { isAuthorized: () => false };
  assert.equal(await adapter.submitLeaderboard("daily", 42), false);
  assert.equal(await adapter.loadLeaderboard("daily"), null);
  assert.equal(leaderboardCalls, 0);
  assert.equal(authCalls, 0);
});

test("authorization opens only explicitly and refreshes the player", async () => {
  let authorized = false;
  let authCalls = 0;
  let playerCalls = 0;
  const adapter = new YandexAdapter({
    auth: { openAuthDialog: async () => { authCalls += 1; authorized = true; } },
    getPlayer: async (options) => {
      playerCalls += 1;
      assert.deepEqual(options, { scopes: false });
      return { isAuthorized: () => authorized };
    },
  });
  await adapter.preparePlayer();
  assert.equal(adapter.isAuthorized(), false);
  assert.equal(authCalls, 0);
  assert.equal(await adapter.authorize(), true);
  assert.equal(adapter.isAuthorized(), true);
  assert.equal(authCalls, 1);
  assert.equal(playerCalls, 2);
  assert.equal(await adapter.authorize(), true);
  assert.equal(authCalls, 1);
});

test("cancelled authorization leaves the guest adapter usable", async () => {
  const adapter = new YandexAdapter({ auth: { openAuthDialog: async () => { throw new Error("cancelled"); } } });
  adapter.player = { isAuthorized: () => false };
  assert.equal(await adapter.authorize(), false);
  assert.equal(adapter.isAuthorized(), false);
  assert.equal(adapter.authPending, null);
});

test("cloud writes stay ordered so an older snapshot cannot finish last", async () => {
  const calls = [];
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  const adapter = new YandexAdapter({});
  adapter.player = { setData: async ({ save }) => { calls.push(`start:${save.id}`); if (save.id === 1) await firstPending; calls.push(`end:${save.id}`); } };
  const first = adapter.saveCloud({ id: 1 });
  const second = adapter.saveCloud({ id: 2 });
  await Promise.resolve();
  assert.deepEqual(calls, ["start:1"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["start:1", "end:1", "start:2", "end:2"]);
});

test("hung cloud and leaderboard SDK calls recover after a bounded timeout", async () => {
  const never = new Promise(() => {});
  const adapter = new YandexAdapter({ leaderboards: { getEntries: () => never } }, { sdkTimeout: 10 });
  adapter.player = { isAuthorized: () => true, getData: () => never, setData: () => never };
  assert.equal(await adapter.loadCloud(), undefined);
  assert.equal(await adapter.saveCloud({ id: 1 }), false);
  assert.equal(await adapter.loadLeaderboard("daily"), null);
});

test("loading ready and gameplay state are de-duplicated", () => {
  const calls = [];
  const adapter = new YandexAdapter({ features: {
    LoadingAPI: { ready: () => calls.push("ready") },
    GameplayAPI: { start: () => calls.push("start"), stop: () => calls.push("stop") },
  } });
  adapter.ready(); adapter.ready();
  adapter.gameplayStart(); adapter.gameplayStart();
  adapter.gameplayStop(); adapter.gameplayStop();
  assert.deepEqual(calls, ["ready", "start", "stop"]);
});

test("ad failure always releases the pause hook and pending lock", async () => {
  const calls = [];
  const adapter = new YandexAdapter({ adv: {
    showFullscreenAdv: ({ callbacks }) => { callbacks.onOpen(); callbacks.onError(); callbacks.onClose(); },
  } }, {
    onAdStart: (kind) => calls.push(`start:${kind}`),
    onAdStop: (kind) => calls.push(`stop:${kind}`),
  });
  assert.equal(await adapter.fullscreen(), false);
  assert.equal(adapter.adPending, false);
  assert.deepEqual(calls, ["start:fullscreen", "stop:fullscreen"]);
});

test("fullscreen success and platform refusal both settle cleanly", async () => {
  for (const [wasShown, expected] of [[true, true], [false, false]]) {
    const calls = [];
    const adapter = new YandexAdapter({ adv: {
      showFullscreenAdv: ({ callbacks }) => {
        if (wasShown) callbacks.onOpen();
        callbacks.onClose(wasShown);
      },
    } }, {
      onAdStart: (kind) => calls.push(`start:${kind}`),
      onAdStop: (kind) => calls.push(`stop:${kind}`),
    });

    assert.equal(await adapter.fullscreen(), expected);
    assert.equal(adapter.adPending, false);
    assert.deepEqual(calls, wasShown
      ? ["start:fullscreen", "stop:fullscreen"]
      : ["stop:fullscreen"]);
  }
});

test("rewarded ad grants only after the reward callback", async () => {
  for (const [rewarded, expected] of [[true, true], [false, false]]) {
    const calls = [];
    const adapter = new YandexAdapter({ adv: {
      showRewardedVideo: ({ callbacks }) => {
        callbacks.onOpen();
        if (rewarded) callbacks.onRewarded();
        callbacks.onClose();
      },
    } }, {
      onAdStart: (kind) => calls.push(`start:${kind}`),
      onAdStop: (kind) => calls.push(`stop:${kind}`),
    });

    assert.equal(await adapter.rewarded(), expected);
    assert.equal(adapter.adPending, false);
    assert.deepEqual(calls, ["start:rewarded", "stop:rewarded"]);
  }
});

test("rewarded ad error never grants a reward or leaves the adapter pending", async () => {
  const calls = [];
  const adapter = new YandexAdapter({ adv: {
    showRewardedVideo: ({ callbacks }) => { callbacks.onOpen(); callbacks.onError(new Error("blocked")); },
  } }, {
    onAdStart: (kind) => calls.push(`start:${kind}`),
    onAdStop: (kind) => calls.push(`stop:${kind}`),
  });

  assert.equal(await adapter.rewarded(), false);
  assert.equal(adapter.adPending, false);
  assert.deepEqual(calls, ["start:rewarded", "stop:rewarded"]);
});

test("late ad callbacks cannot re-pause a settled game", async () => {
  const calls = [];
  const adapter = new YandexAdapter({ adv: {
    showFullscreenAdv: ({ callbacks }) => {
      callbacks.onClose(false); callbacks.onOpen(); callbacks.onClose(true);
    },
  } }, {
    onAdStart: (kind) => calls.push(`start:${kind}`),
    onAdStop: (kind) => calls.push(`stop:${kind}`),
  });
  assert.equal(await adapter.fullscreen(), false);
  assert.deepEqual(calls, ["stop:fullscreen"]);
  assert.equal(adapter.adPending, false);
});
