import { DIRECTIONS, routeMoveTarget } from "./config.js";
import { bonusObjectives } from "./rating.js";

const SEARCH_LIMIT = 60_000;
const key = (x, y) => `${x},${y}`;
const pointKey = ([x, y]) => key(x, y);
const opposite = { up: "down", down: "up", left: "right", right: "left" };

function inBounds(level, point) {
  return Array.isArray(point) && point.length === 2
    && Number.isInteger(point[0]) && Number.isInteger(point[1])
    && point[0] >= 0 && point[1] >= 0 && point[0] < level.width && point[1] < level.height;
}

function floor(level, point) {
  return inBounds(level, point) && typeof level.rows?.[point[1]] === "string" && level.rows[point[1]][point[0]] === ".";
}

function traversalContext(level, dots = level.dots || [], coins = []) {
  // ponytail: mutable breakables/crumbles stay out of this bounded search; generated verified routes must not rely on them.
  const collectibleBits = new Map();
  // ponytail: a 30-bit Number mask covers the authored ceiling (currently 19 collectibles); split masks if rooms ever exceed it.
  let nextBit = 1;
  const addCollectible = (point) => {
    const cell = pointKey(point);
    if (!collectibleBits.has(cell)) {
      collectibleBits.set(cell, nextBit);
      if (collectibleBits.size >= 30) throw new Error("Level validation supports at most 30 collectible cells");
      nextBit *= 2;
    }
    return collectibleBits.get(cell);
  };
  let dotMask = 0;
  for (const point of dots) dotMask |= addCollectible(point);
  for (const point of coins) addCollectible(point);

  const groupBits = new Map();
  let nextGroup = 1;
  const groupBit = (group) => {
    if (!groupBits.has(group)) {
      groupBits.set(group, nextGroup);
      if (groupBits.size >= 30) throw new Error("Level validation supports at most 30 gate groups");
      nextGroup *= 2;
    }
    return groupBits.get(group);
  };
  const gates = new Map();
  for (const gate of level.mechanics?.gates || []) gates.set(key(gate.x, gate.y), (gates.get(key(gate.x, gate.y)) || 0) | groupBit(gate.group));
  const switches = new Map();
  for (const item of level.mechanics?.switches || []) switches.set(key(item.x, item.y), (switches.get(key(item.x, item.y)) || 0) | groupBit(item.group));

  const portals = new Map();
  for (const portal of level.mechanics?.portals || []) {
    portals.set(pointKey(portal.a), portal.b);
    portals.set(pointKey(portal.b), portal.a);
  }
  return {
    collectibleBits,
    dotMask,
    targetMask: nextBit - 1,
    gates,
    switches,
    // ponytail: timed gates stay open in topology checks; add elapsed-time state only if authored routes depend on exact timing.
    oneWays: new Map((level.mechanics?.oneWays || []).map((item) => [key(item.x, item.y), item.dir])),
    portals,
    redirects: new Map((level.mechanics?.redirects || []).map((item) => [key(item.x, item.y), item.dir])),
    spikes: new Set((level.mechanics?.spikes || []).map(pointKey)),
  };
}

