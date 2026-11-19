import { LEVELS } from "../src/levels.js";
import { analyzeLevelQuality, bonusCoinReachability, solveBonusMasks, validateAllLevels } from "../src/level-validator.js";
import { bonusObjectives, coresForDashes, effectivePar } from "../src/rating.js";

const result = validateAllLevels(LEVELS);
const coins = LEVELS.map((level) => ({ id: level.id, ...bonusCoinReachability(level) }));
const quality = LEVELS.map((level) => ({ id: level.id, ...analyzeLevelQuality(level) }));
const ratings = LEVELS.map((level) => {
  const result = solveBonusMasks(level);
  const fullMask = (2 ** bonusObjectives(level).length) - 1;
  const exact = JSON.stringify(level.optimalDashesByBonusMask) === JSON.stringify(result.optimalDashesByBonusMask);
  const feasible = result.bonusSolutionsByMask.every((witness, mask) => !witness
    || (effectivePar(level, mask) === witness.dashes && coresForDashes(witness.dashes, effectivePar(level, mask)) === 3));
  return { id: level.id, valid: !result.truncated && Boolean(result.standardSolution) && result.optimalDashesByBonusMask[fullMask] != null && exact && feasible };
});
const failed = result.results.filter((level) => !level.valid);
const unreachableCoins = coins.filter((level) => !level.reachable);
const invalidRatings = ratings.filter((level) => !level.valid);
const branchEligible = quality.filter((level) => level.id >= 5);
const insufficientBranches = branchEligible.filter((level) => level.objectiveBranches < (level.id <= 20 ? 1 : level.id <= 100 ? 2 : 3));

console.log(`Levels: ${result.passed}/${LEVELS.length} valid`);
console.log(`Bonus coins: ${LEVELS.length - unreachableCoins.length}/${LEVELS.length} levels fully collectible`);
console.log(`Bonus ratings: ${LEVELS.length - invalidRatings.length}/${LEVELS.length} levels have exact static pars`);
console.log(`Puzzle branching: ${branchEligible.length - insufficientBranches.length}/${branchEligible.length} eligible levels meet campaign thresholds (levels 1–4 are onboarding)`);

if (failed.length || unreachableCoins.length || invalidRatings.length || insufficientBranches.length) {
  for (const level of failed.slice(0, 10)) console.error(`Level ${level.id}: ${level.errors.join("; ")}`);
  for (const level of unreachableCoins.slice(0, 10)) console.error(`Level ${level.id}: unreachable bonus coin`);
  for (const level of invalidRatings.slice(0, 10)) console.error(`Level ${level.id}: invalid static bonus rating`);
  for (const level of insufficientBranches.slice(0, 10)) console.error(`Level ${level.id}: insufficient objective branches`);
  process.exitCode = 1;
}
