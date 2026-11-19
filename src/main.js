import { CONFIG, LEVEL_THEMES } from "./config.js";
import { translator, normalizeLanguage, selectLanguage } from "./i18n.js";
import { LEVELS, levelById } from "./levels.js";
import { SKINS, regularChestPrice, vaultChestPrice, nextChestSkin, drawSkin, drawSkinEffect } from "./skins.js";
import { compactSave, levelRecord, levelRevision, loadLocalSave, mergeSaves, writeLocalSave } from "./save.js";
import { YandexAdapter } from "./yandex.js";
import { AudioEngine } from "./audio.js";
import { NeonGame } from "./game.js";
import { Renderer } from "./renderer.js";
import { InputController } from "./input.js";
import { PauseManager } from "./pause-manager.js";
import { mechanicTutorial, nextMechanicTutorial } from "./tutorials.js";
import { isSectorCore, isSectorStart, sectorForLevel } from "./sectors.js";
import { nextSafeMove } from "./assist.js";
import {
  completeVaultRushRoom, continueVaultRush, createVaultRushRun,
  failVaultRush, tickVaultRush, vaultRushRoom,
} from "./vault-rush.js";
import { advanceMission, missionComplete, missionForDay } from "./missions.js";
import {
  bestDailyResult, dailyEntriesForDay, dailyExtraData, dailyLeaderboardScore,
  dailyLevelForDay, dailyScore, recordDailyScore,
} from "./daily.js";
import { objectValues, pad2, setChildren } from "./compat.js";
import { effectivePar } from "./rating.js";
import { installViewportGuards } from "./viewport.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const listHas = (list, value) => list.indexOf(value) !== -1;

const localLoad = loadLocalSave();
let save = localLoad.save;
let trustedLocalBaseline = localLoad.present;
let cloudWritable = false;
let language = selectLanguage(save.settings, navigator.language);
let t = translator(language);
let adapter;
let audio;
let game;
let renderer;
let input;
let pauseManager;
const pendingPauseReasons = new Set();
let currentLevel = save.unlockedLevel;
let screenBack = "home-screen";
let mapZone = Math.floor((save.unlockedLevel - 1) / 20);
let cloudTimer = 0;
let toastTimer = 0;
let tutorialStep = 0;
let mechanicTutorialTimer = 0;
let queuedMechanicTutorial = null;
const introducedCores = new Set();
const levelDeaths = new Map();
let resultReward = 0;
let resultDoubled = false;
let unlockedSkin = null;
let rewardPending = false;
let lastFullscreenAt = 0;
let lastDeathAt = 0;
let dailyMode = false;
let dailyDay = dayKey();
let leaderboardRequest = 0;
let rushLeaderboardRequest = 0;
let rushMode = false;
let rushRun = null;
let rushFinalized = false;
let rushResultVisible = false;
let gameplayTransitionTimer = 0;
let activeDialog = null;
let dialogReturnFocus = null;
let rushHudStamp = -1;
let analyticsUnsaved = 0;
let previewSkinId = null;
let previewFrame = 0;
let previewStarted = 0;

function applyTranslations() {
  document.documentElement.lang = language;
  document.title = t("title");
  $$('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  $$('[data-i18n-aria]').forEach((element) => { element.setAttribute("aria-label", t(element.dataset.i18nAria)); });
  $$('[data-i18n-content]').forEach((element) => { element.setAttribute("content", t(element.dataset.i18nContent)); });
  $$('[data-language]').forEach((button) => button.classList.toggle("active", button.dataset.language === language));
  $(".stage").dataset.traceLabel = t("systemTrace");
}

function rarityLabel(rarity) {
  return t(`rarity${rarity[0].toUpperCase()}${rarity.slice(1)}`);
}

function skinName(skin) { return t(skin.nameKey); }

function skinSourceLabel(skin) {
  if (skin.pool === "starter") return t("skinSourceStarter");
  if (skin.pool === "regular") return t("skinSourceChest");
  if (skin.pool === "vault") return t("skinSourceVaultChest");
  if (skin.pool === "sector") return t("skinSourceSector").replace("{sector}", skin.sector + 1);
  return t("skinSourceCampaign");
}

function totalCores() { return objectValues(save.cores).reduce((sum, value) => sum + value, 0); }
function activeScreen() { return $(".screen.active"); }

function setPauseReason(reason, active) {
  if (pauseManager) return pauseManager.set(reason, active);
  if (active) pendingPauseReasons.add(reason);
  else pendingPauseReasons.delete(reason);
  return false;
}

function syncModalPause() {
  const dialog = $$(".modal").find((modal) => !modal.classList.contains("hidden")) || null;
  if (dialog !== activeDialog) {
    if (dialog && !activeDialog) dialogReturnFocus = document.activeElement;
    activeDialog = dialog;
    $$("#app > :not(.modal)").forEach((element) => { element.inert = Boolean(dialog); });
    if (dialog) requestAnimationFrame(() => dialog.querySelector("button:not([disabled]),[href],input:not([disabled]),select:not([disabled])")?.focus());
    else {
      if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
      dialogReturnFocus = null;
    }
  }
  setPauseReason("modal", Boolean(dialog));
}

function trapDialogFocus(event) {
  if (event.key !== "Tab" || !activeDialog) return;
  const focusable = [...activeDialog.querySelectorAll("button:not([disabled]):not(.hidden),[href],input:not([disabled]),select:not([disabled])")];
  if (!focusable.length) { event.preventDefault(); return; }
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function setGameplayTransition(active) {
  document.body.classList.toggle("game-transition", active);
  $(".hud").inert = active;
  $(".game-nav").inert = active;
}

function scheduleGameplayTransition(callback, delay) {
  clearTimeout(gameplayTransitionTimer);
  setGameplayTransition(true);
  gameplayTransitionTimer = setTimeout(() => { gameplayTransitionTimer = 0; callback(); }, delay);
}

function cancelGameplayTransition() {
  clearTimeout(gameplayTransitionTimer);
  gameplayTransitionTimer = 0;
  setGameplayTransition(false);
}

function recordReward(type, coins = 0, vaultCoins = 0) {
  if (!coins && !vaultCoins) return;
  save.rewardLog = [{ type, coins, vaultCoins, at: Date.now() }, ...(save.rewardLog || [])].slice(0, 20);
}

function dayKey() { return new Date().toISOString().slice(0, 10); }

function ensureMission() {
  const today = dayKey();
  if (save.mission?.day !== today || !save.mission?.type || save.mission.target <= 0) {
    save.mission = missionForDay(today);
    return true;
  }
  return false;
}

function renderMission() {
  const changed = ensureMission();
  if (changed && audio) persist();
  const mission = save.mission;
  const suffix = mission.type ? mission.type[0].toUpperCase() + mission.type.slice(1) : "Completions";
  $("#mission-title").textContent = t(`mission${suffix}`);
  $("#mission-progress").textContent = `${mission.progress}/${mission.target}`;
  const claim = $("#mission-claim");
  claim.disabled = !missionComplete(mission) || mission.claimed;
  claim.textContent = mission.claimed ? t("claimed") : t("claim");
}

function updateMission(type, amount = 1) {
  ensureMission();
  const next = advanceMission(save.mission, type, amount);
  if (next === save.mission || next.progress === save.mission.progress) return;
  save.mission = next;
  persist();
  renderMission();
}

function handleSecret(secret) {
  const scope = dailyMode ? `daily:${dailyDay}` : `level:${currentLevel}`;
  const id = `${scope}:${secret.id || `${secret.x},${secret.y}`}`;
  if (save.secretRewards[id]) { showToast(t("secretAlreadyFound"), 1300); return; }
  save.secretRewards[id] = true;
  const coins = Number(secret.coins) || 0;
  const vaultCoins = Number(secret.vaultCoins) || 0;
  save.coins += coins; save.vaultCoins += vaultCoins;
  if (secret.effect === "overdrive") game.secretBoostUntil = game.elapsed + CONFIG.secretBoostSeconds;
  recordReward("secret", coins, vaultCoins);
  track("secret_found", { secret: id, kind: secret.kind });
  haptic([12, 18, 20]); persist(); updateHud({ ...game.snapshot(), coins: 0 });
  const reward = secret.kind === "crystal" ? t("secretCrystal") : secret.effect === "overdrive" ? t("secretBoost") : t("secretCache").replace("{amount}", coins);
  showToast(t("secretFound").replace("{reward}", reward), 2400);
  if (!save.tutorialSeen.secrets) showMechanicTutorial(mechanicTutorial("secrets"));
}

function track(event, data = {}) {
  const analytics = save.analytics || (save.analytics = { events: {}, levels: {} });
  analytics.events[event] = (analytics.events[event] || 0) + 1;
  const level = Number(data.level ?? currentLevel);
  const metric = { level_start: "attempts", daily_start: "attempts", level_win: "wins", daily_win: "wins", death: "deaths", dash: "dashes", restart: "restarts" }[event];
  if (metric && Number.isInteger(level) && level > 0 && level <= CONFIG.maxLevels) {
    const stats = analytics.levels[level] || (analytics.levels[level] = { attempts: 0, wins: 0, deaths: 0, dashes: 0, restarts: 0 });
    stats[metric] += 1;
  }
  analyticsUnsaved += 1;
  if (analyticsUnsaved >= 12) { analyticsUnsaved = 0; persist(); }
  window.dispatchEvent(new CustomEvent("neon-vaults:analytics", { detail: { event, level: currentLevel, ...data } }));
}

function persist() {
  save.settings.language = language;
  save = writeLocalSave(save);
  analyticsUnsaved = 0;
  audio.settings = save.settings;
  clearTimeout(cloudTimer);
  if (cloudWritable) cloudTimer = setTimeout(() => adapter.saveCloud(compactSave(save)), CONFIG.cloudSaveDelay);
}

function mergeCloudSave(cloud) {
  const merged = trustedLocalBaseline
    ? mergeSaves(save, cloud)
    : mergeSaves(cloud, { ...save, updatedAt: 0 });
  save = writeLocalSave(merged);
  trustedLocalBaseline = true;
}

function showToast(message, duration = 1500) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), duration);
}

