# Audibles & CPU calls

Every set in a playbook has **four audible slots**: the plays you can switch to at the line of scrimmage without
going back to the play-call screen. This page also covers the **CPU weights**, which tell the computer when to call
each play.

## The four slots

Madden's audible menu groups audibles by type. The usual layout, and how the app draws each slot:

| Slot | Usual type | Xbox | PS5 | Keyboard |
|:--:|:--|:--:|:--:|:--:|
| 1 | Quick pass | X | □ | 1 |
| 2 | Run | A | ✕ | 2 |
| 3 | Deep pass | Y | △ | 3 |
| 4 | Play action | B | ○ | 4 |

The slot type is a label, not a rule: you can put any play of the set on any slot. Stock playbooks follow it
(quick passes such as Slants or Stick on slot 1, Inside Zone on slot 2, Four Verticals on slot 3, a PA pass on
slot 4), so it's a good habit.

## Give a play an audible button

1. In **PLAYBOOK**, click a set in step 1 (for example **Y TRIPS WK**).
2. In step 2, **click the play's card**.
3. In step 3, **click one of the four buttons** in the audible diamond. The play's mini diagram and name appear on
   the button.

![The audible diamond for Y Trips Wk: Slants on X, PBS GT Counter on A, PBS Bubble Go on Y, PBS PA Yankee on B.](/guide/audibles-panel.png)

Other ways to do the same:

- **Drag a card** from step 2 onto a button.
- **Right-click a card → Audible →** pick a slot (for example **1 · Quick Pass**).

To **move** a play to another button, select it and click the other button. To **clear** a button, click the small
**×** on it, or select the play and click its own button again. Each button holds one play; giving a button to a new
play takes it away from the old one. The dots next to each set in the tree show how many of its four slots are used.

:::tip Pick audibles you'll actually check to
A good set of audibles answers what the defense shows you: a quick pass against press or blitz, a run against a light
box, a shot play against single-high, and a play action that looks like your run.
:::

## Xbox, PS5 or keyboard buttons

You play Madden on a controller, so the app draws the audible buttons the way your controller shows them. Use the
**SHOW AS** switch above the diamond (**XBOX**, **PS5**, **KEYBOARD**), or **Settings → Audibles → Button style**.
Xbox is the default.

This only changes how the buttons are drawn in the app. The playbook file stores the slot number (1 to 4), so the
same playbook works with any controller.

## If your game puts them on other buttons

![Settings → Audibles: the button style, and which button shows which slot.](/guide/settings-audibles.png)

Open **Settings** (the gear at the top right) → **Audibles** → **Which button is which slot**. Each button has a slot
menu; choosing a slot another button had swaps the two. **Reset to default** puts back X = 1, A = 2, Y = 3, B = 4.

:::warning Check this once in Madden 27
The default layout above was worked out from the game's stock playbooks; it hasn't been confirmed in Madden 27 yet.
After your first export, open your playbook in the game, call a play from a set with audibles, and press the audible
button at the line. If Madden shows a slot on a different button than the app, change it here so the app matches your
game. Your playbooks don't change.
:::

## When the CPU calls a play (CPU weights)

Below the audibles, a selected play shows **When the CPU calls it**: a slider from 0 to 100 for each game situation.
Higher means the computer (and Ask Madden suggestions) is more likely to call this play in that situation. Leave a
situation empty to keep the game's default.

![CPU weights for PBS GT Counter: 1st Down 40, 2nd & Short 50, 3rd & Short 30.](/guide/cpu-weights.png)

1. Select a play in step 2.
2. Drag a slider, or type a number. The **×** next to a row clears it.
3. The common situations (down and distance, red zone, goal line) are shown first. **Show all situations** lists the
   rest (two-minute, kneel, fake punt, go for 2…).

To give several plays the same weights:

1. Select the play that has them and click **Copy** (or right-click → **Copy CPU weights**).
2. Select one or more other plays (⌘-click or Shift-click to select several) and click **Paste** (or right-click →
   **Paste CPU weights**).

**Clear all** removes a play's weights. Every weight is one "CPU row"; a playbook can hold 2,200 of them (the CPU ROWS
meter at the top).

## See it like the game

The **AUDIBLES** tab of [Preview in game](#/help/preview) shows each set's audibles the way Madden's play-call screen
does.
