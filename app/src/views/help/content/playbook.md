# Build a playbook

A playbook is a list of **formations**, each formation holds **sets**, and each set holds **plays**, just like the
FORMATION screen in Madden. One playbook file becomes one custom playbook in the game: `studio-test.json` with the
name STUDIO becomes the save `PBOOKOFF-STUDIO`, and you pick it in the game as STUDIO.

The PLAYBOOK tab works in three steps, left to right: **1 Pick a set**, **2 Add & order plays**, **3 Audibles &
CPU**.

![STUDIO with the Y Trips Wk set open: the tree (1), the set's plays (2), and its audibles (3).](/guide/playbook-set.png)

## Open, create and rename playbooks

The playbook menu at the top left (it shows the playbook's name, for example **STUDIO**) lists every playbook in your
folder.

![The playbook menu: open a playbook, start a new one, duplicate, rename or delete.](/guide/playbook-picker.png)

- **Click a playbook** to open it. STUDIO (`playbooks/studio-test.json`) opens the first time; after that the app
  reopens the one you used last.
- **New playbook…** starts an empty offense playbook with goal line and special teams already in it. Give it a name
  (letters A–Z and digits only; it becomes the in-game name).
- **New from stock template…** starts with every formation, set, play, audible and CPU weight of the game's stock
  playbook, ready to trim down.
- **Duplicate this playbook…** makes a copy to experiment with.
- **Rename this playbook…** changes the in-game name and the file name together.
- **Delete this playbook…** moves the file to `app-data/.trash/`; nothing is lost for good.

Next to the menu you see the save name the game will use (`PBOOKOFF-STUDIO`) and the file (`studio-test.json`).

## Step 1: pick a set

The tree on the left shows the playbook: formations (SHOTGUN, GUN PBS…), and under each one its sets. The dots next to
a set show how many audibles it has; the number is its play count.

1. Click a formation's arrow to open it, then **click a set** to work on it.
2. To add a formation, click **+ FORMATION** at the bottom of the tree and pick one from the list.
3. To add a set, click **+ SET** under the formation and pick a set. Type to search the list.

![+ SET lists the formation's sets with their play counts; type to filter.](/guide/playbook-add-set.png)

Drag formations and sets up and down the tree to reorder them. Your own sets (made in
[Formations](#/help/formations)) show a **CUSTOM** tag and appear in the **+ SET** list like any other set.

## Step 2: add and order plays

With a set selected, the middle column shows two lists:

- **IN THIS PLAYBOOK**: the set's plays as cards, in your order.
- **ALL PLAYS IN THIS SET**: every play the game (and you) have for this set, with a tick box each.

To add plays:

1. **Tick a play** in ALL PLAYS IN THIS SET. It's added at the end. Untick it to take it out again. Use the colored
   chips (PASS, RUN, PLAY ACTION, SCREEN…) and the filter box to narrow the list, or **Only show added plays**.
2. Or click **+ ADD PLAYS** to search beyond this set (next section).
3. Or, in the [Library](#/help/library), click **Add to playbook…** on any play.

To change the order, **drag the cards**. To remove a play, right-click its card and choose **Remove from playbook**,
or select it and press **Delete**.

### Add plays from anywhere

**+ ADD PLAYS** opens a search drawer over the set.

![Add plays: search one set, every set of your formations, or the whole library.](/guide/playbook-add-plays.png)

1. Choose where to search: **One set**, **My formations** (every set of the formations in this playbook) or **Whole
   library**.
2. Type part of a play name, for example "mesh".
3. Click cards to select them, then click **Add N plays** at the bottom. Or drag one card straight onto a set in the
   tree.

Plays from a formation or set that isn't in the playbook yet bring their formation and set with them. **Hide plays
already added** keeps the list short.

### Right-click menu

Right-click any card or tree row (or click its **⋯** button) for everything you can do with it:

![The play menu: copy, paste, duplicate, move, remove, audible, CPU weights, open in the library or the designer.](/guide/playbook-play-menu.png)

- **Copy**, **Paste**, **Duplicate** (also ⌘C, ⌘V, ⌘D). Copied plays, sets and formations wait in the
  **CLIPBOARD** panel at the bottom of the tree, so you can paste them into another set or another playbook.
- **Move up**, **Move down**, **Remove from playbook**.
- **Audible**: give the play an audible button (see [Audibles & CPU calls](#/help/audibles)).
- **Copy CPU weights**, **Paste CPU weights**, **Clear CPU weights**.
- **Open in library** shows the play's details; **Edit in designer** opens one of your own plays (it's only in the
  menu of plays you made; a play copied into one of your own sets offers **Edit its custom set** instead).

Select several plays with **⌘-click** (Ctrl-click on a PC) or a range with **Shift-click**, then use the menu or the
toolbar above the tree on all of them at once.

## Special teams and goal line (template sections)

The last rows of the tree (GOAL LINE OFFENSE, SPECIAL, KICKOFF, SAFETY KICKOFF) have a **TEMPLATE** tag and a lock.
They are copied exactly as they are from the game's stock playbook when you export, so your playbook always has
kickoffs, punts, field goals and goal-line plays.

![A template section (SPECIAL): its sets and plays come from the stock playbook.](/guide/playbook-template-section.png)

- Click a template row to see what's in it.
- To change what's in it, click **Convert to editable sets** (the unlock button on the row). It becomes a normal
  formation you can edit.

:::warning Keep special teams
Keep **Special**, **Kickoff** and **Safety Kickoff** in every offense playbook (as template sections or converted).
Without them the game has no kicking plays to call.
:::

## Limits and checks

The bar under the playbook name counts what the game allows in one playbook:

![The playbook header: play, set, formation and CPU-row counts against the game's limits, plus the checks.](/guide/playbook-header.png)

| Meter | Limit |
|:--|--:|
| PLAYS | 750 |
| SETS | 75 |
| FORMATIONS | 40 |
| CPU ROWS (CPU weights) | 2,200 |

The counts include the template sections. On the right:

- **NEED THE MOD** counts your own plays and the stock plays the game hides from custom playbooks. Both work once the
  Playbook Studio mod is applied; see [NEEDS MOD](#/help/library).
- **READY TO EXPORT** (or the number of problems) opens the list of checks. Click a problem to jump to it.

![The checks list for STUDIO: two notes, nothing blocking.](/guide/playbook-notes.png)

:::note The order in the game
Madden sorts formations by how often you call them, and in testing the order of plays inside a set didn't always
follow the file. Your order is still saved; it's what the preview and the file show.
:::

## Preview it like the game, and plan your gameplan

- **PREVIEW IN GAME** shows the playbook the way Madden's play-call screen does. See
  [Preview in game](#/help/preview).
- **GAMEPLAN** opens your concepts and tags: what you have for each situation, run and pass concepts by formation.
  See [Gameplan](#/help/concepts). The LIBRARY has the same **GAMEPLAN** button.

## Notes and side

Click the playbook's name at the top of the tree (STUDIO) to see its overview: formations, sets and play counts, a
**NOTES** box for yourself, and under **ADVANCED** whether it's an offense or defense playbook.
