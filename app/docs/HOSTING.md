# Putting Playbook Studio on your own website (FTP)

You build the app once on the Mac, upload it to your web server with an FTP app, and from then on open it in
Chrome or Edge from any computer, including the PC that runs Madden. This page walks through every step: building,
turning on HTTPS, uploading, server settings, the first visit, the Madden PC, updates, an optional password,
keeping the Mac and PC in sync, and fixing problems.

## How it works (the short version)

- The website is **only the app**: about 1.5 MB of HTML, JavaScript and CSS, plus the user guide (its screenshots and
  the PDF, about 10 MB in `guide/`). There is no server program, no database and no account, and **your playbooks
  and the game data are never uploaded** anywhere.
- When you open the site, it asks you to **open your "2026 Playbook" folder**: the repo folder with `data`,
  `playbooks` and `tools` inside, on the computer you're using. Chrome or Edge then lets that page read and write
  files in that one folder.
- The app reads the game library (`data/library/*.json`) and the template save from that folder, and saves your work
  into `playbooks/` and `app-data/`. These are the same files `npm run dev` writes. Deleted files go to
  `app-data/.trash/`, as before.
- On the Madden PC you export as before, with `tools\export.ps1 -Install`.

```
 your web server (static files)          the computer you're using
 ┌──────────────────────────────┐       ┌──────────────────────────────────────────────┐
 │ public_html/playbook/        │       │ Chrome / Edge ──reads / writes──▶ 2026 Playbook/
 │   index.html, assets/…       │─load─▶│                                    data/library/  (read)
 └──────────────────────────────┘       │                                    playbooks/     (read/write)
      nothing is sent back              │                                    app-data/      (read/write)
                                        └──────────────────────────────────────────────┘
```

### What you need

| | |
|---|---|
| On the Mac | Node 22.18 or newer and this repo (you already build the app here) |
| From your web host | An **FTP or SFTP login** (host name, user name, password, port), shown in your hosting panel under "FTP Accounts" or "SFTP/SSH" |
| On the website | **HTTPS** (a padlock in the address bar). Free with Let's Encrypt, see step 2 |
| An FTP app | [FileZilla](https://filezilla-project.org) (free, Mac and Windows), [Cyberduck](https://cyberduck.io) (free) or Transmit (Mac) |
| To use the app | **Google Chrome or Microsoft Edge** on a Mac or PC, and the 2026 Playbook folder on that computer |

### Browser requirements

- **Chrome or Edge** on macOS or Windows, a current version (122 or newer adds "Allow on every visit"). Only they let a
  web page edit a folder you pick (the File System Access API).
- **Safari, Firefox, iPhone/iPad and Android can't open folders.** The app tells you to switch browsers. (Brave turns
  the feature off; turn on `brave://flags/#file-system-access-api` if you use Brave.)
- The page must be **https://** (or `http://localhost` on your own computer). On a plain `http://` page the folder
  picker doesn't exist; browsers only allow it on secure pages.
- Open the app as its own page, not inside an `<iframe>` on another site.

## 1. Build the site

On the Mac, in Terminal:

```sh
cd "2026 Playbook/app"
npm install            # first time only
npm run build:site     # type-check, build into app/dist/, then check it's ready to upload
```

`npm run build:site` is `npm run build` plus a check: it lists what to upload, makes sure every link in
`index.html` is relative (so the site works in a sub-folder like `/playbook/`), and makes sure no game data or
playbooks ended up in it. It ends with the next steps.

`app/dist/` is the whole website:

```
app/dist/
  index.html
  favicon.svg
  assets/        ← index-XXXXXXXX.js, ui-XXXXXXXX.css … (the file names change with every build)
  (guide/ …)     ← the printable guide, when the build includes it
```

The app uses addresses like `…/playbook/#/designer`. Everything after the `#` stays in the browser, so the server
needs **no rewrite or redirect rules** for the app's pages, and the same files work at the root of a domain or in any
sub-folder.

**Look at it before you upload it (optional):**

```sh
npm run preview:site   # serves app/dist at http://localhost:4178/playbook/, like the /playbook/ folder on your server
```

