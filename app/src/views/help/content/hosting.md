# Use It on Your Website

You can put Playbook Studio on your own website and open it in Chrome or Edge from any computer, including the PC
that runs Madden. The website only holds the app itself. Your playbooks and the game data stay in your
`2026 Playbook` folder on the computer you're using: the app asks you to open that folder and works on it directly.

| | On This Computer | From Your Website |
|:--|:--|:--|
| Start it | `npm run dev` in the `app` folder | Open `https://your-site.com/playbook/` |
| Needs | Node, a terminal | Chrome or Edge, and the folder on that computer |
| Files | The folder the server runs in | The folder you open in the browser |

Both write the same files, so you can switch freely. The full walkthrough, with every host's screens, is in
`app/docs/HOSTING.md` in the repo.

## 1. Build the Site (on the Mac)

In Terminal:

```sh
cd "2026 Playbook/app"
npm install            # first time only
npm run build:site     # builds the website into app/dist/ and checks it's ready to upload
```

`app/dist/` is the whole website: `index.html`, `favicon.svg`, an `assets/` folder and this guide. No game data or
playbooks are in it. To look at it before uploading, run `npm run preview:site` and open
`http://localhost:4178/playbook/`.

## 2. Turn On HTTPS (Once)

The app can only open your folder on a secure page: the address must start with **https://**. In your hosting
control panel, turn on a free Let's Encrypt certificate (cPanel: **Security → SSL/TLS Status → Run AutoSSL**; other
panels have an "SSL" or "Let's Encrypt" page). Check it: open your site in Chrome and click the icon left of the
address; it should say **Connection is secure**.

## 3. Upload With FTP

1. Open an FTP app (FileZilla, Cyberduck or Transmit) and connect with the FTP or SFTP login from your hosting panel.
   Use **SFTP**, or FTP with **explicit TLS**; avoid plain FTP.
2. On the server, open the website folder (usually `public_html`) and create a folder for the app, for example
   `playbook`.
3. On the Mac side, open `2026 Playbook/app/dist`.
4. Select **everything inside** `dist` and drag it into `playbook`. Upload `assets/` first and `index.html` last.
5. Open `https://your-site.com/playbook/`.

The server should end up with `public_html/playbook/index.html` and `public_html/playbook/assets/…`. If you see
`playbook/dist/index.html`, you uploaded the folder instead of its contents.

## 4. Open Your Folder

![The start screen of the hosted app.](/guide/hosting-open-folder.png)

1. Open the site in **Chrome** or **Edge**.
2. Click **Open Folder…** and pick your **2026 Playbook** folder: the one with `data`, `playbooks` and `tools` inside,
   not a folder inside it. (If you pick the wrong one, the app tells you which one to pick.)
3. Allow the browser to **view** the files, then to **edit** them.
4. The library loads from the folder (a few seconds) and the app opens on **Playbook**. Save as usual; it writes
   straight into the folder.

**Next time**, click **Reconnect to "2026 Playbook"** and allow access. If Chrome offers **Allow on every visit**,
choose it and the app opens straight into your folder from then on.

To use another copy of the folder, go to **Settings → Files & Data** and click **Change Folder…**; **Close Folder**
goes back to the start screen. That page also shows which way the app is running: **Folder in This Browser** (your
website) or **Local Server** (`npm run dev`).

## 5. On the Madden PC

1. Use **Edge** (already on Windows) or Chrome.
2. Keep the `2026 Playbook` folder on the PC, the same one you export from (for example
   `C:\Users\<you>\Documents\2026 Playbook`).
3. Open your site, **Open Folder…**, pick that folder, and edit and save as usual.
4. Close Madden, and run the export from that folder as always (see [Export](#/help/export)).

Audibles are drawn as **Xbox** buttons by default; change it in **Settings → Audibles**.

## Keep the Mac and the PC in Sync

The website always works on the folder of the computer you're on, so keep the two folders in sync:

- **git** (recommended): `git pull` before you start, and when you're done, save in the app, then
  `git add playbooks app-data && git commit -m "playbook edits" && git push`. Keep the repository private: it contains
  game data.
- **A sync app** (OneDrive, Dropbox, iCloud Drive): mark the folder "always keep on this device", and don't edit on
  both computers at the same time.

If files change while the app is open, click back into its window: files you haven't edited reload, and files you
have edited are marked **Changed on Disk** so nothing is overwritten without asking.

## Update the Site

When the app changes: run `npm run build:site` again, upload the contents of `app/dist/` to the same folder (choose
**Overwrite**), and reload the page (⌘⇧R / Ctrl+Shift+R if it still looks old). Updating the site never touches your
playbooks; they're in your folders, not on the server.

## Is It Private?

- **Nothing from the game or your playbooks is uploaded.** The site is plain files; your browser reads and writes your
  folder on your own disk.
- The page can only touch the one folder you picked, and only after you allowed it.
- Anyone with the address can load the app, but without their own 2026 Playbook folder it does nothing. To keep
  others out entirely, password-protect the folder in your hosting panel (cPanel: **Directory Privacy**).

## Troubleshooting

| You See | Do This |
|:--|:--|
| "Use Chrome or Edge" | Safari, Firefox and phones can't open folders. Use Chrome or Edge on a Mac or PC. |
| "Open this page over https" | Use the `https://` address. No certificate yet? See step 2. |
| A blank page | The server sends `.js` files with the wrong type, or `assets/` is missing. Upload the `.htaccess` file from `app/docs/htaccess.txt` (rename it to `.htaccess`), and upload all of `dist` again. |
| "… doesn't look like your 2026 Playbook folder" | Pick the folder that contains `data` and `playbooks`. |
| "… no longer has access to the folder" | Reload the page and click **Reconnect**. |
| The old version still shows | Hard-reload: ⌘⇧R (Mac) or Ctrl+Shift+R (PC). |
| Library won't load | The folder on this computer is missing `data/library/`. Sync it (git pull), or regenerate it on the PC. |
