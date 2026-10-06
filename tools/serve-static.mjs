// Minimal static file server for local previews.  usage: node tools/serve-static.mjs <dir> [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const root = process.argv[2] ?? ".", port = +(process.argv[3] ?? 5179);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[/\\]+/, "");
  if (path.startsWith("..")) { res.writeHead(403).end(); return; }
  const file = join(root, path || "index.html");
  try {
    const body = await readFile(/[/\\]$/.test(file) ? join(file, "index.html") : file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch { res.writeHead(404).end("not found"); }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