function haptic(pattern) {
  if (save.settings.haptics && navigator.vibrate) navigator.vibrate(pattern);
}

function applyRuntimeSettings() {
  if (!audio || !game || !input) return;
  audio.settings = save.settings;
  audio.sync();
  game.reducedMotion = save.settings.reducedMotion;
  if (save.settings.reducedMotion && game.ghost) game.ghost.active = false;
  input.setThreshold({ low: 28, normal: 18, high: 11 }[save.settings.swipeSensitivity] || 18);
  document.body.classList.toggle("reduced-motion", save.settings.reducedMotion);
}

function updateHud(snapshot = game.snapshot()) {
  $("#hud-level-label").textContent = t(rushMode ? "rushRoom" : "level");
  $("#hud-level").textContent = snapshot.level || currentLevel;
  $("#hud-dots").textContent = `${snapshot.dots || 0}/${snapshot.totalDots || 0}`;
  $("#hud-progress-fill").style.width = `${snapshot.totalDots ? Math.min(100, snapshot.dots / snapshot.totalDots * 100) : 0}%`;
  $("#hud-coins").textContent = save.coins + (snapshot.coins || 0) * 12;
  $("#hud-vault-coins").textContent = save.vaultCoins;
  const standardPar = game.level?.minMoves || game.level?.solution?.length || 0;
  const par = effectivePar(game.level, snapshot.bonusMask || 0) || standardPar;
  $("#par-badge").innerHTML = `◆◆◆ ${t(snapshot.bonusMask ? "bonusPar" : "par")}: <b>${par}</b>`;
}

function renderHome() {
  $("#home-coins").textContent = save.coins;
  $("#home-vault-coins").textContent = save.vaultCoins;
  $("#home-level").textContent = save.unlockedLevel;
  renderMission();
  renderDaily();
}

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${pad2(Math.floor(value % 60))}`;
}

function renderScoreRows(list, rows, emptyText) {
  setChildren(list, rows.length ? rows.slice(0, 10).map((entry, index) => {
    const item = document.createElement("li");
    const rank = document.createElement("b"); rank.textContent = String(entry.rank || index + 1);
    const name = document.createElement("span"); name.textContent = entry.name || t("you");
    const value = document.createElement("strong"); value.textContent = String(entry.score);
    item.appendChild(rank); item.appendChild(name); item.appendChild(value);
    return item;
  }) : [Object.assign(document.createElement("li"), { className: "empty-leaderboard", textContent: emptyText })]);
}

function renderDaily(entries = null) {
  const day = dayKey();
  const level = dailyLevelForDay(day, LEVELS);
  const local = save.dailyScores[day] || [];
  $("#daily-date").textContent = day;
  $("#daily-source").textContent = `#${level.dailySourceId}`;
  $("#daily-best").textContent = local[0] ? `${local[0].score} · ${formatTime(local[0].time)}` : t("notPlayed");
  const list = $("#leaderboard-list");
  const rows = entries ? dailyEntriesForDay(entries, day) : local;
  renderScoreRows(list, rows, t("noScores"));
  $("#yandex-auth").classList.toggle("hidden", Boolean(adapter?.isAuthorized()));
}

async function refreshLeaderboard() {
  const request = ++leaderboardRequest;
  const button = $("#leaderboard-refresh");
  button.disabled = true;
  $("#leaderboard-list").innerHTML = `<li class="empty-leaderboard">${t("leaderboardLoading")}</li>`;
  try {
    const entries = await adapter.loadLeaderboard(CONFIG.dailyLeaderboard);
    if (request === leaderboardRequest) renderDaily(entries);
  } finally {
    if (request === leaderboardRequest) button.disabled = false;
  }
}

function renderRush(entries) {
  $("#rush-best").textContent = save.vaultRush.bestScore;
  $("#rush-runs").textContent = save.vaultRush.runs;
  $("#rush-rooms").textContent = save.vaultRush.rooms;
  $("#rush-auth").classList.toggle("hidden", Boolean(adapter?.isAuthorized()));
  const list = $("#rush-leaderboard-list");
  if (entries === null && adapter?.isAuthorized()) { renderScoreRows(list, [], t("leaderboardUnavailable")); return; }
  const remote = Array.isArray(entries?.entries) ? entries.entries.map((entry) => ({
    rank: Math.max(0, Math.floor(Number(entry.rank) || 0)),
    name: String(entry.player?.publicName || entry.player?.uniqueID || t("anonymous")).slice(0, 80),
    score: Math.max(0, Math.floor(Number(entry.score) || 0)),
  })).filter((entry) => entry.score > 0) : [];
  const local = save.vaultRush.bestScore ? [{ name: t("you"), score: save.vaultRush.bestScore }] : [];
  renderScoreRows(list, entries ? remote : local, t("noScores"));
}

function renderModes() {
  $("#modes-rush-best").textContent = save.vaultRush.bestScore;
}

async function refreshRushLeaderboard() {
  const request = ++rushLeaderboardRequest;
  const button = $("#rush-leaderboard-refresh");
  button.disabled = true;
  renderScoreRows($("#rush-leaderboard-list"), [], t("leaderboardLoading"));
  try {
    const entries = await adapter.loadLeaderboard(CONFIG.rushLeaderboard);
    if (request === rushLeaderboardRequest) renderRush(entries);
  } finally {
    if (request === rushLeaderboardRequest) button.disabled = false;
  }
}

async function signInWithYandex(button = $("#yandex-login")) {
  button.disabled = true;
  try {
    if (!await adapter.authorize()) { showToast(t("authCancelled"), 2200); return; }
    cloudWritable = false;
    const cloud = await adapter.loadCloud();
    if (cloud !== undefined) {
      if (cloud) mergeCloudSave(cloud);
      else save = writeLocalSave(save);
      cloudWritable = true;
      if (await adapter.saveCloud(compactSave(save))) trustedLocalBaseline = true;
    }
    language = selectLanguage(save.settings, adapter.language());
    t = translator(language);
    applyTranslations(); applyRuntimeSettings(); renderHome(); renderMap(); renderSkins(); syncSettings();
    const day = dayKey(); const best = bestDailyResult(save.dailyScores, day);
    if (best) await adapter.submitLeaderboard(CONFIG.dailyLeaderboard, dailyLeaderboardScore(day, best.score), dailyExtraData(day, best, best.score));
    if (save.vaultRush.bestScore) await adapter.submitLeaderboard(CONFIG.rushLeaderboard, save.vaultRush.bestScore);
    await refreshLeaderboard();
    await refreshRushLeaderboard();
  } finally {
    button.disabled = false;
    $("#yandex-auth").classList.toggle("hidden", Boolean(adapter.isAuthorized()));
    $("#rush-auth").classList.toggle("hidden", Boolean(adapter.isAuthorized()));
  }
}

