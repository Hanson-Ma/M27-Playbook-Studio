// Production server: `npm run build && npm start`. Serves app/dist (SPA fallback to index.html) plus the same file
// API as the dev server. Runs directly under Node's type stripping (erasable TS only, ".ts" import extensions).
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { createApiHandler } from "./api.ts";

const appDir = path.resolve(import.meta.dirname, "..");
const distDir = path.join(appDir, "dist");
const root = path.resolve(appDir, "..");
const port = Number(process.env.PORT) || 5178;
const host = process.env.HOST || "localhost";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/** Same default as Vite's server.allowedHosts: loopback names and IP literals only (blocks DNS rebinding). */
function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let name: string;
  try {
    name = new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return name === "localhost" || name.endsWith(".localhost") || net.isIP(name) !== 0;
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" }).end("Method not allowed");
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Bad request");
    return;
  }
  const file = path.resolve(distDir, "." + pathname);
  const inside = file === distDir || file.startsWith(distDir + path.sep);

  let target = inside ? file : undefined;
  if (target) {
    const st = await fs.stat(target).catch(() => undefined);
    if (!st?.isFile()) target = undefined;
  }
  // SPA fallback for extension-less paths (the app uses hash routes, but deep links shouldn't 404).
  const isAsset = /\.[a-z0-9]+$/i.test(pathname);
  if (!target && !isAsset) target = path.join(distDir, "index.html");
  if (!target) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }

  let body: Buffer;
  try {
    body = await fs.readFile(target);
  } catch {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }).end("app/dist is missing: run `npm run build` first.");
    return;
  }
  const hashed = target.startsWith(path.join(distDir, "assets") + path.sep);
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

const api = createApiHandler({ root });

const server = http.createServer((req, res) => {
  if (!hostAllowed(req.headers.host)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Host not allowed");
    return;
  }
  api(req, res, () => {
    serveStatic(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal error");
    });
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use (is \`npm run dev\` running?). Start on another port with PORT=5179 npm start.`);
    process.exit(1);
  }
  throw err;
});

server.listen(port, host, () => {
  console.log(`Playbook Studio → http://localhost:${port}  (repo: ${root})`);
  fs.access(path.join(distDir, "index.html")).catch(() =>
    console.warn("app/dist is missing: run `npm run build` first (the API still works)."),
  );
});
