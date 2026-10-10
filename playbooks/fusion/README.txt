__FUSION OFFENSE - MADDEN 27 PORT (v2.4.0, test build)__

Ported from the Madden 24 FUSION mod (hansonma.org/projects/fusion).
Offline only.


__WHAT'S IN THIS FOLDER__

fusion.fbmod       the mod (custom sets + plays, registered in the game's global play sheet)
fusion.fbproject   the same thing as an MMC Editor project, if you want to inspect or tweak it
PBOOKOFF-FUSION    the custom playbook save (already copied to Documents\Madden NFL 27\saves)
preview.html       play art for every play, drawn from the port data (open in a browser)
port-report.md     what each set and play was built from, plus every approximation


__HOW TO INSTALL__

1. Open MMC Mod Manager, add "fusion.fbmod", tick it, and give it the highest priority.
   Untick "pbstudio.fbmod" (and any other playbook mod): they edit the same global play sheet.

2. Apply mods, then launch the game.

3. PBOOKOFF-FUSION is already in Documents\Madden NFL 27\saves.
   (If it's missing, copy it there from this folder.)

4. Pick FUSION as your custom offense before an OFFLINE game.


__v2.4 (test build 5)__

Singleback Tight Doubles
- JW PA Boot: plain HB fake and boot again, no jet fake.
- JW PA Curl: the HB blocks after the fake.
- J PA WR Screen: the motion snaps a hair earlier; the LT and LG release to lead the screen (EA's PA WR screen line).
- Jet Counter Wk: the motion snaps a bit later so the WR clears the QB.
- Jet Dive: the motion snaps earlier and stays flatter (shallower motion, straight across after the snap).

Singleback Bunch Close
- JW PA CW: plain HB zone fake (no jet fake) and the regular wheel.
- JW RPO PW: the slant breaks 2 yards shorter.
- JW PA Shallow Cross, and every play with the jet + HB double fake: the line pass protects. The double fake holds the
  QB longer, and EA's run-action line was leaving the edge open.

Singleback Bunch TE
- JW PA Y Cross: plain HB zone weak fake, no jet fake.
- PA P Y Curl: the LT pass sets and takes the edge rusher.
- PA Dagger Zig: zone right play action.
- RPO Bubble: the blocking WRs run block from the snap instead of freezing until the throw.
  Same for the other bubble RPOs (Stack Y-Off, Pistol Trey Row, Gun Bunch, Gun Stack Y-Off Wk).

Singleback Deuce Close
- Jet Sweep: fixed (the QB ran forward without handing off). It now uses EA's own Deuce Close jet sweep, timed
  for a jet starting 5 yards out like ours.

Everywhere
- PA plays where the M24 back fakes and then blocks now do that; 14 of them had the back running EA's route instead.


__v2.3 (test build 4)__

- HB Wham (Stack Y-Off) and YM Wham (Deuce Close) are gone.
- PA Cross Mesh (was YM PA Cross Mesh, Deuce Close): a plain zone split PA. No Y motion; the Y comes across
  behind the line away from the fake and blocks.
- JW PA plays use Madden 27's jet sweep play action: the QB fakes the jet AND the HB, then the jet man keeps going
  on his wheel. Boots still boot after both fakes. Not available for JW PA Drive (Pistol Trey Row) and
  JW PA Verticals (Gun Doubles Tight): Madden 27 has no jet + HB fake from those backfields, so they keep the HB-only fake.
- BM bursts: the ball snaps a touch earlier and the burst keeps moving through the snap instead of settling first.


__v2.2 (test build 3)__

- Wham: the TE stays in his spot and runs the stock wham (step back, across, wham block); WRs stay on the line.
  YM plays fake the same wham motion.
- Run plays: outside WRs release upfield and stalk; inside WRs and TEs run block.
- Sled: the TE chips and releases wider to lead block; the HB runs a straight, slightly slower flat.
- BM bursts motion to just outside and behind the on-line WR (or flexed TE) for a clean release.
- RPO Stick plays are suggested for short yardage and goal line.


__v2.1 (test build 2)__

- Custom sets now show up (set ids were misregistered in v2.0, so the game showed stock sets).
- Motions use the M24 targets: jet motions cross to the QB and continue across at the snap (JW/JF/JR/JB),
  burst/exit/return/Y motions as designed.
- Your M24 motion presets for every set (M1-M5 left/right, SM1), so FM/FME/FMH/FMO plays motion where you set them.
- PA, boots, RPOs and runs take their QB/HB mechanics from an M27 play with the same handoff animation as M24:
  every boot rolls the same way as in M24, and RPOs mesh on the exact QB/HB spots (one or two pass options).
- PM plays start with the back pre-shifted to the other side; Tush Push stacks both backs behind the QB.
- Cloned M27 plays no longer shift your players before the snap (the jet sweep realignment).
- "P" plays get a pulling guard.
- Situational play calling for every play (red zone for RZ, short yardage, 3rd & long, 2-minute, goal line, Hail Mary).
- Home menu order: Singleback, I-Form, Pistol, Shotgun, Goal Line, Hail Mary, Special Teams.


__WHAT CARRIED OVER__

- All 29 offensive sets with their M24 alignments (Empty Flex, Close Y-Off, Stack, Trey Row, ...), under the same formations.
- Pass plays: every route rebuilt from the M24 route data, including option routes, cuts, delays,
  at-snap motions (JW / JF / YM / FM / BM ...), the red route and the read progression.
- Runs and options: the closest Madden 27 play (HB Stretch, Inside Zone Split, Power O, Read Option, Jet Sweep, ...),
  cloned into your set. M24 motion fakes on runs were kept where the M27 play had none.
- Audibles (125) and situational play calling.
- Special teams, kickoffs (each onside kick in its own set) and safety kicks are the stock Madden 27 ones.


__KNOWN LIMITS__

- 24 of 156 PA/RPO/run plays use an M24 handoff that M27 doesn't have; they use the closest M27 play with the
  same name and an exact backfield fit (listed in port-report.md, "Terminology audit").
- One Jet Touch Pass (Empty set) has no M27 version with the same ball carrier.
- "IGNORE" (Bingo Cross) and the M24 custom kickoffs/punts were left out.
- Some sets had two plays on the same audible slot in M24; the second one lost its audible.
