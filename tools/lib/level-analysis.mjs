import { createLevelTraversal, solveLevel } from "../../src/level-validator.js";

export const ANALYSIS_MODEL_VERSION = "static-safe-v1";
export const PILOT_LEVEL_IDS = Object.freeze([
  ...Array.from({ length: 16 }, (_, index) => index + 5),
  86, 141, 181, 201,
]);
const DIRECTION_ORDER = new Map(["up", "right", "down", "left"].map((name, index) => [name, index]));
const APPROXIMATE_MECHANICS = ["timedSpikes", "movers", "cannons", "enemies", "timedGates", "crumbles", "breakables", "pulses"];
const pointKey = ([x, y]) => `${x},${y}`;
const round = (value) => Number(value.toFixed(3));
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

export function parseLevelIds(value, maxId = 250) {
  if (!value) return null;
  const ids = new Set();
  for (const part of value.split(",")) {
    const [from, to = from] = part.split("-").map(Number);
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new Error(`Invalid level range: ${part}`);
    for (let id = Math.min(from, to); id <= Math.max(from, to); id += 1) ids.add(id);
  }
  return [...ids].filter((id) => id >= 1 && id <= maxId).sort((left, right) => left - right);
}

export function decisionTargetForLevel(id) {
  if (id <= 10) return 1;
  if (id <= 30) return 3;
  if (id <= 60) return 4;
  if (id <= 100) return 5;
  if (id <= 150) return 6;
  if (id <= 200) return 7;
  return 8;
}

function uniqueEdges(edges) {
  return [...new Map(edges.map((edge) => [edge.success ? "$win" : edge.to, edge])).values()];
}

export function buildPuzzleStateGraph(level, { maxStates = 60_000 } = {}) {
  const model = createLevelTraversal(level);
  const startKey = model.stateKey(model.start);
  const nodes = new Map([[startKey, { state: model.start, edges: [] }]]);
  const queue = [startKey];
  const reverse = new Map();
  let truncated = false;

  graph: for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentKey = queue[cursor];
    const node = nodes.get(currentKey);
    for (const transition of model.movesFrom(node.state)) {
      const nextKey = transition.success ? null : model.stateKey(transition.state);
      if (nextKey === currentKey) continue;
      if (nextKey && !nodes.has(nextKey)) {
        if (nodes.size >= maxStates) { truncated = true; break graph; }
        nodes.set(nextKey, { state: transition.state, edges: [] });
        queue.push(nextKey);
      }
      node.edges.push({
        direction: transition.direction,
        success: transition.success,
        to: nextKey,
        point: transition.state.point,
      });
      if (nextKey) {
        if (!reverse.has(nextKey)) reverse.set(nextKey, new Set());
        reverse.get(nextKey).add(currentKey);
      }
    }
  }

  const distanceToWin = new Map();
  const winners = [];
  for (const [state, node] of nodes) if (node.edges.some((edge) => edge.success)) {
    distanceToWin.set(state, 1);
    winners.push(state);
  }
  for (let cursor = 0; cursor < winners.length; cursor += 1) {
    const state = winners[cursor];
    for (const parent of reverse.get(state) || []) if (!distanceToWin.has(parent)) {
      distanceToWin.set(parent, distanceToWin.get(state) + 1);
      winners.push(parent);
    }
  }
  return { level, startKey, nodes, distanceToWin, truncated };
}

