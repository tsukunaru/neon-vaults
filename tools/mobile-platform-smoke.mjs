import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "reports", "mobile-platform-smoke");
const chrome = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const saveKey = "neon-vaults-save-v1";
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webp": "image/webp" };

const sdkMock = `(() => {
  const listeners = {};
  const events = window.__sdkEvents = [];
  const record = (name, detail = null) => events.push({ name, detail, at: performance.now() });
  let authorized = localStorage.getItem("__mockAuthorized") === "true";
  const player = {
    isAuthorized: () => authorized,
    getData: async () => { record("cloud:get"); return { save: JSON.parse(localStorage.getItem("__mockCloud") || "null") }; },
    setData: async ({ save }) => { localStorage.setItem("__mockCloud", JSON.stringify(save)); record("cloud:set"); },
  };
  const ad = (kind, callbacks) => {
    const mode = window.__adMode || {};
    record(kind + ":request"); callbacks.onOpen?.();
    setTimeout(() => {
      if (mode.error) callbacks.onError?.(new Error("mock error"));
      else {
        if (kind === "rewarded" && mode.reward) callbacks.onRewarded?.();
        callbacks.onClose?.(kind === "fullscreen" ? mode.wasShown !== false : undefined);
      }
    }, mode.delay || 20);
  };
  const sdk = {
    environment: { i18n: { lang: localStorage.getItem("__mockLanguage") || "en" } },
    getPlayer: async () => player,
    isAvailableMethod: async () => true,
    auth: { openAuthDialog: async () => { authorized = true; record("auth:open"); } },
    leaderboards: {
      setScore: async (name) => record("leaderboard:set", name),
      getEntries: async (name) => { record("leaderboard:get", name); return { entries: [] }; },
    },
    features: {
      LoadingAPI: { ready: () => record("loading:ready") },
      GameplayAPI: { start: () => record("gameplay:start"), stop: () => record("gameplay:stop") },
    },
    adv: {
      showFullscreenAdv: ({ callbacks }) => ad("fullscreen", callbacks),
      showRewardedVideo: ({ callbacks }) => ad("rewarded", callbacks),
    },
    on: (name, callback) => { listeners[name] = callback; },
  };
  window.__emitSdk = (name) => listeners[name]?.();
  window.__setAdMode = (mode) => { window.__adMode = mode; };
  window.__setDocumentHidden = (hidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  window.YaGames = { init: async () => sdk };
})();`;

function staticServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/sdk.js") { response.writeHead(200, { "content-type": mime[".js"] }); response.end(sdkMock); return; }
      if (pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      const file = path.resolve(root, pathname === "/" ? "index.html" : pathname.slice(1));
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error("Path outside project");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" }); response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
}

const baseSave = (language, overrides = {}) => ({
  version: 3, updatedAt: 1000, unlockedLevel: 5, coins: 5, vaultCoins: 1,
  ownedSkins: ["spark"], equippedSkin: "spark", completed: {}, cores: {},
  stats: { deaths: 0, dashes: 0, dots: 0, coins: 0, completions: 5, perfects: 0, streak: 0, bestStreak: 0 },
  settings: { language, languagePlatform: language, music: true, sound: true, musicVolume: 65, soundVolume: 80, swipeSensitivity: "normal", reducedMotion: false, haptics: false, personalGhost: true },
  ...overrides,
});

async function seed(context, { language, authorized = false, localSave = baseSave(language), cloudSave = null }) {
  await context.addInitScript(({ key, language: lang, authorized: auth, local, cloud }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(local));
    localStorage.setItem("__mockLanguage", lang);
    localStorage.setItem("__mockAuthorized", String(auth));
    if (cloud) {
      if (!localStorage.getItem("__mockCloud")) localStorage.setItem("__mockCloud", JSON.stringify(cloud));
    } else localStorage.removeItem("__mockCloud");
  }, { key: saveKey, language, authorized, local: localSave, cloud: cloudSave });
}

