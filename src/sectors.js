const NAMES = ["zoneBlue", "zoneEmber", "zoneVerdant", "zoneViolet", "zoneCrimson", "zoneFrost", "zoneGold", "zoneRose", "zoneAqua", "zoneMagma", "zoneIndigo", "zoneToxic", "zoneCore"];

export const SECTORS = Object.freeze(NAMES.map((nameKey, index) => Object.freeze({
  index,
  number: index + 1,
  start: index * 20 + 1,
  end: Math.min(250, index * 20 + 20),
  nameKey,
  lineKey: `sectorLine${index}`,
  signatureKey: `sectorSignature${index}`,
})));

export function sectorForLevel(level) {
  return SECTORS[Math.min(12, Math.floor((Math.max(1, Math.floor(Number(level) || 1)) - 1) / 20))];
}

export function isSectorStart(level) {
  return sectorForLevel(level).start === Number(level);
}

export function isSectorCore(level) {
  const id = Number(level);
  return id >= 20 && id <= 240 && id % 20 === 0;
}
