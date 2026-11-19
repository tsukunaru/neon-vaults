import { CONFIG, DIRECTIONS } from "./config.js";

const TAU = Math.PI * 2;
const DIRECTION_LIST = Object.entries(DIRECTIONS).map(([name, vector]) => ({ name, ...vector }));
const key = (x, y) => `${x},${y}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function randomStep(state) {
  let next = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  next = Math.imul(next ^ (next >>> 13), 0x45d9f3b);
  next ^= next >>> 16;
  return [next >>> 0, (next >>> 0) / 4294967296];
}

function perpendicular(direction) {
  return DIRECTION_LIST.filter((item) => item.x * direction.x + item.y * direction.y === 0);
}

export function buildEndlessRoute(length = 220, seed = 0x9e3779b9, start = { x: 0, y: 0 }, initialDirection = "right", occupied = new Set()) {
  const route = [{ ...start }];
  const branches = [];
  const floor = new Set(occupied);
  floor.add(key(start.x, start.y));
  let state = seed >>> 0;
  let direction = DIRECTION_LIST.find((item) => item.name === initialDirection) || DIRECTION_LIST[3];

  for (let index = 0; index < length; index += 1) {
    const [nextState, roll] = randomStep(state); state = nextState;
    const candidates = [direction, ...perpendicular(direction), ...DIRECTION_LIST.filter((item) => item.name !== direction.name && item.x * direction.x + item.y * direction.y < 0)];
    const turns = roll < 0.2 ? 1 : roll < 0.34 ? 2 : 0;
    direction = candidates[turns % candidates.length];
    let next = { x: route[route.length - 1].x + direction.x, y: route[route.length - 1].y + direction.y };
    if (floor.has(key(next.x, next.y))) {
      const fallback = DIRECTION_LIST.find((item) => !floor.has(key(route[route.length - 1].x + item.x, route[route.length - 1].y + item.y)));
      if (fallback) { direction = fallback; next = { x: route[route.length - 1].x + direction.x, y: route[route.length - 1].y + direction.y }; }
    }
    route.push(next); floor.add(key(next.x, next.y));

    if (index > 8 && index % 11 === 0) {
      const side = perpendicular(direction)[Math.floor(roll * 2) % 2];
      let branch = { ...next };
      const branchLength = 2 + Math.floor(roll * 3);
      for (let branchIndex = 0; branchIndex < branchLength; branchIndex += 1) {
        const candidate = { x: branch.x + side.x, y: branch.y + side.y };
        if (floor.has(key(candidate.x, candidate.y))) break;
        branch = candidate; floor.add(key(branch.x, branch.y)); branches.push({ ...branch, depth: branchIndex + 1 });
      }
    }
  }
  return { route, branches, floor, seed: state, direction: direction.name };
}

export class HeroPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: true });
    this.width = 1; this.height = 1; this.dpr = 1; this.tile = 28;
    this.reducedMotion = false; this.distance = 0; this.routeIndex = 0; this.lastTime = 0;
    this.route = []; this.branches = []; this.floor = new Set(); this.seed = 0x9e3779b9; this.direction = "right";
    this.particles = [];
    this.resize();
    this.extendRoute();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    this.tile = clamp(Math.floor(Math.min(this.width / 18, this.height / 10)), 20, 34);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.imageSmoothingEnabled = false;
  }

  setReducedMotion(value) { this.reducedMotion = Boolean(value); }

  extendRoute() {
    const start = this.route.length ? this.route[this.route.length - 1] : { x: 0, y: 0 };
    const chunk = buildEndlessRoute(220, this.seed, start, this.direction, this.floor);
    this.route.push(...(this.route.length ? chunk.route.slice(1) : chunk.route));
    this.branches.push(...chunk.branches);
    this.floor = chunk.floor; this.seed = chunk.seed; this.direction = chunk.direction;
  }

  update(delta) {
    if (this.reducedMotion) return;
    this.distance += Math.min(0.04, delta) * 1.25;
    while (this.distance >= 1) {
      this.distance -= 1; this.routeIndex += 1;
      if (this.routeIndex > this.route.length - 45) this.extendRoute();
      const cell = this.route[this.routeIndex];
      this.particles.push({ x: cell.x, y: cell.y, life: 0.42, max: 0.42, color: CONFIG.colors.cyan });
    }
    for (const particle of this.particles) particle.life -= Math.min(0.04, delta);
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  worldPoint(index) {
    const from = this.route[Math.min(index, this.route.length - 1)];
    const to = this.route[Math.min(index + 1, this.route.length - 1)] || from;
    const amount = this.reducedMotion ? 0 : this.distance;
    return { x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount };
  }

  screenPoint(world, camera) {
    return { x: (world.x - camera.x) * this.tile + this.width / 2, y: (world.y - camera.y) * this.tile + this.height / 2 };
  }

  draw(now = 0) {
    const ctx = this.context; const tile = this.tile; const camera = this.worldPoint(this.routeIndex);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const columns = Math.ceil(this.width / tile / 2) + 2; const rows = Math.ceil(this.height / tile / 2) + 2;
    const minX = Math.floor(camera.x) - columns; const maxX = Math.floor(camera.x) + columns;
    const minY = Math.floor(camera.y) - rows; const maxY = Math.floor(camera.y) + rows;
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const point = this.screenPoint({ x, y }, camera); const cell = key(x, y);
      ctx.fillStyle = this.floor.has(cell) ? ((x + y) % 2 ? "#0b1c31" : "#0d2340") : ((x + y) % 2 ? "#080f1c" : "#0a1425");
      ctx.fillRect(point.x, point.y, tile + 1, tile + 1);
      if (this.floor.has(cell)) {
        ctx.globalAlpha = 0.12; ctx.fillStyle = CONFIG.colors.cyan; ctx.fillRect(point.x + tile * 0.45, point.y + tile * 0.45, tile * 0.1, tile * 0.1); ctx.globalAlpha = 1;
        const edge = [[0, -1, tile, 2], [0, 1, tile, -2], [-1, 0, 2, tile], [1, 0, -2, tile]];
        ctx.strokeStyle = "rgba(54,228,255,.5)"; ctx.lineWidth = 1;
        for (const [dx, dy, width, height] of edge) if (!this.floor.has(key(x + dx, y + dy))) ctx.strokeRect(point.x + (dx === -1 ? 0 : dx === 1 ? tile - 1 : 0), point.y + (dy === -1 ? 0 : dy === 1 ? tile - 1 : 0), width || 2, height || 2);
      }
    }

    const current = this.routeIndex;
    for (const index of [current + 2, current + 5, current + 8, current + 11]) {
      const point = this.screenPoint(this.route[index % this.route.length], camera); const pulse = 0.72 + Math.sin(now * 0.006 + index) * 0.16;
      ctx.shadowBlur = tile * 0.45; ctx.shadowColor = CONFIG.colors.cyan; ctx.fillStyle = CONFIG.colors.cyan; ctx.fillRect(point.x - tile * 0.07 * pulse, point.y - tile * 0.07 * pulse, tile * 0.14 * pulse, tile * 0.14 * pulse);
    }
    for (let index = 0; index < this.branches.length; index += 1) {
      const branch = this.branches[index]; if ((branch.x - camera.x) ** 2 + (branch.y - camera.y) ** 2 > 100) continue;
      const point = this.screenPoint(branch, camera);
      if (index % 3 === 0) { ctx.shadowBlur = tile * 0.55; ctx.shadowColor = CONFIG.colors.yellow; ctx.fillStyle = CONFIG.colors.yellow; ctx.fillRect(point.x - tile * 0.16, point.y - tile * 0.22, tile * 0.32, tile * 0.44); ctx.fillStyle = "#f49d1c"; ctx.fillRect(point.x - tile * 0.08, point.y - tile * 0.13, tile * 0.16, tile * 0.26); }
      else if (index % 5 === 0) { ctx.shadowBlur = tile * 0.45; ctx.shadowColor = CONFIG.colors.magenta; ctx.strokeStyle = CONFIG.colors.magenta; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(point.x, point.y, tile * 0.28, 0, TAU); ctx.stroke(); }
    }
    ctx.shadowBlur = 0;

    const portal = this.screenPoint(this.route[(current + 15) % this.route.length], camera);
    ctx.save(); ctx.translate(portal.x, portal.y); ctx.rotate(now * 0.001); ctx.strokeStyle = CONFIG.colors.lime; ctx.shadowBlur = tile * 0.8; ctx.shadowColor = CONFIG.colors.lime; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, tile * 0.35, 0, TAU * 0.8); ctx.stroke(); ctx.restore(); ctx.shadowBlur = 0;

    for (const particle of this.particles) {
      const point = this.screenPoint({ x: particle.x, y: particle.y }, camera); ctx.globalAlpha = particle.life / particle.max; ctx.fillStyle = particle.color; ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    const player = this.screenPoint(camera, camera); const stretch = this.reducedMotion ? 1 : 1 + Math.sin(now * 0.01) * 0.06;
    ctx.save(); ctx.translate(player.x, player.y); ctx.scale(stretch, 1 / Math.sqrt(stretch)); ctx.shadowBlur = tile * 0.8; ctx.shadowColor = CONFIG.colors.cyan; ctx.fillStyle = "#54efff"; ctx.fillRect(-tile * 0.32, -tile * 0.32, tile * 0.64, tile * 0.64); ctx.strokeStyle = "#d8fcff"; ctx.lineWidth = 2; ctx.strokeRect(-tile * 0.32, -tile * 0.32, tile * 0.64, tile * 0.64); ctx.shadowBlur = 0; ctx.fillStyle = "#07101d"; ctx.fillRect(-tile * 0.17, -tile * 0.1, tile * 0.1, tile * 0.18); ctx.fillRect(tile * 0.07, -tile * 0.1, tile * 0.1, tile * 0.18); ctx.restore();
    ctx.globalAlpha = 1;
  }
}
