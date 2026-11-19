import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { levelKindFor, routeMoveTarget } from "../src/config.js";
import { NeonGame } from "../src/game.js";
import { analyzeLevelQuality, solveLevel, traceLevelSolution, validateLevel } from "../src/level-validator.js";

const DIRS = [
  [0, -1, "up"], [1, 0, "right"], [0, 1, "down"], [-1, 0, "left"],
];

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

const key = ([x, y]) => `${x},${y}`;
const parse = (value) => value.split(",").map(Number);
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

function carveMaze(width, height, random, loops) {
  const grid = Array.from({ length: height }, () => Array(width).fill("#"));
  const start = [1, height - 2];
  const stack = [start];
  grid[start[1]][start[0]] = ".";
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const choices = shuffle(DIRS.map(([dx, dy]) => [x + dx * 2, y + dy * 2, dx, dy]), random)
      .filter(([nx, ny]) => nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1 && grid[ny][nx] === "#");
    if (!choices.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = choices[0];
    grid[y + dy][x + dx] = ".";
    grid[ny][nx] = ".";
    stack.push([nx, ny]);
  }
  const loopWalls = [];
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    if (grid[y][x] !== "#") continue;
    const horizontal = grid[y][x - 1] === "." && grid[y][x + 1] === ".";
    const vertical = grid[y - 1][x] === "." && grid[y + 1][x] === ".";
    if (horizontal !== vertical) loopWalls.push([x, y]);
  }
  shuffle(loopWalls, random).slice(0, loops).forEach(([x, y]) => { grid[y][x] = "."; });
  return { grid, start };
}

function slide(grid, from, direction, blockers = new Set()) {
  const [dx, dy, name] = direction;
  let [x, y] = from;
  const cells = [];
  while (grid[y + dy]?.[x + dx] === "." && !blockers.has(`${x + dx},${y + dy}`)) {
    x += dx; y += dy; cells.push([x, y]);
  }
  return cells.length ? { end: [x, y], cells, direction: name } : null;
}

function dashGraph(grid, start, blockers = new Set()) {
  const queue = [start];
  const distance = new Map([[key(start), 0]]);
  const parent = new Map();
  const transitions = new Map();
  const edges = new Map();
  const traversed = new Set([key(start)]);
  while (queue.length) {
    const point = queue.shift();
    const moves = [];
    for (const direction of DIRS) {
      const move = slide(grid, point, direction, blockers);
      if (!move) continue;
      moves.push(move);
      move.cells.forEach((cell) => traversed.add(key(cell)));
      const nextKey = key(move.end);
      transitions.set(`${key(point)}:${direction[2]}`, move.cells);
      if (distance.has(nextKey)) continue;
      distance.set(nextKey, distance.get(key(point)) + 1);
      parent.set(nextKey, { from: key(point), direction: direction[2], cells: move.cells });
      queue.push(move.end);
    }
    edges.set(key(point), moves);
  }
  return { distance, parent, transitions, traversed, edges };
}

function routeQuality(grid, start, moves) {
  let point = start;
  let previous = null;
  const cells = [];
  const segments = [];
  const stops = [[...start]];
  let decisions = 0;
  let backtracks = 0;
  for (const name of moves) {
    const options = DIRS.map((direction) => slide(grid, point, direction)).filter(Boolean);
    if (options.length >= 3) decisions += 1;
    const move = options.find((item) => item.direction === name);
    if (!move) return null;
    if (previous && OPPOSITE[previous] === name) backtracks += 1;
    previous = name;
    cells.push(...move.cells);
    segments.push(move);
    point = move.end;
    stops.push([...point]);
  }
  const uniqueCells = new Set(cells.map(key));
  const uniqueStops = new Set(stops.map(key));
  return {
    exit: point, cells, segments, stops, moves: [...moves],
    uniqueCells: uniqueCells.size,
    decisionStops: decisions,
    revisitedStops: stops.length - uniqueStops.size,
    backtracks,
  };
}

function pick(items, count, random, used = new Set()) {
  const candidates = shuffle(items.filter((point) => !used.has(key(point))), random);
  const selected = candidates.slice(0, Math.max(0, Math.min(count, candidates.length)));
  selected.forEach((point) => used.add(key(point)));
  return selected;
}

