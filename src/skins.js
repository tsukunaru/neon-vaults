import { CONFIG } from "./config.js";

const SKIN_DATA = [
  ["spark", "#36e4ff", "#ffffff", "common", "core", "halo", "starter"],
  ["lime", "#79ff87", "#eaffb8", "common", "core", "motes", "regular"],
  ["crimson", "#ff526d", "#ffd1d8", "common", "cube", "embers", "regular"],
  ["ice", "#8be9ff", "#dffaff", "common", "diamond", "snow", "regular"],
  ["sunset", "#ff8a4c", "#ff4bd8", "common", "split", "sunrays", "regular"],
  ["circuit", "#35f2b0", "#b8fff0", "rare", "circuit", "circuits", "regular"],
  ["retro", "#b8ff60", "#ecffc8", "rare", "screen", "scanline", "regular"],
  ["ghost", "#c5b4ff", "#ffffff", "rare", "ghost", "wisps", "regular"],
  ["electric", "#ffe45c", "#36e4ff", "rare", "bolt", "bolts", "regular"],
  ["plasma", "#ff4bd8", "#c8a7ff", "rare", "orb", "orbs", "regular"],
  ["glitch", "#ff3f81", "#36e4ff", "rare", "glitch", "glitches", "regular"],
  ["gold", "#ffd23f", "#fff3a8", "epic", "crown", "crown", "vault"],
  ["bubble", "#58c8ff", "#e7fbff", "rare", "bubble", "bubbles", "regular"],
  ["prism", "#e6f4ff", "#ff4bd8", "epic", "prism", "facets", "vault"],
  ["void", "#563b85", "#d5b7ff", "epic", "void", "vortex", "vault"],
  ["arcade", "#ffed4a", "#ff4a82", "rare", "arcade", "pixels", "regular"],
  ["geocat", "#ffb45c", "#fff0cf", "epic", "ears", "whiskers", "regular"],
  ["robot", "#a9becf", "#ff605c", "rare", "robot", "antenna", "regular"],
  ["eye", "#36e4ff", "#ff4bd8", "epic", "eye", "iris", "vault"],
  ["ufo", "#84ffbf", "#d6c6ff", "epic", "ufo", "beam", "vault"],
  ["crystal", "#9eeeff", "#d8c6ff", "epic", "crystal", "shards", "vault"],
  ["lava", "#ff5d32", "#ffea7a", "epic", "lava", "sparks", "vault"],
  ["flower", "#ff70ce", "#b6ffd0", "epic", "flower", "petals", "vault"],
  ["star", "#fff16b", "#ffb54f", "epic", "star", "twinkles", "vault"],
  ["matrix", "#4cff64", "#c9ffd0", "rare", "matrix", "rain", "regular"],
  ["candy", "#ff7ac8", "#7ae8ff", "rare", "split", "sprinkles", "regular"],
  ["frost", "#d6f7ff", "#5dbbff", "epic", "frost", "frostRing", "regular"],
  ["rainbow", "#ff5e7a", "#61e8ff", "legendary", "rainbow", "rainbowArc", "vault"],
  ["obsidian", "#5a4d78", "#f2eaff", "legendary", "obsidian", "eclipse", "vault"],
  ["singularity", "#ffffff", "#8a4dff", "legendary", "singularity", "lens", "vault"],
  ["architect", "#ffe45c", "#36e4ff", "legendary", "architect", "runes", "final"],
];

