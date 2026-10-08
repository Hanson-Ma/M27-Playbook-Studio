// Headless-Chrome QA driver for Playbook Studio (dev tool; needs Google Chrome + a running dev server).
//   node scripts/qa.mjs <steps.json> [--port 9340] [--base http://localhost:5178] 
// steps.json = { "steps": [ … ] }, each step one of:
//   { "size": [w, h] }                 viewport
//   { "nav": "#/library", "wait": ms }  navigate (relative hashes use --base); waits for the app, then `wait` ms (default 1500)
//   { "wait": ms }
//   { "eval": "js expression", "print": true }
//   { "key": "ArrowDown" | "Enter" | "x" | "1", "mods": "mod+shift", "times": n }
//   { "type": "text to type" }
//   { "click": [x, y] } | { "dblclick": [x, y] } | { "rclick": [x, y] } | { "drag": [[x1, y1], [x2, y2]] }
//   { "clickText": "LIBRARY" }        click the first visible element whose text matches (trimmed, case-insensitive)
//   { "pad": "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "LS" | "RS" | "VIEW" | "MENU" | "UP" | "DOWN" | "LEFT" | "RIGHT", "hold": ms, "times": n }
//                                      a virtual Xbox controller (injected navigator.getGamepads)
//   { "padType": "ps" }                switch the virtual controller to a DualSense id
//   { "shot": "file.png" }             screenshot (absolute path or relative to cwd)
//   { "text": true }                   print document.body.innerText (first 4000 chars)
// Console errors/warnings and page exceptions are printed at the end.
// Gotcha: dialogs are only accepted while a run is connected. If Vite does a full reload between runs while a file
// has unsaved changes, the page waits on a "Leave site?" (beforeunload) prompt nobody answers and every later run
// hangs as if the app froze. Save or undo before editing source files, keep a CDP session open that accepts
// Page.javascriptDialogOpening, or restart Chrome (pkill -f "remote-debugging-port=<port>").
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const port = Number(opt("--port", "9340"));
const base = opt("--base", "http://localhost:5178");
const script = JSON.parse(readFileSync(args[0], "utf8"));
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureChrome() {
  try {
    await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    return;
  } catch {}
  const profile = path.join(os.tmpdir(), `pbstudio-qa-${port}`);
  mkdirSync(profile, { recursive: true });
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,900", "about:blank"], {
    detached: true,
    stdio: "ignore",
  }).unref();
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return;
    } catch {}
  }
  throw new Error("Chrome did not start");
}