function draftLevel(grid, start, exit, dots = [], mechanics = {}) {
  return {
    width: grid[0].length, height: grid.length, rows: grid.map((row) => row.join("")),
    start, exit, dots, coins: [], mechanics,
  };
}

function verifiedPlainRoute(grid, level, moves, coins = []) {
  const traced = moves && traceLevelSolution(level, moves, level.dots, coins);
  const route = moves && routeQuality(grid, level.start, moves);
  if (!traced || !route || traced.cells.join("|") !== route.cells.map(key).join("|") || traced.stops.join("|") !== route.stops.map(key).join("|")) return null;
  return route;
}

function branchTarget(level) {
  if (level < 5) return 0;
  if (level < 21) return 1;
  if (level < 101) return 2;
  return 3;
}

function terminalExits(graph, start, random) {
  const interior = new Set([...graph.edges.values()].flatMap((moves) => moves.flatMap((move) => move.cells.slice(0, -1).map(key))));
  const exits = [...graph.distance].filter(([cell]) => cell !== key(start) && !interior.has(cell)).map(([cell]) => parse(cell));
  shuffle(exits, random);
  return exits.sort((left, right) => graph.distance.get(key(right)) - graph.distance.get(key(left)));
}

function offRouteComponents(grid, route) {
  const baseline = new Set([key(route.stops[0]), ...route.cells.map(key)]);
  const remaining = new Set();
  for (let y = 1; y < grid.length - 1; y += 1) for (let x = 1; x < grid[0].length - 1; x += 1) {
    if (grid[y][x] === "." && !baseline.has(`${x},${y}`)) remaining.add(`${x},${y}`);
  }
  const componentByCell = new Map();
  let component = 0;
  while (remaining.size) {
    const first = remaining.values().next().value;
    const queue = [first];
    remaining.delete(first);
    component += 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const [x, y] = parse(queue[cursor]);
      componentByCell.set(queue[cursor], component);
      for (const [dx, dy] of DIRS) {
        const neighbour = `${x + dx},${y + dy}`;
        if (remaining.delete(neighbour)) queue.push(neighbour);
      }
    }
  }
  return componentByCell;
}

function samplePoints(points, count) {
  const unique = uniquePoints(points);
  if (unique.length <= count) return unique;
  return Array.from({ length: count }, (_, index) => unique[Math.round(index * (unique.length - 1) / (count - 1))]);
}

function objectiveDots(level, anchors, components, route) {
  const clusterSize = level < 21 ? 5 : 4;
  return uniquePoints(anchors.flatMap((anchor) => {
    const branchCells = route.cells.filter((point) => components.get(key(point)) === anchor.component);
    return samplePoints([...branchCells, anchor.point], clusterSize);
  }));
}

function planObjectives(level, grid, graph, start, exit, random) {
  const target = routeMoveTarget(level);
  const empty = draftLevel(grid, start, exit);
  const directMoves = solveLevel(empty);
  const directRoute = verifiedPlainRoute(grid, empty, directMoves);
  if (!directRoute || key(directRoute.exit) !== key(exit)) return null;

  const components = offRouteComponents(grid, directRoute);
  const candidates = shuffle([...graph.distance.keys()].map(parse).filter((point) => components.has(key(point))), random);
  const eligible = [];
  for (const point of candidates) {
    const moves = solveLevel({ ...empty, dots: [point] });
    if (moves?.length >= directMoves.length + 2) eligible.push({ point, component: components.get(key(point)) });
  }

  const anchors = [];
  let moves = directMoves;
  const minimumBranches = branchTarget(level);
  while ((anchors.length < minimumBranches || moves.length < target) && anchors.length < 7) {
    let best = null;
    for (const candidate of eligible) {
      if (anchors.some((item) => item.component === candidate.component)) continue;
      const trial = solveLevel({ ...empty, dots: [...anchors.map((item) => item.point), candidate.point] });
      if (!trial || trial.length < moves.length + 2) continue;
      const needsBranches = anchors.length < minimumBranches;
      const reachesTarget = trial.length >= target;
      const better = !best
        || (needsBranches ? trial.length < best.moves.length
          : reachesTarget === (best.moves.length >= target)
            ? (reachesTarget ? trial.length < best.moves.length : trial.length > best.moves.length)
            : reachesTarget);
      if (better) best = { ...candidate, moves: trial };
    }
    if (!best) return null;
    anchors.push(best);
    moves = best.moves;
  }
  if (anchors.length < minimumBranches || moves.length < target) return null;
  const anchorRoute = verifiedPlainRoute(grid, { ...empty, dots: anchors.map((item) => item.point) }, moves);
  if (!anchorRoute) return null;
  const dots = objectiveDots(level, anchors, components, anchorRoute);
  const planned = { ...empty, dots };
  moves = solveLevel(planned);
  const route = verifiedPlainRoute(grid, planned, moves);
  return route && key(route.exit) === key(exit) ? {
    dots, moves, route, directRoute,
    objectiveBranches: anchors.length, objectiveDetourMoves: moves.length - directMoves.length,
  } : null;
}