function traceOptimalRoute(graph, solution) {
  let current = graph.startKey;
  let previous = null;
  let forcedStates = 0;
  let longestForcedRun = 0;
  let forcedRun = 0;
  let decisionPoints = 0;
  let movesAwayFromGoal = 0;
  const rationalChoiceCounts = [];
  const stops = [pointKey(graph.nodes.get(current).state.point)];

  for (const [index, direction] of solution.entries()) {
    const node = graph.nodes.get(current);
    const selected = node?.edges.find((edge) => edge.direction === direction);
    if (!selected || (!selected.success && !graph.distanceToWin.has(selected.to))) return null;
    const rational = uniqueEdges(node.edges.filter((edge) => (edge.success || graph.distanceToWin.has(edge.to))
      && (edge === selected || edge.to !== previous)));
    if (!rational.length) return null;
    rationalChoiceCounts.push(rational.length);
    if (rational.length >= 2) {
      decisionPoints += 1;
      forcedRun = 0;
    } else {
      forcedStates += 1;
      forcedRun += 1;
      longestForcedRun = Math.max(longestForcedRun, forcedRun);
    }
    const fromDistance = Math.abs(node.state.point[0] - graph.level.exit[0]) + Math.abs(node.state.point[1] - graph.level.exit[1]);
    const toDistance = Math.abs(selected.point[0] - graph.level.exit[0]) + Math.abs(selected.point[1] - graph.level.exit[1]);
    if (toDistance > fromDistance) movesAwayFromGoal += 1;
    if (selected.success !== (index === solution.length - 1)) return null;
    previous = current;
    current = selected.to;
    stops.push(pointKey(selected.point));
  }

  const forcedMoveRatio = forcedStates / solution.length;
  const decisionDensity = decisionPoints / solution.length;
  const linearityScore = clamp(forcedMoveRatio * 0.65
    + (longestForcedRun / solution.length) * 0.25
    + (1 - Math.min(1, decisionDensity * 3)) * 0.1);
  return {
    decisionPoints,
    forcedStates,
    forcedMoveRatio: round(forcedMoveRatio),
    longestForcedRun,
    movesAwayFromGoal,
    setupMoveCount: movesAwayFromGoal,
    averageRationalChoices: round(rationalChoiceCounts.reduce((sum, value) => sum + value, 0) / rationalChoiceCounts.length),
    maxRationalChoices: Math.max(...rationalChoiceCounts),
    rationalChoiceCounts,
    revisitedStops: stops.length - new Set(stops).size,
    linearityScore: round(linearityScore),
  };
}

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalDirectionPattern(solution) {
  const vectors = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
  const names = new Map([[[0, -1].join(), "U"], [[1, 0].join(), "R"], [[0, 1].join(), "D"], [[-1, 0].join(), "L"]]);
  const transforms = [
    ([x, y]) => [x, y], ([x, y]) => [-y, x], ([x, y]) => [-x, -y], ([x, y]) => [y, -x],
    ([x, y]) => [-x, y], ([x, y]) => [-y, -x], ([x, y]) => [x, -y], ([x, y]) => [y, x],
  ];
  return transforms.map((transform) => solution.map((direction) => names.get(transform(vectors[direction]).join())).join(""))
    .sort()[0];
}