function renderMap() {
  const unlockedZone = Math.floor((save.unlockedLevel - 1) / 20);
  mapZone = Math.max(0, Math.min(unlockedZone, mapZone));
  const zoneStart = mapZone * 20 + 1;
  const zoneEnd = Math.min(CONFIG.maxLevels, zoneStart + 19);
  const revealEnd = mapZone < unlockedZone ? zoneEnd : Math.min(zoneEnd, Math.max(zoneStart + 7, save.unlockedLevel + 5));
  const levels = LEVELS.slice(zoneStart - 1, revealEnd);
  const theme = LEVEL_THEMES[mapZone];
  $("#map-cores").textContent = `${totalCores()}/${CONFIG.maxLevels * 3}`;
  $("#map-coins").textContent = save.coins;
  $("#map-vault-coins").textContent = save.vaultCoins;
  $("#map-skins").textContent = `${save.ownedSkins.length}/${SKINS.length}`;
  $("#stats-completions").textContent = save.stats.completions;
  $("#stats-perfects").textContent = save.stats.perfects;
  $("#stats-deaths").textContent = save.stats.deaths;
  $("#stats-best-streak").textContent = save.stats.bestStreak;
  $("#stats-dots").textContent = save.stats.dots;
  $("#continue-level").textContent = save.unlockedLevel;
  $("#map-zone-name").textContent = t(theme.nameKey);
  $("#map-zone-range").textContent = `${zoneStart}—${zoneEnd}`;
  $("#map-zone-prev").disabled = mapZone === 0;
  $("#map-zone-next").disabled = mapZone >= unlockedZone;
  const screen = $("#map-screen");
  screen.style.setProperty("--zone-bg", theme.bg); screen.style.setProperty("--zone-center", theme.center); screen.style.setProperty("--zone-edge", theme.edge);
  const positions = [50, 24, 70, 36, 78, 51, 19, 62, 82, 43, 20, 57, 77, 39, 17, 55, 81, 48, 24, 66];
  const map = $("#level-map");
  map.innerHTML = `<svg class="map-path-svg" viewBox="0 0 100 ${Math.max(100, levels.length * 100)}" preserveAspectRatio="none" aria-hidden="true"><path d="M ${positions[0]} 43 ${levels.slice(1).map((_, index) => `L ${positions[index + 1]} ${(index + 1) * 100 + 43}`).join(" ")}"></path></svg>` + levels.map((level, index) => {
    const unlocked = level.id <= save.unlockedLevel;
    const cores = save.cores[level.id] || 0;
    const classes = ["level-node", unlocked ? "unlocked" : "locked", level.id === save.unlockedLevel ? "current" : "", level.id % 5 === 0 ? "milestone challenge" : "", level.id % 20 === 0 ? "sector-boss" : ""].filter(Boolean).join(" ");
    return `<div class="path-stop" style="--x:${positions[index]}%"><button class="${classes}" style="left:${positions[index]}%" data-level="${level.id}" ${unlocked ? "" : "disabled"} aria-label="${t("level")} ${level.id}">${unlocked ? level.id : ""}<small>${"◆".repeat(cores)}${"◇".repeat(Math.max(0, 3 - cores))}</small></button></div>`;
  }).join("");
  map.querySelectorAll("[data-level]").forEach((button) => {
    const level = levelById(Number(button.dataset.level));
    const details = t("mapDetails")
      .replace("{best}", levelRecord(save, level).bestDashes || "—")
      .replace("{par}", level.minMoves || level.solution?.length || "—")
      .replace("{cores}", `${"◆".repeat(save.cores[level.id] || 0)}${"◇".repeat(3 - (save.cores[level.id] || 0))}`);
    button.title = details;
    let held = false; let holdTimer = 0;
    button.addEventListener("pointerdown", () => { held = false; holdTimer = setTimeout(() => { held = true; showToast(details, 2200); }, 520); });
    ["pointerup", "pointercancel", "pointerleave"].forEach((event) => button.addEventListener(event, () => clearTimeout(holdTimer)));
    button.addEventListener("click", () => { if (held) { held = false; return; } playLevel(level.id); });
  });
  $(".map-world").style.minHeight = `${Math.max(680, levels.length * 94 + 48)}px`;
}

function renderSkins() {
  const owned = new Set(save.ownedSkins);
  $("#skin-coins").textContent = save.coins;
  $("#skin-vault-coins").textContent = save.vaultCoins;
  $("#collection-count").textContent = `${owned.size} / ${SKINS.length}`;
  $("#skin-grid").innerHTML = SKINS.map((skin) => {
    const unlocked = owned.has(skin.id);
    const status = save.equippedSkin === skin.id ? "equipped" : unlocked ? "owned" : "locked";
    return `<button class="skin-card ${unlocked ? "" : "locked"} ${status === "equipped" ? "selected" : ""}" data-skin="${skin.id}" aria-label="${skinName(skin)}, ${rarityLabel(skin.rarity)}, ${t(status)}">${listHas(save.favoriteSkins, skin.id) ? "<em>★</em>" : ""}
      <span class="skin-swatch" style="--primary:${skin.primary};--secondary:${skin.secondary}"><i style="background:${skin.primary};box-shadow:0 0 13px ${skin.primary}"></i></span>
      <strong>${skinName(skin)}</strong><small>${rarityLabel(skin.rarity)} · ${t(status)}</small>
    </button>`;
  }).join("");
  $("#skin-grid").querySelectorAll("[data-skin]").forEach((button) => button.addEventListener("click", () => showSkinPreview(button.dataset.skin)));
  const regularOwned = SKINS.filter((skin) => skin.pool === "regular" && owned.has(skin.id)).length;
  const vaultOwned = SKINS.filter((skin) => skin.pool === "vault" && owned.has(skin.id)).length;
  const next = nextChestSkin(save.ownedSkins, save.chestSerial, "regular");
  const nextVault = nextChestSkin(save.ownedSkins, save.vaultChestSerial, "vault");
  const price = regularChestPrice(regularOwned);
  const vaultPrice = vaultChestPrice(vaultOwned);
  $("#chest-price").textContent = price;
  $("#chest-button").disabled = !next || save.coins < price;
  $("#chest-button").textContent = next ? t("openChest") : t("chestComplete");
  $("#vault-chest-price").textContent = vaultPrice;
  $("#vault-chest-button").disabled = !nextVault || save.vaultCoins < vaultPrice;
  $("#vault-chest-button").textContent = nextVault ? t("openChest") : t("chestComplete");
  $("#reward-button").disabled = false;
  const favorite = listHas(save.favoriteSkins, save.equippedSkin);
  $("#favorite-skin").textContent = t(favorite ? "unfavorite" : "favorite");
  $("#favorite-skin").classList.toggle("active", favorite);
  $("#random-favorites").disabled = save.favoriteSkins.length === 0;
  renderRewardHistory();
}

function toggleFavoriteSkin() {
  const id = save.equippedSkin;
  save.favoriteSkins = listHas(save.favoriteSkins, id) ? save.favoriteSkins.filter((item) => item !== id) : [...save.favoriteSkins, id];
  persist(); renderSkins();
}

function equipRandomSkin(favoritesOnly = false) {
  const pool = (favoritesOnly ? save.favoriteSkins : save.ownedSkins).filter((id) => listHas(save.ownedSkins, id));
  if (!pool.length) { showToast(t("noFavorites")); return; }
  const values = new Uint32Array(1);
  const random = window.crypto?.getRandomValues ? (window.crypto.getRandomValues(values), values[0] / 4294967296) : Math.random();
  let index = Math.floor(random * pool.length);
  if (pool.length > 1 && pool[index] === save.equippedSkin) index = (index + 1) % pool.length;
  equipSkin(pool[index]); showToast(skinName(SKINS.find((skin) => skin.id === pool[index]) || SKINS[0]));
}

