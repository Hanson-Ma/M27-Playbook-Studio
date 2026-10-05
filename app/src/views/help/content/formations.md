# Formations & Custom Sets

In Madden a **formation** (SHOTGUN, PISTOL, SINGLEBACK…) holds **sets** (Y TRIPS WK, BUNCH…), and the set decides
where all eleven players line up. The **Formations** tab makes your own sets: start from a set the game has, move
players, adjust its pre-snap motions, and copy plays into it. Your sets are built into the same mod as your plays and
you add them to a playbook like any other set.

:::warning New: Check Your First Custom Set in the Game
Custom sets are the newest part of Playbook Studio. The first ones were built on 2026-10-04 and haven't been
confirmed in the game yet. Build one small set first, export, and check it in Madden before you build a whole
playbook on custom sets.
:::

![Formations: your custom sets, each with its changes, its plays and a Ready or warning badge.](/guide/formations-entry.png)

## Make a Custom Set

1. Click **Formations**, then **+ New Set**.
2. **Pick a Set to Start From**: choose a formation on the left, then click a set (double-click jumps to the next
   step). Pick the one closest to what you want; your set copies its players, personnel and motions.

   ![Step 1: pick the formation and the set to start from.](/guide/formations-new-set.png)

3. Click **Next** and **name your set**. This is the name you'll see in the game.
4. Choose the **Formation** it appears under: keep the starting set's formation, use one of your own formations, or
   **New Formation…** to make one (for example "GUN PBS").
5. Choose the sets file to save it in (**Existing File** or **New File**), then click **Create Set**.

   ![Step 2: the set's name, its formation and the file it's saved in.](/guide/formations-new-set-name.png)

6. Press **⌘S / Ctrl+S** to save.

## Move Players

![The set editor: drag players on the field; the checks are at the bottom, the set's details on the right.](/guide/formations-editor.png)

- **Drag a player** on the field. The X/Y readout shows where he is (in yards from the ball: X across, Y back from the
  line).
- **Click a player** to see his panel: type exact **X** and **Y**, or use the quick buttons for **Depth** (on the
  line, off the line, backfield) and **Split** (tight, wing, slot, numbers, wide…). **Move to the Other Side** mirrors
  him; **Reset Player** puts him back.
- **Arrow keys** nudge the selected player (click the field first). **Snap 0.5 yd** snaps to half yards; **Free** (or
  holding Alt) places freely.
- **Original Spots** shows where everyone started as faint circles.

![A player's panel: exact spot, depth and split buttons.](/guide/formations-player.png)

## The Game's Checks

The chips under the field (**Game Checks**) check what the game needs to build your set. Green is fine; red must be
fixed before you export.

| Check | Rule |
|:--|:--|
| **11 Players** | The set has eleven players |
| **7 on the Line** | Exactly seven players, not counting the QB, on the line of scrimmage |
| **OL Spacing** | The five linemen keep their usual spots, because blocking is built for them |
| **QB Shotgun / Under Center / Pistol** | The QB and backs stay at their kind of depth, so handoffs still line up |
| **Spacing** | No two players on top of each other |

When a check fails, a chip such as **Move TE1, LT, RT Onto the Line** appears next to the checks: click it and the
app makes the fix. The **Checks** box on the right explains every problem in words.

![A set started from I FORM H PRO: its tackles (y −1.5) and TE (y −1.6) don't count as "on the line" yet.](/guide/formations-line-check.png)

:::note For the Owner: The "On the Line" Rule
Today the game-side builder (`tools/PlayDump/SetBuilder.cs`) counts a player as on the line only when **y > −1.5**.
Many stock sets put their tackles at exactly −1.5 and tight ends at −1.6, so about 130 of the roughly 430 stock
offense sets (about 3 in 10) can't be used as a starting point as they are; the app flags them and offers the fix
above. The one-line fix on the game side is to change that check to **y > −1.75**; after that, every one of those
sets works unchanged.
:::

## Flipped Plays (Flip Partners)

When you flip a play in the game, every player moves to his **flip partner's** spot on the other side (for example
WR1 and WR2 trade places). Turn on **Show Flipped** to see the mirrored alignment the game will use. It's read-only;
click a player to see or change his **Flip Partner**. Moving a player also moves his flipped spot.

![Show Flipped: the mirrored alignment, with each player's flip partner.](/guide/formations-flipped.png)

## Motion Presets

A set has a few ready pre-snap motions (M1 Left, M2 Right…), the ones you call at the line in the game. Under
**Show**, open **Motion Presets** and pick one to see who moves and where he ends up.

![The set's motion presets: who moves on each one.](/guide/formations-presets-menu.png)

- **Drag the motion man** to where the motion should end, or type X and Y. The motion can end anywhere behind the
  line, within 23 yards of the ball and up to 8 yards deep. These numbers come from the game's own presets, so they
  differ a little from a play's own motion in the [Designer](#/help/designer), which is measured from the motions
  inside plays.
- **Reset to the Game's Spot** undoes it. **Back to the Alignment** returns to the normal view.

![Editing M4 Left: WR2 now motions to x −8.](/guide/formations-preset.png)

You can change where an existing preset ends. You can't add new presets or change which player moves yet.

## Copy Plays Into Your Set

A new set starts with no plays. Click **Plays in This Set · 0** at the top right (or **Add Plays…** in the set's
panel on the right):

![Plays in This Set: tick plays to copy them in, preview each one on your alignment, and see what needs a look.](/guide/formations-plays.png)

1. **Starting Set** lists the plays of the set you started from; **All Sets** searches every set.
2. Tick plays to copy them in. Each copy gets its own name (for example "PBS T CURLS").
3. Click a play to preview it: **In Your Set** shows it on your alignment, **Original** as the game has it. Change its
   **Name in This Set** or its **Primary Receiver (Red Route)** here.
4. **Add All Without Warnings** copies every play that doesn't need a look; **Remove Listed** takes the listed ones
   out. Click **Done**, then save.

Plays with a **⚠** and player names (for example **⚠ SL1 WR2**) depend on a player you moved. Routes are fine (they
start from the new spot), but some things keep the original coordinates and don't follow your change: handoffs,
pulls, motions to a fixed spot, and players with a fixed starting spot in that play. Check those plays, or leave
them out.

**Customize This Play…** opens the [Designer](#/help/designer) with a new play based on the copy, so you can change
its routes too. Check the **Plays File** on the last step before **Create Play**: it starts on the plays file you
used last.

## Use Your Set in a Playbook

In **Playbook**, click **+ Set** under the formation: your set is in the list with a **Custom** tag. Its copied plays
appear in its **All Plays in This Set** list like any other plays. Your own formations appear under **+ Formation**.
Export builds the formations, sets and copied plays into the mod.