function stopGraphFingerprint(graph, solution) {
  const outgoing = new Map();
  const incoming = new Map();
  const ensure = (cell) => {
    if (!outgoing.has(cell)) outgoing.set(cell, new Set());
    if (!incoming.has(cell)) incoming.set(cell, new Set());
  };
  for (const node of graph.nodes.values()) {
    const from = pointKey(node.state.point);
    ensure(from);
    for (const edge of node.edges) {
      const to = pointKey(edge.point);
      ensure(to);
      outgoing.get(from).add(to);
      incoming.get(to).add(from);
    }
  }

  const undirected = new Map([...outgoing].map(([cell]) => [cell, new Set()]));
  const undirectedEdges = new Set();
  for (const [from, targets] of outgoing) for (const to of targets) {
    if (from === to) continue;
    undirected.get(from).add(to);
    undirected.get(to).add(from);
    undirectedEdges.add([from, to].sort().join("|"));
  }
  let components = 0;
  const unseen = new Set(undirected.keys());
  while (unseen.size) {
    components += 1;
    const queue = [unseen.values().next().value];
    unseen.delete(queue[0]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) for (const neighbour of undirected.get(queue[cursor])) {
      if (unseen.delete(neighbour)) queue.push(neighbour);
    }
  }

  const degreeHistogram = {};
  for (const targets of outgoing.values()) degreeHistogram[targets.size] = (degreeHistogram[targets.size] || 0) + 1;
  let colors = new Map([...outgoing].map(([cell, targets]) => [cell, hashText(`${targets.size}:${incoming.get(cell).size}:${cell === pointKey(graph.level.start) ? 1 : 0}:${cell === pointKey(graph.level.exit) ? 1 : 0}`)]));
  for (let iteration = 0; iteration < 3; iteration += 1) colors = new Map([...outgoing].map(([cell, targets]) => [cell, hashText([
    colors.get(cell),
    [...targets].map((target) => colors.get(target)).sort().join(","),
    [...incoming.get(cell)].map((source) => colors.get(source)).sort().join(","),
  ].join("|"))]));

  const productiveDecisionStates = [...graph.nodes.values()].filter((node) => uniqueEdges(node.edges.filter((edge) => edge.success || graph.distanceToWin.has(edge.to))).length >= 2).length;
  return {
    nodes: outgoing.size,
    edges: [...outgoing.values()].reduce((sum, targets) => sum + targets.size, 0),
    cycleRank: Math.max(0, undirectedEdges.size - outgoing.size + components),
    degreeHistogram,
    productiveDecisionStates,
    topologyHash: hashText([...colors.values()].sort().join("|")),
    optimalRoutePattern: canonicalDirectionPattern(solution),
  };
}

function ratioSimilarity(left, right) {
  return left === right ? 1 : Math.min(left, right) / Math.max(left, right, 1);
}

function histogramSimilarity(left, right) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const difference = [...keys].reduce((sum, key) => sum + Math.abs((left[key] || 0) - (right[key] || 0)), 0);
  const total = [...keys].reduce((sum, key) => sum + Math.max(left[key] || 0, right[key] || 0), 0);
  return total ? 1 - difference / total : 1;
}

