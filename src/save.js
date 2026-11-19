import { CONFIG } from "./config.js";
import { SKINS } from "./skins.js";
import { fromEntries, objectEntries } from "./compat.js";

const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const integer = (value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isFinite(Number(value))
  ? Math.max(0, Math.min(maximum, Math.floor(Number(value)))) : fallback;
const boolean = (value, fallback) => typeof value === "boolean" ? value : fallback;
const GHOST_DIRECTIONS = new Set(["up", "down", "left", "right"]);
const DIRECTION_CODES = { up: "u", down: "d", left: "l", right: "r" };
const CODE_DIRECTIONS = { u: "up", d: "down", l: "left", r: "right" };
const MAX_GHOST_DASHES = 96;
const MAX_DAILY_DAYS = 45;
const MISSION_TYPES = new Set(["completions", "dots", "dashes"]);
const SWIPE_SENSITIVITIES = new Set(["low", "normal", "high"]);
const recordRevision = (save, id) => Math.max(1, integer(save?.levelRevisions?.[id], 1, 10000));

function normalizeRouteGhosts(raw) {
  return fromEntries(objectEntries(object(raw)).filter(([key, value]) => {
    const id = Number(key);
    return /^\d+$/.test(key) && Number.isInteger(id) && id >= 1 && id <= CONFIG.maxLevels && object(value);
  }).slice(0, CONFIG.maxLevels).map(([key, value]) => {
    const encoded = typeof value.d === "string" ? value.d : typeof value.directions === "string" ? value.directions : "";
    const sourceDirections = encoded ? [...encoded].map((direction) => CODE_DIRECTIONS[direction]) : value.directions;
    const directions = (Array.isArray(sourceDirections) ? sourceDirections : [])
      .filter((direction) => GHOST_DIRECTIONS.has(direction)).slice(0, MAX_GHOST_DASHES);
    if (!directions.length) return null;
    const completionTime = Number(value.completionTime ?? value.time ?? value.c);
    return [key, {
      directions,
      timings: [],
      totalDashes: directions.length,
      completionTime: Number.isFinite(completionTime) && completionTime > 0 ? Math.min(99999, completionTime) : 0,
    }];
  }).filter(Boolean));
}

function chooseBestGhost(first, second) {
  if (!first) return second;
  if (!second) return first;
  if (first.totalDashes !== second.totalDashes) return first.totalDashes < second.totalDashes ? first : second;
  const firstTime = first.completionTime || Number.POSITIVE_INFINITY;
  const secondTime = second.completionTime || Number.POSITIVE_INFINITY;
  return firstTime <= secondTime ? first : second;
}

export function levelRevision(level) {
  return Math.max(1, integer(level?.revision, 1, 10000));
}

export function levelRecord(save, level) {
  const id = level?.id;
  const revision = levelRevision(level);
  const compatible = recordRevision(save, id) === revision;
  return {
    revision,
    compatible,
    bestDashes: compatible ? save?.bestDashes?.[id] : undefined,
    bestTime: compatible ? save?.bestTimes?.[id] : undefined,
    ghost: compatible ? save?.routeGhosts?.[id] || null : null,
  };
}

export function createDefaultSave() {
  return {
    version: CONFIG.saveVersion,
    unlockedLevel: 1,
    completed: {},
    cores: {},
    bestDots: {},
    bestTimes: {},
    bestDashes: {},
    levelRevisions: {},
    coins: 0,
    vaultCoins: 0,
    ownedSkins: ["spark"],
    equippedSkin: "spark",
    chestSerial: 0,
    vaultChestSerial: 0,
    milestoneRewards: {},
    sectorRewards: {},
    mission: { day: "", type: "", target: 0, progress: 0, claimed: false },
    dailyScores: {},
    secretRewards: {},
    rewardLog: [],
    analytics: { events: {}, levels: {} },
    tutorialDone: false,
    tutorialSeen: {},
    sectorSeen: {},
    favoriteSkins: [],
    vaultRush: { bestScore: 0, runs: 0, rooms: 0, bestStreak: 0, deaths: 0, dots: 0 },
    routeGhosts: {},
    rewardedDay: "",
    rewardedCount: 0,
    stats: { deaths: 0, dashes: 0, dots: 0, coins: 0, completions: 0, perfects: 0, streak: 0, bestStreak: 0 },
    settings: { language: null, languagePlatform: null, music: true, sound: true, musicVolume: 65, soundVolume: 80, swipeSensitivity: "normal", reducedMotion: false, haptics: true, personalGhost: true },
    updatedAt: Date.now(),
  };
}

export function normalizeSave(raw) {
  const base = createDefaultSave();
  const source = object(raw);
  const settings = object(source.settings);
  const stats = object(source.stats);
  const knownSkins = new Set(SKINS.map((skin) => skin.id));
  const ownedSkins = [...new Set(Array.isArray(source.ownedSkins) ? source.ownedSkins.filter((id) => knownSkins.has(id)) : [])];
  if (ownedSkins.indexOf("spark") < 0) ownedSkins.unshift("spark");
  const equipped = knownSkins.has(source.equippedSkin) && ownedSkins.indexOf(source.equippedSkin) >= 0 ? source.equippedSkin : "spark";
  const completed = fromEntries(objectEntries(object(source.completed))
    .filter(([key, value]) => integer(key) >= 1 && integer(key) <= CONFIG.maxLevels && Boolean(value))
    .map(([key]) => [key, true]));
  const cores = fromEntries(objectEntries(object(source.cores))
    .filter(([key]) => integer(key) >= 1 && integer(key) <= CONFIG.maxLevels)
    .map(([key, value]) => [key, integer(value, 0, 3)]));
  const bestDots = fromEntries(objectEntries(object(source.bestDots))
    .filter(([key]) => integer(key) >= 1 && integer(key) <= CONFIG.maxLevels)
    .map(([key, value]) => [key, integer(value, 0, 10000)]));
  const bestTimes = fromEntries(objectEntries(object(source.bestTimes))
    .filter(([key, value]) => integer(key) >= 1 && integer(key) <= CONFIG.maxLevels && Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([key, value]) => [key, Math.min(99999, Number(value))]));
  const bestDashes = fromEntries(objectEntries(object(source.bestDashes))
    .filter(([key, value]) => integer(key) >= 1 && integer(key) <= CONFIG.maxLevels && integer(value) > 0)
    .map(([key, value]) => [key, integer(value, 1, 10000)]));
  const levelRevisions = fromEntries(objectEntries(object(source.levelRevisions))
    .filter(([key, value]) => integer(key) >= 1 && integer(key) <= CONFIG.maxLevels && integer(value) >= 2)
    .map(([key, value]) => [key, integer(value, 2, 10000)]));
  const tutorialSeen = fromEntries(objectEntries(object(source.tutorialSeen))
    .filter(([key, value]) => /^[a-z][a-zA-Z0-9]{1,31}$/.test(key) && Boolean(value))
    .slice(0, 40).map(([key]) => [key, true]));
  const sectorSeen = fromEntries(objectEntries(object(source.sectorSeen))
    .filter(([key, value]) => /^\d+$/.test(key) && Number(key) >= 0 && Number(key) <= 12 && Boolean(value))
    .map(([key]) => [key, true]));
  const favoriteSkins = [...new Set(Array.isArray(source.favoriteSkins) ? source.favoriteSkins.filter((id) => knownSkins.has(id)) : [])].slice(0, SKINS.length);
  const rush = object(source.vaultRush);
  const dailyScores = fromEntries(objectEntries(object(source.dailyScores))
    .filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .sort(([left], [right]) => right.localeCompare(left)).slice(0, MAX_DAILY_DAYS)
    .map(([day, entries]) => [day, (Array.isArray(entries) ? entries : []).map((entry) => ({
      score: integer(entry?.score, 0, 100000000),
      time: Number.isFinite(Number(entry?.time)) ? Math.max(0, Number(entry.time)) : 0,
      cores: integer(entry?.cores, 0, 3),
      at: integer(entry?.at, Date.now()),
    })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 10)]));
  const rewardTypes = new Set(["level", "ad", "milestone", "sector", "daily", "mission", "secret"]);
  const rewardLog = (Array.isArray(source.rewardLog) ? source.rewardLog : []).filter((entry) => rewardTypes.has(entry?.type)).map((entry) => ({
    type: entry.type,
    coins: integer(entry?.coins, 0, 100000000),
    vaultCoins: integer(entry?.vaultCoins, 0, 1000000),
    at: integer(entry?.at, Date.now()),
  })).filter((entry) => entry.coins || entry.vaultCoins).sort((a, b) => b.at - a.at).slice(0, 20);
  const secretRewards = fromEntries(objectEntries(object(source.secretRewards))
    .filter(([key, value]) => /^(?:level|daily):[\w-]{1,64}:[\w,-]{1,64}$/.test(key) && Boolean(value))
    .slice(0, 500).map(([key]) => [key, true]));
  const eventCounts = fromEntries(objectEntries(object(source.analytics?.events))
    .filter(([key, value]) => /^[a-z][a-z0-9_]{1,40}$/.test(key) && Number.isFinite(Number(value)))
    .slice(0, 80).map(([key, value]) => [key, integer(value, 0, 100000000)]));
  const levelAnalytics = fromEntries(objectEntries(object(source.analytics?.levels))
    .filter(([key, value]) => integer(key) >= 1 && integer(key) <= CONFIG.maxLevels && object(value))
    .slice(0, CONFIG.maxLevels).map(([key, value]) => [key, {
      attempts: integer(value.attempts, 0, 1000000), wins: integer(value.wins, 0, 1000000), deaths: integer(value.deaths, 0, 1000000),
      dashes: integer(value.dashes, 0, 10000000), restarts: integer(value.restarts, 0, 1000000),
    }]));

  return {
    ...base,
    version: CONFIG.saveVersion,
    unlockedLevel: Math.max(1, integer(source.unlockedLevel, 1, CONFIG.maxLevels)),
    completed,
    cores,
    bestDots,
    bestTimes,
    bestDashes,
    levelRevisions,
    coins: integer(source.coins, 0, 100000000),
    vaultCoins: integer(source.vaultCoins, 0, 1000000),
    ownedSkins,
    equippedSkin: equipped,
    chestSerial: integer(source.chestSerial, 0, 10000),
    vaultChestSerial: integer(source.vaultChestSerial, 0, 10000),
    milestoneRewards: fromEntries(objectEntries(object(source.milestoneRewards))
      .filter(([key, value]) => integer(key) >= 5 && integer(key) <= CONFIG.maxLevels && integer(key) % 5 === 0 && Boolean(value))
      .map(([key]) => [key, true])),
    sectorRewards: fromEntries(objectEntries(object(source.sectorRewards))
      .filter(([key, value]) => integer(key) >= 20 && integer(key) <= CONFIG.maxLevels && integer(key) % 20 === 0 && Boolean(value))
      .map(([key]) => [key, true])),
    mission: {
      day: typeof source.mission?.day === "string" ? source.mission.day : "",
      type: MISSION_TYPES.has(source.mission?.type) ? source.mission.type : "",
      target: integer(source.mission?.target, 0, 10000),
      progress: integer(source.mission?.progress, 0, 10000),
      claimed: boolean(source.mission?.claimed, false),
    },
    dailyScores,
    secretRewards,
    rewardLog,
    analytics: { events: eventCounts, levels: levelAnalytics },
    tutorialDone: boolean(source.tutorialDone, false),
    tutorialSeen,
    sectorSeen,
    favoriteSkins,
    vaultRush: {
      bestScore: integer(rush.bestScore, 0, 1000000000),
      runs: integer(rush.runs, 0, 100000000),
      rooms: integer(rush.rooms, 0, 100000000),
      bestStreak: integer(rush.bestStreak, 0, 1000000),
      deaths: integer(rush.deaths, 0, 100000000),
      dots: integer(rush.dots, 0, 1000000000),
    },
    routeGhosts: normalizeRouteGhosts(source.routeGhosts),
    rewardedDay: typeof source.rewardedDay === "string" ? source.rewardedDay : "",
    rewardedCount: integer(source.rewardedCount, 0, 5),
    stats: fromEntries(Object.keys(base.stats).map((key) => [key, integer(stats[key], 0, 100000000)])),
    settings: {
      language: settings.language === "ru" || settings.language === "en" ? settings.language : null,
      languagePlatform: settings.languagePlatform === "ru" || settings.languagePlatform === "en" ? settings.languagePlatform : null,
      music: boolean(settings.music, true),
      sound: boolean(settings.sound, true),
      musicVolume: integer(settings.musicVolume, 65, 100),
      soundVolume: integer(settings.soundVolume, 80, 100),
      swipeSensitivity: SWIPE_SENSITIVITIES.has(settings.swipeSensitivity) ? settings.swipeSensitivity : "normal",
      reducedMotion: boolean(settings.reducedMotion, false),
      haptics: boolean(settings.haptics, true),
      personalGhost: boolean(settings.personalGhost, true),
    },
    updatedAt: integer(source.updatedAt, base.updatedAt),
  };
}

export function loadLocalSave(storage = localStorage) {
  try {
    const raw = storage.getItem(CONFIG.saveKey);
    const parsed = raw ? JSON.parse(raw) : null;
    const known = createDefaultSave();
    const present = Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed)
      && Object.keys(parsed).some((key) => key !== "version" && key !== "updatedAt" && key in known));
    return { save: normalizeSave(parsed), recovered: false, present };
  } catch {
    return { save: createDefaultSave(), recovered: true, present: false };
  }
}