async function appMetrics(page) {
  return page.evaluate(() => {
    const root = document.scrollingElement;
    const app = document.querySelector("#app").getBoundingClientRect();
    const stage = document.querySelector(".stage").getBoundingClientRect();
    const hud = document.querySelector(".hud").getBoundingClientRect();
    const nav = document.querySelector(".game-nav").getBoundingClientRect();
    const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const expectedHeight = Math.round(window.visualViewport?.height || innerHeight);
    const cssHeight = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--viewport-height")) || 0);
    return {
      width: innerWidth, height: innerHeight, scrollX, scrollY,
      rootOverflow: root.scrollWidth > innerWidth + 1 || root.scrollHeight > innerHeight + 1,
      clipped: app.left < -1 || app.top < -1 || app.right > innerWidth + 1 || app.bottom > innerHeight + 1,
      overlap: overlaps(hud, stage) || overlaps(stage, nav),
      viewportSynced: Math.abs(cssHeight - expectedHeight) <= 2,
    };
  });
}

async function assertViewport(page, label) {
  const state = await appMetrics(page);
  assert.equal(state.rootOverflow, false, `${label}: root overflow ${JSON.stringify(state)}`);
  assert.equal(state.clipped, false, `${label}: app clipped ${JSON.stringify(state)}`);
  assert.equal(state.overlap, false, `${label}: gameplay overlap ${JSON.stringify(state)}`);
  assert.equal(state.viewportSynced, true, `${label}: visual viewport not synced ${JSON.stringify(state)}`);
  assert.equal(state.scrollX, 0, `${label}: horizontal browser scroll`);
  assert.equal(state.scrollY, 0, `${label}: vertical browser scroll`);
}

async function assertGestureGuards(page, label) {
  const result = await page.evaluate(async () => {
    const canvas = document.querySelector("#game-canvas");
    const resultCard = document.querySelector("#result-modal .result-card");
    const touch = (target, type, y) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientY: y }] });
      return target.dispatchEvent(event);
    };
    touch(canvas, "touchstart", 80);
    const pullAllowed = touch(canvas, "touchmove", 240);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 91, clientX: 30, clientY: 120 }));
    await new Promise((resolve) => setTimeout(resolve, 650));
    const canvasContextAllowed = canvas.dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));
    const resultContextAllowed = resultCard.dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));
    const canvasSelectionAllowed = canvas.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }));
    const resultSelectionAllowed = resultCard.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 91, clientX: 30, clientY: 120 }));
    return { pullAllowed, canvasContextAllowed, resultContextAllowed, canvasSelectionAllowed, resultSelectionAllowed, scrollY };
  });
  assert.deepEqual(result, {
    pullAllowed: false, canvasContextAllowed: false, resultContextAllowed: false,
    canvasSelectionAllowed: false, resultSelectionAllowed: false, scrollY: 0,
  }, `${label}: gesture guard failure`);
}

async function assertPauseAndRewarded(page, label) {
  await page.locator("#home-continue").click();
  if (await page.locator("#sector-enter").isVisible()) await page.locator("#sector-enter").click();
  if (await page.locator("#mechanic-tutorial").isVisible()) await page.locator("#mechanic-tutorial").click();
  await page.waitForTimeout(80);
  await page.evaluate(() => { window.__setDocumentHidden(true); window.__emitSdk("game_api_pause"); window.__setAdMode({ reward: false, delay: 35 }); });
  const marker = await page.evaluate(() => window.__sdkEvents.length);
  await page.locator("#nav-hint").click();
  await page.waitForTimeout(80);
  let events = await page.evaluate((from) => window.__sdkEvents.slice(from).map((entry) => entry.name), marker);
  assert.ok(events.includes("rewarded:request"), `${label}: rewarded close-without-reward was not requested`);
  assert.equal(events.includes("gameplay:start"), false, `${label}: gameplay resumed while visibility/platform pause remained`);
  await page.evaluate(() => window.__emitSdk("game_api_resume"));
  await page.waitForTimeout(20);
  events = await page.evaluate((from) => window.__sdkEvents.slice(from).map((entry) => entry.name), marker);
  assert.equal(events.includes("gameplay:start"), false, `${label}: platform resume ignored visibility pause`);
  await page.evaluate(() => window.__setDocumentHidden(false));
  await page.waitForTimeout(20);
  events = await page.evaluate((from) => window.__sdkEvents.slice(from).map((entry) => entry.name), marker);
  assert.ok(events.includes("gameplay:start"), `${label}: gameplay did not resume after all reasons cleared`);

  for (const mode of [{ error: true }, { reward: true }]) {
    await page.evaluate((value) => window.__setAdMode({ ...value, delay: 20 }), mode);
    await page.locator("#nav-hint").click();
    await page.waitForTimeout(60);
    assert.equal(await page.locator("#nav-hint").isEnabled(), true, `${label}: rewarded button stayed disabled`);
  }
}

