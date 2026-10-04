# Routes, cuts & My Routes

Everything about a receiver's route happens on the **ROUTE** tab of the [Designer](#/help/designer): pick a
ready-made route, draw your own point by point, choose how he cuts at each corner, and save routes you like to reuse
them on any play.

## Pick a ready-made route

1. Select a receiver (click him on the field).
2. Under **PICK A ROUTE**, click a route: Slant, Flat, Out, In / Dig, Curl, Comeback, Hitch, Corner, Post, Go, Fade,
   Seam, Wheel, Drag / Shallow, Whip, Snag, Arrow, Angle, Swing or Bubble.

The tiles are drawn from that player's spot, and they already know his side of the field: the note above them says,
for example, *Right side · "out" = toward the sideline*. A tile marked **OFF FIELD** would carry him past the
sideline from where he lines up.

![The Corner preset on the slot receiver: a stem, a 45° speed cut, then the break to the corner.](/guide/designer-route-preset.png)

Want more choice? **BROWSE GAME ROUTES…** at the bottom of the tab lists the 5,400 routes from the game's own plays,
drawn from this player's spot.

## Draw or reshape a route

The route on the field has **white points**: one at each corner and one at the end.

- **Drag a white point** to move that corner or the end of the route.
- Click the **+** in the middle of a leg to add a point there (or use **ADD POINT** above the field).
- Click a point to select it, then **DELETE POINT** (or press Delete) to remove it.
- **DRAW ROUTE** extends the route: while it's on (the button reads **DRAWING ON**), every click on the field adds a
  point at the end of the route. Double-click, press Esc or click the button again to stop.
- **CLEAR ROUTE** removes the whole route and turns **DRAW ROUTE** on, so your next clicks draw a new route from the
  player's spot. His spot, motion and release stay. ⌘Z brings the old route back.
- Points snap to half yards and 5° angles. Click **SNAP TO GRID** for free placement, or hold **Alt** while dragging.

:::tip Start close, then shape it
The quickest way to a new route is the preset that's closest to it: pick it, then drag, add or delete points. To draw
one from scratch, click **CLEAR ROUTE** and click the corners on the field, then press Esc. **RESET PLAYER** goes
back to the base play's route.
:::

Every segment between two points is one **leg** of the route. The **ROUTE POINTS** list on the right shows each leg's
length (**YD**), direction (**DIR**: 90° is straight upfield, 0° toward the right sideline, 180° toward the left) and
**SPEED** (0–100; a stem at 80 and the break at 100 sells the cut). Type in these boxes for exact numbers.

![ROUTE POINTS: each leg's yards, direction and speed, its cut, and what he does at the end.](/guide/designer-route-points.png)

What the receiver does when the route ends: **FIND SPACE** (keep working to get open), **SIT** (stop and wait) or
**NONE**.

## Cuts: how the receiver turns

At every corner the receiver makes a **cut**. The cut changes how sharp the break is, and the app draws it the way it
looks on the field, so you can see the difference on the play art:

![The five cut styles and how the app draws them.](/guide/cut-legend-2x.png)

| Looks like | Cut style | Cuts in the menu |
|:--|:--|:--|
| Rounded corner | **Speed cut**: bends the route without slowing down | Speed cut 22°, Speed cut 45° |
| Sharp corner | **Hard cut**: plants and breaks | Hard cut 67°, Hard cut 90°, Hard cut 90° (inside) |
| Small zig at the corner | **Double move**: sells a fake, then keeps going | Stutter, Stutter-go, Slant-and-go, Hitch-and-go, Out-and-up, Stick-nod, Post-corner, Zig, Shake, Hesitation |
| Hook back toward the ball | **Turn back**: stops and comes back | Curl, Comeback, Hinge comeback, Turn back 180°, Partial turn back, Smash, Quick smash |
| Short bar across the end | **Settle**: stops in the open space | Settle (drag stop) |

### Change a cut

1. **Right-click a corner point** of the route (or select it and click **CUT…** above the field).
2. Pick a cut. The menu shows the same icons as the legend above. **Fit the turn** picks the cut that matches the
   angle you drew; **No cut** removes it.

![The cut menu for the corner of a route: speed cuts, hard cuts, turn backs and double moves.](/guide/designer-cut-picker.png)

The chip next to each leg in ROUTE POINTS (for example **SPEED CUT 45°** or **NO CUT**) shows the cut at the end of
that leg; click it to change the cut there too.

:::note Speed and hard cuts follow the angle
When you drag a point, the speed or hard cut (22°, 45°, 67°, 90°) at the corners next to it is re-picked to match
the new angle. Named cuts (curl, comeback, stutter, smash…) stay as you chose them. So shape the route first, then
pick a sharper or softer cut if you want one.
:::

Here's every cut on a real route, drawn by the app the same way the play art shows it:

![Each cut on a route for the right-side receiver: speed cuts, hard cuts, turn backs, a settle and double moves.](/guide/cuts-gallery.png)

![A whole play with each cut style, as it appears on the field and on play cards.](/guide/cut-showcase.png)

## Double moves

Click **DOUBLE MOVES** (*fake, then go*) on the ROUTE tab to open complete double-move routes: **Stutter**, **Stutter-go**,
**Slant-and-go**, **Hitch-and-go (in)**, **Hitch-and-go (out)**, **Out-and-up**, **Stick-nod** and **Zig**. Click
one to put it on the player, then drag its points like any other route. You can also turn any corner into a double
move with the cut menu.

![The double-move presets.](/guide/designer-double-moves.png)

## Releases

A **release** is the receiver's first step off the line, before the stem: straight, inside (toward the ball) or
outside. Set it on the player's **ADVANCED** tab under **RELEASE**, with an optional quick start. The rest of the route
stays where it is.

## A route that runs out of bounds

If a route crosses the sideline from where the player lines up (common when a route drawn for a slot receiver is put
on a wide receiver), a notice appears above the route tools with **Fit to field**. It shortens only the legs that
head for the sideline, so the cuts and the depth stay as you drew them. **EXPORT** lists such a route as a warning.

## My Routes

**My Routes** is your own route library. Save a route once and put it on any player in any play.

### Save a route

1. Select the player whose route you like.
2. Click **SAVE ROUTE TO MY ROUTES** in his header (or right-click him → **Save route to My Routes…**).
3. Give it a name and click **SAVE ROUTE**.

![Name the route; it can then go on any player in any play.](/guide/myroutes-save-dialog.png)

The route is saved at once in `app-data/routes.json`; there's nothing else to save. Only the route itself is kept
(not motion or the player's spot). Name routes by what they do ("Deep Dig 14", "Whip vs Man", "Bang 8 Post"): you'll
find them faster later.

### Use a saved route

1. In any play, select a receiver.
2. Under **MY ROUTES** on the ROUTE tab (below the ready-made routes; scroll down), click the route's tile.

Each tile is drawn from the selected player's spot. A route saved for a player on the right is **mirrored
automatically** for a player on the left (an in-breaking route stays in-breaking, and the tile says **FLIPPED**), so
one saved route works on both sides.

![MY ROUTES for the left receiver: "Deep Dig 12", saved from the right side, is flipped for him.](/guide/myroutes-list.png)

![The same route put on WR1: it breaks inside, toward the ball.](/guide/myroutes-applied.png)

Your saved routes also appear in the library's ROUTES tab (switch the source to **MY ROUTES**).

### Rename, reorder or delete

Right-click a tile in MY ROUTES: **Use for this player**, **Rename…**, **Move earlier**, **Move later** or
**Delete…**. Deleting a saved route doesn't change plays that already use it.
