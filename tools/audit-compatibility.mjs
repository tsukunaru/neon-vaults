import { readFile } from "node:fs/promises";

const bundle = await readFile(new URL("../dist/game.js", import.meta.url), "utf8");
const css = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");
const unsupportedRuntime = [
  ["Object.fromEntries", /\bObject\.fromEntries\b/],
  ["Object.entries", /\bObject\.entries\b/],
  ["Object.values", /\bObject\.values\b/],
  ["Promise.prototype.finally", /\.finally\s*\(/],
  ["Element.append", /\.append\s*\(/],
  ["Element.replaceChildren", /\.replaceChildren\s*\(/],
  ["Array.prototype.includes", /\.includes\s*\(/],
  ["Array.prototype.at", /\.at\s*\(/],
  ["Array.prototype.flat/flatMap", /\.flat(?:Map)?\s*\(/],
  ["String.prototype.padStart/padEnd", /\.pad(?:Start|End)\s*\(/],
  ["URLSearchParams", /\bURLSearchParams\b/],
  ["globalThis", /\bglobalThis\b/],
  ["optional chaining syntax", /\?\.(?!\d)/],
  ["nullish coalescing syntax", /\?\?/],
  ["async function syntax", /\basync(?:\s+function\b|\s+[A-Za-z_$][\w$]*\s*(?:=>|\()|\s*\([^)]*\)\s*=>)/],
];
const unsupportedSyntax = [
  ["arrow functions", /=>/],
  ["generator syntax", /function\s*\*/],
  ["class syntax", /\bclass\s+[A-Za-z_$][\w$]*\s*\{/],
  ["let declarations", /\blet\s+[A-Za-z_$]/],
  ["const declarations", /\bconst\s+[A-Za-z_$]/],
  ["template literals", /`/],
];
const failures = [...unsupportedRuntime, ...unsupportedSyntax].filter(([, pattern]) => pattern.test(bundle)).map(([name]) => name);

if (failures.length) throw new Error(`Production bundle exceeds the Safari/iOS 9 runtime baseline: ${failures.join(", ")}`);
if (!css.includes(".legacy-layout") || !css.includes("no Grid or CSS variables")) throw new Error("Legacy CSS layout fallback is missing");
console.log("Compatibility audit passed: ES5 syntax plus Safari/iOS 9 CSS layout fallback.");