function planCoins(grid, graph, start, exit, dots, required, count, random) {
  const base = draftLevel(grid, start, exit, dots);
  const requiredCells = new Set([key(start), ...required.route.cells.map(key)]);
  const candidates = shuffle([...graph.traversed].map(parse).filter((point) => !requiredCells.has(key(point)) && !dots.some((dot) => key(dot) === key(point))), random);
  const eligible = [];
  for (const point of candidates) {
    const moves = solveLevel(base, { coins: [point] });
    if (!moves || moves.length < required.moves.length + 2) continue;
    const route = verifiedPlainRoute(grid, base, moves, [point]);
    if (route && key(route.exit) === key(exit)) eligible.push({ point, moves, route, detour: moves.length - required.moves.length });
  }
  eligible.sort((left, right) => left.detour - right.detour);

  const coins = [];
  const protectedRoutes = [];
  let combinedMoves = required.moves;
  while (coins.length < count) {
    let best = null;
    for (const candidate of eligible) {
      if (coins.some((point) => key(point) === key(candidate.point))) continue;
      const trial = solveLevel(base, { coins: [...coins, candidate.point] });
      if (trial && (!best || trial.length < best.moves.length)) best = { candidate, moves: trial };
    }
    if (!best) return null;
    coins.push(best.candidate.point);
    protectedRoutes.push(best.candidate.route);
    combinedMoves = best.moves;
  }
  const route = verifiedPlainRoute(grid, base, combinedMoves, coins);
  return route && key(route.exit) === key(exit) ? {
    coins, moves: combinedMoves, route, protectedRoutes,
    rewardDetourMoves: Math.min(...coins.map((point) => eligible.find((item) => key(item.point) === key(point)).detour)),
  } : null;
}

const FEATURE_UNLOCKS = [
  [3, "spikes"], [11, "timedSpikes"], [26, "movers"], [41, "cannons"],
  [56, "breakables"], [71, "oneWays"], [86, "enemies"], [86, "switches"],
  [101, "portals"], [141, "timedGates"], [161, "redirects"], [181, "crumbles"], [201, "pulses"],
];

function featureBand(level) {
  if (level <= 2) return ["movement"];
  const unlocked = FEATURE_UNLOCKS.filter(([firstLevel]) => firstLevel <= level);
  const kind = levelKindFor(level);
  const count = Math.min(unlocked.length, level === 250 || kind === "sector" ? 3 : kind === "challenge" ? 2 : 1);
  const newest = unlocked.findIndex(([firstLevel]) => firstLevel === level);
  const cursor = newest >= 0 ? newest : level % unlocked.length;
  return Array.from({ length: count }, (_, offset) => unlocked[(cursor - offset + unlocked.length) % unlocked.length][1]);
}

function openAlong(grid, point, random) {
  const [x, y] = point;
  const directions = shuffle(DIRS.filter(([dx, dy]) => grid[y + dy]?.[x + dx] === "."), random);
  if (!directions.length) return null;
  const [dx, dy] = directions[0];
  let ex = x; let ey = y;
  while (grid[ey + dy]?.[ex + dx] === ".") { ex += dx; ey += dy; }
  return { from: [x, y], to: [ex, ey] };
}

