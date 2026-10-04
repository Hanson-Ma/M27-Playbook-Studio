# Design a play

The **DESIGNER** makes your own plays. Every custom play starts from a **base play**: a play the game already has in
the same set. You keep what you like and change the rest: routes, cuts, blocks, motion and who gets the red route.

:::note Why a base play?
The base play supplies the things that have to match the game exactly: where everyone lines up, the handoff,
play-action fake or option between the QB and the ball carrier, the pass protection and the QB's reads. Starting from
a play that already works in the game keeps your play working too. Pick the base that's closest to what you want:
for a run, the blocking scheme you want (Inside Zone, Power, Counter…); for a play-action pass, a PA play.
:::

## Start a new play

From the **DESIGNER** tab:

![The Designer's start screen: your plays files on the left, their plays as cards.](/guide/designer-entry.png)

1. Click **+ NEW PLAY**.
2. **Formation**: type to filter (for example "shotgun") and press **Enter**, or click one. Your own formations are
   marked CUSTOM.
3. **Set**: type to filter (for example "y trips wk") and press **Enter**, or click it. The field on the right shows
   the set's alignment.
4. **Base play**: click the play to start from. They're grouped by type and concept.

   ![Step 3 of the wizard: choose the base play.](/guide/designer-wizard-base.png)

5. **Name**: type the in-game name (it must be unique in the set). The **ASSET NAME** below it is filled in from
   the name; leave it. Choose the **PLAYS FILE** to keep it in (**New plays file…** at the bottom of the list starts a
   new one), then click **CREATE PLAY**.

   ![Step 4: the name and the file.](/guide/designer-wizard-name.png)

Other ways to start one:

- **LIBRARY → CLONE IN DESIGNER** on any play uses it as the base.
- **LIBRARY → ROUTES tab → USE IN DESIGNER** starts a play with that route already on the player.
- **FORMATIONS → Plays in this set → CUSTOMIZE THIS PLAY…** starts from a play copied into your own set.

## The editor

![A new play, PBS Comebacks, based on Comebacks in Gun Y Trips Wk.](/guide/designer-editor-empty.png)

- **Left, PLAY:** the name and the **BASE PLAY**; under **PLAY CALL** the **PRIMARY RECEIVER (RED ROUTE)** and the
  **PLAY TYPE**; under **ADVANCED** the asset name, blocking scheme, run hole and reads (a run shows its run hole and
  blocking scheme under PLAY CALL instead). Below that, the other plays in the same file and **ADD TO PLAYBOOK…**.
- **Middle, the field:** the play drawn to scale. The row of player buttons above it (WR1 X, HB1 HB, TE1 Y, SL1
  SLOT, WR2 Z, QB, LT…RT) selects a player. A **red dot** marks the primary receiver, a **blue dot** a player you
  changed, a **lock** a handoff player.
- **Right, the player:** tabs **ROUTE**, **BLOCK**, **MOTION** and **ADVANCED** for the selected player.

At the top of the field: **SNAP TO GRID** (points snap to half yards and 5° steps; click it for free placement, or hold
Alt while dragging), **FLIP VIEW** (look at the play mirrored; the play itself doesn't change) and **DETAILS** (open
the play in the library).

## Edit a player

1. **Click a player** on the field, or his button above the field.
2. Choose a tab on the right:
   - **ROUTE**: pick a ready-made route, one of My Routes, a double move, or draw your own. Everything about routes
     and cuts is in [Routes, cuts & My Routes](#/help/routes).
   - **BLOCK**: make him block (next section).
   - **MOTION**: send him in motion before the snap (below).
3. **Right-click a player** for a shortcut menu.

![The selected slot receiver (SL1): his current route on the field, the route presets on the right.](/guide/designer-editor.png)

![Right-click a player: edit his route, blocking or motion, make him the primary receiver, save his route, move him for this play, or reset him.](/guide/designer-player-menu.png)

**RESET PLAYER** (or right-click → **Reset to the base play's assignment**) puts the player back exactly as the base
play has him.

## Blocking

On the **BLOCK** tab, pick what the player does:

![The BLOCK tab for the halfback: pass block is selected.](/guide/designer-block.png)

| Block | Use it for |
|:--|:--|
| **PASS BLOCK** | Stay in and protect the QB |
| **BLOCK & RELEASE** | Chip or check the rusher, then release into a route |
| **RUN BLOCK** | Block on a run (the play's blocking scheme picks the target) |
| **LEAD**, **KICKOUT**, **TRAP**, **WHAM** | Lead through a hole, kick out the end, trap or wham a defender |
| **CRACK**, **STALK** | Receiver blocks on the perimeter |
| **PULL** | A lineman pulls along the line |
| **SCREEN RELEASE** | Linemen releasing to set up a screen |

Gray lines ending in a T show the blocks on the field.

## Motion

On the **MOTION** tab, pick a preset to start with, then adjust it.

1. Click **JET**, **ORBIT**, **RETURN / SHIFT** or **SHORT**.
2. The field shades the **motion area** and draws the path in light blue. Drag the **blue diamonds** to move the
   points, or click inside the shaded area to add a point (**ADD MOTION POINT** does the same).
3. Each point has **RUN** or **SHUFFLE**, its X and Y and a speed. **MORE OPTIONS** sets when the motion starts,
   delays and facing.
4. **REMOVE MOTION** takes it out.

![A jet motion for WR1: the shaded motion area, the light-blue path and its points on the right.](/guide/designer-motion.png)

### How far a player can motion

The limits come from the game itself: they were measured from all 2,099 motions in Madden's own plays, so a motion
inside them is one the game knows how to run. The designer keeps your points inside them for you.

| Limit | Value |
|:--|:--|
| Where | Behind the line of scrimmage, never past it |
| How deep | No deeper than 11 yards behind the line |
| How wide | Inside the numbers (18 yards either side of the ball) |
| Points | 1 to 5 points per motion |
| Length | About 25 yards in total is a long motion; 35 yards is the most |
| Who | One motion man per play; offensive linemen never motion |

Dragging can't take a point out of the shaded area. The length and the motion man are up to you: the rings on the
field show how far the player can still go from his last point, the tab's header shows the motion's length (for
example **MOTION POINTS · 22.3 YD**), and the Motion tab warns when a motion is longer than 25 yards, longer than
35 yards (no motion in the game is) or when a second player motions. **EXPORT** lists a motion over 35 yards as a
warning too.

## The primary receiver (red route)

The **primary receiver** is the QB's first look. His route is drawn **red** on the play art in the game and in the
app. You can change who it is:

- In the play panel on the left, pick a player under **PRIMARY RECEIVER (RED ROUTE)**; or
- select a player and click **MAKE PRIMARY RECEIVER** in his header; or
- right-click a player → **Make primary receiver (red route)**.

The route turns red right away, and the panel says which player the base play used (*Changed from the base play's
WR2 · Z*). **USE BASE** under it goes back to the base play's primary receiver.

![The slot receiver (SL1) is now the primary receiver: his corner route is red.](/guide/designer-primary.png)

:::warning Red routes and reads
Stock plays have exactly one red route. In testing, plays whose **reads** were rewritten (every read with combo 0 and
no concept) showed several red routes in the game. So: change the primary receiver here, but leave the reads alone
unless you really need to (they're under **ADVANCED → READS**; **USE BASE READS** puts them back). The player's
**ADVANCED → Red routes in the game** note says the same.
:::

![ADVANCED in the play panel: asset name, blocking scheme, run hole, and the reads (here still the base play's).](/guide/designer-reads.png)

## Where players line up (fixed starting spots)

A play doesn't decide where players line up; **the set does**. Every play in Y Trips Wk starts from the same
alignment. In the designer:

- The player's header says where he lines up, for example *Lines up where the formation puts them (10.5, -2.2)*.
- **Handoff players are locked** (lock icon, **HANDOFF** tag): the QB and the ball carrier on a handoff, fake, option
  or pitch keep the base play's first steps and spot, because the handoff only works from there. To change the
  handoff itself, pick another base play. **Edit what happens after the handoff** unlocks the rest of the path.

  ![PBS GT Counter: the halfback is a handoff player, so his first steps and his spot are locked.](/guide/designer-locked.png)

- **Move this player for this play only** lets you line one player up somewhere else in just this play (for example a
  tighter split). Click it, then drag the ring on the field to his new spot. His header then says *Moved for this
  play* and his button above the field shows **MOVED**. **RESET TO FORMATION SPOT** undoes it.

![Moving WR2 for this play only: drag the ring to his new spot.](/guide/designer-move-player.png)

To move a player in **every** play of a set, make your own set in [Formations](#/help/formations) and build the
play on it.

## Change the base play later

The **BASE PLAY** menu on the left swaps the base for another play of the same set. The app asks first and tells you
which players reset (players with a handoff in either base). Your other changes carry over.

## Save, add to a playbook, rename

1. Press **⌘S / Ctrl+S** (or **SAVE** at the top right). The play is saved in its plays file.
2. Click **ADD TO PLAYBOOK…** at the bottom of the play panel and pick a playbook. The play goes into its set.
3. Save the playbook too (⇧⌘S / Ctrl+Shift+S saves everything).

If you rename a play that's already in a playbook, a note offers **Update everywhere**: it renames the play in your
playbooks, tags and favorites too.

The icons next to the file name in the play panel **duplicate** or **delete** the current play. On the start screen,
right-click a play card for **Edit**, **Add to playbook…** and **Delete…**. Undo brings a deleted play back.

## Advanced (rarely needed)

- **PLAY TYPE** changes how the game files the play (Pass, Run, Play action…). It inherits the base's by default.
- Play **ADVANCED**: the asset name (made from the play name), the blocking scheme and run hole (a run has them under
  PLAY CALL), and the reads.
- Player **ADVANCED** tab: the **release** (the first step off the line: straight, inside or outside) and start
  animation, the assignment's name and type, his exact alignment, and the raw step list.
