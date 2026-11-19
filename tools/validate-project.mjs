import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../src/config.js";
import { STRINGS } from "../src/i18n.js";
import { LEVELS } from "../src/levels.js";
import { normalizeSave } from "../src/save.js";
import { SECTORS } from "../src/sectors.js";
import { SKINS } from "../src/skins.js";
import { MECHANIC_TUTORIALS } from "../src/tutorials.js";
import { validateAllLevels } from "../src/level-validator.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, css, main, storeTexts] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "src/styles.css"), "utf8"),
  readFile(path.join(root, "src/main.js"), "utf8"),
  readFile(path.join(root, "store-texts.md"), "utf8"),
]);
const build = await readFile(path.join(root, "scripts/build.mjs"), "utf8");
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
check(duplicateIds.length === 0, `duplicate DOM ids: ${duplicateIds.join(", ")}`);

const generatedIds = [...main.matchAll(/\bid=["']([\w-]+)["']/g)].map((match) => match[1]);
const availableIds = new Set([...ids, ...generatedIds]);
const selectors = [...main.matchAll(/\$\(["']#([\w-]+)["']\)/g)].map((match) => match[1]);
const missingSelectors = [...new Set(selectors.filter((id) => !availableIds.has(id)))];
check(missingSelectors.length === 0, `missing DOM selectors: ${missingSelectors.join(", ")}`);

const references = [
  ...html.matchAll(/\b(?:src|href)="([^"]+)"/g),
  ...css.matchAll(/url\(["']?([^"')]+)["']?\)/g),
].map((match) => match[1]).filter((reference) => reference !== "/sdk.js" && !/^(?:data:|https?:|#)/.test(reference));
const missingAssets = [];
for (const reference of references) {
  const local = reference.split(/[?#]/)[0].replace(/^\//, "");
  try { await access(path.join(root, local)); } catch { missingAssets.push(reference); }
}
check(missingAssets.length === 0, `missing local assets: ${missingAssets.join(", ")}`);

const ruKeys = Object.keys(STRINGS.ru).sort(); const enKeys = Object.keys(STRINGS.en).sort();
check(JSON.stringify(ruKeys) === JSON.stringify(enKeys), `i18n parity mismatch: RU ${ruKeys.length}, EN ${enKeys.length}`);
const htmlKeys = [...html.matchAll(/data-i18n(?:-aria|-content)?="([^"]+)"/g)].map((match) => match[1]);
const sourceKeys = [...main.matchAll(/\bt\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
const missingI18n = [...new Set([...htmlKeys, ...sourceKeys].filter((key) => !STRINGS.ru[key] || !STRINGS.en[key]))];
check(missingI18n.length === 0, `missing i18n keys: ${missingI18n.join(", ")}`);
const missingSkinNames = SKINS.filter((skin) => !STRINGS.ru[skin.nameKey] || !STRINGS.en[skin.nameKey]).map((skin) => skin.id);
check(missingSkinNames.length === 0, `missing localized skin names: ${missingSkinNames.join(", ")}`);
const structuredKeys = [
  ...SECTORS.flatMap((sector) => [sector.nameKey, sector.lineKey, sector.signatureKey]),
  ...MECHANIC_TUTORIALS.flatMap((tutorial) => [tutorial.titleKey, tutorial.bodyKey]),
];
const missingStructuredKeys = structuredKeys.filter((key) => !STRINGS.ru[key] || !STRINGS.en[key]);
check(missingStructuredKeys.length === 0, `missing structured i18n keys: ${missingStructuredKeys.join(", ")}`);
const ruLatin = Object.entries(STRINGS.ru).filter(([, value]) => /[A-Za-z]/.test(value.replace(/\{[^}]+\}/g, "").replace(/Neon Vaults|WASD/g, ""))).map(([key]) => key);
check(ruLatin.length === 0, `untranslated Latin text in RU dictionary: ${ruLatin.join(", ")}`);
const enCyrillic = Object.entries(STRINGS.en).filter(([, value]) => /[\u0400-\u04ff]/.test(value)).map(([key]) => key);
check(enCyrillic.length === 0, `untranslated Cyrillic text in EN dictionary: ${enCyrillic.join(", ")}`);
const [ruStore = "", enStore = ""] = storeTexts.split(/^# English$/m);
check(!/[A-Za-z]/.test(ruStore.replace(/Neon Vaults|WASD/g, "")), "untranslated Latin text in RU store description");
check(!/[\u0400-\u04ff]/.test(enStore), "untranslated Cyrillic text in EN store description");
const staticLeaves = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>([^<>]+)<\/\1>/gi)]
  .filter(([, tag, , value]) => tag !== "script" && /\p{L}/u.test(value))
  .filter(([, , attributes]) => !/data-i18n(?:-aria|-content)?=|data-language=/.test(attributes));
check(staticLeaves.length === 0, `unlocalized static HTML text: ${staticLeaves.map((match) => match[3].trim()).join(" | ")}`);
check(!/(?:Yandex ID|Яндекс ID|COMING SOON|ВСКОРЕ)/i.test(`${html}\n${main}`), "forbidden production or platform-branded UI text found");
check(!/skin\.name\b|["']PAR["']|BEST:|\bpts\b/.test(main), "hard-coded user-facing text found in main UI flow");
check(/installViewportGuards/.test(main) && /-webkit-touch-callout:\s*none/.test(css) && /overscroll-behavior:\s*none/.test(css), "mobile interaction guards are incomplete");
check(/className\+=" legacy-layout"/.test(html) && /\.legacy-layout \.app\{[^}]*display:block/s.test(css), "legacy CSS layout fallback is incomplete");
check(/targets:\s*\{\s*android:\s*"5",\s*ios:\s*"9",\s*safari:\s*"9"\s*\}/.test(build), "legacy JavaScript transpilation target is missing");

check(LEVELS.length === CONFIG.maxLevels, `expected ${CONFIG.maxLevels} levels, found ${LEVELS.length}`);
check(LEVELS.every((level, index) => level.id === index + 1), "level ids must be contiguous 1..250");
const levelResult = validateAllLevels(LEVELS);
check(levelResult.valid, `${levelResult.results.filter((level) => !level.valid).length} invalid levels`);

check(new Set(SKINS.map((skin) => skin.id)).size === SKINS.length, "duplicate skin ids");
check(SECTORS.length === 13 && SECTORS[0].start === 1 && SECTORS.at(-1).end === 250
  && SECTORS.every((sector, index) => index === 0 || sector.start === SECTORS[index - 1].end + 1), "invalid sector ranges");
const migrated = normalizeSave({ version: 1, unlockedLevel: 77, cores: { 76: 3 }, ownedSkins: ["spark"], updatedAt: 1 });
check(migrated.version === CONFIG.saveVersion && migrated.unlockedLevel === 77 && migrated.cores[76] === 3, "save v1 migration failed");

if (errors.length) {
  errors.forEach((error) => console.error(`FAIL: ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Project validation passed: ${LEVELS.length} levels, ${ids.length} DOM ids, ${ruKeys.length} bilingual keys, ${SKINS.length} skins, ${references.length} local references.`);
}