function renderRewardHistory() {
  const labels = { level: t("rewardLevel"), ad: t("rewardAd"), milestone: t("rewardMilestone"), sector: t("rewardSector"), daily: t("rewardDaily"), mission: t("rewardMission"), secret: t("rewardSecret") };
  const list = $("#reward-history-list");
  const entries = (save.rewardLog || []).slice(0, 6);
  list.innerHTML = entries.length ? entries.map((entry) => {
    const amount = [entry.coins ? `+${entry.coins} ⬡` : "", entry.vaultCoins ? `+${entry.vaultCoins} ✦` : ""].filter(Boolean).join(" ");
    const time = new Date(entry.at).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
    return `<li><span>${labels[entry.type] || labels.level}</span><b>${amount}</b><small>${time}</small></li>`;
  }).join("") : `<li class="empty-reward-history">${t("noRewards")}</li>`;
}

function equipSkin(id) {
  if (!listHas(save.ownedSkins, id)) return;
  save.equippedSkin = id;
  game.skin = SKINS.find((skin) => skin.id === id) || SKINS[0];
  audio.switch();
  track("skin_equip", { skin: id });
  persist();
  renderSkins();
}

function stopSkinPreview() {
  previewSkinId = null;
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame = 0;
}

function drawSkinPreviewFrame(now) {
  const canvas = $("#unlock-preview-canvas");
  const skin = SKINS.find((item) => item.id === previewSkinId);
  if (!canvas || !skin || $("#unlock-modal").classList.contains("hidden")) { stopSkinPreview(); return; }
  const context = canvas.getContext("2d"); const size = Math.min(canvas.width, canvas.height); const reducedMotion = save.settings.reducedMotion;
  const cycle = reducedMotion ? 0 : (now - previewStarted) % 3200;
  const mode = cycle < 900 || cycle >= 1800 ? "idle" : cycle < 1300 ? "move" : "return";
  $("#unlock-preview-label").textContent = t(mode === "move" ? "previewMove" : mode === "return" ? "previewReturn" : "previewIdle");
  context.clearRect(0, 0, canvas.width, canvas.height); context.save(); context.translate(canvas.width / 2, canvas.height / 2);
  const drawBody = (x, alpha = 1) => {
    context.save(); context.globalAlpha = alpha;
    drawSkinEffect(context, skin, x, 0, size * 0.78, reducedMotion ? 0 : now, mode === "move");
    drawSkin(context, skin, x, 0, size * 0.62, reducedMotion ? 0 : now, alpha);
    context.restore();
  };
  if (mode === "move") {
    const progress = (cycle - 900) / 400; const x = (1 - (1 - progress) ** 3) * size * 0.18;
    for (let index = 3; index > 0; index -= 1) drawBody(x - index * size * 0.08, 0.12 * (4 - index));
    drawBody(x);
  } else if (mode === "return") {
    const progress = (cycle - 1300) / 500;
    drawBody((1 - progress) * size * 0.18);
  } else drawBody(0);
  context.restore();
  previewFrame = reducedMotion ? 0 : requestAnimationFrame(drawSkinPreviewFrame);
}

function showSkinPreview(id) {
  const skin = SKINS.find((item) => item.id === id);
  if (!skin) return;
  const owned = listHas(save.ownedSkins, skin.id); const equipped = save.equippedSkin === skin.id;
  stopSkinPreview(); previewSkinId = skin.id; previewStarted = performance.now();
  $("#unlock-preview").style.setProperty("--effect-color", skin.secondary);
  $("#unlock-name").textContent = skinName(skin);
  $("#unlock-rarity").textContent = rarityLabel(skin.rarity);
  $("#unlock-status").textContent = t(equipped ? "equipped" : owned ? "owned" : "locked");
  $("#unlock-status").dataset.status = equipped ? "equipped" : owned ? "owned" : "locked";
  $("#unlock-source").textContent = skinSourceLabel(skin);
  $("#unlock-equip").classList.toggle("hidden", !owned || equipped);
  $("#unlock-close").classList.remove("hidden");
  $("#unlock-modal").classList.remove("hidden");
  syncModalPause();
  previewFrame = requestAnimationFrame(drawSkinPreviewFrame);
}

function openScreen(id, back = null) {
  if (back) screenBack = back;
  else if (!activeScreen() && game.state === "playing") screenBack = "game";
  else screenBack = activeScreen()?.id || "home-screen";
  $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
  pauseManager.sync();
  if (id === "home-screen") renderHome();
  if (id === "map-screen") { mapZone = Math.floor((save.unlockedLevel - 1) / 20); renderMap(); setTimeout(() => $(".level-node.current")?.scrollIntoView?.({ block: "center" }), 20); }
  if (id === "daily-screen") { renderMission(); renderDaily(); }
  if (id === "modes-screen") renderModes();
  if (id === "rush-screen") renderRush();
  if (id === "skins-screen") renderSkins();
  if (id === "settings-screen") syncSettings();
}

function closeScreen() {
  if (screenBack === "game" && game.state === "playing") {
    $$(".screen").forEach((screen) => screen.classList.remove("active"));
    pauseManager.sync(); screenBack = "home-screen";
  } else openScreen(screenBack || "home-screen", "home-screen");
}

function tutorialForLevel(level) {
  const hint = $("#tutorial");
  hint.classList.add("hidden"); hint.classList.remove("right");
  if (level === 1 && !save.tutorialDone) {
    tutorialStep = 0;
    const desktop = matchMedia("(pointer: fine)").matches && innerWidth >= 600 ? ` · ${t("desktopHint")}` : "";
    $("#tutorial-text").textContent = `${t("swipeUp")}${desktop}`;
    hint.classList.remove("hidden");
  }
}

function hideMechanicTutorial() {
  clearTimeout(mechanicTutorialTimer);
  $("#mechanic-tutorial").classList.add("hidden");
  setPauseReason("tutorial", false);
}

function showMechanicTutorial(tutorial) {
  if (!tutorial || save.tutorialSeen[tutorial.key]) return;
  save.tutorialSeen[tutorial.key] = true;
  $("#mechanic-tutorial-icon").textContent = tutorial.icon;
  $("#mechanic-tutorial-title").textContent = t(tutorial.titleKey);
  $("#mechanic-tutorial-body").textContent = t(tutorial.bodyKey);
  $("#mechanic-tutorial").classList.remove("hidden");
  setPauseReason("tutorial", true);
  persist();
  clearTimeout(mechanicTutorialTimer);
  mechanicTutorialTimer = setTimeout(hideMechanicTutorial, save.settings.reducedMotion ? 4800 : 6500);
}

function showSectorPresentation(level, tutorial) {
  const sector = sectorForLevel(level.id);
  const firstEntry = isSectorStart(level.id) && !save.sectorSeen[sector.index];
  const core = isSectorCore(level.id) && !save.completed[level.id] && !introducedCores.has(level.id);
  if (!firstEntry && !core) return false;
  if (firstEntry) save.sectorSeen[sector.index] = true;
  if (core) introducedCores.add(level.id);
  queuedMechanicTutorial = tutorial;
  const modal = $("#sector-intro");
  const theme = LEVEL_THEMES[sector.index];
  modal.style.setProperty("--sector-edge", theme.edge); modal.style.setProperty("--sector-center", theme.center);
  modal.classList.toggle("core", core);
  $("#sector-intro-kicker").textContent = core ? `${t("sectorCore")} · ${t("securityLevel")} ${pad2(sector.number)}` : `${t("securityLevel")} ${pad2(sector.number)}`;
  $("#sector-intro-name").textContent = t(sector.nameKey).toUpperCase();
  $("#sector-intro-line").textContent = t(sector.lineKey);
  $("#sector-intro-signature").textContent = t(sector.signatureKey);
  modal.classList.remove("hidden");
  syncModalPause();
  if (firstEntry) persist();
  return true;
}

function closeSectorPresentation() {
  $("#sector-intro").classList.add("hidden");
  syncModalPause();
  const tutorial = queuedMechanicTutorial; queuedMechanicTutorial = null;
  showMechanicTutorial(tutorial);
}