await ensureChrome();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
let page = targets.find((t) => t.type === "page");
if (!page) page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (d.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(d.params.type))
    logs.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description).join(" ")}`.slice(0, 600));
  if (d.method === "Runtime.exceptionThrown")
    logs.push(`EXCEPTION: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`.slice(0, 800));
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
// A background headless tab never has focus: emulate it so :focus styles and focus/blur events behave like a real
// window, and accept JS dialogs (the unsaved-changes beforeunload prompt would otherwise hang the run).
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true });
});

const PAD_INDEX = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PAD_IDS = {
  xbox: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
  ps: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
};
let padType = "xbox";
const injectPad = () =>
  evaluate(`(() => {
    if (!window.__qaPad) {
      window.__qaPad = { id: ${JSON.stringify(PAD_IDS[padType])}, index: 0, connected: true, mapping: "standard", timestamp: 0,
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
      navigator.getGamepads = () => [window.__qaPad, null, null, null];
      window.dispatchEvent(new Event("gamepadconnected"));
    }
    window.__qaPad.id = ${JSON.stringify(PAD_IDS[padType])};
    return true;
  })()`);
const KEYCODES = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27, Tab: 9, Delete: 46, Backspace: 8, " ": 32, "/": 191 };
const modBits = (m = "") => {
  let b = 0;
  for (const p of m.split("+")) {
    if (p === "alt") b |= 1;
    if (p === "ctrl") b |= 2;
    if (p === "mod" || p === "meta") b |= os.platform() === "darwin" ? 4 : 2;
    if (p === "shift") b |= 8;
  }
  return b;
};
const mouse = async (type, x, y, button = "left", clickCount = 1) => send("Input.dispatchMouseEvent", { type, x, y, button, clickCount });

for (const s of script.steps) {
  if (s.size) await send("Emulation.setDeviceMetricsOverride", { width: s.size[0], height: s.size[1], deviceScaleFactor: 1, mobile: false });
  if (s.nav) {
    const url = s.nav.startsWith("#") ? base + "/" + s.nav : s.nav;
    const cur = await evaluate("location.origin + location.pathname");
    if (cur && url.startsWith(cur) && s.nav.startsWith("#")) await evaluate(`location.hash = ${JSON.stringify(s.nav)}; 1`);
    else await send("Page.navigate", { url });
    // wait until the library finished loading (loading screen gone) or 20 s
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      const ready = await evaluate("!!document.querySelector('#root') && !/LOADING|Loading library/i.test(document.body?.innerText?.slice(0, 400) ?? '')");
      if (ready) break;
    }
    await sleep(s.wait ?? 1500);
    continue;
  }
  if (s.wait) await sleep(s.wait);
  if (s.eval) {
    const v = await evaluate(s.eval);
    if (s.print) console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1));
  }
  if (s.key) {
    for (let t = 0; t < (s.times ?? 1); t++) {
      const k = s.key;
      const code = KEYCODES[k] ?? k.toUpperCase().charCodeAt(0);
      const text = k.length === 1 && !s.mods ? k : undefined;
      const c = k.length === 1 ? (/[a-z]/i.test(k) ? "Key" + k.toUpperCase() : /\d/.test(k) ? "Digit" + k : k) : k;
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: c, windowsVirtualKeyCode: code, modifiers: modBits(s.mods), text });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: c, windowsVirtualKeyCode: code, modifiers: modBits(s.mods) });
      await sleep(s.after ?? 220);
    }
  }
  if (s.type) await send("Input.insertText", { text: s.type });
  if (s.click || s.dblclick) {
    const [x, y] = s.click ?? s.dblclick;
    await mouse("mouseMoved", x, y);
    for (let c = 1; c <= (s.dblclick ? 2 : 1); c++) {
      await mouse("mousePressed", x, y, "left", c);
      await mouse("mouseReleased", x, y, "left", c);
    }
    await sleep(s.after ?? 350);
  }
  if (s.rclick) {
    const [x, y] = s.rclick;
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y, "right");
    await mouse("mouseReleased", x, y, "right");
    await sleep(350);
  }
  if (s.drag) {
    const [[x1, y1], [x2, y2]] = s.drag;
    await mouse("mouseMoved", x1, y1);
    await mouse("mousePressed", x1, y1);
    for (let i = 1; i <= 12; i++) await mouse("mouseMoved", x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12);
    await mouse("mouseReleased", x2, y2);
    await sleep(400);
  }
  if (s.clickText) {
    const pt = await evaluate(`(() => {
      const want = ${JSON.stringify(s.clickText)}.trim().toLowerCase();
      const els = [...document.querySelectorAll("button, a, [role=tab], [role=button], [role=option], [role=menuitem], li, span, div")];
      const el = els.find(e => e.offsetParent !== null && e.innerText && e.innerText.trim().toLowerCase() === want);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`);
    if (!pt) console.log(`clickText: "${s.clickText}" not found`);
    else {
      await mouse("mouseMoved", pt[0], pt[1]);
      await mouse("mousePressed", pt[0], pt[1]);
      await mouse("mouseReleased", pt[0], pt[1]);
      await sleep(s.after ?? 400);
    }
  }
  if (s.padType) padType = s.padType;
  if (s.pad) {
    await injectPad();
    const i = PAD_INDEX[s.pad];
    for (let t = 0; t < (s.times ?? 1); t++) {
      await evaluate(`(() => { const b = window.__qaPad.buttons[${i}]; b.pressed = true; b.value = 1; window.__qaPad.timestamp = performance.now(); window.dispatchEvent(new Event("gamepadconnected")); return 1; })()`);
      await sleep(s.hold ?? 90);
      await evaluate(`(() => { const b = window.__qaPad.buttons[${i}]; b.pressed = false; b.value = 0; window.__qaPad.timestamp = performance.now(); return 1; })()`);
      await sleep(s.after ?? 220);
    }
  }
  if (s.shot) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    const file = path.resolve(s.shot);
    const dir = path.dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, Buffer.from(r.result.data, "base64"));
    console.log("shot", file);
  }
  if (s.text) console.log(String(await evaluate("document.body.innerText")).slice(0, s.chars ?? 4000));
}
if (logs.length) console.log("CONSOLE:\n" + [...new Set(logs)].slice(0, 40).join("\n"));
ws.close();
process.exit(0);