const SECTOR_SKIN_DATA = [
  ["sigil-blue", "#36e4ff", "#9b7bff", "epic", "sigil", "sigilBlue", "sector", 0],
  ["sigil-ember", "#ff9a4c", "#ffe45c", "epic", "sigil", "sigilEmber", "sector", 1],
  ["sigil-verdant", "#58ffb2", "#d5ff5c", "epic", "sigil", "sigilVerdant", "sector", 2],
  ["sigil-violet", "#bc7dff", "#ff63d7", "epic", "sigil", "sigilViolet", "sector", 3],
  ["sigil-crimson", "#ff5d76", "#ffb04f", "epic", "sigil", "sigilCrimson", "sector", 4],
  ["sigil-frost", "#a5f3ff", "#6f9dff", "epic", "sigil", "sigilFrost", "sector", 5],
  ["sigil-gold", "#ffe45c", "#ff8a4c", "epic", "sigil", "sigilGold", "sector", 6],
  ["sigil-rose", "#ff68dc", "#a879ff", "epic", "sigil", "sigilRose", "sector", 7],
  ["sigil-aqua", "#4ffff2", "#55a8ff", "epic", "sigil", "sigilAqua", "sector", 8],
  ["sigil-magma", "#ff6b35", "#ffd13d", "epic", "sigil", "sigilMagma", "sector", 9],
  ["sigil-indigo", "#788cff", "#44e7ff", "epic", "sigil", "sigilIndigo", "sector", 10],
  ["sigil-toxic", "#adff4f", "#ffe45c", "epic", "sigil", "sigilToxic", "sector", 11],
  ["sigil-core", "#ffffff", "#36e4ff", "legendary", "sigil", "sigilCore", "sector", 12],
];

export const SKINS = SKIN_DATA.map(([id, primary, secondary, rarity, pattern, effect, pool], index) => ({
  id, nameKey: `skin.${id}`, primary, secondary, rarity, pattern, effect, pool, index, finalOnly: pool === "final",
})).concat(SECTOR_SKIN_DATA.map(([id, primary, secondary, rarity, pattern, effect, pool, sector], index) => ({
  id, nameKey: `skin.${id}`, primary, secondary, rarity, pattern, effect, pool, sector, sectorOnly: true, index: SKIN_DATA.length + index, finalOnly: false,
})));

export function regularChestPrice(ownedCount) {
  return 160 + Math.max(0, ownedCount - 1) * 15;
}

export function vaultChestPrice(ownedCount) {
  return CONFIG.vaultChestBasePrice + Math.max(0, ownedCount);
}

export function nextChestSkin(ownedIds, serial = 0, poolName = "regular") {
  const owned = new Set(ownedIds);
  const pool = SKINS.filter((skin) => skin.pool === poolName && !owned.has(skin.id));
  if (!pool.length) return null;
  return pool[(serial * 7 + 3) % pool.length];
}

export function drawSkin(ctx, skin, x, y, size, time = 0, alpha = 1) {
  const unit = size / 8;
  const pulse = 1 + Math.sin(time * 0.006) * 0.04;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  ctx.shadowBlur = size * 0.65;
  ctx.shadowColor = skin.primary;
  ctx.fillStyle = skin.primary;
  const s = size * 0.72;
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.shadowBlur = 0;
  ctx.fillStyle = skin.secondary;

  if (["diamond", "crystal", "prism"].indexOf(skin.pattern) !== -1) {
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-s * 0.28, -s * 0.28, s * 0.56, s * 0.56);
    ctx.rotate(-Math.PI / 4);
  } else if (skin.pattern === "split" || skin.pattern === "rainbow") {
    ctx.fillRect(0, -s / 2, s / 2, s);
  } else if (skin.pattern === "ears") {
    ctx.beginPath(); ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(-s * 0.38, -s * 0.85); ctx.lineTo(-s * 0.1, -s / 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(s / 2, -s / 2); ctx.lineTo(s * 0.38, -s * 0.85); ctx.lineTo(s * 0.1, -s / 2); ctx.fill();
  } else if (skin.pattern === "orb" || skin.pattern === "bubble" || skin.pattern === "singularity") {
    ctx.beginPath(); ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2); ctx.fill();
  } else if (skin.pattern === "star") {
    ctx.translate(0, -unit * 0.1); ctx.rotate(Math.PI / 4); ctx.fillRect(-unit, -unit, unit * 2, unit * 2); ctx.rotate(-Math.PI / 4);
  } else {
    ctx.fillRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6);
  }

  ctx.fillStyle = "#07111e";
  ctx.fillRect(-unit * 2.15, -unit * 0.8, unit * 1.35, unit * 1.6);
  ctx.fillRect(unit * 0.8, -unit * 0.8, unit * 1.35, unit * 1.6);
  ctx.fillStyle = "#fff";
  ctx.fillRect(-unit * 1.7, -unit * 0.55, unit * 0.55, unit * 0.7);
  ctx.fillRect(unit * 1.15, -unit * 0.55, unit * 0.55, unit * 0.7);
  ctx.restore();
}

