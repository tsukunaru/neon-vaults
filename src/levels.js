import levels001050 from "./levels/levels-001-050.js";
import levels051100 from "./levels/levels-051-100.js";
import levels101150 from "./levels/levels-101-150.js";
import levels151200 from "./levels/levels-151-200.js";
import levels201250 from "./levels/levels-201-250.js";
import bonusPar from "./levels/bonus-par.js";

export const LEVELS = Object.freeze([
  ...levels001050, ...levels051100, ...levels101150, ...levels151200, ...levels201250,
].map((level, index) => ({ ...level, ...bonusPar[index] })));

export function levelById(id) {
  return LEVELS[Math.max(1, Math.min(250, Math.floor(Number(id) || 1))) - 1];
}