function playLevel(id, mode = "campaign") {
  cancelGameplayTransition();
  rushMode = false; rushRun = null; rushResultVisible = false;
  document.body.classList.remove("rush-level"); $("#rush-hud").classList.add("hidden"); $("#par-badge").classList.remove("hidden");
  dailyMode = mode === "daily";
  currentLevel = Math.max(1, Math.min(save.unlockedLevel, Math.floor(id || 1)));
  $("#result-modal").classList.add("hidden"); $("#unlock-modal").classList.add("hidden");
  $$(".screen").forEach((screen) => screen.classList.remove("active"));
  const skin = SKINS.find((item) => item.id === save.equippedSkin) || SKINS[0];
  const level = dailyMode ? dailyLevelForDay(dayKey(), LEVELS) : levelById(currentLevel);
  if (dailyMode) { dailyDay = level.dailyDay; currentLevel = level.dailySourceId; }
  const personalGhost = !dailyMode && save.settings.personalGhost && !save.settings.reducedMotion ? levelRecord(save, level).ghost : null;
  game.load(level, skin, personalGhost);
  track(dailyMode ? "daily_start" : "level_start", { level: currentLevel, day: dailyMode ? dailyDay : undefined });
  const coreLevel = !dailyMode && isSectorCore(currentLevel);
  document.body.classList.toggle("sector-core-level", coreLevel);
  audio.setIntensity(coreLevel ? 1 : Math.min(1, 0.15 + currentLevel / 290)); audio.setZone(Math.floor((currentLevel - 1) / 20)); audio.unlock();
  syncModalPause();
  hideMechanicTutorial();
  tutorialForLevel(dailyMode ? 0 : currentLevel);
  if (!dailyMode) {
    const mechanic = nextMechanicTutorial(level, save.tutorialSeen);
    if (!showSectorPresentation(level, mechanic)) showMechanicTutorial(mechanic);
  }
  updateHud();
}

function updateRushHud(force = false) {
  if (!rushRun) return;
  const stamp = Math.ceil(rushRun.timeRemaining * 10);
  if (!force && stamp === rushHudStamp) return;
  rushHudStamp = stamp;
  $("#rush-time").textContent = rushRun.timeRemaining.toFixed(1);
  $("#rush-score").textContent = rushRun.score;
  $("#rush-multiplier").textContent = `×${rushRun.multiplier.toFixed(2)}`;
  $("#rush-streak").textContent = rushRun.streak;
  $("#rush-security").textContent = pad2(rushRun.securityLevel);
  $("#hud-level-label").textContent = t("rushRoom");
  $("#hud-level").textContent = rushRun.room + 1;
}

function playRushRoom() {
  if (!rushRun || rushRun.ended) return;
  cancelGameplayTransition();
  rushMode = true; dailyMode = false; rushResultVisible = false;
  $("#rush-result-modal").classList.add("hidden");
  $$(".screen").forEach((screen) => screen.classList.remove("active"));
  document.body.classList.add("rush-level"); document.body.classList.remove("sector-core-level");
  $("#rush-hud").classList.remove("hidden"); $("#par-badge").classList.add("hidden");
  const level = vaultRushRoom(rushRun, LEVELS); currentLevel = level.id;
  const skin = SKINS.find((item) => item.id === save.equippedSkin) || SKINS[0];
  game.load(level, skin);
  track("rush_room_start", { level: level.id, room: rushRun.room + 1, security: rushRun.securityLevel });
  audio.setZone(Math.floor((level.id - 1) / 20)); audio.setIntensity(Math.min(1, 0.58 + rushRun.securityLevel * 0.035)); audio.unlock();
  hideMechanicTutorial();
  syncModalPause(); updateHud(); updateRushHud(true);
}

function startVaultRush() {
  if (rushRun && !rushFinalized) finalizeVaultRush();
  rushRun = createVaultRushRun(Date.now()); rushFinalized = false; rushHudStamp = -1;
  track("rush_start");
  playRushRoom();
}

function finalizeVaultRush() {
  if (!rushRun || rushFinalized) return;
  rushFinalized = true;
  save.vaultRush.bestScore = Math.max(save.vaultRush.bestScore, rushRun.score);
  save.vaultRush.runs += 1; save.vaultRush.rooms += rushRun.room;
  save.vaultRush.bestStreak = Math.max(save.vaultRush.bestStreak, rushRun.bestStreak);
  save.vaultRush.deaths += rushRun.deaths; save.vaultRush.dots += rushRun.dots;
  persist();
  adapter.submitLeaderboard(CONFIG.rushLeaderboard, save.vaultRush.bestScore).catch(() => {});
}

function showVaultRushResult() {
  if (!rushRun || rushResultVisible) return;
  rushResultVisible = true;
  const canContinue = rushRun.endReason === "death" && !rushRun.continueUsed;
  if (rushRun.score > save.vaultRush.bestScore) {
    save.vaultRush.bestScore = rushRun.score; persist();
    adapter.submitLeaderboard(CONFIG.rushLeaderboard, save.vaultRush.bestScore).catch(() => {});
  }
  if (!canContinue) finalizeVaultRush();
  $("#rush-result-title").textContent = t(rushRun.endReason === "death" ? "rushCaught" : "rushComplete");
  $("#rush-result-score").textContent = rushRun.score;
  $("#rush-result-rooms").textContent = rushRun.room;
  $("#rush-result-best").textContent = save.vaultRush.bestScore;
  $("#rush-result-streak").textContent = rushRun.bestStreak;
  $("#rush-result-security").textContent = pad2(rushRun.securityLevel);
  $("#rush-continue").classList.toggle("hidden", !canContinue);
  $("#rush-result-modal").classList.remove("hidden");
  syncModalPause(); renderRush();
}

function updateVaultRush(delta) {
  if (!rushMode || !rushRun || rushRun.ended || game.state !== "playing" || game.paused) return;
  tickVaultRush(rushRun, delta); updateRushHud();
  if (rushRun.ended) showVaultRushResult();
}

function finishRushRoom(result, expectedRun = rushRun) {
  if (!rushMode || !rushRun || rushRun !== expectedRun || rushRun.ended) { setGameplayTransition(false); return; }
  const before = rushRun.timeRemaining;
  rushRun = completeVaultRushRoom(rushRun, result);
  track("rush_room_win", { level: currentLevel, room: rushRun.room, score: rushRun.score });
  showToast(t("rushBonus").replace("{seconds}", (rushRun.timeRemaining - before).toFixed(1)).replace("{multiplier}", rushRun.multiplier.toFixed(2)), 900);
  updateRushHud(true);
  const completedRun = rushRun;
  scheduleGameplayTransition(() => {
    if (rushMode && rushRun === completedRun && !rushRun.ended) playRushRoom();
    else setGameplayTransition(false);
  }, 360);
}

async function continueVaultRushWithAd() {
  const button = $("#rush-continue"); button.disabled = true;
  try {
    if (!await adapter.rewarded()) return;
    const resumed = continueVaultRush(rushRun);
    if (resumed === rushRun) return;
    rushRun = resumed; rushResultVisible = false;
    track("rewarded_ad", { kind: "rush_continue" });
    playRushRoom();
  } finally {
    button.disabled = false;
  }
}

function leaveVaultRush() {
  finalizeVaultRush(); rushMode = false;
  document.body.classList.remove("rush-level"); $("#rush-hud").classList.add("hidden"); $("#par-badge").classList.remove("hidden");
  $("#rush-result-modal").classList.add("hidden"); syncModalPause(); openScreen("rush-screen", "modes-screen");
}

function handleDash(direction) {
  save.stats.dashes += 1;
  updateMission("dashes"); track("dash", { direction });
  if (currentLevel === 1 && !save.tutorialDone) {
    if (tutorialStep === 0 && direction === "up") {
      tutorialStep = 1; $("#tutorial").classList.add("right"); $("#tutorial-text").textContent = t("swipeRight");
    } else if (tutorialStep === 1 && direction === "right") {
      tutorialStep = 2; $("#tutorial").classList.add("hidden");
    }
  }
}

