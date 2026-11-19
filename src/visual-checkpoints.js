import { themeForLevel } from "./config.js";

export const VISUAL_CHECKPOINT_LEVELS = Object.freeze([1, 20, 100, 200, 250]);

export function visualFrameDescriptor(level) {
  const theme = themeForLevel(level.id);
  return {
    id: level.id,
    width: level.width,
    height: level.height,
    rows: level.rows,
    start: level.start,
    exit: level.exit,
    dots: level.dots,
    coins: level.coins,
    mechanics: level.mechanics || {},
    theme: { id: theme.id, bg: theme.bg, center: theme.center, floorA: theme.floorA, floorB: theme.floorB, wall: theme.wall, edge: theme.edge, accent: theme.accent },
  };
}
