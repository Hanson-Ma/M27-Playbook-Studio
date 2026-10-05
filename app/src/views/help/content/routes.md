# Routes, Cuts & My Routes

Everything about a receiver's route happens on the **Route** tab of the [Designer](#/help/designer): pick a
ready-made route, draw your own point by point, choose how he cuts at each corner, and save routes you like to reuse
them on any play.

## Pick a Ready-Made Route

1. Select a receiver (click him on the field).
2. Under **Pick a Route**, click a route: Slant, Flat, Out, In / Dig, Curl, Comeback, Hitch, Corner, Post, Go, Fade,
   Seam, Wheel, Drag / Shallow, Whip, Snag, Arrow, Angle, Swing or Bubble.

The tiles are drawn from that player's spot, and they already know his side of the field: the note above them says,
for example, *Right side · "out" = toward the sideline*. A tile marked **Off Field** would carry him past the
sideline from where he lines up.

![The Corner preset on the slot receiver: a stem, a 45° speed cut, then the break to the corner.](/guide/designer-route-preset.png)

Want more choice? **Browse Game Routes…** at the bottom of the tab lists the 5,400 routes from the game's own plays,
drawn from this player's spot.

## Draw or Reshape a Route

The route on the field has **white points**: one at each corner and one at the end.

- **Drag a white point** to move that corner or the end of the route.
- Click the **+** in the middle of a leg to add a point there (or use **Add Point** above the field).
- Click a point to select it, then **Delete Point** (or press Delete) to remove it.
- **Draw Route** extends the route: while it's on (the button reads **Drawing On**), every click on the field adds a
  point at the end of the route. Double-click, press Esc or click the button again to stop.
- **Clear Route** removes the whole route and turns **Draw Route** on, so your next clicks draw a new route from the
  player's spot. His spot, motion and release stay. ⌘Z brings the old route back.
- Points snap to half yards and 5° angles. Click **Snap to Grid** for free placement, or hold **Alt** while dragging.

:::tip Start Close, Then Shape It
The quickest way to a new route is the preset that's closest to it: pick it, then drag, add or delete points. To draw
one from scratch, click **Clear Route** and click the corners on the field, then press Esc. **Reset Player** goes
back to the base play's route.
:::

Every segment between two points is one **leg** of the route. The **Route Points** list on the right shows each leg's
length (**YD**), direction (**DIR**: 90° is straight upfield, 0° toward the right sideline, 180° toward the left) and
speed (**SPD**, 0–100; a stem at 80 and the break at 100 sells the cut). Type in these boxes for exact numbers.

![Route Points: each leg's yards, direction and speed, its cut, and what he does at the end.](/guide/designer-route-points.png)

What the receiver does when the route ends: **Find Space** (keep working to get open), **Sit** (stop and wait) or
**None**.

## Cuts: How the Receiver Turns

At every corner the receiver makes a **cut**. The cut changes how sharp the break is, and the app draws it the way it
looks on the field, so you can see the difference on the play art:

![The five cut styles and how the app draws them.](/guide/cut-legend-2x.png)

| Looks Like | Cut Style | Cuts in the Menu |
|:--|:--|:--|
| Rounded corner | **Speed cut**: bends the route without slowing down | Speed Cut 22°, Speed Cut 45° |
| Sharp corner | **Hard cut**: plants and breaks | Hard Cut 67°, Hard Cut 90°, Hard Cut 90° (Inside) |
| Small zig at the corner | **Double move**: sells a fake, then keeps going | Stutter, Stutter-Go, Slant-and-Go, Hitch-and-Go, Out-and-Up, Stick-Nod, Post-Corner, Zig, Shake, Hesitation |
| Hook back toward the ball | **Turn back**: stops and comes back | Curl, Comeback, Hinge Comeback, Turn Back 180°, Partial Turn Back, Smash, Quick Smash |
| Short bar across the end | **Settle**: stops in the open space | Settle (Drag Stop) |

### Change a Cut

1. **Right-click a corner point** of the route (or select it and click **Cut…** above the field).
2. Pick a cut. The menu shows the same icons as the legend above. **Fit the Turn** picks the cut that matches the
   angle you drew; **No Cut** removes it.

![The cut menu for the corner of a route: speed cuts, hard cuts, turn backs and double moves.](/guide/designer-cut-picker.png)

The chip next to each leg in **Route Points** (for example **Speed Cut 45°** or **No Cut**) shows the cut at the end of
that leg; click it to change the cut there too.

:::note Speed and Hard Cuts Follow the Angle
When you drag a point, the speed or hard cut (22°, 45°, 67°, 90°) at the corners next to it is re-picked to match
the new angle. Named cuts (curl, comeback, stutter, smash…) stay as you chose them. So shape the route first, then
pick a sharper or softer cut if you want one.
:::

Here's every cut on a real route, drawn by the app the same way the play art shows it:

![Each cut on a route for the right-side receiver: speed cuts, hard cuts, turn backs, a settle and double moves.](/guide/cuts-gallery.png)

![A whole play with each cut style, as it appears on the field and on play cards.](/guide/cut-showcase.png)

## Double Moves

Click **Double Moves** (*fake, then go*) on the **Route** tab to open complete double-move routes: **Stutter**, **Stutter-Go**,
**Slant-and-Go**, **Hitch-and-Go (In)**, **Hitch-and-Go (Out)**, **Out-and-Up**, **Stick-Nod** and **Zig**. Click
one to put it on the player, then drag its points like any other route. You can also turn any corner into a double
move with the cut menu.

![The double-move presets.](/guide/designer-double-moves.png)

## Releases

A **release** is the receiver's first step off the line, before the stem: straight, inside (toward the ball) or
outside. Set it on the player's **Advanced** tab under **Release**, with an optional quick start. The rest of the route
stays where it is.

## A Route That Runs Out of Bounds

If a route crosses the sideline from where the player lines up (common when a route drawn for a slot receiver is put
on a wide receiver), a notice appears above the route tools with **Fit to Field**. It shortens only the legs that
head for the sideline, so the cuts and the depth stay as you drew them. **Export** lists such a route as a warning.

## My Routes

**My Routes** is your own route library. Save a route once and put it on any player in any play.

### Save a Route

1. Select the player whose route you like.
2. Click **Save Route to My Routes** in his header (or right-click him → **Save Route to My Routes…**).
3. Give it a name and click **Save Route**.

![Name the route; it can then go on any player in any play.](/guide/myroutes-save-dialog.png)

The route is saved at once in `app-data/routes.json`; there's nothing else to save. Only the route itself is kept
(not motion or the player's spot). Name routes by what they do ("Deep Dig 14", "Whip vs Man", "Bang 8 Post"): you'll
find them faster later.

### Use a Saved Route

1. In any play, select a receiver.
2. Under **My Routes** on the **Route** tab (below the ready-made routes; scroll down), click the route's tile.

Each tile is drawn from the selected player's spot. A route saved for a player on the right is **mirrored
automatically** for a player on the left (an in-breaking route stays in-breaking, and the tile says **Flipped**), so
one saved route works on both sides.

![My Routes for the left receiver: "Deep Dig 12", saved from the right side, is flipped for him.](/guide/myroutes-list.png)

![The same route put on WR1: it breaks inside, toward the ball.](/guide/myroutes-applied.png)

Your saved routes also appear in the library's **Routes** tab (switch the source to **My Routes**).

### Rename, Reorder or Delete

Right-click a tile in **My Routes**: **Use for This Player**, **Rename…**, **Move Earlier**, **Move Later** or
**Delete…**. Deleting a saved route doesn't change plays that already use it.