function handleDeath() {
  lastDeathAt = Date.now();
  if (rushMode) {
    save.stats.deaths += 1; save.stats.streak = 0; haptic([24, 28, 42]); track("rush_death");
    rushRun = failVaultRush(rushRun); persist(); pauseManager.sync();
    scheduleGameplayTransition(() => {
      setGameplayTransition(false);
      if (rushMode && rushRun?.ended) showVaultRushResult();
    }, CONFIG.deathDelay);
    return;
  }
  const key = dailyMode ? `daily:${dailyDay}` : `level:${currentLevel}`;
  const deaths = (levelDeaths.get(key) || 0) + 1; levelDeaths.set(key, deaths);
  save.stats.deaths += 1; save.stats.streak = 0; haptic([24, 28, 42]); track("death"); persist(); pauseManager.sync();
  if (deaths === 2) showToast(t("assistReady"), 2300);
  scheduleGameplayTransition(() => {
    setGameplayTransition(false);
    if (game.state !== "dead" || activeScreen()) return;
    if (game.respawnFromCheckpoint()) { pauseManager.sync(); updateHud(); showToast(t("checkpointRestored")); }
    else playLevel(currentLevel, dailyMode ? "daily" : "campaign");
  }, CONFIG.deathDelay);
}

function showSafeMove() {
  const direction = nextSafeMove(game);
  if (!direction) { showToast(t("hintUnavailable"), 1800); return false; }
  const arrows = { up: "↑", down: "↓", left: "←", right: "→" };
  showToast(t("safeMove").replace("{direction}", arrows[direction]), 2600);
  return true;
}

async function rewardedHint() {
  const button = $("#nav-hint");
  if (activeScreen() || game.state !== "playing" || button.disabled) return;
  button.disabled = true;
  try {
    if (!await adapter.rewarded()) return;
    track("rewarded_ad", { kind: "hint" });
    showSafeMove();
  } finally {
    button.disabled = false;
  }
}

function handleWin(result) {
  pauseManager.sync(); haptic([18, 35, 28]);
  if (rushMode) {
    const expectedRun = rushRun;
    scheduleGameplayTransition(() => finishRushRoom(result, expectedRun), 220);
    return;
  }
  const context = { daily: dailyMode, day: dailyDay, id: currentLevel };
  track(dailyMode ? "daily_win" : "level_win", { dots: result.dots, coins: result.coins, time: result.time });
  scheduleGameplayTransition(() => { setGameplayTransition(false); finishLevel(result, context); }, 360);
}

function finishLevel(result, context = { daily: dailyMode, day: dailyDay, id: currentLevel }) {
  if (context.daily) return finishDailyLevel(result, context.day);
  const id = context.id;
  const level = levelById(id);
  const record = levelRecord(save, level);
  levelDeaths.delete(`level:${id}`);
  const previousBest = record.bestTime;
  const previousBestDashes = record.bestDashes;
  const previousGhostTime = record.ghost?.completionTime || Number.POSITIVE_INFINITY;
  const newRouteBest = !previousBestDashes || result.dashes < previousBestDashes || (result.dashes === previousBestDashes && result.time < previousGhostTime);
  updateMission("completions");
  const firstCompletion = !save.completed[id];
  const sectorReward = id % 20 === 0 && !save.sectorRewards[id];
  const sectorSkin = sectorReward ? SKINS.find((skin) => skin.sector === Math.floor(id / 20) - 1) : null;
  const sectorSkinReward = sectorSkin && !listHas(save.ownedSkins, sectorSkin.id);
  resultReward = result.coins * 12 + 5;
  resultDoubled = false;
  save.coins += resultReward;
  if (firstCompletion) save.vaultCoins += 1;
  if (sectorReward) {
    save.sectorRewards[id] = true;
    save.coins += CONFIG.sectorRewardCoins;
    save.vaultCoins += CONFIG.sectorRewardVaultCoins;
    if (sectorSkinReward) save.ownedSkins.push(sectorSkin.id);
    recordReward("sector", CONFIG.sectorRewardCoins, CONFIG.sectorRewardVaultCoins);
  }
  recordReward("level", resultReward, firstCompletion ? 1 : 0);
  save.completed[id] = true;
  save.cores[id] = Math.max(save.cores[id] || 0, result.cores);
  save.bestDots[id] = Math.max(save.bestDots[id] || 0, result.dots);
  save.bestTimes[id] = previousBest ? Math.min(previousBest, result.time) : result.time;
  save.bestDashes[id] = previousBestDashes ? Math.min(previousBestDashes, result.dashes) : result.dashes;
  if (!record.compatible) delete save.routeGhosts[id];
  if (newRouteBest && result.route) save.routeGhosts[id] = result.route;
  const revision = levelRevision(level);
  if (revision > 1) save.levelRevisions[id] = revision; else delete save.levelRevisions[id];
  save.unlockedLevel = Math.max(save.unlockedLevel, Math.min(CONFIG.maxLevels, id + 1));
  save.stats.completions += 1; save.stats.dots += result.dots; save.stats.coins += result.coins;
  if (result.cores === 3) save.stats.perfects += 1;
  save.stats.streak += 1; save.stats.bestStreak = Math.max(save.stats.bestStreak, save.stats.streak);
  if (id === 1) save.tutorialDone = true;
  if (id === 250 && !listHas(save.ownedSkins, "architect")) save.ownedSkins.push("architect");
  persist();
  $("#result-level").textContent = id;
  $("#result-dots").textContent = `${result.dots}/${result.totalDots}`;
  $("#result-time").textContent = formatTime(result.time);
  const bonusRoute = Boolean(result.bonusMask);
  $("#result-route").textContent = t(bonusRoute ? "bonusRouteResult" : "routeResult").replace("{used}", result.dashes).replace("{par}", result.par).replace("{best}", save.bestDashes[id]);
  $("#result-perfect").textContent = t(bonusRoute ? "bonusRouteComplete" : "perfectRoute").replace("{par}", result.par);
  $("#result-perfect").classList.toggle("hidden", result.dashes > result.par);
  $("#result-record").textContent = t("newBest");
  $("#result-record").classList.toggle("hidden", !newRouteBest && Boolean(previousBest) && result.time >= previousBest);
  $("#result-coins").textContent = `+${resultReward} ⬡`;
  $("#result-vault").textContent = firstCompletion ? "+1 ✦" : "+0 ✦";
  $("#result-vault-label").textContent = t("levelCrystal");
  $("#sector-reward").classList.toggle("hidden", !sectorReward);
  $("#sector-reward").textContent = sectorSkinReward ? `${t("sectorReward")} · ${t("sectorSkinUnlocked")}` : t("sectorReward");
  $("#sector-illustration").classList.toggle("hidden", id % 20 !== 0);
  $(".result-kicker").textContent = t(id % 20 === 0 ? "sectorComplete" : id % 5 === 0 ? "challengeComplete" : "complete");
  $("#result-cores").innerHTML = Array.from({ length: 3 }, (_, index) => `<span class="${index < result.cores ? "" : "off"}">◆</span>`).join("");
  $("#double-button").disabled = resultReward <= 0;
  $("#milestone-button").classList.toggle("hidden", id % 5 !== 0 || Boolean(save.milestoneRewards[id]));
  $("#next-button").textContent = id === 250 ? t("finalTitle") : t("next");
  $("#result-modal").classList.remove("hidden");
  syncModalPause();
  updateHud({ ...result, coins: 0 });
}

function finishDailyLevel(result, day = dailyDay) {
  levelDeaths.delete(`daily:${day}`);
  const score = dailyScore(result);
  const previousDailyBest = save.dailyScores[day]?.[0]?.score || 0;
  const firstDaily = !previousDailyBest;
  save.dailyScores = recordDailyScore(save.dailyScores, day, result);
  const best = bestDailyResult(save.dailyScores, day);
  const reward = firstDaily ? 35 + result.cores * 10 : 0;
  save.coins += reward;
  recordReward("daily", reward);
  save.stats.dots += result.dots;
  save.stats.coins += result.coins;
  persist();
  $("#result-level").textContent = t("dailyResult");
  $("#result-dots").textContent = `${result.dots}/${result.totalDots}`;
  $("#result-time").textContent = formatTime(result.time);
  const bonusRoute = Boolean(result.bonusMask);
  $("#result-route").textContent = t(bonusRoute ? "bonusRouteResult" : "routeResult").replace("{used}", result.dashes).replace("{par}", result.par).replace("{best}", result.dashes);
  $("#result-perfect").textContent = t(bonusRoute ? "bonusRouteComplete" : "perfectRoute").replace("{par}", result.par);
  $("#result-perfect").classList.toggle("hidden", result.dashes > result.par);
  $("#result-record").textContent = t("newDailyBest");
  $("#result-record").classList.toggle("hidden", score <= previousDailyBest);
  $("#result-coins").textContent = `+${reward} ⬡`;
  $("#result-vault").textContent = `${score} ${t("pointsShort")}`;
  $("#result-vault-label").textContent = t("dailyScore");
  $("#sector-reward").classList.add("hidden");
  $("#sector-illustration").classList.add("hidden");
  $(".result-kicker").textContent = t("dailyComplete");
  $("#result-cores").innerHTML = Array.from({ length: 3 }, (_, index) => `<span class="${index < result.cores ? "" : "off"}">◆</span>`).join("");
  $("#double-button").disabled = true;
  $("#milestone-button").classList.add("hidden");
  $("#next-button").textContent = t("back");
  $("#result-modal").classList.remove("hidden");
  syncModalPause();
  updateHud({ ...result, coins: 0 });
  adapter.submitLeaderboard(CONFIG.dailyLeaderboard, dailyLeaderboardScore(day, best.score), dailyExtraData(day, best, best.score)).catch(() => {});
  renderDaily();
}