export function drawSkinEffect(ctx, skin, x, y, size, time = 0, moving = false) {
  const phase = time * 0.001;
  const radius = size * 0.62;
  const dot = (angle, distance, color = skin.secondary, scale = 0.08) => {
    const px = Math.cos(angle) * distance; const py = Math.sin(angle) * distance;
    ctx.fillStyle = color; ctx.fillRect(px - size * scale / 2, py - size * scale / 2, size * scale, size * scale);
  };
  const ring = (distance, color = skin.secondary, width = 0.045) => {
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, size * width); ctx.strokeRect(-distance, -distance, distance * 2, distance * 2);
  };
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = 0.72; ctx.shadowBlur = size * 0.35; ctx.shadowColor = skin.primary;
  switch (skin.effect) {
    case "halo": ring(radius * (0.92 + Math.sin(phase * 4) * 0.08), skin.primary); break;
    case "motes": for (let i = 0; i < 5; i += 1) dot(phase * 1.8 + i * 1.25, radius, "#b8ff72", 0.07); break;
    case "embers": for (let i = 0; i < 5; i += 1) dot(i * 1.6, radius * 0.55 + ((phase * 23 + i * 11) % 18) / 18 * radius, i % 2 ? "#ffb13d" : "#ff526d", 0.065); break;
    case "snow": for (let i = 0; i < 6; i += 1) { ctx.save(); ctx.rotate(phase + i); dot(0, radius, "#e9fcff", 0.075); ctx.restore(); } break;
    case "sunrays": for (let i = 0; i < 8; i += 1) { const a = i * Math.PI / 4 + phase * 0.2; ctx.strokeStyle = i % 2 ? "#ff4bd8" : "#ffb34c"; ctx.lineWidth = size * 0.045; ctx.beginPath(); ctx.moveTo(Math.cos(a) * radius * 0.65, Math.sin(a) * radius * 0.65); ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius); ctx.stroke(); } break;
    case "circuits": ctx.strokeStyle = "#65ffd0"; ctx.lineWidth = size * 0.045; ctx.strokeRect(-radius, -radius * 0.72, radius * 0.35, radius * 0.35); ctx.strokeRect(radius * 0.65, radius * 0.25, radius * 0.35, radius * 0.35); dot(phase, radius, "#fff", 0.06); break;
    case "scanline": ctx.strokeStyle = "#caff82"; ctx.lineWidth = size * 0.035; for (let i = -2; i <= 2; i += 1) { const py = ((phase * 45 + i * size * 0.28) % (size * 1.4)) - size * 0.7; ctx.beginPath(); ctx.moveTo(-radius, py); ctx.lineTo(radius, py); ctx.stroke(); } break;
    case "wisps": ctx.strokeStyle = "#e5ddff"; ctx.lineWidth = size * 0.05; for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.arc(0, i * size * 0.14, radius * (0.7 + i * 0.12), phase + i, phase + i + 1.5); ctx.stroke(); } break;
    case "bolts": ctx.strokeStyle = "#fff56b"; ctx.lineWidth = size * 0.06; ctx.beginPath(); ctx.moveTo(-radius, -radius * 0.5); ctx.lineTo(-radius * 0.45, -radius * 0.15); ctx.lineTo(-radius * 0.75, radius * 0.12); ctx.lineTo(-radius * 0.2, radius * 0.5); ctx.stroke(); dot(phase * 5, radius, "#36e4ff", 0.08); break;
    case "orbs": for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.fillStyle = i % 2 ? "#ff9aeb" : "#b587ff"; ctx.arc(Math.cos(phase * 1.6 + i * 2.1) * radius, Math.sin(phase * 1.6 + i * 2.1) * radius, size * 0.08, 0, Math.PI * 2); ctx.fill(); } break;
    case "glitches": ctx.globalCompositeOperation = "lighter"; dot(0, radius + Math.sin(phase * 19) * size * 0.18, "#ff3f81", 0.14); dot(Math.PI, radius + Math.cos(phase * 17) * size * 0.18, "#36e4ff", 0.14); break;
    case "crown": for (let i = -2; i <= 2; i += 1) dot(-Math.PI / 2 + i * 0.18, radius * (1 + Math.abs(i) * 0.05), "#fff3a8", 0.085); break;
    case "bubbles": for (let i = 0; i < 5; i += 1) { const a = phase * 0.7 + i * 1.35; ctx.strokeStyle = "#dffaff"; ctx.lineWidth = size * 0.025; ctx.beginPath(); ctx.arc(Math.cos(a) * radius, Math.sin(a) * radius, size * (0.045 + i * 0.008), 0, Math.PI * 2); ctx.stroke(); } break;
    case "facets": for (let i = 0; i < 4; i += 1) { const a = phase + i * Math.PI / 2; ctx.fillStyle = i % 2 ? "#ff71df" : "#b8f7ff"; ctx.beginPath(); ctx.moveTo(Math.cos(a) * radius, Math.sin(a) * radius); ctx.lineTo(Math.cos(a + 0.22) * radius * 0.7, Math.sin(a + 0.22) * radius * 0.7); ctx.lineTo(Math.cos(a - 0.22) * radius * 0.7, Math.sin(a - 0.22) * radius * 0.7); ctx.fill(); } break;
    case "vortex": for (let i = 0; i < 7; i += 1) dot(phase * 1.9 + i * 0.9, radius * (0.45 + i * 0.07), "#cba7ff", 0.055); break;
    case "pixels": for (let i = 0; i < 6; i += 1) dot(i * Math.PI / 3 + Math.floor(phase * 4) * 0.2, radius, i % 2 ? "#ff4a82" : "#ffed4a", 0.085); break;
    case "whiskers": ctx.strokeStyle = "#fff0cf"; ctx.lineWidth = size * 0.035; for (const side of [-1, 1]) for (const tilt of [-0.2, 0.2]) { ctx.beginPath(); ctx.moveTo(side * size * 0.28, size * 0.04); ctx.lineTo(side * radius, size * tilt); ctx.stroke(); } break;
    case "antenna": ctx.strokeStyle = "#ff8b89"; ctx.lineWidth = size * 0.045; ctx.beginPath(); ctx.arc(0, -radius * 0.25, radius * 0.7, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -radius * 0.2, radius, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); break;
    case "iris": ctx.strokeStyle = "#ff76df"; ctx.lineWidth = size * 0.055; ctx.beginPath(); ctx.ellipse(0, 0, radius, radius * 0.48, phase * 0.3, 0, Math.PI * 2); ctx.stroke(); dot(phase * 2, radius * 0.85, "#36e4ff", 0.07); break;
    case "beam": ctx.fillStyle = "rgba(132,255,191,.25)"; ctx.beginPath(); ctx.moveTo(-size * 0.28, size * 0.32); ctx.lineTo(-radius, radius * 1.25); ctx.lineTo(radius, radius * 1.25); ctx.lineTo(size * 0.28, size * 0.32); ctx.fill(); break;
    case "shards": for (let i = 0; i < 5; i += 1) { const a = -phase + i * 1.25; ctx.save(); ctx.translate(Math.cos(a) * radius, Math.sin(a) * radius); ctx.rotate(a); ctx.fillStyle = "#d7f8ff"; ctx.fillRect(-size * 0.04, -size * 0.1, size * 0.08, size * 0.2); ctx.restore(); } break;
    case "sparks": for (let i = 0; i < 6; i += 1) dot(i * 1.15 - phase * 0.8, radius * (0.7 + Math.sin(phase * 3 + i) * 0.25), i % 2 ? "#ff5d32" : "#ffe35a", 0.07); break;
    case "petals": for (let i = 0; i < 6; i += 1) { const a = phase * 0.35 + i * Math.PI / 3; ctx.save(); ctx.translate(Math.cos(a) * radius, Math.sin(a) * radius); ctx.rotate(a); ctx.fillStyle = i % 2 ? "#ff70ce" : "#7cffaa"; ctx.fillRect(-size * 0.06, -size * 0.035, size * 0.12, size * 0.07); ctx.restore(); } break;
    case "twinkles": for (let i = 0; i < 5; i += 1) { const a = i * 1.35 + phase * 0.25; const d = radius * (0.8 + Math.sin(phase * 3 + i) * 0.2); dot(a, d, "#fff9ac", 0.055 + (Math.sin(phase * 5 + i) + 1) * 0.02); } break;
    case "rain": for (let i = -2; i <= 2; i += 1) { const py = ((phase * 36 + i * 19) % (size * 1.5)) - size * 0.75; ctx.fillStyle = "#7fff8d"; ctx.fillRect(i * size * 0.2, py, size * 0.035, size * 0.16); } break;
    case "sprinkles": { const colors = ["#ff7ac8", "#7ae8ff", "#fff16b"]; for (let i = 0; i < 7; i += 1) dot(phase * 0.4 + i * 0.9, radius * (0.75 + i % 2 * 0.22), colors[i % 3], 0.055); } break;
    case "frostRing": ctx.strokeStyle = "#dffaff"; ctx.lineWidth = size * 0.04; ctx.beginPath(); for (let i = 0; i <= 6; i += 1) { const a = phase * 0.15 + i * Math.PI / 3; const px = Math.cos(a) * radius; const py = Math.sin(a) * radius; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.stroke(); break;
    case "rainbowArc": { const colors = ["#ff5e7a", "#ffcf4d", "#61e8ff", "#b47cff"]; colors.forEach((color, i) => { ctx.strokeStyle = color; ctx.lineWidth = size * 0.035; ctx.beginPath(); ctx.arc(0, 0, radius * (0.72 + i * 0.1), phase + i * 0.2, phase + Math.PI + i * 0.2); ctx.stroke(); }); } break;
    case "eclipse": ctx.globalAlpha = 0.95; ctx.strokeStyle = "#f2eaff"; ctx.lineWidth = size * 0.075; ctx.beginPath(); ctx.arc(0, 0, radius * (1 + Math.sin(phase * 3) * 0.06), 0, Math.PI * 2); ctx.stroke(); dot(phase * 1.2, radius * 1.08, "#b58cff", 0.09); break;
    case "lens": for (let i = 0; i < 8; i += 1) dot(-phase * 2 + i * Math.PI / 4, radius * (0.75 + Math.sin(phase * 2 + i) * 0.18), i % 2 ? "#fff" : "#9d6cff", 0.05); break;
    case "runes": for (let i = 0; i < 4; i += 1) { const a = phase * 0.6 + i * Math.PI / 2; const px = Math.cos(a) * radius; const py = Math.sin(a) * radius; ctx.strokeStyle = i % 2 ? "#ffe45c" : "#36e4ff"; ctx.lineWidth = size * 0.04; ctx.strokeRect(px - size * 0.07, py - size * 0.07, size * 0.14, size * 0.14); } break;
    default: ring(radius, skin.primary);
  }
  if (moving) ctx.globalAlpha *= 1.15;
  ctx.restore();
}
