import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { translator } from "../src/i18n.js";
import { SKINS } from "../src/skins.js";

test("daily activities live outside the home screen and remain reachable in game", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const home = html.slice(html.indexOf('id="home-screen"'), html.indexOf('id="daily-screen"'));
  assert.doesNotMatch(home, /id="mission-title"|id="home-daily"/);
  assert.match(html, /id="nav-daily"/);
  assert.doesNotMatch(html, /id="hero-canvas"/);
  assert.match(html, /src="assets\/ui\/hero\.webp"/);
  assert.equal(existsSync(new URL("../assets/ui/hero.webp", import.meta.url)), true);
  assert.doesNotMatch(main, /HeroPreview|heroPreview/);
  assert.doesNotMatch(styles, /hero-canvas/);
  assert.match(html, /id="result-record"/);
  assert.match(html, /id="stats-best-streak"/);
  assert.match(html, /id="sector-illustration"/);
  assert.match(html, /id="reward-history-list"/);
  assert.match(html, /id="unlock-preview-canvas"/);
  assert.match(html, /id="unlock-preview-label"/);
  assert.match(main, /showSkinPreview/);
  assert.match(html, /id="mechanic-tutorial"/);
  assert.match(html, /id="yandex-login"/);
  assert.match(html, /id="ghost-toggle"/);
  assert.match(html, /id="sector-intro"/);
});

test("LoadingAPI is signalled once after the app replaces the loading overlay", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="/sdk.js"') >= 0 && html.indexOf('src="/sdk.js"') < html.indexOf('src="dist/game.js"'));
  const visible = main.indexOf('$("#app").classList.remove("is-loading")');
  const hidden = main.indexOf('$("#loading").classList.add("hidden")');
  const ready = main.indexOf("adapter.ready()");
  assert.ok(visible >= 0 && hidden > visible && ready > hidden);
  assert.equal(main.match(/adapter\.ready\(\)/g)?.length, 1);
});

test("Vault Rush and delayed result transitions respect gameplay pause state", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /rushRun\.ended \|\| game\.state !== "playing" \|\| game\.paused/);
  assert.match(main, /const context = \{ daily: dailyMode, day: dailyDay, id: currentLevel \}/);
  assert.match(main, /scheduleGameplayTransition/);
  assert.match(main, /setPauseReason\("tutorial", true\)/);
  assert.match(main, /setPauseReason\("tutorial", false\)/);
  assert.match(main, /mergeSaves\(cloud, \{ \.\.\.save, updatedAt: 0 \}\)/);
  assert.match(main, /cloudWritable = cloud !== undefined/);
  assert.match(main, /function trapDialogFocus/);
  assert.match(main, /element\.inert = Boolean\(dialog\)/);
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.result-card,.unlock-card,.reel-card,.sector-intro-card \{ max-height:/);
  assert.doesNotMatch(styles, /\.settings-card input \{ display:none/);
  const rushRoom = main.slice(main.indexOf("function playRushRoom"), main.indexOf("function startVaultRush"));
  assert.doesNotMatch(rushRoom, /showMechanicTutorial/);
});

test("all skins have a safe, non-gameplay collection preview", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const render = main.slice(main.indexOf("function renderSkins"), main.indexOf("function toggleFavoriteSkin"));
  const preview = main.slice(main.indexOf("function drawSkinPreviewFrame"), main.indexOf("function openScreen"));
  const bind = main.slice(main.indexOf("function bindUi"), main.indexOf("async function start"));
  assert.equal(SKINS.length, 44);
  assert.match(render, /showSkinPreview\(button\.dataset\.skin\)/);
  assert.doesNotMatch(render, /equipSkin\(button\.dataset\.skin\)/);
  assert.match(preview, /drawSkinEffect\(/);
  assert.match(preview, /drawSkin\(/);
  assert.match(preview, /"idle"[\s\S]*"move"[\s\S]*"return"/);
  assert.match(preview, /reducedMotion \? 0 : requestAnimationFrame\(drawSkinPreviewFrame\)/);
  assert.doesNotMatch(preview, /impact|portal|levelById|NeonGame|Renderer/);
  assert.match(preview, /textContent = skinName\(skin\)/);
  assert.match(preview, /skinSourceLabel\(skin\)/);
  assert.match(bind, /const id = previewSkinId; if \(!id \|\| !listHas\(save\.ownedSkins, id\)\) return;/);
  assert.match(html, /id="unlock-status"/);
  assert.match(html, /id="unlock-source"/);
  assert.match(html, /id="unlock-close"[\s\S]*data-i18n="back"/);
  for (const language of ["ru", "en"]) {
    const t = translator(language);
    for (const key of ["owned", "locked", "equipped", "previewReturn", "skinSourceStarter", "skinSourceChest", "skinSourceVaultChest", "skinSourceSector", "skinSourceCampaign"]) assert.notEqual(t(key), key);
  }
});

test("Modes is reachable from home, game, and map with one playable mode", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const modes = html.slice(html.indexOf('id="modes-screen"'), html.indexOf('id="rush-screen"'));
  assert.equal(modes.match(/<article\b/g)?.length, 1);
  assert.equal(modes.match(/class="primary-button"/g)?.length, 1);
  assert.doesNotMatch(modes, /aria-disabled="true"|mode-card-soon|COMING SOON|ВСКОРЕ/);
  for (const id of ["home-modes", "nav-modes", "map-modes-button"]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(main, new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assert.match(main, /function renderModes\(\)[\s\S]*modes-rush-best/);
  assert.match(main, /openScreen\("rush-screen", "modes-screen"\)/);
  assert.match(main, /function leaveVaultRush\(\)[\s\S]*openScreen\("rush-screen", "modes-screen"\)/);
  for (const language of ["ru", "en"]) {
    const t = translator(language);
    for (const key of ["modes", "available", "vaultRush"]) assert.notEqual(t(key), key);
  }
});
