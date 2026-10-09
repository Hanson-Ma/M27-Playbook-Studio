using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace PlayDump
{
    // Finds MMC Editor and Madden 27 without hardcoded paths (shared with Playbook Builder; no Frosty types here).
    public static class GamePaths
    {
        public const string GameFolderName = "Madden NFL 27";
        public const string GameExe = "Madden27.exe";

        public static bool IsEditorDir(string dir) =>
            !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "MMCEditor.exe")) && File.Exists(Path.Combine(dir, "FrostySdk.dll"))
            && File.Exists(Path.Combine(dir, "Profiles", "MADDEN27SDK.dll"));

        public static bool IsGameDir(string dir) => !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, GameExe));

        public static bool HasCache(string editorDir) => File.Exists(Path.Combine(editorDir, "Caches", "madden27.cache"));

        public static Version EditorVersion(string dir)
        {
            var m = Regex.Match(Path.GetFileName(dir.TrimEnd('\\', '/')), @"v?(\d+(\.\d+){1,3})$", RegexOptions.IgnoreCase);
            return m.Success && Version.TryParse(m.Groups[1].Value, out Version v) ? v : new Version(0, 0);
        }

        // Windows keeps the path of every program you've launched (MuiCache), so a used MMC Editor is found instantly;
        // then the usual download spots. Newest version wins.
        public static string FindEditor()
        {
            var found = new List<string>();
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache"))
                    foreach (string name in key?.GetValueNames() ?? new string[0])
                    {
                        int i = name.IndexOf("MMCEditor.exe", StringComparison.OrdinalIgnoreCase);
                        if (i > 0) found.Add(Path.GetDirectoryName(name.Substring(0, i + "MMCEditor.exe".Length)));
                    }
            }
            catch { }
            string user = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var roots = new List<string> { Path.Combine(user, "Downloads"), Path.Combine(user, "Desktop"), Path.Combine(user, "Documents"),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) };
            roots.AddRange(DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed && d.IsReady).Select(d => d.RootDirectory.FullName));
            foreach (string root in roots) found.AddRange(Search(root, 3));
            return found.Distinct(StringComparer.OrdinalIgnoreCase).Where(IsEditorDir).OrderByDescending(EditorVersion).FirstOrDefault();
        }

        static IEnumerable<string> Search(string dir, int depth)
        {
            if (depth < 0) yield break;
            if (File.Exists(Path.Combine(dir, "MMCEditor.exe"))) { yield return dir; yield break; }
            string[] subs;
            try { subs = Directory.GetDirectories(dir); }
            catch { yield break; }
            foreach (string s in subs)
            {
                string n = Path.GetFileName(s);
                if (n.StartsWith("$") || n.StartsWith(".") || n.Equals("Windows", StringComparison.OrdinalIgnoreCase)) continue;
                // only descend where MMC is likely: its own folders, or shallow general folders
                if (depth == 0 && n.IndexOf("MMC", StringComparison.OrdinalIgnoreCase) < 0) continue;
                foreach (string hit in Search(s, depth - 1)) yield return hit;
            }
        }

        // MMC remembers each game's install folder in %LOCALAPPDATA%\MMC\editor_config.json ("Games" > "Madden27" > "GamePath").
        public static string FindGame()
        {
            var candidates = new List<string>();
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            foreach (string cfg in new[] { Path.Combine(local, "MMC", "editor_config.json"), Path.Combine(local, "MMC", "manager_config.json") })
            {
                try
                {
                    string text = File.ReadAllText(cfg);
                    foreach (Match m in Regex.Matches(text, "\"GamePath\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\""))
                        candidates.Add(Regex.Unescape(m.Groups[1].Value));
                }
                catch { }
            }
            foreach (string pf in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) })
            {
                candidates.Add(Path.Combine(pf, "EA Games", GameFolderName));
                candidates.Add(Path.Combine(pf, "Origin Games", GameFolderName));
                candidates.Add(Path.Combine(pf, "Steam", "steamapps", "common", GameFolderName));
            }
            return candidates.FirstOrDefault(IsGameDir);
        }
    }
}
