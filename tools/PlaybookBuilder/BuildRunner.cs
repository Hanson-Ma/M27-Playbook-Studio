using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

namespace PlaybookBuilder
{
    public sealed class BuildConfig
    {
        public string EditorDir, GameDir, PlaybookDir, OutputDir;
    }

    public enum StepState { Pending, Running, Done, Failed }

    public sealed class PlaybookInfo
    {
        public string File, Name, SaveName;
        public int Plays;
    }

    // The same four steps as tools/export.ps1 -Install: collect hidden library plays, build the mod (PlayDump),
    // write one save per playbook, copy the saves into Madden's saves folder (old copies go to backups\).
    public sealed class BuildRunner
    {
        public static readonly string[] Steps = { "Read your playbooks", "Build the mod", "Write playbook saves", "Copy to Madden saves" };
        public static string AppDir => AppDomain.CurrentDomain.BaseDirectory;
        public static string DataDir { get { string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PlaybookBuilder"); Directory.CreateDirectory(d); return d; } }
        public static string LogFile => Path.Combine(DataDir, "last-build.log");
        public static string SavesDir => Environment.GetEnvironmentVariable("PLAYBOOK_BUILDER_SAVES") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Madden NFL 27", "saves");

        public static bool IsPlaybookDir(string dir) =>
            !string.IsNullOrEmpty(dir) && Directory.Exists(Path.Combine(dir, "playbooks")) && File.Exists(Path.Combine(dir, "research", "index", "enums.json"))
            && File.Exists(Path.Combine(dir, "playbooks", "templates", "PBOOKOFF-TEMPLATE"));

        // the app usually sits inside the downloaded project (release\builder), so look upward first
        public static string FindPlaybookDir()
        {
            string d = AppDir;
            for (int i = 0; i < 6 && d != null; i++, d = Path.GetDirectoryName(d.TrimEnd('\\')))
                if (IsPlaybookDir(d)) return d;
            return null;
        }

        public static List<PlaybookInfo> Playbooks(string dir)
        {
            var list = new List<PlaybookInfo>();
            if (!IsPlaybookDir(dir)) return list;
            foreach (string f in Directory.GetFiles(Path.Combine(dir, "playbooks"), "*.json").Where(f => !Path.GetFileName(f).Equals("mod.json", StringComparison.OrdinalIgnoreCase)).OrderBy(f => f))
            {
                try
                {
                    var spec = PbookWriter.ReadJson(f);
                    string name = ((string)spec["name"]).ToUpperInvariant();
                    bool defense = spec.TryGetValue("side", out object s) && (string)s == "defense";
                    int plays = 0;
                    foreach (Dictionary<string, object> form in (IList)spec["formations"])
                        if (form["sets"] is IList sets) foreach (Dictionary<string, object> set in sets) plays += ((IList)set["plays"]).Count;
                    list.Add(new PlaybookInfo { File = f, Name = name, Plays = plays, SaveName = (defense ? "PBOOKDEF-" : "PBOOKOFF-") + name });
                }
                catch { }
            }
            return list;
        }

        // keycheck: PlayDump reads the profile key from this MMC install (isolated process: FrostyCore stays out of the app)
        public static string KeyCheck(string editorDir)
        {
            var (code, outText) = RunTool(new[] { "keycheck" }, new BuildConfig { EditorDir = editorDir }, null);
            return code == 0 && outText.Trim().StartsWith("ok") ? null : (outText.Trim().Split('\n').LastOrDefault() ?? "couldn't read the key");
        }

        static string Quote(string a) => a.Contains(" ") || a.Contains("\"") ? "\"" + a.Replace("\"", "\\\"") + "\"" : a;

        static (int, string) RunTool(string[] args, BuildConfig c, Action<string> onLine)
        {
            var psi = new ProcessStartInfo(Path.Combine(AppDir, "PlayDump.exe"), string.Join(" ", args.Select(Quote)))
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
            };
            if (c.EditorDir != null) psi.EnvironmentVariables["MMC_EDITOR_DIR"] = c.EditorDir;
            if (c.GameDir != null) psi.EnvironmentVariables["MADDEN27_DIR"] = c.GameDir;
            if (c.PlaybookDir != null) psi.EnvironmentVariables["PLAYDUMP_REPO"] = c.PlaybookDir;
            var all = new StringBuilder();
            using (var p = new Process { StartInfo = psi })
            {
                DataReceivedEventHandler h = (s, e) => { if (e.Data == null) return; lock (all) all.AppendLine(e.Data); onLine?.Invoke(e.Data); };
                p.OutputDataReceived += h; p.ErrorDataReceived += h;
                p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine();
                p.WaitForExit();
                return (p.ExitCode, all.ToString());
            }
        }

        public sealed class Result { public List<string> Installed = new List<string>(); public string ModFile; }

        public Result Run(BuildConfig c, Action<int, StepState, string> report)
        {
            using (var log = new StreamWriter(LogFile, false, Encoding.UTF8) { AutoFlush = true })
            {
                int step = -1;
                void Log(string s) { lock (log) log.WriteLine(s); }
                void Begin(int i) { step = i; report(i, StepState.Running, ""); Log("== " + Steps[i]); }
                try
                {
                    if (Process.GetProcessesByName(Path.GetFileNameWithoutExtension(PlayDump.GamePaths.GameExe)).Length > 0)
                        throw new InvalidOperationException("Madden is running. Close it, then build again.");
                    var books = Playbooks(c.PlaybookDir);
                    if (books.Count == 0) throw new InvalidOperationException("No playbooks found in " + Path.Combine(c.PlaybookDir, "playbooks"));
                    string build = Path.Combine(c.PlaybookDir, "build"), backups = Path.Combine(c.PlaybookDir, "backups");
                    Directory.CreateDirectory(build); Directory.CreateDirectory(backups); Directory.CreateDirectory(c.OutputDir);
                    string index = Path.Combine(c.PlaybookDir, "research", "index"), pull = Path.Combine(build, "pull-plays.json");
                    string template = Path.Combine(c.PlaybookDir, "playbooks", "templates", "PBOOKOFF-TEMPLATE");
                    File.Delete(pull);

                    Begin(0);
                    var collector = new PbookWriter(index);
                    foreach (var b in books) collector.Build(b.File, template, null, pull, true, Log);
                    report(0, StepState.Done, books.Count + (books.Count == 1 ? " playbook" : " playbooks"));

                    Begin(1);
                    string modFile = Path.Combine(c.OutputDir, "pbstudio.fbmod");
                    var args = new List<string> { "buildplays", Path.Combine(c.OutputDir, "pbstudio.fbproject"), modFile, Path.Combine(c.PlaybookDir, "playbooks", "mod.json") };
                    foreach (string sub in new[] { "sets", "plays" })
                    {
                        string d = Path.Combine(c.PlaybookDir, "playbooks", sub);
                        if (Directory.Exists(d)) args.AddRange(Directory.GetFiles(d, "*.json").OrderBy(f => f));
                    }
                    var (code, output) = RunTool(args.ToArray(), c, line => { Log(line); report(1, StepState.Running, Short(line)); });
                    if (code != 0) throw new InvalidOperationException(LastError(output) ?? "Building the mod failed.");
                    report(1, StepState.Done, Path.GetFileName(modFile));

                    // custom plays now exist: rebuild the index so saves can find them
                    Begin(2);
                    var writer = new PbookWriter(index);
                    var outs = new List<(PlaybookInfo, string)>();
                    foreach (var b in books)
                    {
                        string outFile = Path.Combine(build, b.SaveName);
                        Log(b.SaveName + ": " + writer.Build(b.File, template, outFile, pull, false, Log));
                        outs.Add((b, outFile));
                    }
                    report(2, StepState.Done, outs.Count.ToString());

                    Begin(3);
                    Directory.CreateDirectory(SavesDir);
                    var result = new Result { ModFile = modFile };
                    bool backedUp = false;
                    foreach (var (b, outFile) in outs)
                    {
                        string dest = Path.Combine(SavesDir, b.SaveName);
                        if (File.Exists(dest)) { File.Copy(dest, Path.Combine(backups, b.SaveName + "." + DateTime.Now.ToString("yyyyMMdd-HHmmss")), true); backedUp = true; }
                        File.Copy(outFile, dest, true);
                        Log("installed " + dest);
                        result.Installed.Add(b.Name);
                    }
                    report(3, StepState.Done, backedUp ? "old copies backed up" : "");
                    return result;
                }
                catch (Exception ex)
                {
                    Log("ERROR: " + ex);
                    if (step >= 0) report(step, StepState.Failed, "");
                    throw;
                }
            }
        }

        static string Short(string line)
        {
            line = line.Trim();
            if (line.StartsWith("Loading")) return "Reading the game…";
            if (line.StartsWith("pulled") || line.StartsWith("built") || line.StartsWith("cloned")) return "Building plays…";
            if (line.StartsWith("saved") || line.StartsWith("wrote")) return "Saving the mod…";
            return null;
        }

        static string LastError(string output)
        {
            var lines = output.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
            var err = lines.LastOrDefault(l => l.Contains("Exception:") || l.StartsWith("error", StringComparison.OrdinalIgnoreCase) || l.Contains("not found") || l.Contains("unknown"));
            if (err == null) return lines.LastOrDefault();
            int i = err.IndexOf("Exception:");
            return i >= 0 ? err.Substring(i + "Exception:".Length).Trim() : err;
        }
    }
}