async function goNext() {
  const completed = currentLevel;
  $("#result-modal").classList.add("hidden");
  syncModalPause();
  if (dailyMode) { dailyMode = false; openScreen("daily-screen", "home-screen"); return; }
  if (completed === 250) { openScreen("map-screen", "home-screen"); showToast(t("finalBody"), 4200); return; }
  const now = Date.now();
  const adDue = completed > 3 && save.stats.completions % CONFIG.interstitialEvery === 0
    && (!lastFullscreenAt || now - lastFullscreenAt >= 180000) && now - lastDeathAt >= 10000;
  if (adDue) {
    lastFullscreenAt = now; setPauseReason("ad-transition", true);
    try { await adapter.fullscreen(); }
    finally { setPauseReason("ad-transition", false); }
  }
  playLevel(completed + 1);
}

async function claimMilestoneReward() {
  if (currentLevel % 5 !== 0 || save.milestoneRewards[currentLevel]) return;
  const button = $("#milestone-button"); button.disabled = true;
  try {
    if (!await adapter.rewarded()) return;
    track("rewarded_ad", { kind: "milestone" });
    save.milestoneRewards[currentLevel] = true;
    save.coins += CONFIG.milestoneRewardCoins;
    save.vaultCoins += CONFIG.milestoneRewardVaultCoins;
    recordReward("milestone", CONFIG.milestoneRewardCoins, CONFIG.milestoneRewardVaultCoins);
    persist(); audio.chest(); updateHud({ ...game.snapshot(), coins: 0 });
    button.classList.add("hidden");
    showToast(t("milestoneReward"), 2200);
  } finally {
    button.disabled = false;
  }
}

function claimDailyMission() {
  ensureMission();
  if (!missionComplete(save.mission) || save.mission.claimed) return;
  save.mission.claimed = true;
  save.coins += CONFIG.dailyRewardCoins;
  save.vaultCoins += CONFIG.dailyRewardVaultCoins;
  recordReward("mission", CONFIG.dailyRewardCoins, CONFIG.dailyRewardVaultCoins);
  haptic([16, 24, 34]); persist(); renderHome(); updateHud({ ...game.snapshot(), coins: 0 });
  showToast(t("dailyReward"), 2200);
}

async function doubleReward() {
  if (resultDoubled || resultReward <= 0) return;
  const button = $("#double-button"); button.disabled = true;
  try {
    if (!await adapter.rewarded()) return;
    track("rewarded_ad", { kind: "double" });
    resultDoubled = true; save.coins += resultReward; persist();
    $("#result-coins").textContent = `+${resultReward * 2} ⬡`;
    audio.coin(); updateHud({ ...game.snapshot(), coins: 0 });
  } finally {
    button.disabled = resultDoubled;
  }
}

function syncSettings() {
  $("#music-toggle").checked = save.settings.music;
  $("#sound-toggle").checked = save.settings.sound;
  $("#music-volume").value = save.settings.musicVolume; $("#music-volume-value").textContent = `${save.settings.musicVolume}%`;
  $("#sound-volume").value = save.settings.soundVolume; $("#sound-volume-value").textContent = `${save.settings.soundVolume}%`;
  $("#swipe-sensitivity").value = save.settings.swipeSensitivity;
  $("#motion-toggle").checked = save.settings.reducedMotion;
  $("#ghost-toggle").checked = save.settings.personalGhost;
  $("#haptics-toggle").checked = save.settings.haptics;
  $$('[data-language]').forEach((button) => button.classList.toggle("active", button.dataset.language === language));
}

function showChestReel(skin, poolName) {
  const candidates = SKINS.filter((item) => item.pool === poolName);
  const items = Array.from({ length: 11 }, (_, index) => candidates[(skin.index + index * 5 + 2) % candidates.length]);
  items.push(skin);
  const track = $("#reel-track");
  track.classList.remove("rolling");
  track.innerHTML = items.map((item) => `<div class="reel-item"><i style="--skin:${item.primary};background:${item.primary};box-shadow:0 0 14px ${item.primary}"></i><div><strong>${skinName(item)}</strong><small>${rarityLabel(item.rarity)}</small></div></div>`).join("");
  track.style.setProperty("--reel-distance", `${-(items.length - 1) * 78}px`);
  $("#chest-reel-modal").classList.remove("hidden");
  syncModalPause();
  requestAnimationFrame(() => track.classList.add("rolling"));
  setTimeout(() => {
    $("#chest-reel-modal").classList.add("hidden");
    showSkinPreview(skin.id);
  }, 2050);
}

async function openChest(poolName = "regular") {
  const ownedCount = SKINS.filter((skin) => skin.pool === poolName && listHas(save.ownedSkins, skin.id)).length;
  const vault = poolName === "vault";
  const price = vault ? vaultChestPrice(ownedCount) : regularChestPrice(ownedCount);
  const serialKey = vault ? "vaultChestSerial" : "chestSerial";
  const skin = nextChestSkin(save.ownedSkins, save[serialKey], poolName);
  const balance = vault ? save.vaultCoins : save.coins;
  if (!skin || balance < price) { showToast(t("notEnough")); return; }
  if (vault) save.vaultCoins -= price; else save.coins -= price;
  save.ownedSkins.push(skin.id); save[serialKey] += 1; unlockedSkin = skin;
  const visual = vault ? $("#vault-chest-visual") : $("#chest-visual");
  visual.classList.add("opening"); audio.chest(); persist(); renderSkins(); updateHud({ ...game.snapshot(), coins: 0 });
  setTimeout(() => { visual.classList.remove("opening"); showChestReel(skin, poolName); }, 620);
}

async function rewardCoins() {
  if (rewardPending) return;
  rewardPending = true;
  $("#reward-button").disabled = true;
  try {
    if (!await adapter.rewarded()) return;
    track("rewarded_ad", { kind: "coins" });
    save.coins += CONFIG.rewardedCoins; recordReward("ad", CONFIG.rewardedCoins); audio.coin(); persist(); updateHud({ ...game.snapshot(), coins: 0 }); showToast(t("rewardCoins"));
  } finally {
    rewardPending = false;
    renderSkins();
  }
}