function dash(level, context, point, name, mask, openGroups) {
  if (!DIRECTIONS[name]) return null;
  let [x, y] = point;
  let directionName = name;
  let moved = false;
  const cells = [];
  const seen = new Set();
  while (true) {
    const direction = DIRECTIONS[directionName];
    const nx = x + direction.x;
    const ny = y + direction.y;
    const nextKey = key(nx, ny);
    const gateMask = context.gates.get(nextKey) || 0;
    if (level.rows[ny]?.[nx] !== "." || (gateMask && (openGroups & gateMask) !== gateMask) || (context.oneWays.has(nextKey) && context.oneWays.get(nextKey) !== directionName)) break;

    const previous = [x, y];
    x = nx; y = ny; moved = true; cells.push([x, y]);
    mask |= context.collectibleBits.get(nextKey) || 0;
    openGroups |= context.switches.get(nextKey) || 0;

    const portalTarget = context.portals.get(nextKey);
    if (portalTarget) {
      if (context.spikes.has(pointKey(portalTarget))) return null;
      cells.push(portalTarget);
      return { point: [...portalTarget], mask, openGroups, cells, success: false };
    }

    const redirected = context.redirects.get(nextKey);
    if (redirected && DIRECTIONS[redirected]) directionName = redirected;

    if (x === level.exit[0] && y === level.exit[1]) {
      if ((mask & context.dotMask) === context.dotMask) {
        return (mask & context.targetMask) === context.targetMask
          ? { point: [x, y], mask, openGroups, cells, success: true }
          : null;
      }
      return { point: previous, mask, openGroups, cells, success: false };
    }
    if (context.spikes.has(nextKey)) return null;

    const cycle = `${x},${y},${directionName},${openGroups}`;
    if (seen.has(cycle)) return null;
    seen.add(cycle);
  }
  return moved ? { point: [x, y], mask, openGroups, cells, success: false } : null;
}

function stateKey(point, mask, openGroups) {
  return `${pointKey(point)}|${mask.toString(16)}|${openGroups.toString(16)}`;
}

function reconstruct(parents, current, finalMove) {
  const moves = [finalMove];
  while (parents.has(current)) {
    const parent = parents.get(current);
    moves.push(parent.move);
    current = parent.previous;
  }
  return moves.reverse();
}

function searchLevel(level, { dots = level.dots || [], coins = [], maxStates = SEARCH_LIMIT } = {}) {
  const context = traversalContext(level, dots, coins);
  const start = { point: level.start, mask: 0, openGroups: 0 };
  const startKey = stateKey(start.point, start.mask, start.openGroups);
  const queue = [{ ...start, state: startKey }];
  const visited = new Set([startKey]);
  const parents = new Map();

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const name of Object.keys(DIRECTIONS)) {
      const result = dash(level, context, current.point, name, current.mask, current.openGroups);
      if (!result) continue;
      if (result.success) return { solution: reconstruct(parents, current.state, name), explored: visited.size, truncated: false };
      const nextState = stateKey(result.point, result.mask, result.openGroups);
      if (visited.has(nextState)) continue;
      if (visited.size >= maxStates) return { solution: null, explored: visited.size, truncated: true };
      visited.add(nextState);
      parents.set(nextState, { previous: current.state, move: name });
      queue.push({ point: result.point, mask: result.mask, openGroups: result.openGroups, state: nextState });
    }
  }
  return { solution: null, explored: visited.size, truncated: false };
}

export function solveLevel(level, { coins = [], maxStates = SEARCH_LIMIT } = {}) {
  return searchLevel(level, { coins, maxStates }).solution;
}

export function createLevelTraversal(level, { dots = level.dots || [], coins = [] } = {}) {
  const context = traversalContext(level, dots, coins);
  const start = { point: [...level.start], mask: 0, openGroups: 0 };
  return {
    start,
    stateKey: (state) => stateKey(state.point, state.mask, state.openGroups),
    movesFrom(state) {
      return Object.keys(DIRECTIONS).flatMap((direction) => {
        const result = dash(level, context, state.point, direction, state.mask, state.openGroups);
        return result ? [{
          direction,
          success: result.success,
          cells: result.cells,
          state: { point: result.point, mask: result.mask, openGroups: result.openGroups },
        }] : [];
      });
    },
  };
}

function indexedBits(points, label) {
  if (points.length >= 30) throw new Error(`Level validation supports at most 29 ${label}`);
  const bits = new Map();
  for (const [index, point] of points.entries()) {
    const cell = pointKey(point);
    bits.set(cell, (bits.get(cell) || 0) | (2 ** index));
  }
  return bits;
}

