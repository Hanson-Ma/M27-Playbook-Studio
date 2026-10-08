# Build a Playbook

A playbook is a list of **formations**, each formation holds **sets**, and each set holds **plays**, just like the
formation screen in Madden. One playbook file becomes one custom playbook in the game: `FUSION.json` with the
name FUSION becomes the save `PBOOKOFF-FUSION`, and you pick it in the game as FUSION.

The **Playbook** tab works in three steps, left to right: **1 Pick a Set**, **2 Add & Order Plays**, **3 Audibles &
CPU**.

![STUDIO with the Y TRIPS WK set open: the tree (1), the set's plays (2), and its audibles (3).](/guide/playbook-set.png)

## Open, Create and Rename Playbooks

The playbook menu at the top left (it shows the playbook's name, for example **FUSION**) lists every playbook in your
folder.

![The playbook menu: open a playbook, start a new one, duplicate, rename or delete.](/guide/playbook-picker.png)

- **Click a playbook** to open it. FUSION (`playbooks/FUSION.json`) opens the first time; after that the app
  reopens the one you used last.
- **New Playbook…** starts an empty offense playbook with goal line and special teams already in it. Give it a name
  (letters A–Z and digits only; it becomes the in-game name).
- **New From Stock Template…** starts with every formation, set, play, audible and CPU weight of the game's stock
  playbook, ready to trim down.
- **Duplicate This Playbook…** makes a copy to experiment with.
- **Rename This Playbook…** changes the in-game name and the file name together.
- **Delete This Playbook…** moves the file to `app-data/.trash/`; nothing is lost for good.

Next to the menu you see the save name the game will use (`PBOOKOFF-FUSION`) and the file (`FUSION.json`).

## Step 1: Pick a Set

The tree on the left shows the playbook: formations (SHOTGUN, GUN PBS…), and under each one its sets. The dots next to
a set show how many audibles it has; the number is its play count.

1. Click a formation's arrow to open it, then **click a set** to work on it.
2. To add a formation, click **+ Formation** at the bottom of the tree and pick one from the list.
3. To add a set, click **+ Set** under the formation and pick a set. Type to search the list.

![+ Set lists the formation's sets with their play counts; type to filter.](/guide/playbook-add-set.png)

Drag formations and sets up and down the tree to reorder them. Your own sets (made in
[Formations](#/help/formations)) show a **Custom** tag and appear in the **+ Set** list like any other set.

## Step 2: Add and Order Plays

With a set selected, the middle column shows two lists:

- **In This Playbook**: the set's plays as cards, in your order.
- **All Plays in This Set**: every play the game (and you) have for this set, with a tick box each.

To add plays:

1. **Tick a play** in **All Plays in This Set**. It's added at the end. Untick it to take it out again. Use the colored
   chips (PASS, RUN, PLAY ACTION, SCREEN…) and the filter box to narrow the list, or **Only Show Added Plays**.
2. Or click **+ Add Plays** to search beyond this set (next section).
3. Or, in the [Library](#/help/library), click **Add to Playbook…** on any play.

To change the order, **drag the cards**. To remove a play, right-click its card and choose **Remove From Playbook**,
or select it and press **Delete**.

### Add Plays From Anywhere

**+ Add Plays** opens a search drawer over the set.

![Add Plays: search one set, every set of your formations, or the whole library.](/guide/playbook-add-plays.png)

1. Choose where to search: **One Set**, **My Formations** (every set of the formations in this playbook) or **Whole
   Library**.
2. Type part of a play name, for example "mesh".
3. Click cards to select them, then click **Add N Plays** at the bottom. Or drag one card straight onto a set in the
   tree.

Plays from a formation or set that isn't in the playbook yet bring their formation and set with them. **Hide Plays
Already Added** keeps the list short.

### Right-Click Menu

Right-click any card or tree row (or click its **⋯** button) for everything you can do with it:

![The play menu: copy, paste, duplicate, move, remove, audible, CPU weights, open in the library or the designer.](/guide/playbook-play-menu.png)

- **Copy**, **Paste**, **Duplicate** (also ⌘C, ⌘V, ⌘D). Copied plays, sets and formations wait in the
  **Clipboard** panel at the bottom of the tree, so you can paste them into another set or another playbook.
- **Move Up**, **Move Down**, **Remove From Playbook**.
- **Audible**: give the play an audible button (see [Audibles & CPU Calls](#/help/audibles)).
- **Copy CPU Weights**, **Paste CPU Weights**, **Clear CPU Weights**.
- **Open in Library** shows the play's details; **Edit in Designer** opens one of your own plays (it's only in the
  menu of plays you made; a play copied into one of your own sets offers **Edit Its Custom Set** instead).

Select several plays with **⌘-click** (Ctrl-click on a PC) or a range with **Shift-click**, then use the menu or the
toolbar above the tree on all of them at once.

## Special Teams and Goal Line (Template Sections)

The last rows of the tree (GOAL LINE OFFENSE, SPECIAL, KICKOFF, SAFETY KICKOFF) have a **Template** tag and a lock.
They are copied exactly as they are from the game's stock playbook when you export, so your playbook always has
kickoffs, punts, field goals and goal-line plays.

![A template section (SPECIAL): its sets and plays come from the stock playbook.](/guide/playbook-template-section.png)

- Click a template row to see what's in it.
- To change what's in it, click **Convert to Editable Sets** (the unlock button on the row). It becomes a normal
  formation you can edit.

:::warning Keep Special Teams
Keep **SPECIAL**, **KICKOFF** and **SAFETY KICKOFF** in every offense playbook (as template sections or converted).
Without them the game has no kicking plays to call.
:::

## Limits and Checks

The bar under the playbook name counts what the game allows in one playbook:

![The playbook header: play, set, formation and CPU-row counts against the game's limits, plus the checks.](/guide/playbook-header.png)

| Meter | Limit |
|:--|--:|
| Plays | 750 |
| Sets | 75 |
| Formations | 40 |
| CPU Rows (CPU weights) | 2,200 |

The counts include the template sections. On the right:

- **Plays Need the Mod** counts your own plays and the stock plays the game hides from custom playbooks. Both work once the
  Playbook Studio mod is applied; see [Needs Mod](#/help/library).
- **Ready to Export** (or the number of problems) opens the list of checks. Click a problem to jump to it.

![The checks list for STUDIO: two notes, nothing blocking.](/guide/playbook-notes.png)

:::note The Order in the Game
Madden sorts formations by how often you call them, and in testing the order of plays inside a set didn't always
follow the file. Your order is still saved; it's what the preview and the file show.
:::

## Preview It Like the Game, and Plan Your Gameplan

- **Preview in Game** shows the playbook the way Madden's play-call screen does. See
  [Preview in Game](#/help/preview).
- **Gameplan** opens your concepts and tags: what you have for each situation, run and pass concepts by formation.
  See [Gameplan](#/help/concepts). The **Library** has the same **Gameplan** button.

## Notes and Side

Click the playbook's name at the top of the tree (FUSION) to see its overview: formations, sets and play counts, a
**Notes** box for yourself, and under **Advanced** whether it's an offense or defense playbook.
