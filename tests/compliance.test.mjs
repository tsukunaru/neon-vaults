import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STRINGS, selectLanguage, translator } from "../src/i18n.js";
import { SECTORS } from "../src/sectors.js";
import { SKINS } from "../src/skins.js";
import { MECHANIC_TUTORIALS } from "../src/tutorials.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const build = readFileSync(new URL("../scripts/build.mjs", import.meta.url), "utf8");
const storeTexts = readFileSync(new URL("../store-texts.md", import.meta.url), "utf8");
const promoBuild = readFileSync(new URL("../tools/build-promo-videos.py", import.meta.url), "utf8");

test("RU and EN dictionaries cover every UI marker and skin", () => {
  assert.deepEqual(Object.keys(STRINGS.ru).sort(), Object.keys(STRINGS.en).sort());
  const keys = [...html.matchAll(/data-i18n(?:-aria|-content)?="([^"]+)"/g)].map((match) => match[1]);
  for (const key of keys) for (const language of ["ru", "en"]) assert.equal(typeof STRINGS[language][key] === "string" && STRINGS[language][key].length > 0, true, `${language}:${key}`);
  for (const skin of SKINS) for (const language of ["ru", "en"]) assert.equal(typeof STRINGS[language][skin.nameKey] === "string" && STRINGS[language][skin.nameKey].length > 0, true, `${language}:${skin.id}`);
  for (const sector of SECTORS) for (const key of [sector.nameKey, sector.lineKey, sector.signatureKey]) for (const language of ["ru", "en"]) assert.ok(STRINGS[language][key], `${language}:${key}`);
  for (const tutorial of MECHANIC_TUTORIALS) for (const key of [tutorial.titleKey, tutorial.bodyKey]) for (const language of ["ru", "en"]) assert.ok(STRINGS[language][key], `${language}:${key}`);
});

test("the RU dictionary contains no unapproved English UI fragments", () => {
  const allowed = /Neon Vaults|WASD/g;
  for (const [key, value] of Object.entries(STRINGS.ru)) {
    const visible = value.replace(/\{[^}]+\}/g, "").replace(allowed, "");
    assert.doesNotMatch(visible, /[A-Za-z]/, key);
  }
});

test("the EN dictionary contains no Cyrillic UI fragments", () => {
  for (const [key, value] of Object.entries(STRINGS.en)) assert.doesNotMatch(value, /[\u0400-\u04ff]/, key);
});

test("platform locale overrides legacy implicit language but preserves an explicit per-locale choice", () => {
  assert.equal(selectLanguage({ language: "ru" }, "en"), "en");
  assert.equal(selectLanguage({ language: "en" }, "ru"), "ru");
  assert.equal(selectLanguage({ language: "en", languagePlatform: "ru" }, "ru"), "en");
  assert.equal(selectLanguage({ language: "ru", languagePlatform: "en" }, "en"), "ru");
});

test("store descriptions do not mix RU and EN text", () => {
  const [ru = "", en = ""] = storeTexts.split(/^# English$/m);
  assert.doesNotMatch(ru.replace(/Neon Vaults|WASD/g, ""), /[A-Za-z]/);
  assert.doesNotMatch(en, /[\u0400-\u04ff]/);
});

test("the RU vertical promo excludes legacy HUD and result text", () => {
  assert.match(promoBuild, /crop=520:575:380:105/);
  assert.match(promoBuild, /"-t", "19"/);
  assert.doesNotMatch(promoBuild.match(/vertical_filter = \([\s\S]*?\n    \)/)?.[0] || "", /drawtext|vertical-overlay|centered_text|pad=/);
});

test("every static textual HTML leaf is localized or is a language selector", () => {
  const leaves = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>([^<>]+)<\/\1>/gi)]
    .filter(([, tag, , value]) => tag !== "script" && /\p{L}/u.test(value))
    .filter(([, , attributes]) => !/data-i18n(?:-aria|-content)?=|data-language=/.test(attributes));
  assert.deepEqual(leaves.map((match) => match[3].trim()), []);
});

test("production UI has no platform branding, placeholders, or direct skin names", () => {
  assert.doesNotMatch(`${html}\n${main}`, /Yandex ID|Яндекс ID|COMING SOON|ВСКОРЕ/i);
  assert.doesNotMatch(html, /mode-card-soon|aria-disabled="true"|id="debug-panel"/);
  assert.doesNotMatch(main, /setupDebug|skin\.name\b|["']PAR["']|BEST:|\bpts\b/);
  assert.match(main, /function skinName\(skin\) \{ return t\(skin\.nameKey\); \}/);
});

test("mobile shell blocks native selection and root overscroll", () => {
  assert.match(styles, /-webkit-user-select:\s*none/);
  assert.match(styles, /-webkit-touch-callout:\s*none/);
  assert.match(styles, /body \{ position:fixed;/);
  assert.match(styles, /overscroll-behavior:none/);
  assert.match(styles, /\.screen \{[^}]*touch-action:pan-y/s);
  assert.match(styles, /min-width:900px[^}]*min-height:600px/);
  assert.match(main, /installViewportGuards\(\{ root: \$\("#app"\), onResize: \(\) => renderer\.resize\(\) \}\)/);
});

test("legacy Yandex baseline has syntax transpilation and a non-Grid layout", () => {
  assert.match(build, /targets:\s*\{\s*android:\s*"5",\s*ios:\s*"9",\s*safari:\s*"9"\s*\}/);
  assert.match(html, /className\+=" legacy-layout"/);
  assert.match(styles, /\.legacy-layout \.app\{[^}]*display:block/s);
  assert.match(styles, /\.legacy-layout \.stage\{[^}]*position:absolute/s);
  assert.match(styles, /\.legacy-layout \.game-nav\{[^}]*display:flex/s);
});