function objectiveBits(objectives, type) {
  if (objectives.length >= 30) throw new Error("Level validation supports at most 29 bonus objectives");
  const bits = new Map();
  for (const [index, objective] of objectives.entries()) {
    if (objective.type !== type) continue;
    const cell = key(objective.x, objective.y);
    bits.set(cell, (bits.get(cell) || 0) | (2 ** index));
  }
  return bits;
}

function uniqueBits(points, label) {
  const bits = new Map();
  let nextBit = 1;
  for (const point of points) {
    const cell = pointKey(point);
    if (bits.has(cell)) continue;
    if (bits.size >= 29) throw new Error(`Level validation supports at most 29 ${label}`);
    bits.set(cell, nextBit);
    nextBit *= 2;
  }
  return bits;
}

function bonusTraversalContext(level, objectives) {
  return {
    ...traversalContext(level, level.dots || [], []),
    coinBits: objectiveBits(objectives, "coin"),
    secretBits: objectiveBits(objectives, "secret"),
    breakableBits: uniqueBits(level.mechanics?.breakables || [], "breakables"),
    crumbleBits: uniqueBits(level.mechanics?.crumbles || [], "crumbles"),
  };
}

function bonusStateKey(state) {
  return [
    pointKey(state.point), state.mask, state.bonusMask, state.openGroups,
    state.brokenBreakables, state.crumbleBlocked,
  ].map((value) => typeof value === "number" ? value.toString(16) : value).join("|");
}

function bonusDash(level, context, state, name) {
  if (!DIRECTIONS[name]) return null;
  let [x, y] = state.point;
  let directionName = name;
  let mask = state.mask;
  let bonusMask = state.bonusMask;
  let openGroups = state.openGroups;
  let brokenBreakables = state.brokenBreakables;
  let crumbleBlocked = state.crumbleBlocked;
  let moved = false;
  const cells = [];
  const seen = new Set();

  while (true) {
    const direction = DIRECTIONS[directionName];
    const nx = x + direction.x;
    const ny = y + direction.y;
    const nextKey = key(nx, ny);
    const breakableBit = context.breakableBits.get(nextKey) || 0;
    const breakableOpen = breakableBit && (brokenBreakables & breakableBit) === breakableBit;
    if (level.rows[ny]?.[nx] !== "." && !breakableOpen) {
      if (!breakableBit) break;
      brokenBreakables |= breakableBit;
      bonusMask |= context.secretBits.get(nextKey) || 0;
      return {
        action: { direction: name, counted: moved },
        cells,
        success: false,
        state: { point: [x, y], mask, bonusMask, openGroups, brokenBreakables, crumbleBlocked },
      };
    }

    const gateMask = context.gates.get(nextKey) || 0;
    const crumbleBit = context.crumbleBits.get(nextKey) || 0;
    if ((gateMask && (openGroups & gateMask) !== gateMask)
      || (crumbleBit && (crumbleBlocked & crumbleBit) === crumbleBit)
      || (context.oneWays.has(nextKey) && context.oneWays.get(nextKey) !== directionName)) break;

    const previous = [x, y];
    const previousCrumble = context.crumbleBits.get(key(x, y)) || 0;
    if (previousCrumble) crumbleBlocked |= previousCrumble;
    x = nx; y = ny; moved = true; cells.push([x, y]);
    mask |= context.collectibleBits.get(nextKey) || 0;
    bonusMask |= context.coinBits.get(nextKey) || 0;
    openGroups |= context.switches.get(nextKey) || 0;

    const portalTarget = context.portals.get(nextKey);
    if (portalTarget) {
      if (context.spikes.has(pointKey(portalTarget))) return null;
      cells.push(portalTarget);
      return {
        action: { direction: name, counted: true },
        cells,
        success: false,
        state: { point: [...portalTarget], mask, bonusMask, openGroups, brokenBreakables, crumbleBlocked },
      };
    }

    const redirected = context.redirects.get(nextKey);
    if (redirected && DIRECTIONS[redirected]) directionName = redirected;

    if (x === level.exit[0] && y === level.exit[1]) {
      return {
        action: { direction: name, counted: true },
        cells,
        success: (mask & context.dotMask) === context.dotMask,
        state: {
          point: (mask & context.dotMask) === context.dotMask ? [x, y] : previous,
          mask, bonusMask, openGroups, brokenBreakables, crumbleBlocked,
        },
      };
    }
    if (context.spikes.has(nextKey)) return null;

    const cycle = `${x},${y},${directionName},${openGroups},${brokenBreakables},${crumbleBlocked}`;
    if (seen.has(cycle)) return null;
    seen.add(cycle);
  }

  return moved ? {
    action: { direction: name, counted: true },
    cells,
    success: false,
    state: { point: [x, y], mask, bonusMask, openGroups, brokenBreakables, crumbleBlocked },
  } : null;
}