function sidePatrol(grid, candidates, protectedCells, random, used) {
  for (const point of candidates) {
    if (used.has(key(point))) continue;
    const [x, y] = point;
    const directions = shuffle(DIRS.filter(([dx, dy]) => grid[y + dy]?.[x + dx] === "."
      && !protectedCells.has(`${x + dx},${y + dy}`)), random);
    for (const [dx, dy] of directions) {
      let ex = x; let ey = y;
      const cells = [];
      while (grid[ey + dy]?.[ex + dx] === "." && !protectedCells.has(`${ex + dx},${ey + dy}`)) {
        ex += dx; ey += dy; cells.push([ex, ey]);
      }
      if (!cells.length) continue;
      used.add(key(point)); cells.forEach((cell) => used.add(key(cell)));
      return { from: point, to: [ex, ey] };
    }
  }
  return null;
}

const silentAudio = new Proxy({}, { get: () => () => {} });
const testSkin = { primary: "#36e4ff", secondary: "#ffe45c", effect: "spark" };

export function runtimeRouteWins(level, route, dt) {
  const game = new NeonGame(silentAudio);
  game.load(level, testSkin);
  for (const direction of route) {
    if (!game.input(direction)) return false;
    for (let frame = 0; game.player.direction && game.state === "playing" && frame < 2_000; frame += 1) game.update(dt);
    if (game.state === "dead" || game.player.direction) return false;
  }
  return game.state === "won";
}

function tuneDynamicPhases(level, routes, random) {
  const dynamic = ["timedSpikes", "movers", "cannons", "enemies", "pulses"]
    .flatMap((name) => level.mechanics?.[name] || []);
  if (!dynamic.length) return true;
  for (let attempt = 0; attempt < 192; attempt += 1) {
    dynamic.forEach((item) => { item.phase = random(); });
    if (routes.every((route) => [1 / 30, 1 / 60, 1 / 120].every((dt) => runtimeRouteWins(level, route, dt)))) return true;
  }
  return false;
}

function wallCandidates(grid) {
  const points = [];
  for (let y = 1; y < grid.length - 1; y += 1) for (let x = 1; x < grid[0].length - 1; x += 1) {
    if (grid[y][x] !== "#") continue;
    const horizontal = grid[y][x - 1] === "." && grid[y][x + 1] === ".";
    const vertical = grid[y - 1][x] === "." && grid[y + 1][x] === ".";
    if (horizontal || vertical) points.push([x, y]);
  }
  return points;
}

function uniquePoints(points) {
  return [...new Map(points.map((point) => [key(point), point])).values()];
}

function wrongChoices(grid, routes, protectedCells) {
  const choices = [];
  for (const route of routes) for (let index = 0; index < route.moves.length; index += 1) {
    const stop = route.stops[index];
    for (const direction of DIRS) {
      if (direction[2] === route.moves[index]) continue;
      const move = slide(grid, stop, direction);
      const cells = move?.cells.filter((point) => !protectedCells.has(key(point))) || [];
      if (!cells.length) continue;
      choices.push({ point: cells[Math.floor(cells.length / 2)], dir: OPPOSITE[direction[2]] });
    }
  }
  return [...new Map(choices.map((choice) => [key(choice.point), choice])).values()];
}

function directedRouteCells(routes, excluded) {
  const visits = new Map();
  for (const route of routes) for (const segment of route.segments) for (const point of segment.cells) {
    const cell = key(point);
    if (!visits.has(cell)) visits.set(cell, { point, directions: new Set() });
    visits.get(cell).directions.add(segment.direction);
  }
  return [...visits.values()].filter(({ point, directions }) => directions.size === 1 && !excluded.has(key(point)))
    .map(({ point, directions }) => ({ point, dir: [...directions][0] }));
}

