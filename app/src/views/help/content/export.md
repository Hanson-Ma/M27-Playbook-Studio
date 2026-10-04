# Export to the game

Playbook Studio only writes files. Turning them into something Madden can load happens on the **Madden PC**, with one
command. The **EXPORT** tab checks everything first, shows what will be built, and gives you the command.

![EXPORT: the status at the top, the three summary cards, and the command to run on the Madden PC.](/guide/export.png)

## 1. Check for problems

The big status at the top tells you where you stand:

| Status | Means |
|:--|:--|
| **READY TO EXPORT** (green) | Nothing blocks the build. Warnings and notes are worth a look but don't stop it. |
| **N PROBLEMS TO FIX** (red) | Something would make the build fail. Fix these first. |
| **BUILD WOULD FAIL** (red) | A playbook can't be built as it is (for example a template section the template doesn't have). |
| **NOTHING TO EXPORT YET** | There are no playbooks, plays or sets yet. |

The bar under it (for example *NOTHING BLOCKS THE EXPORT · 2 WARNINGS · 22 NOTES*) opens the full list with
**SHOW**:

![The checks list: grouped by file; click one to see it and open the right editor.](/guide/export-issues.png)

- **ERRORS** (red) stop the build: an unknown play, too many plays, two audibles on the same button, a custom set
  without 7 on the line…
- **WARNINGS** (amber) build, but might not do what you want in the game: a route that runs out of bounds, a motion
  longer than any in the game, a copied play that depends on a player you moved…
- **NOTES** are just information, such as which plays need the mod.

Click a row to see the details, then the button on the right (for example **OPEN IN PLAY DESIGNER**) to fix it.

## 2. Click EXPORT

**EXPORT** saves every changed file, reads them back from disk and checks them again. When some files aren't saved
yet, it lists them first: click **CANCEL** if one of them holds changes you only made to try something out.

![If everything is saved, Export just re-checks; otherwise it lists the files it will save first.](/guide/export-confirm.png)

When it's done you see what the Madden PC will build:

![The result: the saves it will build, the custom plays in the mod, the stock plays pulled in, and the command.](/guide/export-result.png)

## 3. Get the files to the Madden PC

The command runs in the `2026 Playbook` folder **on the Madden PC**, so that folder needs your latest files:

- **You used the app on the Madden PC** (from your website, with that PC's folder): they're already there.
- **You sync the folder** (git or a sync app): sync it (`git pull` on the PC).
- **Neither**: click **DOWNLOAD ZIP** and unzip it into the `2026 Playbook` folder on the PC. It holds just your
  playbooks, plays, sets and app data.

## 4. Run the command on the Madden PC

1. **Close Madden.**
2. Open the `2026 Playbook` folder in File Explorer, click the address bar, type `powershell` and press Enter.
3. Paste the command (**COPY COMMAND** copies it) and press Enter:

```powershell
powershell -ExecutionPolicy Bypass -File tools\export.ps1 -Install
```

It builds:

- **One mod**, `mods\pbstudio.fbmod`, with all your custom plays, custom formations and sets, copied plays, and the
  stock plays the game normally hides (NEEDS MOD).
- **One save per playbook**, `PBOOKOFF-<NAME>` (for example `PBOOKOFF-STUDIO`). `-Install` copies them into
  `Documents\Madden NFL 27\saves`; the copy that was there before is backed up to `backups\`.

## 5. Apply the mod

1. Open **MMC Mod Manager**.
2. The first time, add `mods\pbstudio.fbmod` from the `2026 Playbook` folder. After that, **refresh** it so the manager
   picks up the new build.
3. Click **Apply**, then **Launch**.

## 6. Pick your playbook in the game

In an **offline** mode, open the playbook choice and pick your custom playbook (STUDIO shows up as STUDIO). The
special-teams and goal-line sections come from the stock playbook, so kicking works as usual.

:::warning Offline only
Modded playbooks follow the MMC rules: offline modes only, never online.
:::

## The summary cards

- **PLAYBOOK SAVES**: one card per playbook with its plays, sets, formations and audibles, what comes from the
  template, and tags for custom plays, custom sets and plays that need the mod. **DETAILS** lists every row the save
  gets.
- **THE MOD**: everything in the one mod: custom plays, custom sets, new formations, copied plays.
- **LIBRARY PLAYS PULLED IN**: stock plays your playbooks use that the game hides from custom playbooks. The mod adds
  them back.

## If something goes wrong

| Problem | What to do |
|:--|:--|
| The command says a play or set can't be found | Re-run the export in the app (it re-checks); fix the errors it lists. Make sure the PC has your latest files. |
| A play is missing in the game | It probably needs the mod: check that `pbstudio.fbmod` is refreshed and applied, then launch through the mod manager. |
| The playbook doesn't show up | Check that the command finished without errors and that `PBOOKOFF-<NAME>` is in `Documents\Madden NFL 27\saves`. Restart Madden. |
| Old version in the game | Close Madden, run the command again, refresh the mod in MMC Mod Manager, Apply. |
| "running scripts is disabled" | Use the full command above; `-ExecutionPolicy Bypass` allows it for this one run. |

More answers in the [FAQ](#/help/faq).
