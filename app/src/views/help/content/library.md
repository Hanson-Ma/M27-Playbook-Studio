# Find plays

The **LIBRARY** holds every play in Madden NFL 27 (about 11,000, offense, defense and special teams) plus the plays
you made yourself. Find a play here, look at what every player does, then add it to a playbook or use it as the start
of your own play.

![Searching for "mesh" in Shotgun: the filters on the left, the results as play cards.](/guide/library-filtered.png)

## Search and filter

1. Type in the **search box** at the top: a play name ("mesh", "four verticals"), a concept or a formation.
2. Narrow it down with the **FILTERS** on the left:
   - **SIDE**: offense, defense or special teams.
   - **FORMATION**: type to find a formation (Shotgun, Pistol, Singleback…), then pick a set under it.
   - **PLAY TYPE**: pass, run, play action, screen, RPO, option.
   - **CONCEPT**: your own [Gameplan](#/help/concepts) categories and the game's read concepts (Smash, Flood, Mesh…).
   - **ROUTE CONTAINS**: plays with a slant, a wheel, a double move…
   - **AVAILABILITY**: plays that work without the mod, or plays that need it.
   - **SOURCE**: stock plays or your own (custom) plays.
3. The active filters show as chips above the results. Click a chip's **×** to drop it, or **CLEAR ALL**.

The tabs at the top left browse the library a different way: **ALL**, by **FORMATION**, **CONCEPT** or **PLAY
TYPE**, your **FAVORITES** (star a play to add it) and **RECENT** plays. **FLIP PLAYS** mirrors every diagram, and
**GAMEPLAN** at the top right opens your [concepts and tags](#/help/concepts).

:::tip Hide the drills
Madden's minigame and drill formations are hidden by default. To see them, turn off **Hide minigame formations** in
**Settings → Editor**.
:::

## Reading a play card

| On the card | Means |
|:--|:--|
| Yellow line | A route |
| **Red** line | The **primary receiver** (the red route), or the ball carrier on a run |
| Gray line ending in a T | A block |
| Light blue line | Pre-snap motion |
| White line from the QB | The QB's drop, rollout or handoff |
| Corner shapes | How the receiver cuts; see [cuts](#/help/routes) |
| PASS, RUN, PLAY ACTION, SCREEN, RPO, OPTION | The play type |
| CUSTOM | A play you made |
| NEEDS MOD | See below |

### NEEDS MOD

A custom playbook can normally only use the plays in the game's "global" play list; Madden quietly drops the others.
Plays with a **NEEDS MOD** tag aren't on that list. You can still use them: the export adds them to the Playbook
Studio mod automatically, so they work once the mod is applied. Your own plays and sets always need the mod too.

## Look at a play

**Click** a card to select it (it gets a white outline). The bar above the cards then names the play and offers
**OPEN**, **ADD TO PLAYBOOK**, **CLONE IN DESIGNER** and **FAVORITE**. **Double-click** a card (or click **OPEN**) to
open the play.

![A play opened from the library: the field on the left, four tabs on the right.](/guide/library-detail.png)

- **‹** and **›** next to the name step through the other plays in your results.
- **FLIP** mirrors the play; the **MOTION** menu shows it with one of the set's pre-snap motions.
- Click a player on the field to highlight what he does.

The four tabs on the right:

| Tab | Shows |
|:--|:--|
| **OVERVIEW** | Play type, formation and set, whether it needs the mod, the primary receiver, whether it can be flipped, and its concept tags |
| **PLAYERS** | Every player with his assignment (route, block, run path) |
| **READS** | The QB's read order with the percentage for each receiver; the primary receiver is the red one |
| **ROUTES** | Every route the game has, drawn from the selected player's spot (see below) |

![The PLAYERS tab: each player and his assignment.](/guide/library-players.png)

![The READS tab: the progression, with the primary receiver in red.](/guide/library-reads.png)

### Try other routes for a player (ROUTES tab)

1. Click a player on the field (for example the slot, **2 SL1**).
2. Open **ROUTES**. You see every route in the game for that spot, grouped by type (Hitch, Curl, Post…). **ROUTES**,
   **BLOCKS**, **BACKS**, **QB** and **ALL** switch the kind of assignment; the filter box finds one by name.
3. Click a route to preview it on the field (a **PREVIEW** chip appears above the field).
4. Click **USE IN DESIGNER** to start a new play from this one with that route on that player.

![Previewing a hitch for the slot receiver in the ROUTES tab.](/guide/library-routes.png)

## Add a play to a playbook

1. Click **ADD TO PLAYBOOK…** (on the play, or in the bar after selecting a card).
2. Pick the playbook. Plays already in a playbook say **ALREADY IN BOOK** (the button then reads **SHOW IN BOOK** and
   takes you to it).
3. Click **ADD** (or double-click the playbook). **NEW OFFENSE PLAYBOOK…** creates a new one on the spot.

![Add to playbook: pick which playbook gets the play.](/guide/library-add-dialog.png)

The play goes into its own formation and set in that playbook; if the playbook doesn't have them yet, they're added
(before the special-teams sections). A message with an **Open** link takes you there. Remember to save the playbook
(⌘S).

## Use a play as the start of your own

**CLONE IN DESIGNER** opens the [Designer](#/help/designer) with this play as the base: same formation, same set,
same handoffs and protection. Change the routes, blocks, motion and the red route there.

You can't edit a game play in place. Your changes always become a new play with its own name, so the original stays
in the game untouched.
