__GAME TWEAKS (motion snap) - test build 0.3.0__

Separate from FUSION: enable both in MMC Mod Manager (order doesn't matter, they touch different files).
Offline only. This is a global house rule, so it applies to every mode; turn the mod off for regular games if needed.

1. Motion snap on any motion (experimental).
   House rule GPCF_ALLOW_SNAP_TO_ANY false -> true. It sits with the motion rules (return during motion, auto pass block
   on motion snap). If motion snap still only works on some motions, the next step is per-play AutoMotionSnap steps.

v0.3.0: dropped the practice start spot experiments. Neither the no-kickoff yard line (0.1) nor the touchback spot (0.2)
moved practice off the 30, and the touchback spot would also have moved touchbacks in real games. Practice's starting
spot is set by the game's code, not by a data file.

Rebuild: tools/PlayDump/bin/Release/PlayDump.exe tweaks mods/tweaks.fbproject mods/tweaks.fbmod mods/tweaks.json