function bindUi() {
  $("#home-continue").addEventListener("click", () => playLevel(save.unlockedLevel));
  $("#home-map").addEventListener("click", () => openScreen("map-screen", "home-screen"));
  $("#home-modes").addEventListener("click", () => openScreen("modes-screen", "home-screen"));
  $("#home-skins").addEventListener("click", () => openScreen("skins-screen", "home-screen"));
  $("#home-settings").addEventListener("click", () => openScreen("settings-screen", "home-screen"));
  $("#continue-button").addEventListener("click", () => playLevel(save.unlockedLevel));
  $("#map-modes-button").addEventListener("click", () => openScreen("modes-screen", "map-screen"));
  $("#map-skins-button").addEventListener("click", () => openScreen("skins-screen", "map-screen"));
  $("#map-button").addEventListener("click", () => openScreen("map-screen", "game"));
  $("#nav-map").addEventListener("click", () => openScreen("map-screen", "game"));
  $("#nav-daily").addEventListener("click", () => openScreen("daily-screen", "game"));
  $("#nav-hint").addEventListener("click", rewardedHint);
  $("#nav-skins").addEventListener("click", () => openScreen("skins-screen", "game"));
  $("#nav-modes").addEventListener("click", () => openScreen("modes-screen", "game"));
  $("#settings-button").addEventListener("click", () => openScreen("settings-screen", "game"));
  $("#map-zone-prev").addEventListener("click", () => { mapZone -= 1; renderMap(); });
  $("#map-zone-next").addEventListener("click", () => { mapZone += 1; renderMap(); });
  const restartLevel = () => { track("restart"); if (rushMode) playRushRoom(); else playLevel(currentLevel, dailyMode ? "daily" : "campaign"); };
  $("#restart-button").addEventListener("click", restartLevel);
  $("#settings-restart").addEventListener("click", restartLevel);
  $$('[data-close-screen]').forEach((button) => button.addEventListener("click", closeScreen));
  $("#next-button").addEventListener("click", goNext);
  $("#double-button").addEventListener("click", doubleReward);
  $("#milestone-button").addEventListener("click", claimMilestoneReward);
  $("#replay-button").addEventListener("click", () => playLevel(currentLevel, dailyMode ? "daily" : "campaign"));
  $("#home-daily").addEventListener("click", () => playLevel(dailyLevelForDay(dayKey(), LEVELS).dailySourceId, "daily"));
  $("#leaderboard-refresh").addEventListener("click", refreshLeaderboard);
  $("#mechanic-tutorial").addEventListener("click", hideMechanicTutorial);
  $("#sector-enter").addEventListener("click", closeSectorPresentation);
  $("#yandex-login").addEventListener("click", (event) => signInWithYandex(event.currentTarget));
  $("#rush-login").addEventListener("click", (event) => signInWithYandex(event.currentTarget));
  $("#open-rush").addEventListener("click", () => openScreen("rush-screen", "modes-screen"));
  $("#rush-start").addEventListener("click", startVaultRush);
  $("#rush-leaderboard-refresh").addEventListener("click", refreshRushLeaderboard);
  $("#rush-continue").addEventListener("click", continueVaultRushWithAd);
  $("#rush-again").addEventListener("click", () => { finalizeVaultRush(); startVaultRush(); });
  $("#rush-back").addEventListener("click", leaveVaultRush);
  $("#chest-button").addEventListener("click", () => openChest("regular"));
  $("#vault-chest-button").addEventListener("click", () => openChest("vault"));
  $("#reward-button").addEventListener("click", rewardCoins);
  $("#favorite-skin").addEventListener("click", toggleFavoriteSkin);
  $("#random-skin").addEventListener("click", () => equipRandomSkin(false));
  $("#random-favorites").addEventListener("click", () => equipRandomSkin(true));
  $("#unlock-equip").addEventListener("click", () => { const id = previewSkinId; if (!id || !listHas(save.ownedSkins, id)) return; equipSkin(id); stopSkinPreview(); $("#unlock-modal").classList.add("hidden"); syncModalPause(); });
  $("#unlock-close").addEventListener("click", () => { stopSkinPreview(); $("#unlock-modal").classList.add("hidden"); syncModalPause(); });
  $("#music-toggle").addEventListener("change", (event) => { save.settings.music = event.target.checked; persist(); audio.sync(); });
  $("#sound-toggle").addEventListener("change", (event) => { save.settings.sound = event.target.checked; applyRuntimeSettings(); persist(); });
  $("#music-volume").addEventListener("input", (event) => { save.settings.musicVolume = Number(event.target.value); $("#music-volume-value").textContent = `${event.target.value}%`; applyRuntimeSettings(); });
  $("#music-volume").addEventListener("change", persist);
  $("#sound-volume").addEventListener("input", (event) => { save.settings.soundVolume = Number(event.target.value); $("#sound-volume-value").textContent = `${event.target.value}%`; applyRuntimeSettings(); });
  $("#sound-volume").addEventListener("change", persist);
  $("#swipe-sensitivity").addEventListener("change", (event) => { save.settings.swipeSensitivity = event.target.value; applyRuntimeSettings(); persist(); });
  $("#motion-toggle").addEventListener("change", (event) => { save.settings.reducedMotion = event.target.checked; applyRuntimeSettings(); persist(); });
  $("#ghost-toggle").addEventListener("change", (event) => { save.settings.personalGhost = event.target.checked; persist(); });
  $("#haptics-toggle").addEventListener("change", (event) => { save.settings.haptics = event.target.checked; persist(); });
  $("#mission-claim").addEventListener("click", claimDailyMission);
  $$('[data-language]').forEach((button) => button.addEventListener("click", () => {
    language = button.dataset.language;
    save.settings.language = language;
    save.settings.languagePlatform = normalizeLanguage(adapter?.language() || navigator.language);
    t = translator(language); applyTranslations(); persist(); renderHome(); renderMap(); renderSkins(); renderRush(); updateHud(); syncSettings();
  }));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && analyticsUnsaved) persist();
    setPauseReason("visibility", document.hidden);
  });
  window.addEventListener("blur", () => setPauseReason("blur", true));
  window.addEventListener("focus", () => setPauseReason("blur", false));
  document.addEventListener("keydown", trapDialogFocus);
  const unlockAudio = () => { audio.unlock(); pauseManager.sync(); };
  window.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
  window.addEventListener("keydown", unlockAudio, { once: true });
}

async function start() {
  adapter = await YandexAdapter.create({
    onPause: () => setPauseReason("platform", true),
    onResume: () => setPauseReason("platform", false),
    onAdStart: () => setPauseReason("ad", true),
    onAdStop: () => setPauseReason("ad", false),
  });
  const cloud = await adapter.loadCloud();
  cloudWritable = cloud !== undefined;
  if (cloud) {
    mergeCloudSave(cloud);
    adapter.saveCloud(compactSave(save));
  }
  language = selectLanguage(save.settings, adapter.language());
  save.settings.language = language; t = translator(language);
  audio = new AudioEngine(save.settings);
  renderer = new Renderer($("#game-canvas"));
  game = new NeonGame(audio, {
    onLoad: updateHud, onDash: handleDash, onDot: (snapshot) => { updateMission("dots"); updateHud(snapshot); }, onCoin: (snapshot) => { haptic(9); updateHud(snapshot); },
    onDeath: handleDeath, onWin: handleWin, onSecret: handleSecret, onCheckpoint: () => { haptic(14); showToast(t("checkpoint")); },
    onPortalLocked: (remaining) => showToast(t("portalLocked").replace("{count}", remaining), 2100),
    onHint: (remaining) => showToast(t(remaining <= 3 ? "energyHint" : "routeSignal"), 1700),
    onAssist: showSafeMove,
  });
  input = new InputController($("#game-canvas"), (direction) => game.input(direction), CONFIG.swipeThreshold);
  installViewportGuards({ root: $("#app"), onResize: () => renderer.resize() });
  pauseManager = new PauseManager({ game, audio, input, adapter, isGameplay: () => !activeScreen() && game.state === "playing" });
  pendingPauseReasons.forEach((reason) => pauseManager.pauseReasons.add(reason));
  pauseManager.set("visibility", document.hidden);
  bindUi(); applyTranslations(); applyRuntimeSettings();
  const skin = SKINS.find((item) => item.id === save.equippedSkin) || SKINS[0];
  game.load(levelById(save.unlockedLevel), skin); pauseManager.sync();
  renderHome(); renderMap(); renderSkins(); syncSettings();
  $("#app").classList.remove("is-loading"); $("#loading").classList.add("hidden");
  let previous = performance.now();
  const frame = (now) => {
    const delta = Math.min(0.05, (now - previous) / 1000); previous = now;
    const screen = activeScreen();
    if (!screen) {
      updateVaultRush(delta);
      game.update(delta);
      if (game.state === "playing") {
        const progress = game.totalDots ? game.collectedDots / game.totalDots : 0;
        audio.setIntensity(Math.min(1, 0.12 + currentLevel / 480 + progress * 0.42 + (game.dots.size === 0 ? 0.18 : 0)));
      }
      renderer.draw(game, now);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame((now) => {
    frame(now);
    requestAnimationFrame(() => adapter.ready());
  });
}

start().catch((error) => {
  console.error(error);
  const title = document.createElement("strong"); title.textContent = t("title");
  const message = document.createElement("p"); message.textContent = t("startupError");
  const retry = document.createElement("button"); retry.textContent = t("reload"); retry.addEventListener("click", () => location.reload());
  setChildren($("#loading"), [title, message, retry]);
});
