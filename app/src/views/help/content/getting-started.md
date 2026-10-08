# Getting Started

Playbook Studio is where you build your Madden NFL 27 playbooks. Pick plays from the game's library, put them in
the order you like, set your audibles, design your own plays and routes, and even make your own formations. When
you're done, one command on the Madden PC turns everything into a custom playbook you can pick in the game.

You don't need to know anything about Frosty, mods or file formats. The app writes a few small files into your
**2026 Playbook** folder, and the export tools on the Madden PC do the rest.

![The Playbook tab with the STUDIO playbook open: pick a set on the left, its plays in the middle, audibles and CPU calls on the right.](/guide/playbook-home.png)

## How It All Fits Together

Every change you make goes around the same loop:

1. **Edit in Playbook Studio.** Build playbooks, design plays, make sets. Save with **⌘S** (Mac) or **Ctrl+S** (PC).
2. **Your work is saved as files** in the `2026 Playbook` folder: playbooks in `playbooks/`, your own plays in
   `playbooks/plays/`, your own sets in `playbooks/sets/`.
3. **Run the export on the Madden PC.** Close Madden, open PowerShell in the `2026 Playbook` folder and run
   `tools\export.ps1 -Install`. It builds one mod and one playbook save per playbook.
4. **Apply the mod in MMC Mod Manager.** Add (or refresh) `mods\pbstudio.fbmod`, click **Apply**, then **Launch**.
5. **Pick your playbook in the game.** In an offline mode, choose your custom playbook (for example FUSION).

The [Export](#/help/export) section walks through steps 3 to 5 with screenshots.

:::tip The Short Version
Work through the tabs at the top from left to right: **Playbook → Library → Designer → Formations → Export**. Most
people only ever need the first two and the last one.
:::

## The Five Tabs

| Tab | What You Do There |
|:--|:--|
| **Playbook** | Open a playbook (FUSION opens by default), arrange formations, sets and plays, set the four audibles of each set and tell the CPU when to call each play. |
| **Library** | Browse and search every play in the game (about 11,000) plus your own plays, then add them to a playbook. |
| **Designer** | Make your own play from a play in the game: change routes, cuts, blocks, motion and the primary receiver (the red route). |
| **Formations** | Make your own set: move players, adjust the pre-snap motions, copy plays into it. |
| **Export** | Check everything, see what the game PC will build, and get the command to run. |

At the top right you'll also find:

- the **file chip**: the file you're working on, with **Saved**, or a **Save** button and a yellow dot when there
  are unsaved changes;
- **Undo** and **Redo** (the curved arrows);
- **?** opens this guide at the section for the screen you're on;
- the **gear** opens Settings (audible buttons, field options, where your files are).

## Your First Playbook in Ten Minutes

1. Click **Playbook**. The FUSION playbook (`playbooks/FUSION.json`) opens. To practise on a fresh one instead,
   open the playbook menu at the top left (it shows **FUSION**) and choose **New Playbook…**.
2. In step 1 on the left, click a set, for example **Y TRIPS WK** under SHOTGUN. In a new playbook, first click
   **+ Formation** (type "shotgun", press Enter), then **+ Set** under it (type "y trips wk", press Enter).
3. In step 2 in the middle, tick a few plays in **All Plays in This Set**. They appear as cards in **In This
   Playbook**. Drag the cards to put them in order.
4. In step 3 on the right, click a play card, then click one of the four buttons in the audible diamond to make it
   an audible.
5. Press **⌘S / Ctrl+S** to save (or click **Save** at the top right).
6. Click the **Export** tab. If it says **Ready to Export**, click the **Export** button, then run the command it
   shows on the Madden PC.

Want a play that isn't in this set? Click **+ Add Plays** and search the whole library, or find it in the
[Library](#/help/library) and use **Add to Playbook**.

## Saving and Undo

- **⌘S / Ctrl+S** saves the file you're working on. **⇧⌘S / Ctrl+Shift+S** saves every changed file.
- A yellow dot and a **Save** button in the file chip mean there are unsaved changes. **Saved** means the file on
  disk is up to date.
- **⌘Z / Ctrl+Z** undoes, **⇧⌘Z / Ctrl+Y** redoes. Every file keeps its own history (up to 200 steps), so undo
  works even after you've switched tabs.
- If you try to close the page with unsaved changes, the browser asks first.
- **Export** saves everything for you before it checks.

:::note Changed on Disk
If a file changes outside the app while it's open (git, a sync app, another browser tab), the app never overwrites
it silently. You choose: reload the disk version, overwrite it, or save your version as a copy. See the
[FAQ](#/help/faq).
:::

## Where Your Files Live

Everything is in your `2026 Playbook` folder. Nothing is uploaded anywhere.

| What | File |
|:--|:--|
| Playbooks | `playbooks/<name>.json`, one per playbook (becomes the save `PBOOKOFF-<NAME>`) |
| Your own plays | `playbooks/plays/<name>.json` (built into the mod) |
| Your own formations and sets | `playbooks/sets/<name>.json` (built into the same mod) |
| My Routes, concepts and tags | `app-data/routes.json`, `app-data/concepts.json` (only the app uses these) |
| Deleted files | `app-data/.trash/` (move a file back to restore it) |
| The game's play library | `data/library/` (read only) |

## Mouse First, a Few Keys

Everything is a button, a menu or a right-click menu. The keyboard only has the usual shortcuts:

| Keys | Does |
|:--|:--|
| ⌘S / Ctrl+S | Save this file |
| ⇧⌘S / Ctrl+Shift+S | Save all files |
| ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y | Undo, redo |
| ⌘C, ⌘V, ⌘D (Ctrl on a PC) | Copy, paste, duplicate in the playbook tree and card grid |
| Delete / Backspace | Remove the selected play, or the selected route point in the designer |
| Esc | Close a dialog or menu, clear a selection |
| Enter | Confirm a dialog |

:::note Controller Buttons
You use the app with a mouse and keyboard. Controller buttons only show up for audibles, drawn as Xbox, PS5 or
keyboard buttons. See [Audibles & CPU Calls](#/help/audibles).
:::

## Getting Help

The **?** at the top right opens this guide at the section for the screen you're on. Use the search box above the
section list to find a word anywhere in the guide, and **Open the PDF Guide** at the bottom for the printable version.

![The guide inside the app: sections on the left, the page in the middle, its topics on the right.](/guide/help-view.png)

## Two Ways to Open the App

- **On your own computer:** run `npm run dev` in the `app` folder and open `http://localhost:5178`.
- **From your website:** upload the app once and open it in Chrome or Edge from any computer, including the Madden
  PC. It asks you to open your `2026 Playbook` folder. See [Use It on Your Website](#/help/hosting).

Both work on the same files in the same way.