function createMechanics(level, grid, required, reward, random, start, exit, dots, coins) {
  const features = featureBand(level);
  if (features[0] === "movement") return {};
  const routes = [required.route, reward.route, ...reward.protectedRoutes];
  const verified = new Set(routes.flatMap((route) => route.cells.map(key)));
  const requiredCells = new Set(required.route.cells.map(key));
  const items = new Set([key(start), key(exit), ...dots.map(key), ...coins.map(key)]);
  const used = new Set(items);
  const direct = new Set(required.directRoute.cells.map(key));
  const objectiveApproach = uniquePoints(required.route.cells.filter((point) => !direct.has(key(point)) && !items.has(key(point))));
  const rewardApproach = uniquePoints(routes.slice(1).flatMap((route) => route.cells).filter((point) => !requiredCells.has(key(point)) && !items.has(key(point))));
  const fallbackApproach = uniquePoints(required.route.cells.filter((point) => !items.has(key(point))));
  const dynamicCandidates = shuffle([...objectiveApproach, ...rewardApproach, ...fallbackApproach], random);
  const wrong = shuffle(wrongChoices(grid, routes, verified), random);
  const directed = shuffle(directedRouteCells(routes, items), random);
  const mechanics = {};
  const takePoint = (candidates) => pick(candidates.map((item) => item.point || item), 1, random, used)[0];

  if (features.includes("spikes")) {
    const point = takePoint(wrong);
    if (!point) return null;
    mechanics.spikes = [point];
  }
  if (features.includes("timedSpikes")) {
    const point = takePoint(dynamicCandidates);
    if (!point) return null;
    mechanics.timedSpikes = [{ x: point[0], y: point[1], period: 2.4, phase: random() }];
  }
  if (features.includes("movers")) {
    const patrol = sidePatrol(grid, dynamicCandidates, verified, random, used);
    if (!patrol) return null;
    mechanics.movers = [{ ...patrol, period: 2.65, phase: random() }];
  }
  if (features.includes("cannons")) {
    const point = takePoint(dynamicCandidates);
    const line = point && openAlong(grid, point, random);
    if (!point || !line) return null;
    const dx = Math.sign(line.to[0] - point[0]); const dy = Math.sign(line.to[1] - point[1]);
    mechanics.cannons = [{ x: point[0], y: point[1], dir: DIRS.find(([vx, vy]) => vx === dx && vy === dy)[2], period: 2.4, phase: random() }];
  }
  if (features.includes("breakables")) {
    const stops = new Set(routes.flatMap((route) => route.stops.map(key)));
    const routeImpactWalls = new Set(routes.flatMap((route) => route.segments.map((segment) => {
      const stop = segment.cells.at(-1);
      const [dx, dy] = DIRS.find(([, , name]) => name === segment.direction);
      return `${stop[0] + dx},${stop[1] + dy}`;
    })));
    // A wall hit at the end of a protected route opens immediately in the runtime,
    // changing every later stopping point. Keep optional breakables on deliberate side paths.
    const walls = wallCandidates(grid).filter(([x, y]) => !routeImpactWalls.has(`${x},${y}`)
      && DIRS.some(([dx, dy]) => stops.has(`${x + dx},${y + dy}`)));
    mechanics.breakables = pick(walls, 1, random);
    if (!mechanics.breakables.length) return null;
  }
  if (mechanics.breakables?.length && level >= 70) {
    const secrets = mechanics.breakables.filter(([x, y], index) => (level + x + y + index) % 3 === 0).slice(0, 2);
    mechanics.secrets = secrets.map(([x, y], index) => {
      const roll = (level * 17 + x * 7 + y * 11 + index) % 7;
      const kind = roll === 0 ? "crystal" : roll === 1 ? "boost" : "cache";
      return {
        id: `${level}-${index}`,
        x, y, kind,
        coins: kind === "crystal" ? 0 : 25 + (level % 3) * 5,
        vaultCoins: kind === "crystal" ? 1 : 0,
        effect: kind === "boost" ? "overdrive" : "",
      };
    });
    if (!mechanics.secrets.length) delete mechanics.secrets;
  }
  if (features.includes("oneWays")) {
    const choice = directed.find(({ point }) => !used.has(key(point)));
    if (!choice) return null;
    used.add(key(choice.point));
    mechanics.oneWays = [{ x: choice.point[0], y: choice.point[1], dir: choice.dir }];
  }
  if (features.includes("enemies")) {
    const line = sidePatrol(grid, dynamicCandidates, verified, random, used);
    if (!line) return null;
    mechanics.enemies = [{ path: [line.from, line.to], period: 2.9, phase: random() }];
  }
  if (features.includes("portals")) {
    const points = pick(wrong.map(({ point }) => point), 2, random, used);
    if (points.length < 2) return null;
    mechanics.portals = [{ a: points[0], b: points[1], color: "cyan" }];
  }
  if (features.includes("switches") || features.includes("timedGates")) {
    const timed = features.includes("timedGates");
    const route = required.route;
    let pair = null;
    for (let index = 1; index < route.segments.length; index += 1) {
      const switchPoint = route.stops[index];
      const gatePoint = route.segments[index].cells[0];
      const visitedBefore = new Set(route.segments.slice(0, index).flatMap((segment) => segment.cells.map(key)));
      if (!items.has(key(switchPoint)) && !items.has(key(gatePoint)) && !used.has(key(switchPoint)) && !used.has(key(gatePoint)) && !visitedBefore.has(key(gatePoint))) {
        pair = { switchPoint, gatePoint }; break;
      }
    }
    if (!pair) return null;
    used.add(key(pair.switchPoint)); used.add(key(pair.gatePoint));
    mechanics.switches = [{ x: pair.switchPoint[0], y: pair.switchPoint[1], group: timed ? "t" : "a", timed }];
    mechanics.gates = [{ x: pair.gatePoint[0], y: pair.gatePoint[1], group: timed ? "t" : "a", timed, duration: timed ? 4.2 : 0 }];
  }
  if (features.includes("redirects")) {
    const choice = wrong.find(({ point }) => !used.has(key(point)));
    if (!choice) return null;
    used.add(key(choice.point));
    mechanics.redirects = [{ x: choice.point[0], y: choice.point[1], dir: choice.dir }];
  }
  if (features.includes("crumbles")) {
    const point = takePoint(wrong);
    if (!point) return null;
    mechanics.crumbles = [point];
  }
  if (features.includes("pulses")) {
    const point = takePoint(dynamicCandidates);
    if (!point) return null;
    mechanics.pulses = [{ x: point[0], y: point[1], period: 2.75, phase: random() }];
  }
  if (level === 100 || level === 250) {
    const point = required.route.cells[Math.floor(required.route.cells.length * 0.55)];
    if (point) mechanics.checkpoints = [point];
  }
  return mechanics;
}

