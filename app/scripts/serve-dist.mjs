// The built site (app/dist), served the way your web server will serve it — for a look before you upload it.
//
//   npm run preview:site                       → http://localhost:4178/playbook/  (dist/ under a /playbook/ sub-folder,
//                                                 like public_html/playbook/ on your server)
//   node scripts/serve-dist.mjs --port 8080 --path /    serve it at the root instead
//   npm run build:site                         → build, then `--check`: is dist/ ready to upload?
//
// Static files only — no file API — so the app starts in folder mode (the "Open your 2026 Playbook folder" screen),
// exactly like the hosted site. http://localhost counts as a secure page, so the folder picker works here (Chrome or
// Edge). Binds to localhost only. Docs: docs/HOSTING.md.
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(APP, "dist");
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

/** Every file under `dir`, as paths relative to it ("/"-separated). */
function walk(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out;
}

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ───────────────────────────── --check ─────────────────────────────

function check() {
  const problems = [];
  if (!existsSync(path.join(DIST, "index.html"))) {
    console.error("app/dist/index.html is missing — run `npm run build` (or `npm run build:site`) in app/ first.");
    process.exit(1);
  }
  const files = walk(DIST);
  const html = readFileSync(path.join(DIST, "index.html"), "utf8");
  // Absolute links break when the site lives in a sub-folder (public_html/playbook/).
  const absolute = [...html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((m) => m[1]);
  if (absolute.length) problems.push(`index.html links to absolute paths (${absolute.join(", ")}): keep base "./" in vite.config.ts.`);
  if (!files.some((f) => f.startsWith("assets/") && f.endsWith(".js"))) problems.push("dist/assets/ has no .js files — the build looks incomplete.");
  // The site must never contain game data or your playbooks.
  const leaked = files.filter((f) => /^(data|playbooks|app-data|tools|mods)\//.test(f) || /(^|\/)(plays|assignments|sets|formations|enums)\.json$/.test(f));
  if (leaked.length) problems.push(`dist/ contains files that belong in your 2026 Playbook folder, not on a website: ${leaked.slice(0, 5).join(", ")}`);
  // The site loads its fonts (Public Sans, DM Mono) from Google Fonts; dist/ should carry no font files of its own.
  const fontFiles = files.filter((f) => /\.(otf|ttf|woff2?|eot)$/i.test(f) && /nb.?international/i.test(f));
  const fontData = files.filter((f) => /\.(css|js|html)$/i.test(f) && /data:(font\/|application\/(x-)?font)/i.test(readFileSync(path.join(DIST, f), "utf8")));
  if (fontFiles.length || fontData.length)
    problems.push(`dist/ carries font files or embedded font data (${[...fontFiles, ...fontData].slice(0, 5).join(", ")}): load fonts from Google Fonts instead of uploading them.`);

  const total = files.reduce((n, f) => n + statSync(path.join(DIST, f)).size, 0);
  const top = [...new Set(files.map((f) => (f.includes("/") ? `${f.split("/")[0]}/` : f)))].sort();
  console.log(`\napp/dist is the whole website: ${files.length} files, ${fmtSize(total)}.`);
  console.log(`Upload what's INSIDE it (not the dist folder itself): ${top.join("  ")}`);
  if (problems.length) {
    console.log("\nProblems:");
    for (const p of problems) console.log(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log(`
Next steps (docs/HOSTING.md):
  1. Look at it first:   npm run preview:site   → http://localhost:4178/playbook/ in Chrome or Edge
  2. Upload with your FTP app into the site folder, e.g. /public_html/playbook/ — the assets/ folder first,
     index.html last. Replace the old files when you update.
  3. Open https://<your-site>/playbook/  (https is required for the folder picker).
`);
}

// ───────────────────────────── server ─────────────────────────────

function serve() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    console.error("app/dist/index.html is missing — run `npm run build` in app/ first.");
    process.exit(1);
  }
  const port = Number(opt("--port", process.env.PORT ?? "4178"));
  let mount = opt("--path", "/playbook/");
  if (!mount.startsWith("/")) mount = `/${mount}`;
  if (!mount.endsWith("/")) mount += "/";

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = url.pathname;
    }
    // Like Apache: /playbook → /playbook/ (relative links need the slash).
    if (pathname === mount.slice(0, -1) || (mount !== "/" && pathname === "/")) {
      res.writeHead(301, { Location: mount });
      return res.end();
    }
    if (!pathname.startsWith(mount)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(`Not found. The site is at ${mount}\n`);
    }
    let rel = pathname.slice(mount.length);
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(DIST, rel);
    if (!file.startsWith(DIST + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found\n");
    }
    const ext = path.extname(file).toLowerCase();
    // The same caching the .htaccess in docs/htaccess.txt sets up: fingerprinted assets forever, index.html re-checked.
    const cache = /-[\w-]{8}\.(js|css)$/.test(file) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  });
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${port} is taken — try: node scripts/serve-dist.mjs --port ${port + 1}` : e.message);
    process.exit(1);
  });
  server.listen(port, "localhost", () => {
    console.log(`Playbook Studio (built site, folder mode): http://localhost:${port}${mount}`);
    console.log("Open it in Chrome or Edge, click Open folder… and pick your 2026 Playbook folder. Ctrl+C stops the server.");
  });
}

if (args.includes("--check")) check();
else serve();
