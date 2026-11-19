const hashDay = (day) => {
  let value = 2166136261;
  for (const character of String(day)) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
};

export const DAILY_SCORE_BASE = 100000000;
const DAILY_EPOCH_UTC = Date.UTC(2025, 0, 1);

const clampScore = (score) => Math.max(0, Math.min(DAILY_SCORE_BASE - 1, Math.floor(Number(score) || 0)));

export function dailyDayIndex(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return 0;
  const timestamp = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) return 0;
  return Math.max(0, Math.floor((timestamp - DAILY_EPOCH_UTC) / 86400000));
}

export function dailyLeaderboardScore(day, realScore) {
  return dailyDayIndex(day) * DAILY_SCORE_BASE + clampScore(realScore);
}

export function dailyExtraData(day, result, score = dailyScore(result)) {
  return JSON.stringify({
    version: 2,
    day: String(day),
    score: clampScore(score),
    time: Math.max(0, Number(result?.time) || 0),
    cores: Math.max(0, Math.min(3, Math.floor(Number(result?.cores) || 0))),
  });
}

export function parseDailyEntry(entry, day) {
  try {
    const data = JSON.parse(typeof entry?.extraData === "string" ? entry.extraData : "");
    const composite = Number(entry?.score);
    if (data?.version !== 2 || data.day !== day || !Number.isFinite(composite)) return null;
    if (Math.floor(composite / DAILY_SCORE_BASE) !== dailyDayIndex(day)) return null;
    const score = clampScore(data.score);
    if (dailyLeaderboardScore(day, score) !== Math.floor(composite)) return null;
    return {
      rank: Math.max(0, Math.floor(Number(entry.rank) || 0)),
      name: String(entry.player?.publicName || entry.player?.uniqueID || "").slice(0, 80),
      score,
      time: Math.max(0, Number(data.time) || 0),
      cores: Math.max(0, Math.min(3, Math.floor(Number(data.cores) || 0))),
    };
  } catch {
    return null;
  }
}

export function dailyEntriesForDay(response, day) {
  return (Array.isArray(response?.entries) ? response.entries : [])
    .map((entry) => parseDailyEntry(entry, day)).filter(Boolean)
    .sort((a, b) => b.score - a.score || a.time - b.time).slice(0, 10);
}

export function dailyLevelForDay(day, levels) {
  const source = levels[hashDay(day) % levels.length] || levels[0];
  return { ...source, daily: true, dailyDay: String(day), dailySourceId: source.id };
}

export function dailyScore(result) {
  return Math.max(1, Math.round(1000000 + (result.cores || 0) * 100000 + (result.dots || 0) * 5000 + (result.coins || 0) * 250 - (result.time || 0) * 100));
}

export function recordDailyScore(scores, day, result) {
  const entry = { score: dailyScore(result), time: Math.max(0, Number(result.time) || 0), cores: result.cores || 0, at: Date.now() };
  const next = [...(scores?.[day] || []), entry].sort((a, b) => b.score - a.score).slice(0, 10);
  return { ...(scores || {}), [day]: next };
}

export const bestDailyResult = (scores, day) => scores?.[day]?.[0] || null;