function customTutorial() {
  const rows = [
    "#########",
    "#########",
    "#########",
    "#########",
    "#########",
    "#.......#",
    "#.#######",
    "#.#######",
    "#.#######",
    "#.#######",
    "#########",
  ];
  const level = {
    id: 1, width: 9, height: 11, rows, start: [1, 9], exit: [7, 5],
    dots: [[1, 8], [1, 7], [1, 6], [2, 5], [3, 5], [4, 5], [6, 5]],
    coins: [[5, 5]], mechanics: {}, minMoves: 2, difficulty: 1, expectedSeconds: 12,
    solution: ["up", "right"], shortestMoves: 2, levelKind: "tutorial",
    featureNames: ["movement", "dots", "coins", "exit"],
  };
  level.quality = analyzeLevelQuality(level);
  return level;
}

export function generateCandidate(level, attempt = 0) {
  if (level === 1) return customTutorial();
  const random = rng((level * 2654435761 + attempt * 1013904223 + 0x9e3779b9) >>> 0);
  const width = level < 11 ? 9 : level < 31 ? 11 : level < 81 ? 13 : level < 151 ? 15 : level < 221 ? 17 : 19;
  const height = level < 11 ? 11 : level < 31 ? 13 : level < 81 ? 15 : level < 151 ? 17 : level < 221 ? 19 : 21;
  const loops = Math.min(2 + Math.floor(level / 38), 8);
  const { grid, start } = carveMaze(width, height, random, loops);
  const graph = dashGraph(grid, start);
  const levelKind = levelKindFor(level);
  const exits = terminalExits(graph, start, random);
  if (level < 5) exits.sort((left, right) => Math.abs(graph.distance.get(key(left)) - routeMoveTarget(level)) - Math.abs(graph.distance.get(key(right)) - routeMoveTarget(level)));
  let required = null; let exit = null;
  for (const candidate of exits) {
    const plan = planObjectives(level, grid, graph, start, candidate, random);
    if (plan) { required = plan; exit = candidate; break; }
  }
  if (!required) return generateCandidate(level, attempt + 1);
  if (!required.dots.length) {
    const dots = samplePoints(required.route.cells.filter((cell) => key(cell) !== key(exit)), 5);
    const draft = dots.length && draftLevel(grid, start, exit, dots);
    const moves = draft && solveLevel(draft);
    const route = draft && verifiedPlainRoute(grid, draft, moves);
    if (!route) return generateCandidate(level, attempt + 1);
    required = { ...required, dots, moves, route };
  }

  const reward = planCoins(grid, graph, start, exit, required.dots, required, levelKind === "sector" ? 3 : levelKind === "challenge" ? 2 : 1, random);
  if (!reward) return generateCandidate(level, attempt + 1);
  const mechanics = createMechanics(level, grid, required, reward, random, start, exit, required.dots, reward.coins);
  if (!mechanics) return generateCandidate(level, attempt + 1);
  if (levelKind === "sector" && !mechanics.checkpoints) {
    const point = required.route.cells[Math.floor(required.route.cells.length * 0.52)];
    if (point) mechanics.checkpoints = [point];
  }
  const generated = {
    id: level, width, height, rows: grid.map((row) => row.join("")), start, exit, dots: required.dots, coins: reward.coins, mechanics,
    minMoves: required.moves.length, shortestMoves: required.directRoute.moves.length, levelKind,
    difficulty: Math.min(10, 1 + Math.floor(level / 28) + Object.keys(mechanics).length * 0.28 + required.route.decisionStops * 0.035),
    expectedSeconds: Math.round(10 + required.moves.length * 2.05 + level / 12),
    solution: required.moves,
    featureNames: featureBand(level),
  };
  generated.solution = solveLevel(generated);
  if (!generated.solution) return generateCandidate(level, attempt + 1);
  const rewardSolution = solveLevel(generated, { coins: generated.coins });
  if (!rewardSolution || !tuneDynamicPhases(generated, [generated.solution, rewardSolution], random)) return generateCandidate(level, attempt + 1);
  generated.minMoves = generated.solution.length;
  generated.expectedSeconds = Math.round(10 + generated.minMoves * 2.05 + level / 12);
  generated.quality = analyzeLevelQuality(generated);
  const validation = generated.quality && validateLevel(generated);
  const hasDynamicHazard = generated.featureNames.some((feature) => ["timedSpikes", "movers", "cannons", "enemies", "pulses"].includes(feature));
  if (!validation?.valid || (branchTarget(level) && hasDynamicHazard && generated.quality.forcedHazardObjectives < 1)) return generateCandidate(level, attempt + 1);
  return generated;
}

