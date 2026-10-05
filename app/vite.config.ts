/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pbstudioApi } from "./server/plugin.ts";

export default defineConfig({
  // Relative asset URLs: the built dist/ works from any path — the site root, a /playbook/ sub-folder of an existing
  // website, or `npm start` (docs/HOSTING.md). The app uses hash routes, so no server rewrites are needed.
  base: "./",
  plugins: [react(), pbstudioApi()],
  // The README, docs and bookmarks point at :5178; if it's taken, fail loudly instead of moving to another port
  // (run a second copy with `npx vite --port 5179`).
  server: { port: 5178, strictPort: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
