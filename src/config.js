export const CONFIG = Object.freeze({
  maxLevels: 250,
  playerSpeed: 20,
  swipeThreshold: 18,
  deathDelay: 430,
  hintDelay: 6,
  chestBasePrice: 160,
  chestPriceStep: 15,
  vaultChestBasePrice: 20,
  rewardedCoins: 50,
  milestoneRewardCoins: 100,
  milestoneRewardVaultCoins: 2,
  sectorRewardCoins: 250,
  sectorRewardVaultCoins: 5,
  dailyRewardCoins: 75,
  dailyRewardVaultCoins: 1,
  secretRewardCoins: 35,
  secretBoostSeconds: 8,
  dailyLeaderboard: "neonvaultsdaily",
  rushLeaderboard: "neonvaultsrush",
  interstitialEvery: 5,
  cloudSaveDelay: 4000,
  saveKey: "neon-vaults-save-v1",
  saveVersion: 3,
  colors: {
    background: "#05060d",
    floor: "#0b1020",
    wall: "#17264a",
    wallEdge: "#24d8ff",
    cyan: "#36e4ff",
    yellow: "#ffe45c",
    magenta: "#ff4bd8",
    lime: "#79ff87",
    orange: "#ff8a4c",
    violet: "#9b7bff",
  },
});

export const LEVEL_THEMES = Object.freeze([
  { id: "blue", nameKey: "zoneBlue", bg: "#050917", center: "#0e2048", floorA: "#0b142b", floorB: "#0e1932", wall: "#172b55", edge: "#36e4ff", accent: "#9b7bff" },
  { id: "ember", nameKey: "zoneEmber", bg: "#130806", center: "#492011", floorA: "#26120c", floorB: "#31170e", wall: "#552816", edge: "#ff9a4c", accent: "#ffe45c" },
  { id: "verdant", nameKey: "zoneVerdant", bg: "#03110d", center: "#123d2e", floorA: "#09251d", floorB: "#0c2e23", wall: "#174b37", edge: "#58ffb2", accent: "#d5ff5c" },
  { id: "violet", nameKey: "zoneViolet", bg: "#0b0615", center: "#321957", floorA: "#1a102d", floorB: "#211438", wall: "#42266d", edge: "#bc7dff", accent: "#ff63d7" },
  { id: "crimson", nameKey: "zoneCrimson", bg: "#130509", center: "#4a1222", floorA: "#280b14", floorB: "#33101a", wall: "#5c1c2d", edge: "#ff5d76", accent: "#ffb04f" },
  { id: "frost", nameKey: "zoneFrost", bg: "#041015", center: "#143b4b", floorA: "#09232c", floorB: "#0c2d38", wall: "#194d5f", edge: "#a5f3ff", accent: "#6f9dff" },
  { id: "gold", nameKey: "zoneGold", bg: "#120e03", center: "#493a0d", floorA: "#282008", floorB: "#33290b", wall: "#594713", edge: "#ffe45c", accent: "#ff8a4c" },
  { id: "rose", nameKey: "zoneRose", bg: "#120510", center: "#471541", floorA: "#290d25", floorB: "#33102f", wall: "#5a2053", edge: "#ff68dc", accent: "#a879ff" },
  { id: "aqua", nameKey: "zoneAqua", bg: "#031013", center: "#0c4147", floorA: "#07262a", floorB: "#093036", wall: "#14545c", edge: "#4ffff2", accent: "#55a8ff" },
  { id: "magma", nameKey: "zoneMagma", bg: "#140703", center: "#50200c", floorA: "#2c1108", floorB: "#37170a", wall: "#612d13", edge: "#ff6b35", accent: "#ffd13d" },
  { id: "indigo", nameKey: "zoneIndigo", bg: "#060719", center: "#171d58", floorA: "#0d1230", floorB: "#11163c", wall: "#252e70", edge: "#788cff", accent: "#44e7ff" },
  { id: "toxic", nameKey: "zoneToxic", bg: "#071003", center: "#263f0b", floorA: "#152407", floorB: "#1b2d09", wall: "#354f14", edge: "#adff4f", accent: "#ffe45c" },
  { id: "core", nameKey: "zoneCore", bg: "#0a0611", center: "#35184a", floorA: "#1b1027", floorB: "#241431", wall: "#43235b", edge: "#ffffff", accent: "#36e4ff" },
]);

export function themeForLevel(level) {
  return LEVEL_THEMES[Math.min(LEVEL_THEMES.length - 1, Math.floor((Math.max(1, level) - 1) / 20))];
}

export function levelKindFor(level) {
  if (level === 1) return "tutorial";
  if (level % 20 === 0) return "sector";
  if (level % 5 === 0) return "challenge";
  return "standard";
}

export function routeMoveTarget(level) {
  if (level <= 1) return 2;
  let target;
  if (level <= 10) target = 3 + Math.floor((level - 2) / 3);
  else if (level <= 20) target = 6 + Math.floor((level - 11) / 3);
  else if (level <= 50) target = 9 + Math.floor((level - 21) / 10);
  else if (level <= 100) target = 12 + Math.floor((level - 51) / 10);
  else if (level <= 150) target = 17 + Math.floor((level - 101) / 10);
  else if (level <= 200) target = 22 + Math.floor((level - 151) / 10);
  else target = 27 + Math.floor((level - 201) / 8);
  return target + (level % 20 === 0 ? 5 : level % 5 === 0 ? 2 : 0);
}

export const DIRECTIONS = Object.freeze({
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
});

export const KEY_DIRECTIONS = Object.freeze({
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
});