export function writeLocalSave(save, storage = localStorage) {
  const normalized = normalizeSave({ ...save, updatedAt: Date.now() });
  storage.setItem(CONFIG.saveKey, JSON.stringify(compactSave(normalized)));
  return normalized;
}

export function compactSave(save) {
  return {
    ...save,
    routeGhosts: fromEntries(objectEntries(save.routeGhosts || {}).map(([id, route]) => [id, {
      d: route.directions.map((direction) => DIRECTION_CODES[direction]).join(""),
      c: route.completionTime || 0,
    }])),
  };
}

export function mergeSaves(localRaw, cloudRaw) {
  const local = normalizeSave(localRaw);
  const cloud = normalizeSave(cloudRaw);
  // Consumable balances must stay together with the spend counters from the
  // newest snapshot; merging them independently can resurrect spent currency.
  const localSource = object(localRaw);
  const cloudSource = object(cloudRaw);
  const localTime = Number.isFinite(Number(localSource.updatedAt)) && Number(localSource.updatedAt) > 0 ? Number(localSource.updatedAt) : 0;
  const cloudTime = Number.isFinite(Number(cloudSource.updatedAt)) && Number(cloudSource.updatedAt) > 0 ? Number(cloudSource.updatedAt) : 0;
  const localHasData = Object.keys(localSource).some((key) => key !== "version" && key !== "updatedAt");
  const cloudHasData = Object.keys(cloudSource).some((key) => key !== "version" && key !== "updatedAt");
  const primary = cloudTime > localTime || (cloudTime === localTime && !localHasData && cloudHasData) ? cloud : local;
  const secondary = primary === local ? cloud : local;
  const stats = fromEntries(Object.keys(primary.stats).map((key) => [key, Math.max(primary.stats[key], secondary.stats[key])]));
  const levelKeys = [...new Set([...Object.keys(primary.cores), ...Object.keys(secondary.cores)])];
  const dotKeys = [...new Set([...Object.keys(primary.bestDots), ...Object.keys(secondary.bestDots)])];
  const recordKeys = [...new Set([
    ...Object.keys(primary.bestTimes), ...Object.keys(secondary.bestTimes),
    ...Object.keys(primary.bestDashes), ...Object.keys(secondary.bestDashes),
    ...Object.keys(primary.routeGhosts), ...Object.keys(secondary.routeGhosts),
    ...Object.keys(primary.levelRevisions), ...Object.keys(secondary.levelRevisions),
  ])];
  const records = recordKeys.map((key) => {
    const revision = Math.max(recordRevision(primary, key), recordRevision(secondary, key));
    const sources = [primary, secondary].filter((candidate) => recordRevision(candidate, key) === revision);
    const times = sources.map((candidate) => candidate.bestTimes[key]).filter((value) => Number.isFinite(value) && value > 0);
    const dashes = sources.map((candidate) => candidate.bestDashes[key]).filter((value) => Number.isFinite(value) && value > 0);
    return {
      key, revision,
      bestTime: times.length ? Math.min(...times) : 0,
      bestDashes: dashes.length ? Math.min(...dashes) : 0,
      ghost: sources.map((candidate) => candidate.routeGhosts[key]).reduce(chooseBestGhost, null),
    };
  });
  return normalizeSave({
    ...primary,
    unlockedLevel: Math.max(primary.unlockedLevel, secondary.unlockedLevel),
    completed: { ...secondary.completed, ...primary.completed },
    cores: fromEntries(levelKeys.map((key) => [key, Math.max(primary.cores[key] || 0, secondary.cores[key] || 0)])),
    bestDots: fromEntries(dotKeys.map((key) => [key, Math.max(primary.bestDots[key] || 0, secondary.bestDots[key] || 0)])),
    bestTimes: fromEntries(records.filter((record) => record.bestTime).map((record) => [record.key, record.bestTime])),
    bestDashes: fromEntries(records.filter((record) => record.bestDashes).map((record) => [record.key, record.bestDashes])),
    levelRevisions: fromEntries(records.filter((record) => record.revision > 1).map((record) => [record.key, record.revision])),
    coins: primary.coins,
    vaultCoins: primary.vaultCoins,
    chestSerial: primary.chestSerial,
    vaultChestSerial: primary.vaultChestSerial,
    ownedSkins: [...new Set([...primary.ownedSkins, ...secondary.ownedSkins])],
    stats,
    tutorialDone: primary.tutorialDone || secondary.tutorialDone,
    tutorialSeen: { ...secondary.tutorialSeen, ...primary.tutorialSeen },
    sectorSeen: { ...secondary.sectorSeen, ...primary.sectorSeen },
    favoriteSkins: primary.favoriteSkins,
    settings: primary.settings,
    equippedSkin: primary.equippedSkin,
    mission: primary.mission,
    rewardedDay: primary.rewardedDay,
    rewardedCount: primary.rewardedCount,
    milestoneRewards: { ...secondary.milestoneRewards, ...primary.milestoneRewards },
    sectorRewards: { ...secondary.sectorRewards, ...primary.sectorRewards },
    dailyScores: fromEntries(objectEntries({ ...secondary.dailyScores, ...primary.dailyScores }).map(([day, entries]) => [day,
      [...(secondary.dailyScores[day] || []), ...(primary.dailyScores[day] || [])]
        .sort((a, b) => b.score - a.score).slice(0, 10)])),
    secretRewards: { ...secondary.secretRewards, ...primary.secretRewards },
    analytics: {
      events: fromEntries([...new Set([...Object.keys(primary.analytics.events), ...Object.keys(secondary.analytics.events)])]
        .map((key) => [key, Math.max(primary.analytics.events[key] || 0, secondary.analytics.events[key] || 0)])),
      levels: fromEntries([...new Set([...Object.keys(primary.analytics.levels), ...Object.keys(secondary.analytics.levels)])]
        .map((key) => [key, fromEntries(["attempts", "wins", "deaths", "dashes", "restarts"].map((metric) => [metric, Math.max(primary.analytics.levels[key]?.[metric] || 0, secondary.analytics.levels[key]?.[metric] || 0)]))])),
    },
    rewardLog: [...(secondary.rewardLog || []), ...(primary.rewardLog || [])]
      .sort((a, b) => b.at - a.at).slice(0, 20),
    vaultRush: {
      bestScore: Math.max(primary.vaultRush.bestScore, secondary.vaultRush.bestScore),
      runs: Math.max(primary.vaultRush.runs, secondary.vaultRush.runs),
      rooms: Math.max(primary.vaultRush.rooms, secondary.vaultRush.rooms),
      bestStreak: Math.max(primary.vaultRush.bestStreak, secondary.vaultRush.bestStreak),
      deaths: Math.max(primary.vaultRush.deaths, secondary.vaultRush.deaths),
      dots: Math.max(primary.vaultRush.dots, secondary.vaultRush.dots),
    },
    routeGhosts: fromEntries(records.filter((record) => record.ghost).map((record) => [record.key, record.ghost])),
    updatedAt: Math.max(primary.updatedAt, secondary.updatedAt),
  });
}
