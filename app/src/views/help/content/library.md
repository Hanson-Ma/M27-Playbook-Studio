# Find Plays

The **Library** holds every play in Madden NFL 27 (about 11,000, offense, defense and special teams) plus the plays
you made yourself. Find a play here, look at what every player does, then add it to a playbook or use it as the start
of your own play.

![Searching for "mesh" in SHOTGUN: the filters on the left, the results as play cards.](/guide/library-filtered.png)

## Search and Filter

1. Type in the **search box** at the top: a play name ("mesh", "four verticals"), a concept or a formation.
2. Narrow it down with the **Filters** on the left:
   - **Side**: offense, defense or special teams.
   - **Formation**: type to find a formation (SHOTGUN, PISTOL, SINGLEBACK…), then pick a set under it.
   - **Play Type**: PASS, RUN, PLAY ACTION, SCREEN, RPO, OPTION.
   - **Concept**: your own [Gameplan](#/help/concepts) categories and the game's read concepts (Smash, Flood, Mesh…).
   - **Route Contains**: plays with a slant, a wheel, a double move…
   - **Availability**: plays that work without the mod, or plays that need it.
   - **Source**: stock plays or your own (custom) plays.
3. The active filters show as chips above the results. Click a chip's **×** to drop it, or **Clear All**.

The tabs at the top left browse the library a different way: **All**, **Browse** (pick a formation in the list, then
one of its sets or **All Sets**, the way the game's formation screen works), **Concept** or **Play Type**, your **Favorites** (star a play to add it) and **Recent** plays. **Flip Plays** mirrors every diagram, and
**Gameplan** at the top right opens your [concepts and tags](#/help/concepts).

:::tip Hide the Drills
Madden's minigame and drill formations are hidden by default. To see them, turn off **Hide Minigame Formations** in
**Settings → Editor**.
:::

## Reading a Play Card

| On the Card | Means |
|:--|:--|
| Yellow line | A route |
| **Red** line | The **primary receiver** (the red route), or the ball carrier on a run |
| Gray line ending in a T | A block |
| Light blue line | Pre-snap motion |
| White line from the QB | The QB's drop, rollout or handoff |
| Corner shapes | How the receiver cuts; see [cuts](#/help/routes) |
| PASS, RUN, PLAY ACTION, SCREEN, RPO, OPTION | The play type |
| Custom | A play you made |
| Needs Mod | See below |

### Needs Mod

A custom playbook can normally only use the plays in the game's "global" play list; Madden quietly drops the others.
Plays with a **Needs Mod** tag aren't on that list. You can still use them: the export adds them to the Playbook
Studio mod automatically, so they work once the mod is applied. Your own plays and sets always need the mod too.

## Look at a Play

**Click** a card to select it (it gets a white outline). The bar above the cards then names the play and offers
**Open**, **Add to Playbook**, **Clone in Designer** and **Favorite**. **Double-click** a card (or click **Open**) to
open the play.

![A play opened from the library: the field on the left, four tabs on the right.](/guide/library-detail.png)

- **‹** and **›** next to the name step through the other plays in your results.
- **Flip** mirrors the play; the **Motion** menu shows it with one of the set's pre-snap motions.
- Click a player on the field to highlight what he does.

The four tabs on the right:

| Tab | Shows |
|:--|:--|
| **Overview** | Play type, formation and set, whether it needs the mod, the primary receiver, whether it can be flipped, and its concept tags |
| **Players** | Every player with his assignment (route, block, run path) |
| **Reads** | The QB's read order with the percentage for each receiver; the primary receiver is the red one |
| **Routes** | Every route the game has, drawn from the selected player's spot (see below) |

![The Players tab: each player and his assignment.](/guide/library-players.png)

![The Reads tab: the progression, with the primary receiver in red.](/guide/library-reads.png)

### Try Other Routes for a Player (Routes Tab)

1. Click a player on the field (for example the slot, **2 SL1**).
2. Open **Routes**. You see every route in the game for that spot, grouped by type (Hitch, Curl, Post…). **Routes**,
   **Blocks**, **Backs**, **QB** and **All** switch the kind of assignment; the filter box finds one by name.
3. Click a route to preview it on the field (a **Preview** chip appears above the field).
4. Click **Use in Designer** to start a new play from this one with that route on that player.

![Previewing a hitch for the slot receiver in the Routes tab.](/guide/library-routes.png)

## Add a Play to a Playbook

1. Click **Add to Playbook…** (on the play, or in the bar after selecting a card).
2. Pick the playbook. Plays already in a playbook say **Already in Book** (the button then reads **Show in Book** and
   takes you to it).
3. Click **Add** (or double-click the playbook). **New Offense Playbook…** creates a new one on the spot.

![Add to Playbook: pick which playbook gets the play.](/guide/library-add-dialog.png)

The play goes into its own formation and set in that playbook; if the playbook doesn't have them yet, they're added
(before the special-teams sections). A message with an **Open** link takes you there. Remember to save the playbook
(⌘S).

## Use a Play as the Start of Your Own

**Clone in Designer** opens the [Designer](#/help/designer) with this play as the base: same formation, same set,
same handoffs and protection. Change the routes, blocks, motion and the red route there.

You can't edit a game play in place. Your changes always become a new play with its own name, so the original stays
in the game untouched.
