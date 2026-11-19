export const VAULT_RUSH_START_TIME = 45;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const mixed = (seed, value) => {
  let hash = (Math.floor(Number(seed) || 1) ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
};

export function createVaultRushRun(seed = Date.now()) {
  return {
    seed: Math.floor(Number(seed) || 1) >>> 0,
    room: 0,
    securityLevel: 1,
    score: 0,
    multiplier: 1,
    streak: 0,
    bestStreak: 0,
    timeRemaining: VAULT_RUSH_START_TIME,
    dots: 0,
    deaths: 0,
    ended: false,
    endReason: "",
    continueUsed: false,
  };
}

export function vaultRushRoom(run, levels) {
  const security = clamp(Math.floor(Number(run?.securityLevel) || 1), 1, 13);
  const start = (security - 1) * 20 + 1;
  const end = Math.min(250, start + 19);
  const candidates = levels.filter((level) => level.id >= start && level.id <= end && level.id % 20 !== 0)
    .sort((left, right) => (left.minMoves || left.solution?.length || 999) - (right.minMoves || right.solution?.length || 999) || left.id - right.id)
    .slice(0, 10);
  const fallback = levels.filter((level) => level.id >= start && level.id <= end);
  const pool = candidates.length ? candidates : fallback.length ? fallback : levels;
  const groupOffset = mixed(run?.seed, security) % pool.length;
  const index = (groupOffset + (Math.floor(Number(run?.room) || 0) % 3) * 3) % pool.length;
  const source = pool[index];
  return { ...source, rush: true, rushRoom: Math.floor(Number(run?.room) || 0) + 1, securityLevel: security };
}

export function tickVaultRush(run, seconds) {
  if (run.ended) return run;
  run.timeRemaining = Math.max(0, run.timeRemaining - Math.max(0, Number(seconds) || 0));
  if (run.timeRemaining === 0) { run.ended = true; run.endReason = "timer"; }
  return run;
}

export function completeVaultRushRoom(run, result) {
  if (run.ended) return run;
  const dots = Math.max(0, Math.floor(Number(result?.dots) || 0));
  const coins = Math.max(0, Math.floor(Number(result?.coins) || 0));
  const cores = clamp(Math.floor(Number(result?.cores) || 0), 0, 3);
  const dashes = Math.max(0, Math.floor(Number(result?.dashes) || 0));
  const par = Math.max(1, Math.floor(Number(result?.par) || dashes || 1));
  const perfect = dashes <= par;
  const multiplier = perfect ? Math.min(5, run.multiplier + 0.25) : Math.max(1, run.multiplier - 0.25);
  const streak = run.streak + 1;
  const speedBonus = Math.max(0, Math.round((30 - Math.max(0, Number(result?.time) || 0)) * 20));
  const baseScore = 1000 + dots * 80 + coins * 300 + cores * 250 + speedBonus;
  const room = run.room + 1;
  const securityLevel = Math.min(13, 1 + Math.floor(room / 3));
  const timeBonus = 4.5 + Math.min(3, run.securityLevel * 0.2) + Math.min(6, dots * 0.18);
  return {
    ...run,
    room,
    securityLevel,
    score: run.score + Math.round(baseScore * multiplier + streak * 100),
    multiplier,
    streak,
    bestStreak: Math.max(run.bestStreak, streak),
    timeRemaining: Math.min(75, run.timeRemaining + timeBonus),
    dots: run.dots + dots,
  };
}

export function failVaultRush(run) {
  if (run.ended) return run;
  return { ...run, deaths: run.deaths + 1, streak: 0, ended: true, endReason: "death" };
}

export function continueVaultRush(run) {
  if (!run.ended || run.endReason !== "death" || run.continueUsed) return run;
  return { ...run, ended: false, endReason: "", continueUsed: true, multiplier: 1, streak: 0, timeRemaining: Math.max(12, run.timeRemaining) };
}
