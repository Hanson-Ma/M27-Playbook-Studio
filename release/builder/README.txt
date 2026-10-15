__PLAYBOOK BUILDER__

Turns the playbooks you make in Playbook Studio into a mod and playbook saves for Madden NFL 27. Offline only.

You need: Windows 10 or 11, Madden NFL 27 (PC), and the MMC Modding Tools (Editor + Mod Manager).
Nothing to install: keep this folder inside the project you downloaded, and double-click "Playbook Builder.exe".


__FIRST TIME__

1. Open Madden once in MMC Editor and let it finish loading, then close MMC Editor.
2. Open Playbook Builder. It finds MMC Editor, Madden and the game key on its own.
   Anything it can't find shows a red X: click Locate... next to it.
3. Check the playbook folder (the folder containing your playbook mod) and where the mod files should go.


__EVERY TIME__

1. Close Madden.
2. If you have more than one playbook, pick the one to build (the app remembers it).
3. Click Build and install (about a minute). The mod is named after the playbook: FUSION makes fusion.fbmod and fusion.fbproject.
4. In MMC Mod Manager: add or refresh that .fbmod, Apply, then Launch. Only one playbook mod can be on at a time (they edit the same game files), so untick any other, including an old pbstudio.fbmod.
5. Pick your playbook in an offline mode.

Old copies of your playbook saves are backed up to the backups folder before they're replaced.
If a build fails, Show log opens the details.


__FILES__

Playbook Builder.exe   the app
PlayDump.exe           builds the mod (the app runs it for you)
(the window font, Public Sans, is built into the exe)

Settings are remembered in %LOCALAPPDATA%\PlaybookBuilder.
