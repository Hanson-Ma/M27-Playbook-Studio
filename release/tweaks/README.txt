__GAME TWEAKS (practice start + motion snap) - test build 0.2.0__

Separate from FUSION: enable both in MMC Mod Manager (order doesn't matter, they touch different files).
Offline only. These are global house rules, so they apply to every mode; turn the mod off for regular games if needed.

1. Practice starts at midfield (experimental).
   Practice's default spot is the 30, which matches house rule GPCF_TOUCHBACK_SPOT (30). Set to 50.
   Side effect if it's the right setting: touchbacks in regular games also go to the 50 (kickoff touchbacks use a
   separate value, GPCF_TOUCHBACK_SPOT_KICKOFF = 25, which is unchanged).
   If practice still starts at the 30, this setting isn't it and the practice spot is set in code.

2. Motion snap on any motion (experimental).
   House rule GPCF_ALLOW_SNAP_TO_ANY false -> true. It sits with the motion rules (return during motion, auto pass block
   on motion snap). If motion snap still only works on some motions, the next step is per-play AutoMotionSnap steps.

v0.2.0: dropped the "Practice Field = indoor" redirect and the skip-kickoff yard line change from 0.1.0.

Rebuild: tools/PlayDump/bin/Release/PlayDump.exe tweaks mods/tweaks.fbproject mods/tweaks.fbmod mods/tweaks.json
