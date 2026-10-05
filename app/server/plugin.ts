// Vite plugin: mounts the file API + library handler on the dev and preview servers, so `npm run dev` serves the
// app and the API from one process.
import path from "node:path";
import type { Plugin } from "vite";
import { createApiHandler } from "./api.ts";

export function pbstudioApi(opts: { root?: string } = {}): Plugin {
  let root = opts.root;
  const handler = () => createApiHandler({ root: root ?? path.resolve(process.cwd(), "..") });
  return {
    name: "pbstudio-api",
    configResolved(config) {
      // config.root is app/; the repo root is its parent.
      root ??= path.resolve(config.root, "..");
    },
    // Registered directly (not via a returned post-hook) so /api and /library run before Vite's own middlewares.
    configureServer(server) {
      server.middlewares.use(handler());
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler());
    },
  };
}
