export function bonusObjectives(level) {
  return [
    ...(level.coins || []).map(([x, y]) => ({ x, y, type: "coin" })),
    ...(level.mechanics?.secrets || [])
      .filter((secret) => Number(secret.coins) > 0 || Number(secret.vaultCoins) > 0)
      .map(({ x, y }) => ({ x, y, type: "secret" })),
  ];
}

export function effectivePar(level, bonusMask) {
  const mask = Number.isInteger(bonusMask) && bonusMask >= 0 ? bonusMask : 0;
  return level.optimalDashesByBonusMask?.[mask]
    ?? level.standardSolution?.length
    ?? level.minMoves
    ?? level.solution?.length
    ?? null;
}

export function coresForDashes(dashes, par) {
  const target = Math.max(1, Number(par) || 1);
  return dashes <= target ? 3 : dashes <= Math.ceil(target * 1.25) ? 2 : 1;
}