async function assertImmediateNextAd(page, label) {
  await page.evaluate(() => {
    document.querySelector("#result-modal").classList.remove("hidden");
    document.querySelector("#next-button").addEventListener("click", () => { window.__nextClickAt = performance.now(); }, { capture: true, once: true });
    window.__setAdMode({ wasShown: true, delay: 20 });
  });
  await page.locator("#next-button").click();
  await page.waitForFunction(() => window.__sdkEvents.some((entry) => entry.name === "fullscreen:request"));
  const latency = await page.evaluate(() => window.__sdkEvents.find((entry) => entry.name === "fullscreen:request").at - window.__nextClickAt);
  assert.ok(latency >= 0 && latency < 330, `${label}: NEXT → fullscreen latency ${latency.toFixed(1)} ms`);
  assert.equal(await page.locator("#ad-warning").count(), 0, `${label}: legacy countdown is still in the DOM`);
  await page.waitForTimeout(40);
  return latency;
}

async function assertRotationAndFullscreenExit(page, profile) {
  const portrait = profile.portrait;
  const landscape = { width: portrait.height, height: portrait.width };
  await page.setViewportSize(landscape);
  await page.evaluate(() => { window.dispatchEvent(new Event("orientationchange")); document.dispatchEvent(new Event("fullscreenchange")); });
  await page.waitForTimeout(50);
  await assertViewport(page, `${profile.name} landscape/fullscreen exit`);
  await page.setViewportSize(portrait);
  await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
  await page.waitForTimeout(50);
  await assertViewport(page, `${profile.name} portrait return`);
}

async function assertAuthorizedCloudAndLeaderboards(browser, profile, origin) {
  const context = await browser.newContext({ ...profile.device, viewport: profile.portrait, screen: profile.portrait, locale: profile.locale });
  const cloud = baseSave(profile.language, { updatedAt: 2000, unlockedLevel: 8, coins: 777, vaultCoins: 9, completed: { 1: true }, cores: { 1: 3 } });
  await seed(context, { language: profile.language, authorized: true, localSave: baseSave(profile.language), cloudSave: cloud });
  const page = await context.newPage();
  await page.goto(origin); await page.locator("#app:not(.is-loading)").waitFor();
  const merged = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(merged.unlockedLevel, 8, `${profile.name}: cloud progression was not merged`);
  assert.equal(merged.coins, 777, `${profile.name}: newest cloud economy was not kept`);
  assert.equal(await page.locator("#yandex-auth:not(.hidden)").count(), 0, `${profile.name}: sign-in CTA shown to authorized player`);
  await page.locator("#home-continue").click();
  if (await page.locator("#sector-enter").isVisible()) await page.locator("#sector-enter").click();
  if (await page.locator("#mechanic-tutorial").isVisible()) await page.locator("#mechanic-tutorial").click();
  await page.locator("#nav-daily").click(); await page.locator("#leaderboard-refresh").click();
  await page.waitForFunction(() => window.__sdkEvents.some((entry) => entry.name === "leaderboard:get" && entry.detail === "neonvaultsdaily"));
  await page.locator("[data-close-screen]").first().click();
  await page.locator("#nav-modes").click(); await page.locator("#open-rush").click(); await page.locator("#rush-leaderboard-refresh").click();
  await page.waitForFunction(() => window.__sdkEvents.some((entry) => entry.name === "leaderboard:get" && entry.detail === "neonvaultsrush"));
  assert.equal((await page.evaluate(() => window.__sdkEvents.filter((entry) => entry.name === "auth:open").length)), 0, `${profile.name}: auth dialog opened automatically`);
  await context.close();
}