function reconstructBonusActions(parents, current, finalAction) {
  const actions = [finalAction];
  while (parents.has(current)) {
    const parent = parents.get(current);
    actions.push(parent.action);
    current = parent.previous;
  }
  return actions.reverse();
}

function bonusWitness(parents, current, action, bonusMask) {
  const actions = reconstructBonusActions(parents, current, action);
  const directions = actions.filter((item) => item.counted).map((item) => item.direction);
  return { actions, directions, dashes: directions.length, bonusMask };
}

export function solveBonusMasks(level, { maxStates = SEARCH_LIMIT } = {}) {
  const objectives = bonusObjectives(level);
  const maskCount = 2 ** objectives.length;
  const context = bonusTraversalContext(level, objectives);
  const start = {
    point: [...level.start], mask: 0, bonusMask: 0, openGroups: 0,
    brokenBreakables: 0, crumbleBlocked: 0,
  };
  const startKey = bonusStateKey(start);
  const buckets = [[{ ...start, state: startKey }]];
  const distances = new Map([[startKey, 0]]);
  const parents = new Map();
  const solutionsByMask = Array(maskCount).fill(null);
  let standardWitness = null;
  let truncated = false;

  for (let distance = 0; distance < buckets.length && !truncated; distance += 1) {
    const bucket = buckets[distance] || [];
    for (let cursor = 0; cursor < bucket.length; cursor += 1) {
      const current = bucket[cursor];
      if (distances.get(current.state) !== distance) continue;
      for (const name of Object.keys(DIRECTIONS)) {
        const result = bonusDash(level, context, current, name);
        if (!result) continue;
        const nextDistance = distance + (result.action.counted ? 1 : 0);
        if (result.success) {
          if (!standardWitness || !solutionsByMask[result.state.bonusMask]) {
            const witness = bonusWitness(parents, current.state, result.action, result.state.bonusMask);
            if (!standardWitness) standardWitness = witness;
            if (!solutionsByMask[result.state.bonusMask]) solutionsByMask[result.state.bonusMask] = witness;
          }
          continue;
        }

        const nextState = bonusStateKey(result.state);
        const previousDistance = distances.get(nextState);
        if (previousDistance !== undefined && previousDistance <= nextDistance) continue;
        if (distances.size >= maxStates) { truncated = true; break; }
        distances.set(nextState, nextDistance);
        parents.set(nextState, { previous: current.state, action: result.action });
        if (!buckets[nextDistance]) buckets[nextDistance] = [];
        buckets[nextDistance].push({ ...result.state, state: nextState });
      }
      if (truncated) break;
    }
  }

  return {
    standardSolution: standardWitness?.directions || null,
    bonusSolutionsByMask: solutionsByMask,
    optimalDashesByBonusMask: solutionsByMask.map((solution) => solution?.dashes ?? null),
    explored: distances.size,
    truncated,
  };
}