Open http://localhost:4178/playbook/ in Chrome or Edge. You should see **Open your 2026 Playbook folder**. `localhost`
counts as a secure page, so the folder picker works here and you can try the whole thing. Ctrl+C stops it.

## 2. Turn on HTTPS (once)

The folder picker only works on secure pages, so the site must load over **https://**.

**Check it:** open `https://your-site.com` in Chrome. Left of the address you should see the "site information" icon
(a padlock or a slider icon); click it and it should say **Connection is secure**. If Chrome says **Not secure**, or
the page doesn't load with `https://`, the site has no certificate yet.

**Get a free certificate (Let's Encrypt)** in your host's control panel:

| Panel | Where |
|---|---|
| cPanel | **Security → SSL/TLS Status**: tick your domain, **Run AutoSSL**. (Some hosts call it "Let's Encrypt SSL".) |
| Plesk | **Websites & Domains → SSL/TLS Certificates → Install** a free Let's Encrypt certificate (or the **SSL It!** button) |
| DirectAdmin | **Account Manager → SSL Certificates → Free & automatic certificate from Let's Encrypt** |
| Other hosts | Look for "SSL", "HTTPS" or "Let's Encrypt" in the panel, or ask support to "enable a free Let's Encrypt certificate" |
| Your own server (VPS) | `sudo certbot --apache` or `sudo certbot --nginx` |

It can take a few minutes to an hour to start working. The certificate renews itself.

To make plain `http://` addresses jump to `https://`, use the redirect in the `.htaccess` file (step 4), or the
"Force HTTPS" switch many panels have next to the certificate.

## 3. Upload with FTP

Upload the **contents** of `app/dist/` into a folder on the server. These steps use FileZilla; Cyberduck and
Transmit work the same way (a list of your Mac's files and a list of the server's files, then drag across).

1. **Connect.** FileZilla → **File → Site Manager → New site**:
   - **Protocol:** *SFTP* if your host offers it (port 22), otherwise *FTP* with **Encryption: Require explicit FTP
     over TLS** (port 21). Avoid "plain FTP (insecure)": it sends your password unencrypted.
   - **Host**, **User**, **Password**: from your hosting panel (FTP Accounts).
   - **Connect.** If FileZilla asks to trust the server's certificate or key, check it's your host and accept.
2. **Find the website folder** in the right-hand (server) list. It's usually `public_html`, sometimes `www`,
   `htdocs` or `httpdocs`. Files in it appear at `https://your-site.com/`.
3. **Make a folder for the app**: right-click inside `public_html` → **Create directory** → `playbook`. Double-click
   it to open it. (Any name works; it becomes the address, `https://your-site.com/playbook/`.)
4. **Find `app/dist` on the Mac** in the left-hand (local) list: `…/2026 Playbook/app/dist`. Open it.
5. **Select everything inside `dist`** (click the first item, Shift-click the last), then drag it onto the right-hand
   list. Upload `assets/` first and `index.html` last, so a visitor never gets a new `index.html` that points at files
   that aren't there yet. Drag the items, not the `dist` folder itself.
6. Wait until the queue at the bottom is empty and **Failed transfers** shows 0.

The server should now look like this:

```
public_html/
  playbook/
    index.html
    favicon.svg
    assets/
      index-XXXXXXXX.js
      …
```

If you see `public_html/playbook/dist/index.html`, you uploaded the folder instead of its contents: move the files up
one level (or delete `dist` on the server and upload again).

Files should be readable by the web server: **644** for files and **755** for folders (FileZilla: right-click →
**File permissions…**). FTP apps normally set these on upload.

Then open **`https://your-site.com/playbook/`**, with `https` and the `/` at the end.

## 4. Server settings (usually nothing to do)

Most web hosts serve the app correctly as it is. Add these only if something's wrong (see Troubleshooting) or you want
faster loading.

### Apache (most shared hosting, cPanel, Plesk, DirectAdmin): `.htaccess`

A ready-made file is in the repo: **[`app/docs/htaccess.txt`](htaccess.txt)**. Upload it into the same folder as
`index.html` and rename it on the server to **`.htaccess`** (FileZilla: right-click → **Rename**). It:

1. sends `http://` visitors to `https://`;
2. makes sure `.js` files are sent as JavaScript (`AddType text/javascript .js`). A server that sends `.js` as
   `text/plain` gives you a **blank page**, because browsers won't run modules with the wrong type;
3. sets caching: `assets/*` (file names with a fingerprint) can be cached for a year, and `index.html` is checked on
   every visit so updates show up;
4. turns on compression;
5. has an optional, commented-out password block (step 8).

Every block is wrapped in `<IfModule>`, so missing modules are skipped. If the site shows **500 Internal Server Error**
after uploading it, your host doesn't allow one of these settings: delete the file and the app works as before. Files
whose name starts with a dot are hidden by default. In FileZilla, use **Server → Force showing hidden files**; in
Cyberduck, **View → Show Hidden Files**.

### Nginx (your own server)

Nginx's standard `mime.types` already serves `.js` as JavaScript, as long as `include mime.types;` is in the `http`
block. Optional caching:

```nginx
location /playbook/ {
    location ~* /playbook/assets/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
    add_header Cache-Control "no-cache";
}
```

No `try_files` or rewrites are needed (hash addresses).

## 5. Open it: the first visit on a computer

1. Open `https://your-site.com/playbook/` in **Chrome or Edge**.
2. Click **Open folder…** and pick your **2026 Playbook** folder: the one that contains `data`, `playbooks` and
   `tools`, not a folder inside it. (If you pick the wrong one, the app says so and tells you which to pick.)
3. Chrome asks for access: allow it to **view** the files, then to **edit** them ("Edit files" / "Save changes").
4. The library loads from the folder (a few seconds) and the app opens on PLAYBOOK. Save with ⌘S / Ctrl+S as usual;
   it writes straight into the folder.

**Next visits:** the app remembers the folder. Click **Reconnect to "2026 Playbook"** and allow access. When Chrome
offers **Allow on every visit**, choose it and the app opens straight into your folder from then on.

To switch to another copy of the folder, or forget it, use **Settings (gear) → Files & data → Change folder… / Close
folder**. That page also shows which mode the app is in: **Folder in this browser** (the hosted site) or **Local
server** (`npm run dev`).

## 6. On the Madden PC

1. Use **Chrome or Edge**. Edge is already installed on Windows.
2. Have the repo on the PC, e.g. `C:\Users\<you>\Documents\2026 Playbook`: the same folder that has `tools\` in it
   and that you export from today. See step 9 for keeping it in sync.
3. Open `https://your-site.com/playbook/`, click **Open folder…**, pick that folder, allow access. Edit and save.
4. Close Madden, then from that folder run, as before:
   ```
   powershell -ExecutionPolicy Bypass -File tools\export.ps1 -Install
   ```
   Add or refresh `mods\pbstudio.fbmod` in MMC Mod Manager, **Apply**, and pick your playbook in-game. Nothing about
   the export changes: the browser only edits the JSON files the export reads.

Audible buttons are drawn as **Xbox** buttons by default. Change it under **Settings → Audibles** or next to the
audible diamond in the playbook. The rest of the app is mouse and keyboard.

## 7. Updating the site

When the app changes (a `git pull` with app changes, or your own edits):

1. On the Mac: `cd app` and `npm run build:site`.
2. Upload the contents of `app/dist/` to the same server folder again (`assets/` first, `index.html` last). When
   FileZilla asks about existing files, choose **Overwrite** (tick "Always use this action").
3. Optional: delete the old files in `assets/` on the server that aren't in your new `app/dist/assets/`. They're
   harmless, just unused.
4. Reload the app page. If it still looks old, hard-reload: **⌘⇧R** (Mac) / **Ctrl+Shift+R** (PC). With the
   `.htaccess` from step 4, a normal reload is enough.

Updating the site never touches anyone's files: your playbooks are in your folders, not on the server.

## 8. Optional: password-protect the app

You don't need this for privacy, because your files never go to the server. It only stops other people from loading
the app.

- **cPanel:** **Files → Directory Privacy** (older: "Password Protect Directories"), pick `public_html/playbook`,
  tick **Password protect this directory**, give it a name, save, then **create a user**.
- **Plesk:** **Websites & Domains → Password-Protected Directories → Add Protected Directory** → `/playbook`, then add
  a user.
- **DirectAdmin:** **Advanced Features → Password Protected Directories**.
- **By hand (Apache):** make a password file on the Mac:
  ```sh
  htpasswd -c ~/Desktop/passwd hanson      # asks for a password; htpasswd comes with macOS
  ```
  Upload `passwd` to a folder **outside** `public_html` (e.g. `/home/<account>/.htpasswds/playbook/passwd`), then
  enable block 5 at the end of the `.htaccess` with that path.

The browser asks for the user name and password once per session; the app works as usual after that.

## 9. Keeping the Mac and the PC in sync

The hosted app always works on the folder on *that* computer, so the two copies need syncing, the same as today.

**git (recommended)**
- Before you start on a machine: `git pull`.
- When you're done: save in the app, then `git add playbooks app-data && git commit -m "playbook edits" && git push`.
- If the app is open while you pull, click back into its window. It re-checks the folder, reloads files you haven't
  edited, and marks files you *have* edited as "changed on disk", so nothing is overwritten without you choosing.
- `data/library/*.json` and the template save are in git too, so both machines have the same library. After a game
  patch, regenerate it on the PC (`PlayDump library data/library`), commit and push.
- Keep the git remote **private**: the repo contains game data.

**A synced folder** (iCloud Drive, OneDrive, Dropbox, Syncthing) also works:
- Mark the folder "always keep on this device". The browser can't read online-only placeholder files.
- Don't edit on both machines at the same time. Sync conflicts show up as copies like `studio-test (1).json`.
- Don't use a synced folder and git on the same checkout (the sync can corrupt `.git`). Pick one.

## 10. Security and privacy

- **Nothing leaves your computer.** The site is static files. Your playbooks, the game library and the template save
  are read and written on your disk by your own browser. The only network requests are loading the app itself and
  its fonts (Google Fonts).
- **The site is public but harmless.** Anyone with the address can load the app, but without a 2026 Playbook folder
  of their own it can't do anything, and it never sees yours. Add a password (step 8) if you'd rather it stayed
  private.
- **The browser is the gatekeeper.** The page can only touch the one folder you picked, only after you allowed it, and
  the app only ever writes `playbooks/*.json` (never `mod.json`), `playbooks/plays|sets/*.json` and
  `app-data/*.json`: the same rules as the local server. To revoke access, click the icon left of the address →
  **Site settings** → **Reset permissions**.
- **Only open your folder on a copy you uploaded.** Whoever controls a website controls the code that runs with
  access to your folder.
- **Back up with git.** The app saves straight into your folder; git history (or `app-data/.trash/` for deleted files)
  is how you go back.

## Limitations

- Chrome or Edge on a Mac or PC only; no Safari, Firefox, iPad or phone.
- The browser asks for access again on each visit unless you chose "Allow on every visit".
- The library (about 25 MB of JSON) is read from your disk on every visit: a few seconds, like the local app.
- Renaming or deleting a file is a copy plus a delete (browsers can't rename files in place), so a renamed file gets
  a new modified time.
- Two tabs on the same folder are safe (saves never overwrite a file that changed since it was loaded), but each tab
  has its own unsaved edits. Use one tab.
- Exporting to the game still runs on the PC with PowerShell; a web page can't run the export or touch the game.
- Some system folders (your home folder itself, system or app folders) can't be opened. The repo folder is fine.

## Troubleshooting

To see why a page is blank, open the browser console: **⌥⌘I** (Mac) / **F12** (PC) → **Console**.

| You see | Cause and fix |
|---|---|
| **A blank page** | Usually the file type or the path. In the console: *"Expected a JavaScript module script but the server responded with a MIME type of text/plain"* (or *application/octet-stream*) means the server sends `.js` with the wrong type. Upload the `.htaccess` from step 4 (`AddType text/javascript .js`), or ask your host to serve `.js` as `text/javascript`. *"404 (Not Found)"* for `assets/…` means the files aren't where `index.html` expects them; see the next two rows. |
| 404 for `assets/…`, or the page is unstyled | `assets/` wasn't uploaded, only partly uploaded (check FileZilla's **Failed transfers**), or you uploaded an old `index.html` with a new `assets/`. Upload the whole `dist` contents again. |
| 404 for the page itself | Wrong address or folder: the files must be in `public_html/playbook/` (not `…/playbook/dist/`), and the address is `https://your-site.com/playbook/`. |
| **"Use Chrome or Edge"** | You're in Safari, Firefox, Brave (see Browser requirements) or on a phone. Open the same address in Chrome or Edge. |
| **"Open this page over https"** / no folder picker | The page was opened with `http://`. Use `https://…`, or add the https redirect (step 4). No certificate yet? See step 2. |
| Chrome says **Not secure**, or a certificate warning | The certificate is missing, expired or for another name (e.g. `www.` vs no `www.`). Re-run AutoSSL / Let's Encrypt for both names in the panel. |
| **"Too many redirects"** | The https redirect loops (common behind Cloudflare with "Flexible" SSL). Delete block 1 from `.htaccess`, or set Cloudflare SSL to "Full". |
| **500 Internal Server Error** right after uploading `.htaccess` | Your host doesn't allow one of its settings. Delete `.htaccess` (or remove blocks one at a time). |
| **403 Forbidden** | File permissions: set files to 644 and folders to 755 (FileZilla: right-click → File permissions…). |
| The old version still shows after an update | Hard-reload (⌘⇧R / Ctrl+Shift+R). The `.htaccess` caching block prevents this in future. |
| The password prompt keeps coming back | The `AuthUserFile` path is wrong or the file isn't readable. Use the full path your panel shows, or set up the password in the panel instead. |
| **"… doesn't look like your 2026 Playbook folder"** | Pick the folder that contains `data` and `playbooks` (the message says which one when it can tell). |
| **"… no longer has access to the folder"** | Reload the page and click **Reconnect**. |
| **"… is locked by another program"** | Close the file in the other app (an editor, a sync client) and save again. |
| A file shows **CHANGED ON DISK** | Another program (git, sync, another tab) changed it: choose reload, overwrite, or save a copy. |
| Library won't load / "Library file not found" | `data/library/*.json` is missing in that copy of the folder: `git pull`, or regenerate on the PC with `PlayDump library data/library`. |

## Other ways to host it

If you'd rather not use FTP, any static host works the same way, since you always upload the contents of
`app/dist/`: **Netlify Drop** (https://app.netlify.com/drop, drag the `dist` folder onto the page), **Cloudflare
Pages** (Workers & Pages → Create → Pages → Upload assets), or **Vercel** (`npx vercel deploy app/dist --prod`). All
of them give you HTTPS automatically. Keep this repo private. If you use GitHub Pages, publish `dist` from a separate,
small repo.

## For developers

- `src/storage/storage.ts` picks the backend on boot: `GET /api/status` answering with `app: "playbook-studio"` (or
  the old status shape) → "server"; otherwise "folder". `?storage=folder` / `?storage=server` before the `#` forces one
  (e.g. http://localhost:5178/?storage=folder tries folder mode on the dev server).
- `src/storage/folderBackend.ts` implements the same contract as `server/api.ts` (paths from
  `src/storage/paths.ts`, shared with the server; ConflictError on refused conditional writes; soft delete;
  case-insensitive clash checks).
- `src/storage/StorageGate.tsx` renders the start screen until a backend is ready; `useStorage()` (from
  `src/storage`) gives `{ kind, label, canSwitch, switchFolder(), forgetFolder() }` for Settings → Files & data.
- `scripts/serve-dist.mjs` serves `dist/` statically (`npm run preview:site`, default http://localhost:4178/playbook/)
  and checks it (`--check`, run by `npm run build:site`): relative links, no game data, the upload list.
- Tests: `src/storage/*.test.ts` run the folder backend and the workspace store against an in-memory folder
  (`src/storage/memoryFs.ts`).
