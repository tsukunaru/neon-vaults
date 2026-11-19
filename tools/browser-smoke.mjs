import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "reports", "browser-smoke");
const chrome = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const viewports = [[320, 480], [320, 568], [320, 640], [360, 640], [390, 844], [412, 915], [740, 360], [812, 375], [844, 390], [873, 393], [915, 412], [768, 1024], [1024, 768], [1280, 720], [1366, 768], [1920, 1080], [2560, 1440]];
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webp": "image/webp" };
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function staticServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/sdk.js") { response.writeHead(200, { "content-type": mime[".js"] }); response.end("/* local SDK fallback */"); return; }
      if (pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      const file = path.resolve(root, pathname === "/" ? "index.html" : pathname.slice(1));
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error("Path outside project");
      const body = await readFile(file);
      response.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" }); response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
}

async function devtoolsPort(profile) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]); } catch { await wait(50); }
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let serial = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const task = pending.get(message.id); pending.delete(message.id);
      if (message.error) task?.reject(new Error(message.error.message)); else task?.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, listener) => listeners.set(method, [...(listeners.get(method) || []), listener]);
  return { socket, send, on };
}

async function main() {
  await mkdir(output, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(path.join(tmpdir(), "neon-vaults-smoke-"));
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const failures = [];
  try {
    const port = await devtoolsPort(profile);
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = pages.find((entry) => entry.type === "page");
    if (!page) throw new Error("No Chrome page target");
    const cdp = await connect(page.webSocketDebuggerUrl);
    const consoleErrors = [];
    cdp.on("Runtime.exceptionThrown", (event) => consoleErrors.push(event.exceptionDetails?.text || "runtime exception"));
    cdp.on("Log.entryAdded", ({ entry }) => { if (entry.level === "error") consoleErrors.push(entry.text); });
    await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Log.enable")]);
    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const ready = async () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate("Boolean(document.querySelector('#app') && !document.querySelector('#app').classList.contains('is-loading'))")) return;
        await wait(50);
      }
      throw new Error("Game did not become interactive");
    };
    const metrics = () => evaluate(`(() => {
      const activeScreen = document.querySelector('.screen.active');
      const candidates = activeScreen
        ? [activeScreen, ...activeScreen.querySelectorAll('*'), ...document.querySelectorAll('.modal:not(.hidden), .modal:not(.hidden) *')]
        : [...document.querySelectorAll('.hud, .hud *, .stage, .stage *, .game-nav, .game-nav *, .modal:not(.hidden), .modal:not(.hidden) *')];
      const visible = candidates.filter((element) => {
        const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
        const rendered = element.checkVisibility ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : element.offsetParent !== null;
        return rendered && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
      });
      const horizontalOverflow = visible.filter((element) => !element.matches('.world-orb,.world-spire') && ((rect) => rect.left < -1 || rect.right > innerWidth + 1)(element.getBoundingClientRect())).map((element) => element.id || element.className || element.tagName).slice(0, 8);
      const clippedText = visible.filter((element) => element.children.length === 0 && element.textContent.trim() && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).textOverflow !== 'ellipsis').map((element) => element.id || element.className || element.tagName + ':' + element.textContent.trim() + ':' + element.scrollWidth + '/' + element.clientWidth).slice(0, 8);
      const languageLeaks = visible.filter((element) => {
        if (element.children.length || !element.textContent.trim() || element.closest('[data-language]')) return false;
        const text = element.textContent.replace(/Neon Vaults|WASD/g, '');
        return document.documentElement.lang === 'ru' ? /[A-Za-z]/.test(text) : /[\u0400-\u04ff]/.test(text);
      }).map((element) => element.textContent.trim()).slice(0, 8);
      const hud = document.querySelector('.hud').getBoundingClientRect(); const stage = document.querySelector('.stage').getBoundingClientRect(); const nav = document.querySelector('.game-nav').getBoundingClientRect();
      const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      return { width: innerWidth, height: innerHeight, language: document.documentElement.lang, horizontalOverflow, clippedText, languageLeaks,
        rootScroll: document.scrollingElement.scrollWidth > innerWidth + 1 || document.scrollingElement.scrollHeight > innerHeight + 1,
        gameplayOverlap: !document.querySelector('.screen.active') && (overlaps(hud, stage) || overlaps(stage, nav) || hud.top < -1 || nav.bottom > innerHeight + 1) };
    })()`);
    const setViewport = (width, height) => cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 900, screenWidth: width, screenHeight: height, screenOrientation: { type: width > height ? "landscapePrimary" : "portraitPrimary", angle: width > height ? 90 : 0 } });

    for (const [width, height] of viewports) {
      await setViewport(width, height);
      await cdp.send("Page.navigate", { url: origin });
      await ready();
      await evaluate("document.querySelector('[data-language=\"ru\"]').click()");
      await wait(30);
      let state = await metrics();
      if (state.width !== width || state.height !== height || state.rootScroll || state.horizontalOverflow.length || state.clippedText.length || state.languageLeaks.length) failures.push(`${width}x${height} home: ${JSON.stringify(state)}`);
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(path.join(output, `home-${width}x${height}.png`), Buffer.from(shot.data, "base64"));
      await evaluate("document.querySelector('#home-continue').click(); document.querySelector('#sector-enter:not(.hidden)')?.click()");
      await wait(50);
      state = await metrics();
      if (state.rootScroll || state.horizontalOverflow.length || state.clippedText.length || state.languageLeaks.length || state.gameplayOverlap) failures.push(`${width}x${height} gameplay: ${JSON.stringify(state)}`);
      const gameShot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      await writeFile(path.join(output, `gameplay-${width}x${height}.png`), Buffer.from(gameShot.data, "base64"));
    }

    await setViewport(320, 640);
    await cdp.send("Page.navigate", { url: origin }); await ready();
    await evaluate("document.querySelector('[data-language=\"en\"]').click()"); await wait(30);
    const english = await metrics();
    if (english.language !== "en" || english.rootScroll || english.horizontalOverflow.length || english.clippedText.length || english.languageLeaks.length) failures.push(`320x640 EN: ${JSON.stringify(english)}`);

    await evaluate("document.querySelector('[data-language=\"ru\"]').click()");
    for (const selector of ["#nav-map", "#nav-daily", "#nav-modes", "#nav-skins", "#settings-button"]) {
      await evaluate(`document.querySelector('${selector}').click()`); await wait(30);
      const screen = await metrics();
      if (screen.rootScroll || screen.horizontalOverflow.length || screen.clippedText.length || screen.languageLeaks.length) failures.push(`320x640 ${selector}: ${JSON.stringify(screen)}`);
      if (selector === "#nav-skins" && !await evaluate("(() => { const screen = document.querySelector('.screen.active'); if (screen.scrollHeight <= screen.clientHeight + 1) return false; screen.scrollTop = 80; return screen.scrollTop > 0; })()")) failures.push("320x640 skins: internal scrolling is unavailable");
    }

    await evaluate("document.querySelector('.screen.active [data-close-screen]')?.click(); document.querySelector('#home-continue').click(); document.querySelector('#sector-enter:not(.hidden)')?.click()");
    await setViewport(844, 390); await wait(50); await setViewport(390, 844); await wait(50);
    const rotated = await metrics();
    if (rotated.rootScroll || rotated.horizontalOverflow.length || rotated.clippedText.length || rotated.languageLeaks.length || rotated.gameplayOverlap) failures.push(`fullscreen exit/orientation: ${JSON.stringify(rotated)}`);

    await setViewport(320, 568);
    await cdp.send("Page.navigate", { url: origin }); await ready();
    await evaluate("document.documentElement.classList.add('legacy-layout'); document.querySelector('[data-language=\"ru\"]').click()"); await wait(50);
    let legacy = await metrics();
    if (legacy.rootScroll || legacy.horizontalOverflow.length || legacy.clippedText.length || legacy.languageLeaks.length) failures.push(`legacy 320x568 home: ${JSON.stringify(legacy)}`);
    await evaluate("document.querySelector('#home-continue').click(); document.querySelector('#sector-enter:not(.hidden)')?.click()"); await wait(50);
    legacy = await metrics();
    if (legacy.rootScroll || legacy.horizontalOverflow.length || legacy.clippedText.length || legacy.languageLeaks.length || legacy.gameplayOverlap) failures.push(`legacy 320x568 gameplay: ${JSON.stringify(legacy)}`);
    const legacyShot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(path.join(output, "legacy-gameplay-320x568.png"), Buffer.from(legacyShot.data, "base64"));
    cdp.socket.close();
    if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.join(" | ")}`);
  } finally {
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await Promise.race([exited, wait(2000)]);
    await new Promise((resolve) => server.close(resolve));
    const safeTemp = `${path.resolve(tmpdir())}${path.sep}`;
    if (path.resolve(profile).startsWith(safeTemp)) {
      try { await rm(profile, { recursive: true, force: true }); } catch { /* Chrome may briefly retain Crashpad state on Windows. */ }
    }
  }
  if (failures.length) throw new Error(`Browser smoke failed:\n${failures.join("\n")}`);
  console.log(`Browser smoke passed: ${viewports.length} viewports, RU/EN, gameplay, fullscreen-exit rotation and legacy CSS fallback.`);
}

await main();
