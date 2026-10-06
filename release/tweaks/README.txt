__GAME TWEAKS (practice + motion snap) - test build 0.1.0__

Separate from FUSION: enable both in MMC Mod Manager (order doesn't matter, they touch different files).
Offline only.

1. Practice starts at midfield.
   House rule GPCF_SKIP_KICKOFF_YARDLINE -25 -> 0 (the spot a drive starts from when there's no kickoff; -25 = own 25).
   Also applies to any game played with kickoffs skipped.

2. "Practice Field" loads the indoor practice facility.
   Stadium id 34 (Practice Field) now points at the Indoor Practice level, so the default practice pick is indoors.
   The outdoor practice field is no longer reachable while this mod is on.

3. Motion snap on any motion (experimental).
   House rule GPCF_ALLOW_SNAP_TO_ANY false -> true. It sits with the motion rules (return during motion,
   auto pass block on motion snap); if motion snap still only works on some motions, this flag means something else
   and the next step is per-play AutoMotionSnap steps.

Rebuild: tools/PlayDump/bin/Release/PlayDump.exe tweaks mods/tweaks.fbproject mods/tweaks.fbmod mods/tweaks.json
