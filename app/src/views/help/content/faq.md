# FAQ & troubleshooting

## Plays and routes

### Can I change who gets the red route (the primary receiver)?
Yes. In the [Designer](#/help/designer), pick a player under **PRIMARY RECEIVER (RED ROUTE)** in the play panel, or
right-click the player → **Make primary receiver (red route)**. For a stock play, make a copy first: **CLONE IN
DESIGNER** in the library. For a play copied into one of your own sets, the **Plays in this set** dialog has the same
menu.

### The red route shows on two receivers in the game
That has happened with plays whose **reads** were rewritten. Open the play in the designer, go to **ADVANCED → READS**
in the play panel and click **USE BASE READS**, set the primary receiver again, save and export. Change the reads only
when you really need to.

### Can I save a route I made and use it again?
Yes: **SAVE ROUTE TO MY ROUTES** in the player's header. It then shows under **MY ROUTES** on the ROUTE tab of every
play, flipped automatically for players on the other side. See [My Routes](#/help/routes).

### How do I clear a route and draw my own?
Select the player and click **CLEAR ROUTE** above the field: the route goes and **DRAW ROUTE** turns on. Click each
corner on the field, then press Esc. See [Routes, cuts & My Routes](#/help/routes).

### Can I see the different cuts?
Yes. The app draws each cut the way it looks: rounded for speed cuts, sharp for hard cuts, a small zig for double
moves, a hook for turn-backs and a bar for settles. See the legend in [Routes, cuts & My Routes](#/help/routes).

### Why can't I drag a player to a new spot in the designer?
Players line up where the **set** puts them. You can move one player for **this play only** (player header → **Move
this player for this play only**). To move him in every play, make your own set in
[Formations](#/help/formations) and build plays on it. Players in a handoff are locked to the base play's spot.

### Why is a player locked (lock icon)?
He takes part in the base play's handoff, fake, option or pitch, which has to match the QB exactly. His first steps
come from the base play. Use **Edit what happens after the handoff** to change the rest, or pick another base play.

### How far can a player go in motion?
Behind the line, no deeper than 11 yards, inside the numbers (18 yards either side of the ball), 1 to 5 points,
about 25 yards in total (35 at most), one motion man per play, never a lineman. The designer keeps the points inside
the shaded area and warns about the rest. See [Design a play](#/help/designer).

### Can I edit a play the game already has?
Not in place. Use it as the base of a new play (**CLONE IN DESIGNER**); the original stays in the game.

### Can I make defensive plays or sets?
The library shows defensive plays and you can build a defense playbook from them. Custom plays and custom sets are
offense only for now.

## Playbooks and the game

### What does NEEDS MOD mean?
The game hides some plays from custom playbooks. The export adds them to the Playbook Studio mod for you, so they
work once the mod is applied. Your own plays and sets always need the mod.

### A play is missing in the game
- Make sure the mod is **refreshed and applied** in MMC Mod Manager after every export, and that you launched through
  it. Custom plays and NEEDS MOD plays only exist with the mod.
- Make sure the play is actually in the playbook (PLAYBOOK tab), and that you saved before exporting.
- Check **EXPORT** for errors, then run the export again.

### My kickoffs, punts or field goals are gone
Keep **Special**, **Kickoff** and **Safety Kickoff** in the playbook (and usually **Goal Line Offense**). They're
there as **TEMPLATE** sections in new playbooks; if you removed one, add the formation again with **+ FORMATION**.

### The plays are in a different order in the game
Madden sorts formations by how often you call them, and in testing the order of plays inside a set didn't always
follow the file. The app keeps your order in the file anyway.

### The audible buttons in the game don't match the app
Change the mapping in **Settings → Audibles → Which button is which slot**. The default layout hasn't been
confirmed in Madden 27 yet. See [Audibles](#/help/audibles).

### My custom set says it needs 7 players on the line
The game-side builder counts a player as on the line only when he's less than 1.5 yards off the ball. Click the fix
chip next to the checks (for example **MOVE TE1, LT, RT ONTO THE LINE**), or start from another set. See
[Formations](#/help/formations).

## Saving and files

### Did my changes save?
Look at the file chip at the top right: **SAVED** means yes; a yellow dot and **SAVE** mean there are unsaved changes.
Press **⌘S / Ctrl+S** (this file) or **⇧⌘S / Ctrl+Shift+S** (all files). **EXPORT** also saves everything.

### "Changed on disk" / a file changed outside the app
Something else changed the file since the app loaded it: git, a sync app, another browser tab or an editor. The app
never overwrites it silently; it asks:

![The changed-on-disk dialog: reload the disk version, overwrite it, or save your version as a copy.](/guide/conflict-dialog.png)

- **RELOAD FROM DISK**: take the version on disk. Your edits stay one ⌘Z away.
- **OVERWRITE**: write your version over it.
- **SAVE A COPY**: save yours as `<name>-copy.json` and reload the original.
- **LATER**: decide later; the file chip shows **CHANGED ON DISK** until you do.

### I deleted something by mistake
Inside a file: **⌘Z / Ctrl+Z**. A deleted file (playbook, plays file, sets file) is moved to `app-data/.trash/` with
the date in its name: move it back to its folder to restore it.

### Where are my files?
| What | Where |
|:--|:--|
| Playbooks | `playbooks/<name>.json` |
| Your plays | `playbooks/plays/<name>.json` |
| Your formations and sets | `playbooks/sets/<name>.json` |
| My Routes, concepts and tags | `app-data/` |
| Deleted files | `app-data/.trash/` |

**Settings → Files & data** shows the folder the app is working on.

![Settings → Files & data: the folder in use, unsaved files, your lists and the play library it found.](/guide/settings-files.png)

## The app and the browser

### The browser can't open my folder
- Use **Chrome** or **Edge** on a Mac or PC. Safari, Firefox, iPad and phones can't open folders.
- The address must start with **https://** (or be `localhost`).
- Pick the **2026 Playbook** folder itself, not `playbooks` or `data` inside it.
- Next visit, click **Reconnect** and allow access again (or choose **Allow on every visit**).

See [Use it on your website](#/help/hosting).

### The library won't load
The app reads the game's play library from `data/library/` in your 2026 Playbook folder. Make sure those files are
there (sync the folder, or regenerate them on the Madden PC after a game patch with `PlayDump library data/library`),
then reload. **Settings → Files & data → PLAY LIBRARY** shows what it found.

### Where's the PDF version of this guide?
Click **Open the PDF guide** at the bottom of the guide's section list. It has the same content, ready to print.
