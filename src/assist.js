import { solveLevel } from "./level-validator.js";

function setCell(rows, cell, value) {
  const [x, y] = cell.split(",").map(Number);
  if (!rows[y]?.[x]) return;
  rows[y] = `${rows[y].slice(0, x)}${value}${rows[y].slice(x + 1)}`;
}

export function nextSafeMove(game) {
  if (!game?.level || !game.player || game.player.direction) return null;
  const rows = [...game.level.rows];
  for (const cell of game.brokenBreakables || []) setCell(rows, cell, ".");
  for (const cell of game.crumbleBlocked || []) setCell(rows, cell, "#");
  const dots = [...(game.dots || [])].map((cell) => cell.split(",").map(Number));
  const mechanics = { ...game.level.mechanics, gates: (game.level.mechanics?.gates || []).filter((gate) => !game.openGroups?.has(gate.group)) };
  const solution = solveLevel({ ...game.level, rows, start: [game.player.x, game.player.y], dots, mechanics }, { maxStates: 20000 });
  return solution?.[0] || null;
}
