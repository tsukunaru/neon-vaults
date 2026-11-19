import { CONFIG, DIRECTIONS, themeForLevel } from "./config.js";
import { drawSkin, drawSkinEffect } from "./skins.js";

const TAU = Math.PI * 2;

export function staticLayerKey(game, layout) {
  const fallback = game.staticLayerVersion === undefined
    ? `${[...(game.breakables || [])].sort().join(";")}:${[...(game.brokenBreakables || [])].sort().join(";")}`
    : game.staticLayerVersion;
  return `${game.level?.id || 0}:${layout.x}:${layout.y}:${layout.tile}:${layout.tile * game.level?.width}:${layout.tile * game.level?.height}:${fallback}`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.width = 0; this.height = 0; this.dpr = 1;
    this.backgroundKey = ""; this.background = null;
    this.staticCanvas = null; this.staticContext = null; this.staticKey = "";
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(1.75, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.imageSmoothingEnabled = false;
    this.background = null;
    this.staticKey = "";
  }

  layout(level) {
    const tile = Math.max(10, Math.floor(Math.min((this.width - 20) / level.width, (this.height - 18) / level.height)));
    return { tile, x: Math.floor((this.width - tile * level.width) / 2), y: Math.floor((this.height - tile * level.height) / 2) };
  }

  cell(layout, x, y) { return { x: layout.x + (x + 0.5) * layout.tile, y: layout.y + (y + 0.5) * layout.tile }; }

  draw(game, now) {
    const ctx = this.context;
    const level = game.level;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const theme = themeForLevel(level?.id || 1);
    const backgroundKey = `${theme.id}:${this.width}:${this.height}`;
    if (!this.background || this.backgroundKey !== backgroundKey) {
      this.backgroundKey = backgroundKey;
      this.background = ctx.createRadialGradient(this.width / 2, this.height / 2, 20, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.75);
      this.background.addColorStop(0, theme.center); this.background.addColorStop(1, theme.bg);
    }
    ctx.fillStyle = this.background; ctx.fillRect(0, 0, this.width, this.height);
    if (!level) return;
    const layout = this.layout(level);
    ctx.save();
    if (game.shake > 0) ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
    this.drawBoard(ctx, game, layout, game.reducedMotion ? 0 : now);
    ctx.restore();
    if (game.flash > 0) { ctx.fillStyle = `rgba(255,80,160,${game.flash * 1.8})`; ctx.fillRect(0, 0, this.width, this.height); }
  }

  drawBoard(ctx, game, layout, now) {
    const { level } = game; const { tile } = layout;
    this.drawStaticBoard(ctx, game, layout, tile);

    this.drawExit(ctx, game, layout, now);
    this.drawMechanics(ctx, game, layout, now);
    this.drawCollectibles(ctx, game, layout, now);

    for (const trail of game.trails) {
      const point = this.cell(layout, trail.x, trail.y);
      ctx.globalAlpha = Math.max(0, trail.life / trail.max) * 0.35;
      ctx.fillStyle = trail.color;
      ctx.fillRect(point.x - tile * 0.23, point.y - tile * 0.23, tile * 0.46, tile * 0.46);
    }
    ctx.globalAlpha = 1;
    for (const particle of game.particles) {
      const point = this.cell(layout, particle.x, particle.y);
      ctx.globalAlpha = Math.max(0, particle.life / particle.max);
      ctx.fillStyle = particle.color;
      const size = Math.max(2, tile * 0.11);
      ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    if (game.ghost?.active && !game.reducedMotion) {
      const ghost = this.cell(layout, game.ghost.drawX, game.ghost.drawY);
      ctx.save(); ctx.globalAlpha = 0.28; ctx.strokeStyle = game.skin?.secondary || CONFIG.colors.cyan;
      ctx.shadowBlur = tile * 0.42; ctx.shadowColor = ctx.strokeStyle; ctx.lineWidth = Math.max(1, tile * 0.055);
      ctx.strokeRect(ghost.x - tile * 0.28, ghost.y - tile * 0.28, tile * 0.56, tile * 0.56);
      ctx.fillStyle = ctx.strokeStyle; ctx.globalAlpha = 0.09; ctx.fillRect(ghost.x - tile * 0.23, ghost.y - tile * 0.23, tile * 0.46, tile * 0.46);
      ctx.restore();
    }

    if (game.state !== "dead") {
      const point = this.cell(layout, game.player.drawX, game.player.drawY);
      const stretch = game.player.direction ? 1.16 : 1;
      if (game.secretBoostUntil > game.elapsed) {
        ctx.save(); ctx.strokeStyle = CONFIG.colors.yellow; ctx.shadowBlur = tile * 0.5; ctx.shadowColor = CONFIG.colors.yellow; ctx.lineWidth = Math.max(1, tile * 0.06);
        ctx.beginPath(); ctx.arc(point.x, point.y, tile * (0.55 + Math.sin(now * 0.01) * 0.05), now * -0.004, now * -0.004 + Math.PI * 1.55); ctx.stroke(); ctx.restore();
      }
      drawSkinEffect(ctx, game.skin, point.x, point.y, tile * 0.84, now, Boolean(game.player.direction));
      ctx.save(); ctx.translate(point.x, point.y);
      const direction = DIRECTIONS[game.player.direction] || { x: 0, y: 0 };
      ctx.scale(direction.x ? stretch : 1 / Math.sqrt(stretch), direction.y ? stretch : 1 / Math.sqrt(stretch));
      drawSkin(ctx, game.skin, 0, 0, tile * 0.78, now);
      ctx.restore();
    }
    if (game.showGrid) this.drawGrid(ctx, level, layout);
  }

  drawStaticBoard(ctx, game, layout, tile) {
    const { level } = game; const theme = themeForLevel(level.id); const cacheKey = staticLayerKey(game, layout);
    if (!this.staticCanvas || this.staticCanvas.width !== Math.ceil(this.width) || this.staticCanvas.height !== Math.ceil(this.height)) {
      this.staticCanvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(Math.ceil(this.width), Math.ceil(this.height)) : document.createElement("canvas");
      this.staticCanvas.width = Math.ceil(this.width); this.staticCanvas.height = Math.ceil(this.height);
      this.staticContext = this.staticCanvas.getContext("2d", { alpha: false }); this.staticKey = "";
    }
    if (this.staticKey !== cacheKey) {
      const layer = this.staticContext; this.staticKey = cacheKey; layer.setTransform(1, 0, 0, 1, 0, 0); layer.imageSmoothingEnabled = false;
      layer.fillStyle = theme.bg; layer.fillRect(0, 0, this.width, this.height);
      for (let y = 0; y < level.height; y += 1) for (let x = 0; x < level.width; x += 1) {
        const px = layout.x + x * tile; const py = layout.y + y * tile;
        if (level.rows[y][x] === ".") {
          layer.fillStyle = (x + y) % 2 ? theme.floorA : theme.floorB; layer.fillRect(px, py, tile, tile);
          layer.globalAlpha = 0.09; layer.fillStyle = theme.edge; layer.fillRect(px + tile * 0.44, py + tile * 0.44, Math.max(1, tile * 0.1), Math.max(1, tile * 0.1)); layer.globalAlpha = 1;
        } else if (game.brokenBreakables.has(`${x},${y}`)) {
          layer.fillStyle = theme.floorA; layer.fillRect(px, py, tile, tile);
        } else this.drawWall(layer, level, layout, x, y, game.breakables.has(`${x},${y}`), theme);
      }
    }
    ctx.drawImage(this.staticCanvas, 0, 0);
  }

  drawWall(ctx, level, layout, x, y, breakable, theme) {
    const t = layout.tile; const px = layout.x + x * t; const py = layout.y + y * t;
    ctx.fillStyle = breakable ? "#4b3541" : theme.wall;
    ctx.fillRect(px, py, t, t);
    ctx.fillStyle = breakable ? CONFIG.colors.yellow : theme.edge;
    ctx.globalAlpha = breakable ? 0.85 : 0.42;
    const edge = Math.max(1, Math.floor(t * 0.1));
    if (level.rows[y - 1]?.[x] === ".") ctx.fillRect(px, py, t, edge);
    if (level.rows[y + 1]?.[x] === ".") ctx.fillRect(px, py + t - edge, t, edge);
    if (level.rows[y]?.[x - 1] === ".") ctx.fillRect(px, py, edge, t);
    if (level.rows[y]?.[x + 1] === ".") ctx.fillRect(px + t - edge, py, edge, t);
    ctx.globalAlpha = 1;
    if ((x * 7 + y * 11) % 5 === 0) {
      ctx.globalAlpha = 0.38; ctx.fillStyle = breakable ? CONFIG.colors.yellow : theme.accent;
      ctx.fillRect(px + t * 0.32, py + t * 0.24, Math.max(1, t * 0.12), t * 0.52);
      ctx.fillRect(px + t * 0.44, py + t * 0.4, t * 0.25, Math.max(1, t * 0.1));
      ctx.globalAlpha = 1;
    }
  }

  drawCollectibles(ctx, game, layout, now) {
    const t = layout.tile;
    for (const value of game.dots) {
      const [x, y] = value.split(",").map(Number); const point = this.cell(layout, x, y);
      const pulse = 0.8 + Math.sin(now * 0.008 + x + y) * 0.2;
      ctx.shadowBlur = t * 0.35; ctx.shadowColor = CONFIG.colors.cyan; ctx.fillStyle = CONFIG.colors.cyan;
      ctx.fillRect(point.x - t * 0.07 * pulse, point.y - t * 0.07 * pulse, t * 0.14 * pulse, t * 0.14 * pulse);
      if (game.hintDot === value) {
        ctx.strokeStyle = CONFIG.colors.yellow; ctx.lineWidth = Math.max(2, t * 0.08); ctx.globalAlpha = 0.55 + Math.sin(now * 0.01) * 0.25;
        ctx.beginPath(); ctx.arc(point.x, point.y, t * (0.42 + Math.sin(now * 0.006) * 0.08), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    for (const value of game.coins) {
      const [x, y] = value.split(",").map(Number); const point = this.cell(layout, x, y);
      const width = t * (0.16 + Math.abs(Math.sin(now * 0.005 + x)) * 0.14);
      ctx.shadowBlur = t * 0.65; ctx.shadowColor = CONFIG.colors.yellow; ctx.fillStyle = CONFIG.colors.yellow;
      ctx.fillRect(point.x - width, point.y - t * 0.28, width * 2, t * 0.56);
      ctx.fillStyle = "#ff9f1c"; ctx.fillRect(point.x - width * 0.35, point.y - t * 0.17, width * 0.7, t * 0.34);
    }
    ctx.shadowBlur = 0;
  }

  drawExit(ctx, game, layout, now) {
    const point = this.cell(layout, game.level.exit[0], game.level.exit[1]); const t = layout.tile;
    const open = game.dots.size === 0; const lockedPulse = game.portalFlash > 0; const color = lockedPulse ? "#ff3f67" : open ? CONFIG.colors.lime : CONFIG.colors.magenta;
    ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(now * (open ? 0.0018 : 0.00035));
    ctx.shadowBlur = open ? t * 1.1 : t * 0.5; ctx.shadowColor = color; ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, t * 0.1);
    ctx.beginPath(); ctx.arc(0, 0, t * 0.37, 0, TAU * 0.78); ctx.stroke();
    ctx.rotate(-now * 0.0031); ctx.beginPath(); ctx.arc(0, 0, t * 0.23, 0, TAU * 0.68); ctx.stroke();
    if (open) { ctx.globalAlpha = 0.32 + Math.sin(now * 0.008) * 0.08; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, t * 0.29, 0, TAU); ctx.fill(); }
    else { ctx.rotate(now * 0.00275); ctx.fillStyle = color; for (let i = 0; i < 4; i += 1) { ctx.fillRect(-t * 0.04, -t * 0.29, t * 0.08, t * 0.16); ctx.rotate(Math.PI / 2); } }
    if (!open) {
      ctx.rotate(-now * 0.00275); ctx.shadowBlur = 0; ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.max(8, Math.floor(t * 0.28))}px monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(game.dots.size), 0, 0);
    }
    ctx.restore(); ctx.shadowBlur = 0;
    if (lockedPulse) {
      ctx.globalAlpha = Math.min(1, game.portalFlash * 3.6); ctx.strokeStyle = "#ff3f67"; ctx.lineWidth = Math.max(2, t * 0.11);
      ctx.beginPath(); ctx.arc(point.x, point.y, t * (0.52 + (0.32 - game.portalFlash) * 0.8), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }

  drawMechanics(ctx, game, layout, now) {
    const t = layout.tile; const mechanics = game.level.mechanics || {};
    const drawSpike = (x, y, color, active = true) => {
      const point = this.cell(layout, x, y); ctx.save(); ctx.translate(point.x, point.y);
      const reach = t * (active ? 0.45 : 0.18); ctx.shadowBlur = active ? t * 0.75 : 0; ctx.shadowColor = color;
      ctx.fillStyle = "#16070c"; ctx.rotate(Math.PI / 4); ctx.fillRect(-t * 0.2, -t * 0.2, t * 0.4, t * 0.4); ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = active ? color : "rgba(255,255,255,.22)"; ctx.strokeStyle = active ? "#fff0dc" : "rgba(255,255,255,.25)"; ctx.lineWidth = Math.max(1, t * 0.035);
      for (let index = 0; index < 4; index += 1) { const angle = index * Math.PI / 2; ctx.beginPath(); ctx.moveTo(Math.cos(angle - 0.5) * t * 0.12, Math.sin(angle - 0.5) * t * 0.12); ctx.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach); ctx.lineTo(Math.cos(angle + 0.5) * t * 0.12, Math.sin(angle + 0.5) * t * 0.12); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      if (!active) { ctx.strokeStyle = "rgba(255,71,117,.5)"; ctx.beginPath(); ctx.arc(0, 0, t * (0.28 + Math.sin(now * 0.012) * 0.06), 0, TAU); ctx.stroke(); }
      ctx.restore();
    };
    (mechanics.spikes || []).forEach(([x, y]) => drawSpike(x, y, "#ff493d"));
    (mechanics.timedSpikes || []).forEach((item) => drawSpike(item.x, item.y, "#ff315d", game.timedActive(item)));
    (mechanics.pulses || []).forEach((item) => {
      const point = this.cell(layout, item.x, item.y); const active = game.timedActive(item, 0.48);
      ctx.save(); ctx.translate(point.x, point.y); ctx.shadowBlur = active ? t : 0; ctx.shadowColor = "#ff315d";
      ctx.fillStyle = active ? "rgba(255,49,93,.32)" : "rgba(255,255,255,.06)"; ctx.fillRect(-t * 0.42, -t * 0.42, t * 0.84, t * 0.84);
      ctx.strokeStyle = active ? "#ff557b" : "rgba(255,85,123,.3)"; ctx.lineWidth = Math.max(1, t * 0.07); ctx.beginPath(); ctx.arc(0, 0, t * (active ? 0.37 : 0.2), 0, TAU); ctx.stroke();
      if (active) { ctx.beginPath(); ctx.moveTo(-t * 0.4, 0); ctx.lineTo(t * 0.4, 0); ctx.moveTo(0, -t * 0.4); ctx.lineTo(0, t * 0.4); ctx.stroke(); } ctx.restore();
    });
    for (const item of game.dynamicHazards || []) {
      const point = game.movingPosition(item); const p = this.cell(layout, point.x, point.y);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(now * 0.0025); ctx.shadowBlur = t * 0.75; ctx.shadowColor = "#ff493d"; ctx.fillStyle = "#ff613f";
      ctx.beginPath(); for (let i = 0; i < 16; i += 1) { const a = i * TAU / 16; const r = t * (i % 2 ? 0.28 : 0.39); const px = Math.cos(a) * r; const py = Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); ctx.rotate(-now * 0.0025);
      ctx.fillStyle = "#18080c"; ctx.fillRect(-t * 0.2, -t * 0.16, t * 0.4, t * 0.32); ctx.fillStyle = "#fff4df"; ctx.fillRect(-t * 0.13, -t * 0.07, t * 0.07, t * 0.09); ctx.fillRect(t * 0.06, -t * 0.07, t * 0.07, t * 0.09); ctx.restore();
    }
    ctx.shadowBlur = 0;
    (mechanics.cannons || []).forEach((item) => {
      const p = this.cell(layout, item.x, item.y); const vector = DIRECTIONS[item.dir];
      const charge = ((game.elapsed + item.phase * item.period) % item.period) / item.period;
      ctx.save(); ctx.translate(p.x, p.y); ctx.shadowBlur = t * charge; ctx.shadowColor = "#ff315d"; ctx.fillStyle = "#50306e"; ctx.beginPath(); ctx.arc(0, 0, t * 0.29, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#ff557b"; ctx.lineWidth = t * 0.14; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(vector.x * t * 0.48, vector.y * t * 0.48); ctx.stroke(); ctx.strokeStyle = `rgba(255,255,255,${0.25 + charge * 0.65})`; ctx.lineWidth = t * 0.035; ctx.beginPath(); ctx.arc(0, 0, t * (0.32 + charge * 0.1), 0, TAU * charge); ctx.stroke(); ctx.restore();
    });
    for (const projectile of game.projectiles) { const p = this.cell(layout, projectile.x, projectile.y); ctx.strokeStyle = "rgba(255,49,93,.45)"; ctx.lineWidth = t * 0.16; ctx.beginPath(); ctx.moveTo(p.x - projectile.dx * t * 0.55, p.y - projectile.dy * t * 0.55); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.fillStyle = "#fff"; ctx.shadowColor = "#ff315d"; ctx.shadowBlur = t * 0.8; ctx.fillRect(p.x - t * 0.11, p.y - t * 0.11, t * 0.22, t * 0.22); }
    ctx.shadowBlur = 0;
    (mechanics.portals || []).forEach((portal) => [portal.a, portal.b].forEach(([x, y]) => {
      const p = this.cell(layout, x, y); ctx.strokeStyle = portal.color === "magenta" ? CONFIG.colors.magenta : CONFIG.colors.cyan; ctx.lineWidth = t * 0.1; ctx.beginPath(); ctx.arc(p.x, p.y, t * 0.31, now * 0.003, now * 0.003 + Math.PI * 1.5); ctx.stroke();
    }));
    for (const secret of mechanics.secrets || []) if (game.foundSecrets?.has(`${secret.x},${secret.y}`)) {
      const p = this.cell(layout, secret.x, secret.y); const color = secret.kind === "crystal" ? CONFIG.colors.violet : CONFIG.colors.yellow;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(now * 0.002); ctx.shadowBlur = t * 0.65; ctx.shadowColor = color; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, t * 0.07); ctx.strokeRect(-t * 0.22, -t * 0.22, t * 0.44, t * 0.44); ctx.restore();
    }
    (mechanics.switches || []).forEach((item) => { const p = this.cell(layout, item.x, item.y); ctx.fillStyle = game.openGroups.has(item.group) ? CONFIG.colors.lime : CONFIG.colors.yellow; ctx.fillRect(p.x - t * 0.24, p.y - t * 0.12, t * 0.48, t * 0.24); });
    (mechanics.gates || []).forEach((item) => { if (!game.gateClosed(item.x, item.y)) return; const p = this.cell(layout, item.x, item.y); ctx.fillStyle = "rgba(255,49,93,.16)"; ctx.fillRect(p.x - t * 0.43, p.y - t * 0.43, t * 0.86, t * 0.86); ctx.shadowBlur = t * 0.6; ctx.shadowColor = "#ff315d"; ctx.strokeStyle = "#ff557b"; ctx.lineWidth = t * 0.1; for (let offset = -0.25; offset <= 0.25; offset += 0.25) { ctx.beginPath(); ctx.moveTo(p.x + offset * t, p.y - t * 0.42); ctx.lineTo(p.x + offset * t, p.y + t * 0.42); ctx.stroke(); } ctx.shadowBlur = 0; });
    (mechanics.oneWays || []).forEach((item) => this.drawArrow(ctx, layout, item.x, item.y, item.dir, CONFIG.colors.yellow));
    (mechanics.redirects || []).forEach((item) => this.drawArrow(ctx, layout, item.x, item.y, item.dir, CONFIG.colors.lime));
    for (const value of game.crumbles) { if (game.crumbleBlocked.has(value)) continue; const [x, y] = value.split(",").map(Number); const p = this.cell(layout, x, y); ctx.strokeStyle = CONFIG.colors.violet; ctx.lineWidth = Math.max(1, t * 0.06); ctx.beginPath(); ctx.moveTo(p.x - t * 0.32, p.y - t * 0.22); ctx.lineTo(p.x, p.y + t * 0.05); ctx.lineTo(p.x + t * 0.28, p.y - t * 0.25); ctx.stroke(); }
    for (const value of game.crumbleBlocked) { const [x, y] = value.split(",").map(Number); const p = this.cell(layout, x, y); ctx.fillStyle = "#05060d"; ctx.fillRect(p.x - t / 2, p.y - t / 2, t, t); }
    for (const value of game.checkpoints) { const [x, y] = value.split(",").map(Number); const p = this.cell(layout, x, y); ctx.strokeStyle = CONFIG.colors.yellow; ctx.lineWidth = t * 0.08; ctx.strokeRect(p.x - t * 0.32, p.y - t * 0.32, t * 0.64, t * 0.64); }
  }

  drawArrow(ctx, layout, x, y, direction, color) {
    const p = this.cell(layout, x, y); const v = DIRECTIONS[direction]; const t = layout.tile;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(v.y, v.x)); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(t * 0.34, 0); ctx.lineTo(-t * 0.18, -t * 0.24); ctx.lineTo(-t * 0.18, t * 0.24); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  drawGrid(ctx, level, layout) {
    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 1;
    for (let x = 0; x <= level.width; x += 1) { ctx.beginPath(); ctx.moveTo(layout.x + x * layout.tile, layout.y); ctx.lineTo(layout.x + x * layout.tile, layout.y + level.height * layout.tile); ctx.stroke(); }
    for (let y = 0; y <= level.height; y += 1) { ctx.beginPath(); ctx.moveTo(layout.x, layout.y + y * layout.tile); ctx.lineTo(layout.x + level.width * layout.tile, layout.y + y * layout.tile); ctx.stroke(); }
  }
}
