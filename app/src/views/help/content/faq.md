# FAQ & Troubleshooting

## Plays and Routes

### Can I Change Who Gets the Red Route (the Primary Receiver)?
Yes. In the [Designer](#/help/designer), pick a player under **Primary Receiver (Red Route)** in the play panel, or
right-click the player → **Make Primary Receiver (Red Route)**. For a stock play, make a copy first: **Clone in
Designer** in the library. For a play copied into one of your own sets, the **Plays in This Set** dialog has the same
menu.

### The Red Route Shows on Two Receivers in the Game
That has happened with plays whose **reads** were rewritten. Open the play in the designer, go to **Advanced → Reads**
in the play panel and click **Use Base Reads**, set the primary receiver again, save and export. Change the reads only
when you really need to.

### Can I Save a Route I Made and Use It Again?
Yes: **Save Route to My Routes** in the player's header. It then shows under **My Routes** on the **Route** tab of every
play, flipped automatically for players on the other side. See [My Routes](#/help/routes).

### How Do I Clear a Route and Draw My Own?
Select the player and click **Clear Route** above the field: the route goes and **Draw Route** turns on. Click each
corner on the field, then press Esc. See [Routes, Cuts & My Routes](#/help/routes).

### Can I See the Different Cuts?
Yes. The app draws each cut the way it looks: rounded for speed cuts, sharp for hard cuts, a small zig for double
moves, a hook for turn-backs and a bar for settles. See the legend in [Routes, Cuts & My Routes](#/help/routes).

### Why Can't I Drag a Player to a New Spot in the Designer?
Players line up where the **set** puts them. You can move one player for **this play only** (player header → **Move
This Player for This Play Only**). To move him in every play, make your own set in
[Formations](#/help/formations) and build plays on it. Players in a handoff are locked to the base play's spot.

### Why Is a Player Locked (Lock Icon)?
He takes part in the base play's handoff, fake, option or pitch, which has to match the QB exactly. His first steps
come from the base play. Use **Edit What Happens After the Handoff** to change the rest, or pick another base play.

### How Far Can a Player Go in Motion?
Behind the line, no deeper than 11 yards, inside the numbers (18 yards either side of the ball), 1 to 5 points,
about 25 yards in total (35 at most), one motion man per play, never a lineman. The designer keeps the points inside
the shaded area and warns about the rest. See [Design a Play](#/help/designer).

### Can I Edit a Play the Game Already Has?
Not in place. Use it as the base of a new play (**Clone in Designer**); the original stays in the game.

### Can I Make Defensive Plays or Sets?
The library shows defensive plays and you can build a defense playbook from them. Custom plays and custom sets are
offense only for now.

## Playbooks and the Game

### What Does Needs Mod Mean?
The game hides some plays from custom playbooks. The export adds them to the Playbook Studio mod for you, so they
work once the mod is applied. Your own plays and sets always need the mod.

### A Play Is Missing in the Game
- Make sure the mod is **refreshed and applied** in MMC Mod Manager after every export, and that you launched through
  it. Custom plays and **Needs Mod** plays only exist with the mod.
- Make sure the play is actually in the playbook (**Playbook** tab), and that you saved before exporting.
- Check **Export** for errors, then run the export again.

### My Kickoffs, Punts or Field Goals Are Gone
Keep **SPECIAL**, **KICKOFF** and **SAFETY KICKOFF** in the playbook (and usually **GOAL LINE OFFENSE**). They're
there as **Template** sections in new playbooks; if you removed one, add the formation again with **+ Formation**.

### The Plays Are in a Different Order in the Game
Madden sorts formations by how often you call them, and in testing the order of plays inside a set didn't always
follow the file. The app keeps your order in the file anyway.

### The Audible Buttons in the Game Don't Match the App
Change the mapping in **Settings → Audibles → Which Button Is Which Slot**. The default layout hasn't been
confirmed in Madden 27 yet. See [Audibles](#/help/audibles).

### My Custom Set Says It Needs 7 Players on the Line
The game-side builder counts a player as on the line only when he's less than 1.5 yards off the ball. Click the fix
chip next to the checks (for example **Move TE1, LT, RT Onto the Line**), or start from another set. See
[Formations](#/help/formations).

## Saving and Files

### Did My Changes Save?
Look at the file chip at the top right: **Saved** means yes; a yellow dot and **Save** mean there are unsaved changes.
Press **⌘S / Ctrl+S** (this file) or **⇧⌘S / Ctrl+Shift+S** (all files). **Export** also saves everything.

### "Changed on Disk" / a File Changed Outside the App
Something else changed the file since the app loaded it: git, a sync app, another browser tab or an editor. The app
never overwrites it silently; it asks:

![The changed-on-disk dialog: reload the disk version, overwrite it, or save your version as a copy.](/guide/conflict-dialog.png)

- **Reload From Disk**: take the version on disk. Your edits stay one ⌘Z away.
- **Overwrite**: write your version over it.
- **Save a Copy**: save yours as `<name>-copy.json` and reload the original.
- **Later**: decide later; the file chip shows **Changed on Disk** until you do.

### I Deleted Something by Mistake
Inside a file: **⌘Z / Ctrl+Z**. A deleted file (playbook, plays file, sets file) is moved to `app-data/.trash/` with
the date in its name: move it back to its folder to restore it.

### Where Are My Files?
| What | Where |
|:--|:--|
| Playbooks | `playbooks/<name>.json` |
| Your plays | `playbooks/plays/<name>.json` |
| Your formations and sets | `playbooks/sets/<name>.json` |
| My Routes, concepts and tags | `app-data/` |
| Deleted files | `app-data/.trash/` |

**Settings → Files & Data** shows the folder the app is working on.

![Settings → Files & Data: the folder in use, unsaved files, your lists and the play library it found.](/guide/settings-files.png)

## The App and the Browser

### The Browser Can't Open My Folder
- Use **Chrome** or **Edge** on a Mac or PC. Safari, Firefox, iPad and phones can't open folders.
- The address must start with **https://** (or be `localhost`).
- Pick the **2026 Playbook** folder itself, not `playbooks` or `data` inside it.
- Next visit, click **Reconnect** and allow access again (or choose **Allow on every visit**).

See [Use It on Your Website](#/help/hosting).

### The Library Won't Load
The app reads the game's play library from `data/library/` in your 2026 Playbook folder. Make sure those files are
there (sync the folder, or regenerate them on the Madden PC after a game patch with `PlayDump library data/library`),
then reload. **Settings → Files & Data → Play Library** shows what it found.

### Where's the PDF Version of This Guide?
Click **Open the PDF Guide** at the bottom of the guide's section list. It has the same content, ready to print.
