# Follow-up prompt: make Playbook Studio run as a hosted static site

> Paste everything below the line into Claude Code on the other machine **after** the first build of `app/` is done.

---

Playbook Studio (`app/`) must also run as a **static website** on my own host (hansonma.org, uploaded via FTP), usable from any browser, with no server and no GitHub login. Keep the local dev mode (Node file server writing to the repo) working exactly as it does now. Re-read `docs/FORMATS.md` first, since it has changed since the first build (red-route rule, custom sets §5, availability).

## Build
- `npm run build` produces `app/dist/`, a fully static site. Use a configurable base path (`VITE_BASE`, default `/playbook-studio/`), relative asset URLs, and **hash routing**, because FTP hosting has no rewrite rules.
- Detect the mode at runtime: if the local file server answers, use it (dev mode); otherwise run in **browser mode**.

## Browser mode: data
- **Library** (`data/library/*.json`, about 24 MB): **don't deploy it to the public site by default**, because it's data extracted from the game. Add a "Load library" action:
  - the user picks the `data/library` folder (File System Access API, with a multi-file `<input>` fallback) or a zip of it;
  - cache it in IndexedDB with a content hash, and show the library version and date.
- Add an optional build flag, `INCLUDE_LIBRARY=1`, that copies the library into `dist/` for private deployments (e.g. behind HTTP basic auth). Document it.
- **Workspace** (my playbooks, plays, sets, concepts): stored in IndexedDB with autosave and named snapshots.
  - **Import**: a zip or loose files laid out like the repo (`playbooks/*.json`, `playbooks/plays/*.json`, `playbooks/sets/*.json`, `playbooks/mod.json`, `app-data/*.json`).
  - **Export bundle**: a zip with exactly that layout, in a top-level folder (e.g. `studio-export-2026-10-04/playbooks/...`).
  - The game PC consumes it as-is with `powershell -ExecutionPolicy Bypass -File tools\export.ps1 -Bundle <zip> -Install`. That command already exists: it backs up the current `playbooks/` and `app-data/`, merges the bundle in, builds the mod and saves, and installs the saves.
- Show the import/export state clearly: what changed since the last export, and a warning before discarding unsaved work.

## Deploy
- `npm run deploy` uploads `dist/` over FTP (e.g. the `basic-ftp` package). Credentials come from env vars in a **gitignored** `app/.env.local`: `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`, `FTP_DIR`, `FTP_SECURE`. Never commit credentials, and add `.env.local` to `.gitignore`.
- Support a dry run (`npm run deploy -- --dry-run`) that lists what would be uploaded.
- I'll configure the FTP account later; leave the script ready and documented in `app/README.md`.

## Acceptance
- `npm run build && npx serve app/dist` (or any static server) works with no Node server: load the library from the folder, open `playbooks/studio-test.json` via Import, edit it, and Export a bundle whose files match FORMATS.md. Feeding that bundle to `tools/export.ps1 -Bundle` on the game PC needs no manual steps.
- Dev mode still reads and writes the repo directly.