async function assertGuestProgressPersistence(browser, profile, origin) {
  const context = await browser.newContext({ ...profile.device, viewport: profile.portrait, screen: profile.portrait, locale: profile.locale });
  await seed(context, { language: profile.language, localSave: baseSave(profile.language, { unlockedLevel: 1, stats: { completions: 0 } }) });
  const page = await context.newPage();
  await page.goto(origin); await page.locator("#app:not(.is-loading)").waitFor();
  await page.locator("#home-continue").click();
  if (await page.locator("#sector-enter").isVisible()) await page.locator("#sector-enter").click();
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(500);
  await page.keyboard.press("ArrowRight");
  await page.locator("#result-modal:not(.hidden)").waitFor({ timeout: 3000 });
  let saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(saved.unlockedLevel, 2, `${profile.name}: guest completion was not saved`);
  assert.equal(saved.completed[1], true, `${profile.name}: guest completed level is missing`);
  await page.reload(); await page.locator("#app:not(.is-loading)").waitFor();
  saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(saved.unlockedLevel, 2, `${profile.name}: guest progress was lost after reload`);
  assert.equal(await page.locator("#home-level").textContent(), "2", `${profile.name}: reloaded UI did not restore guest level`);
  assert.equal((await page.evaluate(() => window.__sdkEvents.filter((entry) => entry.name === "auth:open").length)), 0, `${profile.name}: guest persistence triggered auth`);
  await context.close();
}

async function runProfile(profile, origin) {
  const browser = await profile.browser.launch(profile.launch || { headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ ...profile.device, viewport: profile.portrait, screen: profile.portrait, locale: profile.locale });
    await seed(context, { language: profile.language });
    const page = await context.newPage();
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin); await page.locator("#app:not(.is-loading)").waitFor();
    assert.equal(await page.locator("#loading.hidden").count(), 1, `${profile.name}: loading overlay remains visible`);
    assert.equal((await page.evaluate(() => window.__sdkEvents.filter((entry) => entry.name === "auth:open").length)), 0, `${profile.name}: guest auth opened automatically`);
    await assertViewport(page, `${profile.name} startup`);
    await assertGestureGuards(page, profile.name);
    await assertPauseAndRewarded(page, profile.name);
    await assertRotationAndFullscreenExit(page, profile);
    const latency = await assertImmediateNextAd(page, profile.name);
    await page.screenshot({ path: path.join(output, `${profile.name}.png`) });
    await context.close();
    await assertAuthorizedCloudAndLeaderboards(browser, profile, origin);
    await assertGuestProgressPersistence(browser, profile, origin);
    assert.deepEqual(errors, [], `${profile.name}: console errors`);
    return { profile: profile.name, latency: Number(latency.toFixed(1)) };
  } finally { await browser.close(); }
}

await mkdir(output, { recursive: true });
const server = staticServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const results = [];
  results.push(await runProfile({
    name: "ios-webkit-iphone13", browser: webkit, device: devices["iPhone 13"],
    portrait: { width: 390, height: 844 }, locale: "ru-RU", language: "ru",
  }, origin));
  results.push(await runProfile({
    name: "android-chrome-pixel7", browser: chromium, device: devices["Pixel 7"],
    portrait: { width: 412, height: 915 }, locale: "en-US", language: "en",
    launch: { headless: true, executablePath: chrome },
  }, origin));
  await writeFile(path.join(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Mobile platform smoke passed: ${results.map((item) => `${item.profile} (NEXT ad ${item.latency} ms)`).join(", ")}.`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
