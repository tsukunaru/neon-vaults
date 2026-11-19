const TYPES = ["completions", "dots", "dashes"];

function hashDay(day) {
  let value = 2166136261;
  for (const character of String(day)) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

export function missionForDay(day) {
  const hash = hashDay(day);
  const type = TYPES[hash % TYPES.length];
  const target = type === "completions" ? 3 : type === "dots" ? 45 + hash % 20 : 35 + hash % 16;
  return { day: String(day), type, target, progress: 0, claimed: false };
}

export function advanceMission(mission, type, amount = 1) {
  if (!mission || mission.claimed || mission.type !== type) return mission;
  return { ...mission, progress: Math.min(mission.target, mission.progress + Math.max(0, Math.floor(amount))) };
}

export function missionComplete(mission) {
  return Boolean(mission && mission.progress >= mission.target);
}

export const missionTypes = Object.freeze(TYPES);
