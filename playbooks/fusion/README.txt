__FUSION OFFENSE - MADDEN 27 PORT (v2.0.0, test build)__

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


__WHAT CARRIED OVER__

- All 29 offensive sets with their M24 alignments (Empty Flex, Close Y-Off, Stack, Trey Row, ...), under the same formations.
- Pass plays: every route rebuilt from the M24 route data, including option routes, cuts, delays,
  at-snap motions (JW / JF / YM / FM / BM ...), the red route and the read progression.
- Runs and options: the closest Madden 27 play (HB Stretch, Inside Zone Split, Power O, Read Option, Jet Sweep, ...),
  cloned into your set. M24 motion fakes on runs were kept where the M27 play had none.
- Audibles (125) and CPU play-call weights.
- Special teams, kickoffs and safety kicks are the stock Madden 27 ones.


__KNOWN LIMITS__

- QB drops, play-action fakes and RPO reads come from a Madden 27 play of the same kind, so a boot may roll the other way.
- "IGNORE" (Bingo Cross) and the M24 custom kickoffs/punts were left out.
- Some sets had two plays on the same audible slot in M24; the second one lost its audible.
