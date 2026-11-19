import { CONFIG, DIRECTIONS } from "./config.js";
import { bonusObjectives, coresForDashes, effectivePar } from "./rating.js";

const positionKey = (x, y) => `${x},${y}`;
const pointKey = ([x, y]) => positionKey(x, y);
const lerp = (from, to, amount) => from + (to - from) * amount;
const directionName = (dx, dy) => Object.keys(DIRECTIONS).find((name) => DIRECTIONS[name].x === dx && DIRECTIONS[name].y === dy);

function cloneSet(points = []) { return new Set(points.map(pointKey)); }

export class NeonGame {
  constructor(audio, callbacks = {}) {
    this.audio = audio;
    this.callbacks = callbacks;
    this.level = null;
    this.state = "idle";
    this.paused = false;
    this.invulnerable = false;
    this.timeScale = 1;
    this.showGrid = false;
    this.reducedMotion = false;
  }

  load(level, skin, personalGhost = null) {
    this.level = level;
    this.skin = skin;
    this.state = "playing";
    this.paused = false;
    this.elapsed = 0;
    this.shake = 0;
    this.flash = 0;
    this.portalFlash = 0;
    this.secretBoostUntil = 0;
    this.player = {
      x: level.start[0], y: level.start[1], drawX: level.start[0], drawY: level.start[1],
      targetX: level.start[0], targetY: level.start[1], direction: null, buffered: null, progress: 0,
    };
    this.dots = cloneSet(level.dots);
    this.coins = cloneSet(level.coins);
    this.bonusObjectives = bonusObjectives(level);
    this.bonusByCell = new Map(this.bonusObjectives.map((objective, index) => [positionKey(objective.x, objective.y), { ...objective, bit: 2 ** index }]));
    this.bonusMask = 0;
    this.totalDots = this.dots.size;
    this.collectedDots = 0;
    this.collectedCoins = 0;
    this.dashCount = 0;
    this.routeDirections = [];
    this.routeTimings = [];
    this.breakables = cloneSet(level.mechanics?.breakables);
    this.brokenBreakables = new Set();
    this.staticLayerVersion = 0;
    this.dynamicHazards = [...(level.mechanics?.movers || []), ...(level.mechanics?.enemies || [])];
    this.secrets = (level.mechanics?.secrets || []).map((secret) => ({ ...secret }));
    this.foundSecrets = new Set();
    this.crumbles = cloneSet(level.mechanics?.crumbles);
    this.crumbleBlocked = new Set();
    this.openGroups = new Set();
    this.groupDeadlines = new Map();
    this.checkpoints = cloneSet(level.mechanics?.checkpoints);
    this.reachedCheckpoints = new Set();
    this.checkpointState = null;
    this.projectiles = [];
    this.particles = [];
    this.trails = [];
    this.cannonCycles = new Map();
    this.lastCell = { x: this.player.x, y: this.player.y };
    this.portalHinted = false;
    this.lastProgressAt = 0;
    this.hintDot = null;
    this.hintNotified = false;
    this.assistNotified = false;
    this.ghost = !this.reducedMotion && personalGhost?.directions?.length ? {
      x: level.start[0], y: level.start[1], drawX: level.start[0], drawY: level.start[1],
      targetX: level.start[0], targetY: level.start[1], direction: null, progress: 0, routeIndex: 0,
      directions: personalGhost.directions, timings: personalGhost.timings || [], nextAt: 0,
      dots: cloneSet(level.dots), brokenBreakables: new Set(), crumbleBlocked: new Set(), openGroups: new Set(), active: true,
    } : null;
    this.callbacks.onLoad?.(this.snapshot());
  }

