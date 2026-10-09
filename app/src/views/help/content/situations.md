# Situations

**Situations** shows, for one playbook, which plays the computer (the CPU, and **Ask Madden**) may call in each
game situation: every down and distance, each part of the red zone, the goal line, the two-minute drill and more.
It's the same CPU weight you can set on a single play in **Playbook**, laid out the other way round: pick the
situation first, then see and change every play in it.

## Read a Situation

1. Click **Situations** in the top bar. It opens the playbook you were last working on.
2. Pick a situation in the list on the left. The number next to each one is how many plays have a weight there; a dash
   means the game's own defaults are in charge.

Every play shows as its play card (nine to a row; **3 / 6 / 9** at the top right changes that), with its weight under
it. Plays that are audibles carry their audible button and say so on the card. **By Formation** groups the cards under
their formation and set; **By Weight** puts the heaviest first. The coloured bar at the top is the mix of the
situation: how much of the weight goes to passes, runs, play action, screens and RPOs.

**With Ratings** shows only the plays that have a weight in the situation; **All Plays** shows the whole playbook, with
the unrated plays faded.

## Change a Weight

A weight is a percentage from 0 to 100: the higher it is, the more likely the CPU is to pick that play when the
situation comes up. Drag the bar under the card, or type a number. **⌘/Ctrl+Z** undoes it, like any other edit.

## Add a Play to a Situation

Switch to **All Plays**, find the play (the search box filters by play, formation or set) and click **Add to Situation**.
It starts at 50%; drag the bar to set it. Plays that already have a weight show their bar instead.

## Take a Play Out

Click the **✕** next to the number under the card. The play stays in its set, and the CPU just stops calling it in this
situation.

:::tip
Special teams and any other **template sections** keep the game's own weights; they aren't listed here. Convert a
template section to editable sets in **Playbook** to change them.
:::

Saving works as everywhere else: the top bar shows when the playbook has unsaved changes, and **⌘/Ctrl+S** saves it.
