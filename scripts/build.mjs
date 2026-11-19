import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { transformAsync } from "@babel/core";
import presetEnv from "@babel/preset-env";

const result = await build({
  entryPoints: ["src/main.js"], bundle: true, format: "iife", target: ["es2015"],
  minify: true, legalComments: "none", write: false,
});
const legacy = await transformAsync(result.outputFiles[0].text, {
  babelrc: false,
  configFile: false,
  comments: false,
  compact: true,
  minified: true,
  sourceType: "script",
  presets: [[presetEnv, {
    bugfixes: true,
    modules: false,
    targets: { android: "5", ios: "9", safari: "9" },
    useBuiltIns: false,
  }]],
});
if (!legacy?.code) throw new Error("Legacy browser transpilation produced no output");
await mkdir("dist", { recursive: true });
await writeFile("dist/game.js", legacy.code, "utf8");
await cp("src/styles.css", "dist/styles.css");
const index = await readFile("index.html", "utf8");
if (!index.includes("dist/game.js") || !index.includes("dist/styles.css")) throw new Error("index.html must reference production assets");
await access("assets/ui/hero.webp");
console.log(`Built ${(Buffer.byteLength(legacy.code) / 1024).toFixed(1)} KiB Safari/iOS 9-compatible game bundle.`);