  snapshot() {
    return {
      level: this.level?.id, state: this.state, dots: this.collectedDots, totalDots: this.totalDots,
      coins: this.collectedCoins, bonusMask: this.bonusMask, totalBonus: this.bonusObjectives?.length || 0,
      dashes: this.dashCount, time: this.elapsed || 0, boost: Math.max(0, (this.secretBoostUntil || 0) - (this.elapsed || 0)), daily: Boolean(this.level?.daily), moving: Boolean(this.player?.direction),
    };
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  input(direction) {
    if (this.state !== "playing" || this.paused || !DIRECTIONS[direction]) return false;
    if (this.player.direction) {
      this.player.buffered = direction;
      return true;
    }
    return this.beginDash(direction);
  }

  beginDash(direction) {
    const vector = DIRECTIONS[direction];
    if (!vector || this.blocked(this.player.x, this.player.y, vector.x, vector.y, direction, true)) {
      this.wallImpact();
      return false;
    }
    this.player.direction = direction;
    this.player.buffered = null;
    this.dashCount += 1;
    this.routeDirections.push(direction);
    this.routeTimings.push(Math.round(this.elapsed * 1000));
    this.audio.dash();
    this.callbacks.onDash?.(direction);
    this.queueNextCell();
    return true;
  }

  gateClosed(x, y) {
    const gate = (this.level.mechanics?.gates || []).find((item) => item.x === x && item.y === y);
    if (!gate) return false;
    return !this.openGroups.has(gate.group);
  }

  blocked(x, y, dx, dy, direction, mayBreak = false) {
    const nx = x + dx; const ny = y + dy; const nextKey = positionKey(nx, ny);
    const isWall = this.level.rows[ny]?.[nx] !== ".";
    if (isWall && this.breakables.has(nextKey)) {
      if (mayBreak) {
        this.breakables.delete(nextKey);
        this.brokenBreakables.add(nextKey);
        this.staticLayerVersion += 1;
        this.burst(nx, ny, CONFIG.colors.yellow, 9);
        this.audio.impact();
        this.callbacks.onBreak?.();
        const bonus = this.bonusByCell.get(nextKey);
        if (bonus?.type === "secret") this.bonusMask |= bonus.bit;
        const secret = this.secrets.find((item) => item.x === nx && item.y === ny && !this.foundSecrets.has(nextKey));
        if (secret) {
          this.foundSecrets.add(nextKey);
          this.burst(nx, ny, secret.kind === "crystal" ? CONFIG.colors.violet : CONFIG.colors.yellow, 15);
          this.audio.secret?.();
          this.callbacks.onSecret?.(secret);
        }
      }
      return true;
    }
    if ((isWall && !this.brokenBreakables.has(nextKey)) || this.crumbleBlocked.has(nextKey) || this.gateClosed(nx, ny)) return true;
    const oneWay = (this.level.mechanics?.oneWays || []).find((item) => item.x === nx && item.y === ny);
    return Boolean(oneWay && oneWay.dir !== direction);
  }

  queueNextCell() {
    if (!this.player.direction) return;
    const vector = DIRECTIONS[this.player.direction];
    if (this.blocked(this.player.x, this.player.y, vector.x, vector.y, this.player.direction, true)) {
      this.stopDash();
      return;
    }
    this.player.targetX = this.player.x + vector.x;
    this.player.targetY = this.player.y + vector.y;
    this.player.progress = 0;
  }

  stopDash() {
    if (!this.player.direction) return;
    this.player.direction = null;
    this.player.drawX = this.player.x;
    this.player.drawY = this.player.y;
    this.wallImpact();
    const buffered = this.player.buffered;
    this.player.buffered = null;
    if (buffered) this.beginDash(buffered);
  }

  wallImpact() {
    this.shake = this.reducedMotion ? 0 : Math.max(this.shake, 0.14);
    this.audio.impact();
    this.burst(this.player.x, this.player.y, this.skin?.primary || CONFIG.colors.cyan, 3);
  }

  update(delta) {
    if (this.paused || this.state === "idle" || !this.level) return;
    const dt = Math.min(0.04, delta) * this.timeScale;
    this.elapsed += dt;
    this.shake = Math.max(0, this.shake - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.portalFlash = Math.max(0, this.portalFlash - dt);
    this.updateParticles(dt);
    this.updateGhost(dt);
    if (this.state !== "playing") return;
    this.updateGates();
    this.updateCannons(dt);
    this.updateProjectiles(dt);
    this.updatePlayer(dt);
    this.checkDynamicHazards();
    this.updateHint();
  }

  updateHint() {
    const idle = this.elapsed - this.lastProgressAt;
    if (!this.hintNotified && !this.player.direction && this.dots.size > 0 && idle >= CONFIG.hintDelay) {
      this.hintNotified = true;
      this.callbacks.onHint?.(this.dots.size);
    }
    if (!this.assistNotified && !this.player.direction && this.dots.size > 0 && idle >= CONFIG.hintDelay * 2) {
      this.assistNotified = true;
      this.callbacks.onAssist?.(this.snapshot());
    }
    if (this.dots.size === 0 || this.dots.size > 3 || idle < CONFIG.hintDelay) {
      this.hintDot = null;
      return;
    }
    if (this.hintDot && this.dots.has(this.hintDot)) return;
    this.hintDot = [...this.dots].sort((left, right) => {
      const [lx, ly] = left.split(",").map(Number); const [rx, ry] = right.split(",").map(Number);
      return Math.hypot(lx - this.player.x, ly - this.player.y) - Math.hypot(rx - this.player.x, ry - this.player.y);
    })[0] || null;
  }

  ghostBlocked(x, y, dx, dy, direction) {
    const nx = x + dx; const ny = y + dy; const cell = positionKey(nx, ny);
    const wall = this.level.rows[ny]?.[nx] !== ".";
    if (wall && this.breakables.has(cell) && !this.ghost.brokenBreakables.has(cell)) {
      this.ghost.brokenBreakables.add(cell);
      // The recorded route omits the non-moving impact gesture; the visual-only
      // ghost therefore treats that already-demonstrated break as passable.
      return false;
    }
    if ((wall && !this.ghost.brokenBreakables.has(cell)) || this.ghost.crumbleBlocked.has(cell)) return true;
    const gate = (this.level.mechanics?.gates || []).find((item) => item.x === nx && item.y === ny);
    if (gate && !this.ghost.openGroups.has(gate.group)) return true;
    const oneWay = (this.level.mechanics?.oneWays || []).find((item) => item.x === nx && item.y === ny);
    return Boolean(oneWay && oneWay.dir !== direction);
  }

  stopGhost() {
    this.ghost.direction = null;
    this.ghost.drawX = this.ghost.x; this.ghost.drawY = this.ghost.y;
    this.ghost.nextAt = this.elapsed + 0.28;
  }

  queueGhostCell() {
    const vector = DIRECTIONS[this.ghost.direction];
    if (!vector || this.ghostBlocked(this.ghost.x, this.ghost.y, vector.x, vector.y, this.ghost.direction)) { this.stopGhost(); return; }
    this.ghost.targetX = this.ghost.x + vector.x; this.ghost.targetY = this.ghost.y + vector.y; this.ghost.progress = 0;
  }

  updateGhost(dt) {
    const ghost = this.ghost;
    if (!ghost?.active) return;
    if (!ghost.direction) {
      if (ghost.routeIndex >= ghost.directions.length) { ghost.active = false; return; }
      const timing = ghost.timings[ghost.routeIndex];
      if (Number.isFinite(timing) ? this.elapsed * 1000 < timing : this.elapsed < ghost.nextAt) return;
      ghost.direction = ghost.directions[ghost.routeIndex]; ghost.routeIndex += 1;
      this.queueGhostCell();
      if (!ghost.direction) return;
    }
    let remaining = dt * CONFIG.playerSpeed;
    while (remaining > 0 && ghost.direction && ghost.active) {
      const step = Math.min(1 - ghost.progress, remaining);
      ghost.progress += step; remaining -= step;
      ghost.drawX = lerp(ghost.x, ghost.targetX, ghost.progress); ghost.drawY = lerp(ghost.y, ghost.targetY, ghost.progress);
      if (ghost.progress < 0.999) continue;
      const previous = { x: ghost.x, y: ghost.y };
      if (this.crumbles.has(positionKey(previous.x, previous.y))) ghost.crumbleBlocked.add(positionKey(previous.x, previous.y));
      ghost.x = ghost.targetX; ghost.y = ghost.targetY; ghost.drawX = ghost.x; ghost.drawY = ghost.y; ghost.progress = 0;
      const cell = positionKey(ghost.x, ghost.y);
      ghost.dots.delete(cell);
      const item = (this.level.mechanics?.switches || []).find((entry) => entry.x === ghost.x && entry.y === ghost.y);
      if (item) ghost.openGroups.add(item.group);
      const portal = (this.level.mechanics?.portals || []).find((entry) => pointKey(entry.a) === cell || pointKey(entry.b) === cell);
      if (portal) {
        const target = pointKey(portal.a) === cell ? portal.b : portal.a;
        ghost.x = target[0]; ghost.y = target[1]; ghost.drawX = ghost.x; ghost.drawY = ghost.y; this.stopGhost(); continue;
      }
      const redirect = (this.level.mechanics?.redirects || []).find((entry) => entry.x === ghost.x && entry.y === ghost.y);
      if (redirect) ghost.direction = redirect.dir;
      if (ghost.x === this.level.exit[0] && ghost.y === this.level.exit[1]) {
        if (!ghost.dots.size) { ghost.active = false; ghost.direction = null; break; }
        ghost.x = previous.x; ghost.y = previous.y; ghost.drawX = ghost.x; ghost.drawY = ghost.y; this.stopGhost(); continue;
      }
      this.queueGhostCell();
    }
  }

  updatePlayer(dt) {
    if (!this.player.direction) return;
    const speed = this.secretBoostUntil > this.elapsed ? CONFIG.playerSpeed * 1.18 : CONFIG.playerSpeed;
    let remaining = dt * speed;
    while (remaining > 0 && this.player.direction && this.state === "playing") {
      const step = Math.min(1 - this.player.progress, remaining);
      this.player.progress += step;
      remaining -= step;
      this.player.drawX = lerp(this.player.x, this.player.targetX, this.player.progress);
      this.player.drawY = lerp(this.player.y, this.player.targetY, this.player.progress);
      if (Math.random() < 0.58) this.trails.push({ x: this.player.drawX, y: this.player.drawY, life: 0.16, max: 0.16, color: this.skin.primary });
      if (this.player.progress < 0.999) continue;
      const from = { x: this.player.x, y: this.player.y };
      this.lastCell = from;
      this.player.x = this.player.targetX; this.player.y = this.player.targetY;
      this.player.drawX = this.player.x; this.player.drawY = this.player.y;
      this.player.progress = 0;
      this.leaveCell(from.x, from.y);
      if (this.enterCell() === false || this.state !== "playing") break;
      this.queueNextCell();
    }
  }

  leaveCell(x, y) {
    const cell = positionKey(x, y);
    if (this.crumbles.has(cell)) {
      this.crumbleBlocked.add(cell);
      this.burst(x, y, CONFIG.colors.violet, 5);
    }
  }

  enterCell() {
    const cell = positionKey(this.player.x, this.player.y);
    if (this.dots.delete(cell)) {
      this.collectedDots += 1;
      this.lastProgressAt = this.elapsed;
      this.hintDot = null;
      this.hintNotified = false; this.assistNotified = false;
      this.audio.dot();
      this.burst(this.player.x, this.player.y, CONFIG.colors.cyan, 2);
      this.callbacks.onDot?.(this.snapshot());
    }
    if (this.coins.delete(cell)) {
      this.collectedCoins += 1;
      const bonus = this.bonusByCell.get(cell);
      if (bonus?.type === "coin") this.bonusMask |= bonus.bit;
      this.lastProgressAt = this.elapsed; this.hintNotified = false; this.assistNotified = false;
      this.audio.coin();
      this.burst(this.player.x, this.player.y, CONFIG.colors.yellow, 10);
      this.callbacks.onCoin?.(this.snapshot());
    }
    if (this.checkpoints.has(cell) && !this.reachedCheckpoints.has(cell)) {
      this.reachedCheckpoints.add(cell);
      this.lastProgressAt = this.elapsed; this.hintNotified = false; this.assistNotified = false;
      this.checkpointState = {
        x: this.player.x, y: this.player.y,
        dots: new Set(this.dots), coins: new Set(this.coins),
        collectedDots: this.collectedDots, collectedCoins: this.collectedCoins, bonusMask: this.bonusMask, dashCount: this.dashCount,
        breakables: new Set(this.breakables), brokenBreakables: new Set(this.brokenBreakables),
        crumbleBlocked: new Set(this.crumbleBlocked), openGroups: new Set(this.openGroups),
        groupRemaining: new Map([...this.groupDeadlines].map(([group, deadline]) => [group, Math.max(0, deadline - this.elapsed)])),
        reachedCheckpoints: new Set(this.reachedCheckpoints),
        routeLength: this.routeDirections.length,
      };
      this.audio.checkpoint();
      this.callbacks.onCheckpoint?.();
    }
    const switchItem = (this.level.mechanics?.switches || []).find((item) => item.x === this.player.x && item.y === this.player.y);
    if (switchItem) {
      this.openGroups.add(switchItem.group);
      this.lastProgressAt = this.elapsed; this.hintNotified = false; this.assistNotified = false;
      if (switchItem.timed) {
        const gate = (this.level.mechanics?.gates || []).find((item) => item.group === switchItem.group);
        this.groupDeadlines.set(switchItem.group, this.elapsed + (gate?.duration || 3.5));
      }
      this.audio.switch();
      this.callbacks.onSwitch?.();
    }
    const portal = (this.level.mechanics?.portals || []).find((item) => pointKey(item.a) === cell || pointKey(item.b) === cell);
    if (portal) {
      const target = pointKey(portal.a) === cell ? portal.b : portal.a;
      this.player.x = target[0]; this.player.y = target[1];
      this.player.drawX = target[0]; this.player.drawY = target[1];
      this.player.direction = null;
      this.audio.teleport();
      this.burst(target[0], target[1], portal.color === "magenta" ? CONFIG.colors.magenta : CONFIG.colors.cyan, 12);
      const buffered = this.player.buffered; this.player.buffered = null;
      if (buffered) this.beginDash(buffered);
      return false;
    }
    const redirect = (this.level.mechanics?.redirects || []).find((item) => item.x === this.player.x && item.y === this.player.y);
    if (redirect) this.player.direction = redirect.dir;
    if (this.player.x === this.level.exit[0] && this.player.y === this.level.exit[1]) {
      if (this.dots.size === 0) { this.win(); return false; }
      if (!this.portalHinted) {
        this.portalHinted = true;
        this.callbacks.onPortalLocked?.(this.dots.size);
      }
      this.portalFlash = this.reducedMotion ? 0.12 : 0.32;
      this.shake = this.reducedMotion ? 0 : Math.max(this.shake, 0.18);
      this.audio.portalLocked?.();
      this.player.x = this.lastCell.x; this.player.y = this.lastCell.y;
      this.player.drawX = this.lastCell.x; this.player.drawY = this.lastCell.y;
      this.player.direction = null; this.player.buffered = null;
      return false;
    }
    if (!this.invulnerable && this.staticHazardAt(this.player.x, this.player.y)) { this.die(); return false; }
    return true;
  }

  timedActive(item, ratio = 0.52) {
    return ((this.elapsed + (item.phase || 0) * item.period) % item.period) < item.period * ratio;
  }

  staticHazardAt(x, y) {
    if ((this.level.mechanics?.spikes || []).some((point) => point[0] === x && point[1] === y)) return true;
    if ((this.level.mechanics?.timedSpikes || []).some((item) => item.x === x && item.y === y && this.timedActive(item))) return true;
    return (this.level.mechanics?.pulses || []).some((item) => item.x === x && item.y === y && this.timedActive(item, 0.48));
  }

  movingPosition(item) {
    const wave = (Math.sin(((this.elapsed / item.period) + (item.phase || 0)) * Math.PI * 2) + 1) / 2;
    const from = item.from || item.path?.[0]; const to = item.to || item.path?.[1];
    return { x: lerp(from[0], to[0], wave), y: lerp(from[1], to[1], wave) };
  }

  checkDynamicHazards() {
    if (this.invulnerable || this.state !== "playing") return;
    if (this.staticHazardAt(this.player.drawX, this.player.drawY)) { this.die(); return; }
    for (const item of this.dynamicHazards) {
      const point = this.movingPosition(item);
      if (Math.hypot(point.x - this.player.drawX, point.y - this.player.drawY) < 0.52) { this.die(); return; }
    }
    for (const projectile of this.projectiles) {
      if (Math.hypot(projectile.x - this.player.drawX, projectile.y - this.player.drawY) < 0.42) { this.die(); return; }
    }
  }

  updateGates() {
    for (const [group, deadline] of this.groupDeadlines) if (this.elapsed >= deadline) {
      this.openGroups.delete(group); this.groupDeadlines.delete(group);
    }
  }

  updateCannons() {
    for (const [index, cannon] of (this.level.mechanics?.cannons || []).entries()) {
      const cycle = Math.floor((this.elapsed + cannon.phase * cannon.period) / cannon.period);
      if (this.cannonCycles.get(index) === cycle) continue;
      this.cannonCycles.set(index, cycle);
      if (this.elapsed < 0.18) continue;
      const vector = DIRECTIONS[cannon.dir];
      this.projectiles.push({ x: cannon.x, y: cannon.y, dx: vector.x, dy: vector.y, life: 4 });
      if (Math.hypot(cannon.x - this.player.x, cannon.y - this.player.y) < 5) this.audio.chord([185, 247], 0.03, "square", 0.025);
    }
  }

  updateProjectiles(dt) {
    let alive = 0;
    for (const projectile of this.projectiles) {
      projectile.x += projectile.dx * dt * 5.2;
      projectile.y += projectile.dy * dt * 5.2;
      projectile.life -= dt;
      const gridX = Math.round(projectile.x); const gridY = Math.round(projectile.y);
      if (this.level.rows[gridY]?.[gridX] !== ".") projectile.life = 0;
      if (projectile.life > 0) this.projectiles[alive++] = projectile;
    }
    this.projectiles.length = alive;
  }

  burst(x, y, color, count) {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.7 + Math.random() * 2.1;
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.25 + Math.random() * 0.28, max: 0.53, color });
    }
  }

  updateParticles(dt) {
    let aliveParticles = 0;
    for (const particle of this.particles) {
      particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vx *= 0.92; particle.vy *= 0.92; particle.life -= dt;
      if (particle.life > 0) this.particles[aliveParticles++] = particle;
    }
    this.particles.length = aliveParticles;
    let aliveTrails = 0;
    for (const trail of this.trails) {
      trail.life -= dt;
      if (trail.life > 0) this.trails[aliveTrails++] = trail;
    }
    this.trails.length = aliveTrails;
  }

  die() {
    if (this.invulnerable || this.state !== "playing") return;
    this.state = "dead";
    this.player.direction = null;
    this.flash = this.reducedMotion ? 0.06 : 0.2;
    this.shake = this.reducedMotion ? 0 : 0.32;
    this.burst(this.player.drawX, this.player.drawY, this.skin.primary, 34);
    this.audio.hazard();
    this.callbacks.onDeath?.(this.snapshot());
  }

  respawnFromCheckpoint() {
    const saved = this.checkpointState;
    if (!saved || this.state !== "dead") return false;
    this.state = "playing"; this.paused = false; this.shake = 0; this.flash = 0;
    this.portalFlash = 0;
    this.secretBoostUntil = 0;
    this.player = { x: saved.x, y: saved.y, drawX: saved.x, drawY: saved.y, targetX: saved.x, targetY: saved.y, direction: null, buffered: null, progress: 0 };
    this.dots = new Set(saved.dots); this.coins = new Set(saved.coins);
    this.collectedDots = saved.collectedDots; this.collectedCoins = saved.collectedCoins;
    this.bonusMask = saved.bonusMask || 0;
    this.dashCount = saved.dashCount;
    this.routeDirections = this.routeDirections.slice(0, saved.routeLength);
    this.routeTimings = this.routeTimings.slice(0, saved.routeLength);
    this.breakables = new Set(saved.breakables); this.brokenBreakables = new Set(saved.brokenBreakables);
    this.staticLayerVersion += 1;
    this.crumbleBlocked = new Set(saved.crumbleBlocked); this.openGroups = new Set(saved.openGroups);
    this.groupDeadlines = new Map([...saved.groupRemaining].map(([group, remaining]) => [group, this.elapsed + remaining]));
    this.reachedCheckpoints = new Set(saved.reachedCheckpoints);
    this.projectiles = []; this.particles = []; this.trails = []; this.cannonCycles = new Map();
    this.portalHinted = false; this.lastProgressAt = this.elapsed; this.hintDot = null; this.hintNotified = false; this.assistNotified = false;
    this.audio.checkpoint(); this.callbacks.onRespawn?.(this.snapshot());
    return true;
  }

  win() {
    if (this.state !== "playing") return;
    this.state = "won";
    this.player.direction = null;
    this.burst(this.player.x, this.player.y, CONFIG.colors.yellow, 32);
    this.audio.exit();
    const standardPar = Math.max(1, this.level.minMoves || this.level.solution?.length || this.dashCount);
    const par = Math.max(1, effectivePar(this.level, this.bonusMask) || standardPar);
    const cores = coresForDashes(this.dashCount, par);
    this.callbacks.onWin?.({
      ...this.snapshot(), cores, par, standardPar, moveRatio: this.dashCount / par,
      route: { directions: [...this.routeDirections], timings: [...this.routeTimings], totalDashes: this.dashCount, completionTime: this.elapsed },
    });
  }
}