export function traceLevelSolution(level, solution, dots = level.dots || [], coins = []) {
  if (!Array.isArray(solution) || !solution.length) return null;
  const context = traversalContext(level, dots, coins);
  let point = level.start;
  let mask = 0;
  let openGroups = 0;
  let previous = null;
  let decisions = 0;
  let backtracks = 0;
  let deadEnds = 0;
  let alternativeRoutes = 0;
  const meaningfulStops = new Set();
  const cells = [];
  const stops = [pointKey(point)];

  for (const [index, name] of solution.entries()) {
    const options = Object.keys(DIRECTIONS).map((optionName) => ({
      name: optionName,
      result: dash(level, context, point, optionName, mask, openGroups),
    })).filter(({ result }) => result);
    if (options.length >= 3) decisions += 1;
    if (options.length === 1) deadEnds += 1;
    if (options.filter(({ name: optionName }) => !previous || optionName !== opposite[previous]).length >= 2) meaningfulStops.add(pointKey(point));
    alternativeRoutes += Math.max(0, options.length - 1);

    const selected = options.find((option) => option.name === name)?.result;
    if (!selected || (selected.success && index !== solution.length - 1)) return null;
    if (previous && opposite[previous] === name) backtracks += 1;
    previous = name;
    point = selected.point;
    mask = selected.mask;
    openGroups = selected.openGroups;
    cells.push(...selected.cells.map(pointKey));
    stops.push(pointKey(point));
    if (index === solution.length - 1 && !selected.success) return null;
  }
  return { cells, stops, decisions, meaningfulDecisions: meaningfulStops.size, deadEnds, alternativeRoutes, backtracks };
}

export function solutionCollectsEveryDot(level, solution = level.solution) {
  return Boolean(traceLevelSolution(level, solution));
}

export function bonusCoinReachability(level) {
  const required = searchLevel(level);
  const combined = searchLevel(level, { coins: level.coins || [] });
  const unreachable = [];
  const detourMoves = [];
  let truncated = required.truncated || combined.truncated;
  for (const coin of level.coins || []) {
    const result = searchLevel(level, { coins: [coin] });
    truncated ||= result.truncated;
    if (!result.solution) unreachable.push(coin);
    else if (required.solution) detourMoves.push(result.solution.length - required.solution.length);
  }
  return {
    reachable: Boolean(required.solution && combined.solution) && unreachable.length === 0,
    combinedReachable: Boolean(combined.solution),
    unreachable,
    detourMoves,
    minimumDetourMoves: detourMoves.length ? Math.min(...detourMoves) : 0,
    combinedDetourMoves: required.solution && combined.solution ? combined.solution.length - required.solution.length : 0,
    truncated,
  };
}

function patrolCells(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to) || (from[0] !== to[0] && from[1] !== to[1])) return [];
  const dx = Math.sign(to[0] - from[0]); const dy = Math.sign(to[1] - from[1]);
  const cells = [pointKey(from)];
  let x = from[0]; let y = from[1];
  while (x !== to[0] || y !== to[1]) { x += dx; y += dy; cells.push(key(x, y)); }
  return cells;
}

function objectiveBranchComponents(level, baselineCells) {
  const blocked = new Set((level.mechanics?.spikes || []).map(pointKey));
  const remaining = new Set();
  for (let y = 0; y < level.height; y += 1) for (let x = 0; x < level.width; x += 1) {
    const cell = key(x, y);
    if (level.rows[y]?.[x] === "." && !baselineCells.has(cell) && !blocked.has(cell)) remaining.add(cell);
  }
  const dotCells = new Set((level.dots || []).map(pointKey));
  const components = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    const queue = [first];
    const component = new Set([first]);
    remaining.delete(first);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const [x, y] = queue[cursor].split(",").map(Number);
      for (const direction of Object.values(DIRECTIONS)) {
        const neighbour = key(x + direction.x, y + direction.y);
        if (!remaining.delete(neighbour)) continue;
        component.add(neighbour);
        queue.push(neighbour);
      }
    }
    if ([...component].some((cell) => dotCells.has(cell))) components.push(component);
  }
  return components;
}