function sequenceSimilarity(left, right) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let x = 1; x <= left.length; x += 1) {
    let diagonal = row[0];
    row[0] = x;
    for (let y = 1; y <= right.length; y += 1) {
      const previous = row[y];
      row[y] = Math.min(row[y] + 1, row[y - 1] + 1, diagonal + (left[x - 1] === right[y - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return 1 - row[right.length] / Math.max(left.length, right.length, 1);
}

export function compareStopGraphs(left, right) {
  const a = left.stopGraph || left;
  const b = right.stopGraph || right;
  const exactTopology = a.topologyHash === b.topologyHash;
  const similarity = ratioSimilarity(a.nodes, b.nodes) * 0.15
    + ratioSimilarity(a.edges, b.edges) * 0.15
    + histogramSimilarity(a.degreeHistogram, b.degreeHistogram) * 0.2
    + ratioSimilarity(a.cycleRank, b.cycleRank) * 0.1
    + sequenceSimilarity(a.optimalRoutePattern, b.optimalRoutePattern) * 0.25
    + (exactTopology ? 0.15 : 0);
  return { similarity: round(similarity), exactTopology };
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function agentChoices(graph, state, previous) {
  const choices = uniqueEdges(graph.nodes.get(state)?.edges || []);
  if (!previous || choices.length < 2) return choices;
  const forward = choices.filter((edge) => edge.to !== previous);
  return forward.length ? forward : choices;
}

function runAgent(graph, chooser, maxDashes, stopOnRepeat = false) {
  let state = graph.startKey;
  let previous = null;
  const visited = new Set([state]);
  for (let dashes = 1; dashes <= maxDashes; dashes += 1) {
    const choices = agentChoices(graph, state, previous);
    if (!choices.length) return { success: false, dashes: dashes - 1, stopped: true, timedOut: false };
    const selected = chooser(choices);
    if (selected.success) return { success: true, dashes, stopped: false, timedOut: false };
    previous = state;
    state = selected.to;
    if (stopOnRepeat && visited.has(state)) return { success: false, dashes, stopped: true, timedOut: false };
    visited.add(state);
  }
  return { success: false, dashes: maxDashes, stopped: false, timedOut: true };
}

function simulateAgents(level, graph, optimalPathLength, { randomRuns, seed }) {
  const maxDashes = Math.min(512, Math.max(20, optimalPathLength * 4));
  const greedy = runAgent(graph, (choices) => [...choices].sort((left, right) => {
    const leftDistance = left.success ? -1 : Math.abs(left.point[0] - level.exit[0]) + Math.abs(left.point[1] - level.exit[1]);
    const rightDistance = right.success ? -1 : Math.abs(right.point[0] - level.exit[0]) + Math.abs(right.point[1] - level.exit[1]);
    return leftDistance - rightDistance || DIRECTION_ORDER.get(left.direction) - DIRECTION_ORDER.get(right.direction);
  })[0], maxDashes, true);

  const randomResults = Array.from({ length: randomRuns }, (_, run) => {
    const random = mulberry32((seed + Math.imul(run + 1, 0x9e3779b9)) >>> 0);
    return runAgent(graph, (choices) => choices[Math.floor(random() * choices.length)], maxDashes);
  });
  const successes = randomResults.filter((result) => result.success);
  const averageDashes = successes.length ? successes.reduce((sum, result) => sum + result.dashes, 0) / successes.length : null;
  return {
    greedyExit: {
      success: greedy.success,
      dashes: greedy.success ? greedy.dashes : null,
      gapFromOptimal: greedy.success ? greedy.dashes - optimalPathLength : null,
      stopped: greedy.stopped,
    },
    randomSafe: {
      runs: randomRuns,
      successRate: round(successes.length / randomRuns),
      averageDashes: averageDashes === null ? null : round(averageDashes),
      averageGapFromOptimal: averageDashes === null ? null : round(averageDashes - optimalPathLength),
      stoppedRuns: randomResults.filter((result) => result.stopped).length,
      timedOutRuns: randomResults.filter((result) => result.timedOut).length,
    },
  };
}

export function analyzeDecisionQuality(level, { maxStates = 60_000, randomRuns = 128, seed = 0x4e564c54 } = {}) {
  const solution = solveLevel(level, { maxStates });
  if (!solution) return { modelVersion: ANALYSIS_MODEL_VERSION, solvable: false, optimalPathLength: null };
  const graph = buildPuzzleStateGraph(level, { maxStates });
  const route = traceOptimalRoute(graph, solution);
  const approximateMechanics = APPROXIMATE_MECHANICS.filter((name) => name === "timedGates"
    ? (level.mechanics?.gates || []).some((gate) => gate.timed)
    : (level.mechanics?.[name] || []).length);
  if (graph.truncated || !route) return {
    modelVersion: ANALYSIS_MODEL_VERSION,
    solvable: true,
    optimalPathLength: solution.length,
    optimalSolution: solution,
    truncated: graph.truncated,
    analysisError: route ? null : "optimal route is missing from the explored state graph",
    topologyApproximation: approximateMechanics.length > 0,
    approximateMechanics,
  };

  const mastery = solveLevel(level, { coins: level.coins || [], maxStates });
  const agents = simulateAgents(level, graph, solution.length, {
    randomRuns,
    seed: (seed ^ Math.imul(level.id || 1, 0x45d9f3b)) >>> 0,
  });
  return {
    modelVersion: ANALYSIS_MODEL_VERSION,
    solvable: true,
    truncated: false,
    optimalPathLength: solution.length,
    optimalMasteryPathLength: mastery?.length ?? null,
    masteryGap: mastery ? mastery.length - solution.length : null,
    optimalSolution: solution,
    ...route,
    stateGraph: {
      nodes: graph.nodes.size,
      edges: [...graph.nodes.values()].reduce((sum, node) => sum + node.edges.length, 0),
      productiveStates: graph.distanceToWin.size,
    },
    stopGraph: stopGraphFingerprint(graph, solution),
    ...agents,
    topologyApproximation: approximateMechanics.length > 0,
    approximateMechanics,
  };
}
