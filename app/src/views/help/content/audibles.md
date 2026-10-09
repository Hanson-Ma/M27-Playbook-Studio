# Audibles & CPU Calls

Every set in a playbook has **four audible slots**: the plays you can switch to at the line of scrimmage without
going back to the play-call screen. This page also covers the **CPU weights**, which tell the computer when to call
each play.

## The Four Slots

Madden's audible menu groups audibles by type. The usual layout, and how the app draws each slot:

| Slot | Usual Type | Xbox | PS5 | Keyboard |
|:--:|:--|:--:|:--:|:--:|
| 1 | Quick Pass | X | □ | 1 |
| 2 | Run | A | ✕ | 2 |
| 3 | Deep Pass | Y | △ | 3 |
| 4 | Play Action | B | ○ | 4 |

The slot type is a label, not a rule: you can put any play of the set on any slot. Stock playbooks follow it
(quick passes such as SLANTS or STICK on slot 1, INSIDE ZONE on slot 2, FOUR VERTICALS on slot 3, a PA pass on
slot 4), so it's a good habit.

## Give a Play an Audible Button

1. In **Playbook**, click a set in the tree (for example **Y TRIPS WK**).
2. In the middle, **click the play's card**.
3. On the right, **click one of the four buttons** in the audible diamond. The play's mini diagram and name appear on
   the button.

![The audible diamond for Y TRIPS WK: SLANTS on X, PBS GT COUNTER on A, PBS BUBBLE GO on Y, PBS PA YANKEE on B.](/guide/audibles-panel.png)

Other ways to do the same:

- **Drag a card** from the middle onto a button.
- **Right-click a card → Audible →** pick a slot (for example **1 · Quick Pass**).

To **move** a play to another button, select it and click the other button. To **clear** a button, click the small
**×** on it, or select the play and click its own button again. Each button holds one play; giving a button to a new
play takes it away from the old one. The dots next to each set in the tree show how many of its four slots are used.

:::tip Pick Audibles You'll Actually Check To
A good set of audibles answers what the defense shows you: a quick pass against press or blitz, a run against a light
box, a shot play against single-high, and a play action that looks like your run.
:::

## Xbox, PS5 or Keyboard Buttons

You play Madden on a controller, so the app draws the audible buttons the way your controller shows them. Use the
**Show As** switch above the diamond (**Xbox**, **PS5**, **Keyboard**), or **Settings → Audibles → Button Style**.
Xbox is the default.

This only changes how the buttons are drawn in the app. The playbook file stores the slot number (1 to 4), so the
same playbook works with any controller.

## If Your Game Puts Them on Other Buttons

![Settings → Audibles: the button style, and which button shows which slot.](/guide/settings-audibles.png)

Open **Settings** (the gear at the top right) → **Audibles** → **Which Button Is Which Slot**. Each button has a slot
menu; choosing a slot another button had swaps the two. **Reset to Default** puts back X = 1, A = 2, Y = 3, B = 4.

:::warning Check This Once in Madden 27
The default layout above was worked out from the game's stock playbooks; it hasn't been confirmed in Madden 27 yet.
After your first export, open your playbook in the game, call a play from a set with audibles, and press the audible
button at the line. If Madden shows a slot on a different button than the app, change it here so the app matches your
game. Your playbooks don't change.
:::

## When the CPU Calls a Play (CPU Weights)

Below the audibles, a selected play shows **When the CPU Calls It**: a slider from 0 to 100 for each game situation.
Higher means the computer (and Ask Madden suggestions) is more likely to call this play in that situation. Leave a
situation empty to keep the game's default.

![CPU weights for PBS GT COUNTER: 1st Down 40, 2nd & Short 50, 3rd & Short 30.](/guide/cpu-weights.png)

1. Select a play in the middle.
2. Drag a slider, or type a number. The **×** next to a row clears it.
3. The common situations (down and distance, red zone, goal line) are shown first. **Show All Situations** lists the
   rest (two-minute, kneel, fake punt, go for 2…).

To give several plays the same weights:

1. Select the play that has them and click **Copy** (or right-click → **Copy CPU Weights**).
2. Select one or more other plays (⌘-click or Shift-click to select several) and click **Paste** (or right-click →
   **Paste CPU Weights**).

**Clear All** removes a play's weights. Every weight is one "CPU row"; a playbook can hold 2,200 of them (the **CPU Rows**
meter at the top).

## See It Like the Game

The **Audibles** tab of [Preview in Game](#/help/preview) shows each set's audibles the way Madden's play-call screen
does.
