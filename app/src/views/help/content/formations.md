# Formations & custom sets

In Madden a **formation** (Shotgun, Pistol, Singleback…) holds **sets** (Y Trips Wk, Bunch…), and the set decides
where all eleven players line up. The **FORMATIONS** tab makes your own sets: start from a set the game has, move
players, adjust its pre-snap motions, and copy plays into it. Your sets are built into the same mod as your plays and
you add them to a playbook like any other set.

:::warning New: check your first custom set in the game
Custom sets are the newest part of Playbook Studio. The first ones were built on 2026-10-04 and haven't been
confirmed in the game yet. Build one small set first, export, and check it in Madden before you build a whole
playbook on custom sets.
:::

![FORMATIONS: your custom sets, each with its changes, its plays and a READY or warning badge.](/guide/formations-entry.png)

## Make a custom set

1. Click **FORMATIONS**, then **+ NEW SET**.
2. **Pick a set to start from**: choose a formation on the left, then click a set (double-click jumps to the next
   step). Pick the one closest to what you want; your set copies its players, personnel and motions.

   ![Step 1: pick the formation and the set to start from.](/guide/formations-new-set.png)

3. Click **NEXT** and **name your set**. This is the name you'll see in the game.
4. Choose the **FORMATION** it appears under: keep the starting set's formation, use one of your own formations, or
   **New formation…** to make one (for example "Gun PBS").
5. Choose the sets file to save it in (**EXISTING FILE** or **NEW FILE**), then click **CREATE SET**.

   ![Step 2: the set's name, its formation and the file it's saved in.](/guide/formations-new-set-name.png)

6. Press **⌘S / Ctrl+S** to save.

## Move players

![The set editor: drag players on the field; the checks are at the bottom, the set's details on the right.](/guide/formations-editor.png)

- **Drag a player** on the field. The X/Y readout shows where he is (in yards from the ball: X across, Y back from the
  line).
- **Click a player** to see his panel: type exact **X** and **Y**, or use the quick buttons for **DEPTH** (on the
  line, off the line, backfield) and **SPLIT** (tight, wing, slot, numbers, wide…). **MOVE TO THE OTHER SIDE** mirrors
  him; **RESET PLAYER** puts him back.
- **Arrow keys** nudge the selected player (click the field first). **SNAP 0.5 YD** snaps to half yards; **FREE** (or
  holding Alt) places freely.
- **Original spots** shows where everyone started as faint circles.

![A player's panel: exact spot, depth and split buttons.](/guide/formations-player.png)

## The game's checks

The chips under the field (**GAME CHECKS**) check what the game needs to build your set. Green is fine; red must be
fixed before you export.

| Check | Rule |
|:--|:--|
| **11 PLAYERS** | The set has eleven players |
| **7 ON THE LINE** | Exactly seven players, not counting the QB, on the line of scrimmage |
| **OL SPACING** | The five linemen keep their usual spots, because blocking is built for them |
| **QB SHOTGUN / UNDER CENTER / PISTOL** | The QB and backs stay at their kind of depth, so handoffs still line up |
| **SPACING** | No two players on top of each other |

When a check fails, a chip such as **MOVE TE1, LT, RT ONTO THE LINE** appears next to the checks: click it and the
app makes the fix. The **CHECKS** box on the right explains every problem in words.

![A set started from I Form H Pro: its tackles (y −1.5) and TE (y −1.6) don't count as "on the line" yet.](/guide/formations-line-check.png)

:::note For the owner: the "on the line" rule
Today the game-side builder (`tools/PlayDump/SetBuilder.cs`) counts a player as on the line only when **y > −1.5**.
Many stock sets put their tackles at exactly −1.5 and tight ends at −1.6, so about 130 of the roughly 430 stock
offense sets (about 3 in 10) can't be used as a starting point as they are; the app flags them and offers the fix
above. The one-line fix on the game side is to change that check to **y > −1.75**; after that, every one of those
sets works unchanged.
:::

## Flipped plays (flip partners)

When you flip a play in the game, every player moves to his **flip partner's** spot on the other side (for example
WR1 and WR2 trade places). Turn on **Show flipped** to see the mirrored alignment the game will use. It's read-only;
click a player to see or change his **FLIP PARTNER**. Moving a player also moves his flipped spot.

![Show flipped: the mirrored alignment, with each player's flip partner.](/guide/formations-flipped.png)

## Motion presets

A set has a few ready pre-snap motions (M1 Left, M2 Right…), the ones you call at the line in the game. Under
**SHOW**, open **MOTION PRESETS** and pick one to see who moves and where he ends up.

![The set's motion presets: who moves on each one.](/guide/formations-presets-menu.png)

- **Drag the motion man** to where the motion should end, or type X and Y. The motion can end anywhere behind the
  line, within 23 yards of the ball and up to 8 yards deep. These numbers come from the game's own presets, so they
  differ a little from a play's own motion in the [Designer](#/help/designer), which is measured from the motions
  inside plays.
- **RESET TO THE GAME'S SPOT** undoes it. **Back to the alignment** returns to the normal view.

![Editing M4 Left: WR2 now motions to x −8.](/guide/formations-preset.png)

You can change where an existing preset ends. You can't add new presets or change which player moves yet.

## Copy plays into your set

A new set starts with no plays. Click **PLAYS IN THIS SET · 0** at the top right (or **ADD PLAYS…** in the set's
panel on the right):

![Plays in this set: tick plays to copy them in, preview each one on your alignment, and see what needs a look.](/guide/formations-plays.png)

1. **STARTING SET** lists the plays of the set you started from; **ALL SETS** searches every set.
2. Tick plays to copy them in. Each copy gets its own name (for example "PBS T Curls").
3. Click a play to preview it: **IN YOUR SET** shows it on your alignment, **ORIGINAL** as the game has it. Change its
   **NAME IN THIS SET** or its **PRIMARY RECEIVER (RED ROUTE)** here.
4. **ADD ALL WITHOUT WARNINGS** copies every play that doesn't need a look; **REMOVE LISTED** takes the listed ones
   out. Click **DONE**, then save.

Plays with a **⚠** and player names (for example **⚠ SL1 WR2**) depend on a player you moved. Routes are fine (they
start from the new spot), but some things keep the original coordinates and don't follow your change: handoffs,
pulls, motions to a fixed spot, and players with a fixed starting spot in that play. Check those plays, or leave
them out.

**CUSTOMIZE THIS PLAY…** opens the [Designer](#/help/designer) with a new play based on the copy, so you can change
its routes too. Check the **PLAYS FILE** on the last step before **CREATE PLAY**: it starts on the plays file you
used last.

## Use your set in a playbook

In **PLAYBOOK**, click **+ SET** under the formation: your set is in the list with a **CUSTOM** tag. Its copied plays
appear in its ALL PLAYS IN THIS SET list like any other plays. Your own formations appear under **+ FORMATION**.
Export builds the formations, sets and copied plays into the mod.
