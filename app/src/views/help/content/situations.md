# Situations

**Situations** shows, for one playbook, which plays the computer (the CPU, and **Ask Madden**) may call in each
game situation: every down and distance, each part of the red zone, the goal line, the two-minute drill and more.
It's the same CPU weight you can set on a single play in **Playbook**, laid out the other way round: pick the
situation first, then see and change every play in it.

## Read a Situation

1. Click **Situations** in the top bar.
2. Pick the playbook at the top (it opens the one you were last working on).
3. Pick a situation in the list on the left. The number next to each one is how many plays have a weight there; a dash
   means the game's own defaults are in charge.

The page shows every play with a weight in that situation, with a bar for how strongly the CPU leans on it. **By
Formation** groups them under their formation and set; **By Weight** puts the heaviest first. The coloured bar at the
top is the mix of the situation: how much of the weight goes to passes, runs, play action, screens and RPOs.

## Change a Weight

A weight is a percentage from 0 to 100: the higher it is, the more likely the CPU is to pick that play when the
situation comes up. Click the number and type a new one, or use the arrows. **⌘/Ctrl+Z** undoes it, like any other
edit.

## Add a Play to a Situation

1. Click **Add Plays**.
2. Search by play, formation or set, or narrow the list with the kind-of-play buttons.
3. Set **Start at** (new plays start at 50%), then click **Add** on each play you want.

The play is added to this situation only. Plays that are already in the situation aren't listed.

## Take a Play Out

Click the **✕** at the end of the row. The play stays in its set, and the CPU just stops calling it in this
situation.

:::tip
Special teams and any other **template sections** keep the game's own weights; they aren't listed here. Convert a
template section to editable sets in **Playbook** to change them.
:::

Saving works as everywhere else: the top bar shows when the playbook has unsaved changes, and **⌘/Ctrl+S** saves it.