async function writeProductionLevels() {
  const levels = [];
  const layouts = new Set();
  for (let level = 1; level <= 250; level += 1) {
    let config = generateCandidate(level);
    let attempt = 1;
    while (layouts.has(config.rows.join("/"))) config = generateCandidate(level, attempt++);
    layouts.add(config.rows.join("/"));
    levels.push(config);
  }

  await mkdir("src/levels", { recursive: true });
  for (let start = 0; start < 250; start += 50) {
    const from = String(start + 1).padStart(3, "0");
    const to = String(start + 50).padStart(3, "0");
    const content = `// Generated static level configurations ${from}-${to}.\nexport default ${JSON.stringify(levels.slice(start, start + 50))};\n`;
    await writeFile(`src/levels/levels-${from}-${to}.js`, content, "utf8");
  }

  const metrics = levels.map(({ id, width, height, minMoves, shortestMoves, levelKind, quality, difficulty, expectedSeconds, featureNames }) => ({
    id, width, height, minMoves, shortestMoves, levelKind, quality,
    difficulty: Number(difficulty.toFixed(1)), expectedSeconds, mechanics: featureNames,
  }));
  await writeFile("src/levels/metrics.json", `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  console.log(`Generated ${levels.length} unique static levels.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes("--write-production")) throw new Error("Refusing to overwrite 250 levels without --write-production");
  await writeProductionLevels();
}