export function analyzeLevelQuality(level, solution = level.solution) {
  const trace = traceLevelSolution(level, solution);
  if (!trace) return null;
  const floorCells = level.rows.reduce((sum, row) => sum + [...row].filter((cell) => cell === ".").length, 0);
  const hazardCells = new Set([
    ...(level.mechanics?.spikes || []),
    ...(level.mechanics?.timedSpikes || []).map(({ x, y }) => [x, y]),
    ...(level.mechanics?.movers || []).flatMap(({ from, to }) => [from, to]),
    ...(level.mechanics?.cannons || []).map(({ x, y }) => [x, y]),
    ...(level.mechanics?.enemies || []).flatMap(({ path = [] }) => path),
    ...(level.mechanics?.pulses || []).map(({ x, y }) => [x, y]),
  ].map(pointKey));
  const dynamicHazards = new Set([
    ...(level.mechanics?.timedSpikes || []).map(({ x, y }) => [x, y]),
    ...(level.mechanics?.movers || []).flatMap(({ from, to }) => [from, to]),
    ...(level.mechanics?.cannons || []).map(({ x, y }) => [x, y]),
    ...(level.mechanics?.enemies || []).flatMap(({ path = [] }) => path),
    ...(level.mechanics?.pulses || []).map(({ x, y }) => [x, y]),
  ].map(pointKey));
  const reactionLoad = (level.mechanics?.timedSpikes || []).length
    + (level.mechanics?.movers || []).length * 2
    + (level.mechanics?.cannons || []).length * 2
    + (level.mechanics?.enemies || []).length * 2
    + (level.mechanics?.pulses || []).length;

  const direct = searchLevel(level, { dots: [] });
  const required = searchLevel(level);
  const directTrace = direct.solution ? traceLevelSolution(level, direct.solution, []) : null;
  const baselineCells = new Set([pointKey(level.start), ...(directTrace?.cells || [])]);
  const branches = objectiveBranchComponents(level, baselineCells);
  const bonus = bonusCoinReachability(level);
  return {
    routeMoves: solution.length,
    uniqueCells: new Set(trace.cells).size,
    decisionStops: trace.decisions,
    meaningfulDecisions: trace.meaningfulDecisions,
    deadEnds: trace.deadEnds,
    alternativeRoutes: trace.alternativeRoutes,
    revisitedStops: trace.stops.length - new Set(trace.stops).size,
    backtracks: trace.backtracks,
    objectiveBranches: branches.length,
    objectiveDetourMoves: direct.solution && required.solution ? required.solution.length - direct.solution.length : 0,
    rewardDetourMoves: bonus.minimumDetourMoves,
    combinedRewardDetourMoves: bonus.combinedDetourMoves,
    forcedHazardObjectives: branches.filter((component) => [...component].some((cell) => dynamicHazards.has(cell))).length,
    trapDensity: floorCells ? Number((hazardCells.size / floorCells).toFixed(3)) : 0,
    reactionLoad,
  };
}

function requiredObjectiveBranches(level) {
  if (level.id < 5) return 0;
  if (level.id < 21) return 1;
  if (level.id < 101) return 2;
  return 3;
}

