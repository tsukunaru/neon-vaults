const DEFINITIONS = Object.freeze([
  ["spikes", "spikes", "tutorialSpikesTitle", "tutorialSpikesBody", "▲"],
  ["timedSpikes", "timedSpikes", "tutorialTimedSpikesTitle", "tutorialTimedSpikesBody", "◴"],
  ["movers", "movers", "tutorialMoversTitle", "tutorialMoversBody", "↔"],
  ["cannons", "cannons", "tutorialCannonsTitle", "tutorialCannonsBody", "◉"],
  ["breakables", "breakables", "tutorialBreakablesTitle", "tutorialBreakablesBody", "▧"],
  ["oneWays", "oneWays", "tutorialOneWaysTitle", "tutorialOneWaysBody", "➜"],
  ["enemies", "enemies", "tutorialEnemiesTitle", "tutorialEnemiesBody", "◆"],
  ["switches", "switches", "tutorialSwitchesTitle", "tutorialSwitchesBody", "⌁"],
  ["portals", "portals", "tutorialPortalsTitle", "tutorialPortalsBody", "◎"],
  ["timedGates", "timedGates", "tutorialTimedGatesTitle", "tutorialTimedGatesBody", "⌛"],
  ["redirects", "redirects", "tutorialRedirectsTitle", "tutorialRedirectsBody", "↱"],
  ["crumbles", "crumbles", "tutorialCrumblesTitle", "tutorialCrumblesBody", "▦"],
  ["pulses", "pulses", "tutorialPulsesTitle", "tutorialPulsesBody", "◌"],
  ["checkpoints", "checkpoints", "tutorialCheckpointsTitle", "tutorialCheckpointsBody", "◇"],
  ["secrets", "secrets", "tutorialSecretsTitle", "tutorialSecretsBody", "✦"],
].map(([key, mechanic, titleKey, bodyKey, icon]) => Object.freeze({ key, mechanic, titleKey, bodyKey, icon })));

export const MECHANIC_TUTORIALS = DEFINITIONS;

function present(level, definition) {
  const mechanics = level?.mechanics || {};
  if (definition.key === "timedGates") return (mechanics.gates || []).some((gate) => gate.timed) || (mechanics.switches || []).some((item) => item.timed);
  return Array.isArray(mechanics[definition.mechanic]) && mechanics[definition.mechanic].length > 0;
}

export function mechanicTutorial(key) {
  return DEFINITIONS.find((definition) => definition.key === key) || null;
}

export function mechanicTutorialsForLevel(level, seen = {}, includeSecrets = false) {
  return DEFINITIONS.filter((definition) => (includeSecrets || definition.key !== "secrets") && !seen?.[definition.key] && present(level, definition));
}

export function nextMechanicTutorial(level, seen = {}) {
  return mechanicTutorialsForLevel(level, seen)[0] || null;
}