export function validateLevel(level) {
  const errors = [];
  const mechanics = level.mechanics || {};
  const requireFloor = (point, label) => {
    if (!inBounds(level, point)) errors.push(`${label} is out of bounds ${point}`);
    else if (!floor(level, point)) errors.push(`${label} is blocked ${point}`);
  };
  const requirePeriod = (item, label) => {
    if (!Number.isFinite(Number(item?.period)) || Number(item.period) <= 0) errors.push(`${label} has an invalid period`);
  };
  if (!Number.isInteger(level.id) || level.id < 1 || level.id > 250) errors.push("invalid id");
  if (!Number.isInteger(level.width) || !Number.isInteger(level.height)) errors.push("invalid dimensions");
  if (!Array.isArray(level.rows) || level.rows.length !== level.height || level.rows.some((row) => typeof row !== "string" || row.length !== level.width)) errors.push("row dimensions mismatch");
  if (!floor(level, level.start)) errors.push("start is missing or blocked");
  if (!floor(level, level.exit)) errors.push("exit is missing or blocked");
  for (const point of level.dots || []) requireFloor(point, "required dot");
  for (const point of level.coins || []) requireFloor(point, "bonus coin");
  for (const point of mechanics.spikes || []) requireFloor(point, "spike");
  for (const point of mechanics.crumbles || []) requireFloor(point, "crumble");
  for (const point of mechanics.checkpoints || []) requireFloor(point, "checkpoint");
  for (const point of mechanics.breakables || []) {
    if (!inBounds(level, point)) errors.push(`breakable is out of bounds ${point}`);
    else if (floor(level, point)) errors.push(`breakable must replace a wall ${point}`);
  }
  for (const [label, items] of [["timed spike", mechanics.timedSpikes], ["pulse", mechanics.pulses]]) for (const item of items || []) {
    requireFloor([item?.x, item?.y], label); requirePeriod(item, label);
  }
  for (const item of mechanics.cannons || []) {
    requireFloor([item?.x, item?.y], "cannon"); requirePeriod(item, "cannon");
    if (!DIRECTIONS[item?.dir]) errors.push("cannon has an invalid direction");
  }
  for (const item of mechanics.movers || []) {
    requireFloor(item?.from, "mover start"); requireFloor(item?.to, "mover end"); requirePeriod(item, "mover");
    if (pointKey(item?.from || []) === pointKey(item?.to || []) || (item?.from?.[0] !== item?.to?.[0] && item?.from?.[1] !== item?.to?.[1])) errors.push("mover needs a non-zero straight patrol");
  }
  for (const item of mechanics.enemies || []) {
    if (!Array.isArray(item?.path) || item.path.length < 2) errors.push("enemy has an invalid path");
    else for (const point of item.path) requireFloor(point, "enemy path");
    requirePeriod(item, "enemy");
    if (item?.path?.length >= 2 && (pointKey(item.path[0]) === pointKey(item.path[1])
      || (item.path[0][0] !== item.path[1][0] && item.path[0][1] !== item.path[1][1]))) errors.push("enemy needs a non-zero straight patrol");
  }
  const spikeCells = new Set((mechanics.spikes || []).filter((point) => inBounds(level, point)).map(pointKey));
  for (const point of level.dots || []) if (spikeCells.has(pointKey(point))) errors.push(`required dot on permanent spike ${point}`);
  for (const point of level.coins || []) if (spikeCells.has(pointKey(point))) errors.push(`bonus coin on permanent spike ${point}`);
  const breakableKeys = new Set((mechanics.breakables || []).filter((point) => inBounds(level, point)).map(pointKey));
  const secretIds = new Set();
  for (const secret of mechanics.secrets || []) {
    const point = [secret?.x, secret?.y];
    if (!inBounds(level, point) || !breakableKeys.has(pointKey(point))) errors.push("secret is outside a breakable block");
    if (!secret?.id || ["cache", "crystal", "boost"].indexOf(secret.kind) < 0) errors.push("invalid secret reward");
    if (secretIds.has(secret?.id)) errors.push("duplicate secret id");
    secretIds.add(secret?.id);
  }
  for (const portal of mechanics.portals || []) {
    if (!floor(level, portal.a) || !floor(level, portal.b) || pointKey(portal.a) === pointKey(portal.b)) errors.push("invalid portal pair");
  }
  const groups = new Set();
  for (const item of mechanics.switches || []) {
    requireFloor([item?.x, item?.y], "switch");
    if (typeof item?.group !== "string" || !item.group) errors.push("switch has an invalid group");
    else groups.add(item.group);
  }
  for (const gate of mechanics.gates || []) {
    requireFloor([gate?.x, gate?.y], "gate");
    if (!groups.has(gate?.group)) errors.push(`gate without switch ${gate?.group}`);
    if (gate?.timed && (!Number.isFinite(Number(gate.duration)) || Number(gate.duration) <= 0)) errors.push("timed gate has an invalid duration");
  }
  for (const item of mechanics.oneWays || []) {
    requireFloor([item?.x, item?.y], "one-way");
    if (!DIRECTIONS[item?.dir]) errors.push("invalid forced direction");
  }
  for (const item of mechanics.redirects || []) {
    requireFloor([item?.x, item?.y], "redirect");
    if (!DIRECTIONS[item?.dir]) errors.push("invalid forced direction");
  }

  const required = errors.length ? null : searchLevel(level);
  if (required?.truncated) errors.push("required-dot search exceeded its state limit");
  else if (required && !required.solution) errors.push("no route collects every required dot before exit");
  if (required?.solution && !solutionCollectsEveryDot(level)) errors.push("stored route does not collect every required dot before exit");

  const bonus = required?.solution ? bonusCoinReachability(level) : null;
  if (bonus?.truncated) errors.push("bonus-coin search exceeded its state limit");
  for (const point of bonus?.unreachable || []) errors.push(`bonus coin is not collectible on a completable route ${point}`);
  if (bonus && !bonus.unreachable.length && !bonus.combinedReachable) errors.push("bonus coins cannot all be collected on one completable route");
  const rewardSolution = required?.solution && bonus?.combinedReachable ? searchLevel(level, { coins: level.coins || [] }).solution : null;
  if (required?.solution && rewardSolution) {
    const requiredTrace = traceLevelSolution(level, required.solution);
    const rewardTrace = traceLevelSolution(level, rewardSolution, level.dots || [], level.coins || []);
    const protectedCells = new Set([pointKey(level.start), ...(requiredTrace?.cells || []), ...(rewardTrace?.cells || [])]);
    const patrols = [
      ...(mechanics.movers || []).map((item) => [item.from, item.to]),
      ...(mechanics.enemies || []).map((item) => [item.path?.[0], item.path?.[1]]),
    ];
    for (const [from, to] of patrols) {
      const intersections = patrolCells(from, to).filter((cell) => protectedCells.has(cell));
      if (intersections.length !== 1) errors.push(`patrol must cross protected routes once, found ${intersections.length}`);
    }
  }

  const quality = errors.length ? null : analyzeLevelQuality(level);
  if (quality && level.id > 1 && quality.routeMoves < routeMoveTarget(level.id)) errors.push("route is shorter than its progression target");
  if (quality && quality.uniqueCells < Math.ceil(quality.routeMoves * 1.45)) errors.push("route has too little unique traversal");
  const branchTarget = requiredObjectiveBranches(level);
  if (quality && quality.objectiveBranches < branchTarget) errors.push(`level needs at least ${branchTarget} objective branches`);
  if (quality && quality.objectiveDetourMoves < branchTarget * 2) errors.push("required objectives do not create a meaningful detour");
  if (quality && level.id > 1 && (level.coins || []).length && quality.rewardDetourMoves < 2) errors.push("bonus coin does not create a meaningful detour");
  return { valid: errors.length === 0, errors, solution: required?.solution || null };
}

export function validateAllLevels(levels) {
  const layouts = new Set();
  const results = levels.map((level) => {
    const result = validateLevel(level);
    const layout = level.rows.join("/");
    if (layouts.has(layout)) result.errors.push("duplicate layout");
    layouts.add(layout);
    result.valid = result.errors.length === 0;
    return { id: level.id, ...result };
  });
  return { valid: results.every((result) => result.valid), results, passed: results.filter((result) => result.valid).length };
}
