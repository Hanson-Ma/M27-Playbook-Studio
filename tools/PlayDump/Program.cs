using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using FrostySdk;
using FrostySdk.Ebx;
using FrostySdk.Interfaces;
using FrostySdk.IO;
using FrostySdk.Managers;
using FrostySdk.Managers.Entries;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PlayDump
{
    // Headless, read-only access to Madden 27 game data through the MMC Editor's FrostySdk.
    // Boots the same way FrostyEditor.Windows.SplashWindow.LoadData does, then dumps EBX assets to JSON.
    internal static class Program
    {
        const string DefaultEditorDir = @"P:\Dropbox\Projects\Madden Modding\MMC_Modding_Tools_v1.1.0.4\MMC_Editor_v1.1.0.4";
        const string DefaultGameDir = @"W:\Games\Origin Games\Madden NFL 27";
        const string Profile = "Madden27";

        static string editorDir;
        static string repoDir;
        static AssetManager am;

        static int Main(string[] args)
        {
            editorDir = Environment.GetEnvironmentVariable("MMC_EDITOR_DIR") ?? DefaultEditorDir;
            string gameDir = Environment.GetEnvironmentVariable("MADDEN27_DIR") ?? DefaultGameDir;
            AppDomain.CurrentDomain.AssemblyResolve += ResolveFromEditor;
            // Boot() switches the working directory to the editor, so pin caller-relative paths first.
            repoDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", ".."));
            if (args.Length > 1 && (args[0] == "dump" || args[0] == "oracle" || args[0] == "index" || args[0] == "library")) args[1] = Path.GetFullPath(args[1]);
            if (args[0] == "buildplays")
                for (int i = 1; i < args.Length; i++)
                {
                    try { args[i] = Path.GetFullPath(args[i]); }
                    catch (Exception ex) { throw new ArgumentException($"bad path argument {i}: [{args[i]}]", ex); }
                }
            if (args.Length == 0)
            {
                Console.Error.WriteLine("usage:\n  PlayDump types [regex]\n  PlayDump list <Type> [nameRegex]\n  PlayDump dump <outDir> <nameRegex> [--type T] [--max N] [--follow N]");
                return 1;
            }
            return Run(args, gameDir);
        }

        // Kept separate so FrostySdk types are only touched after the resolver is installed.
        static int Run(string[] args, string gameDir)
        {
            bool writes = args[0] == "oracle" || args[0] == "buildplays";
            Boot(gameDir, writes);
            switch (args[0])
            {
                case "types": return CmdTypes(args.Length > 1 ? args[1] : ".");
                case "list": return CmdList(args[1], args.Length > 2 ? args[2] : ".");
                case "dump": return CmdDump(args.Skip(1).ToArray());
                case "bundles": return CmdBundles(args.Skip(1).ToArray());
                case "index": return CmdIndex(args[1]);
                case "library": return LibraryExport.Run(am, args[1]);
                case "closure": return CmdClosure(args[1], args.Skip(2).ToArray());
                case "oracle": return Oracle.Run(am, args[1]);
                case "buildplays":
                    // buildplays <out.fbproject> <out.fbmod> <mod.json> <plays spec...>
                    // One combined mod: every play mod edits GlobalPlaySheet, so separate mods would overwrite each other.
                    var spec = Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(args[3]));
                    var all = new Newtonsoft.Json.Linq.JArray();
                    foreach (string f in args.Skip(4))
                        foreach (var play in Newtonsoft.Json.Linq.JObject.Parse(File.ReadAllText(f))["plays"]) all.Add(play);
                    spec["plays"] = all;
                    new PlayBuilder(am, spec, Path.Combine(repoDir, "research", "index"))
                        .Run(args[1], args[2], Path.Combine(repoDir, "research", "index", "custom-plays.tsv"));
                    return 0;
                default: Console.Error.WriteLine("unknown command " + args[0]); return 1;
            }
        }

        static readonly Dictionary<string, Assembly> resolved = new Dictionary<string, Assembly>();

        static Assembly ResolveFromEditor(object sender, ResolveEventArgs e)
        {
            string name = new AssemblyName(e.Name).Name;
            if (resolved.TryGetValue(name, out Assembly hit)) return hit;
            resolved[name] = null; // reentrancy guard: a nested request for the same name falls through
            if (Environment.GetEnvironmentVariable("PLAYDUMP_TRACE") == "1") Console.Error.WriteLine("resolve " + name);
            string path = null;
            if (name == "EbxClasses")
                path = Path.Combine(editorDir, "Profiles", "MADDEN27SDK.dll");
            else
                path = new[] { editorDir, Path.Combine(editorDir, "ThirdParty"), Path.Combine(editorDir, "Profiles") }
                    .Select(d => Path.Combine(d, name + ".dll")).FirstOrDefault(File.Exists);
            Assembly asm = path == null ? null : Assembly.LoadFrom(path);
            resolved[name] = asm;
            return asm;
        }

        // editorGlobals: also stand up what Frosty.Core needs to save projects (config, plugins, App statics),
        // mirroring FrostyEditor.App and FrostyProfileTaskWindow. The editor config is loaded but never saved.
        static void Boot(string gameDir, bool editorGlobals)
        {
            // FrostySdk resolves Profiles/, Caches/ and thirdparty/ relative to the working directory.
            Environment.CurrentDirectory = editorDir;
            var log = new StderrLogger();
            if (editorGlobals) EditorGlobals.Start(log);
            ProfilesLibrary.Initialize(editorGlobals ? EditorGlobals.Profiles : new List<Profile>());
            ProfilesLibrary.Initialize(Profile);
            // MMC Editor stages a regenerated SDK (after a game patch) in TmpProfiles and swaps it in on its next start,
            // and TypeLibrary.Initialize would perform that swap. That's the editor's job: refuse instead of touching its files.
            string pendingSdk = Path.Combine(editorDir, "TmpProfiles", ProfilesLibrary.SDKFilename + ".dll");
            if (File.Exists(pendingSdk))
                throw new InvalidOperationException("MMC Editor has a pending SDK update (" + pendingSdk + "). Close MMC Editor, start it once " +
                    "so it installs the new SDK and rebuilds its cache, close it again, then rerun.");

            byte[] key1 = null;
            if (ProfilesLibrary.RequiresKey)
            {
                // Same Key1 that Frosty.Core.Windows.FrostyProfileTaskWindow hardcodes; kept in a gitignored local file.
                string keyFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "key1.local.bin");
                if (!File.Exists(keyFile))
                    throw new FileNotFoundException("Profile requires Key1; expected it at " + Path.GetFullPath(keyFile));
                key1 = File.ReadAllBytes(keyFile);
                KeyManager.Instance.AddKey("Key1", key1);
            }

            var fs = new FileSystemManager(gameDir.TrimEnd('\\') + "\\");
            foreach (FileSystemSource src in ProfilesLibrary.Sources)
                fs.AddSource(src.Path, src.SubDirs);
            fs.Initialize(key1);
            var rm = new ResourceManager(fs);
            rm.SetLogger(log);
            rm.Initialize();
            am = new AssetManager(fs, rm);
            TypeLibrary.Initialize();
            if (editorGlobals) EditorGlobals.Attach(fs, rm, am);
            am.SetLogger(log);
            am.Initialize(additionalStartup: true, new AssetManagerImportResult());
            log.Log("Loaded {0} ({1} ebx)", ProfilesLibrary.DisplayName, am.EnumerateEbx().Count());
        }

        static int CmdTypes(string regex)
        {
            var re = new Regex(regex, RegexOptions.IgnoreCase);
            foreach (var g in am.EnumerateEbx().GroupBy(e => e.Type).Where(g => re.IsMatch(g.Key)).OrderBy(g => g.Key))
                Console.WriteLine($"{g.Count(),7}  {g.Key}");
            return 0;
        }

        static int CmdList(string type, string regex)
        {
            var re = new Regex(regex, RegexOptions.IgnoreCase);
            foreach (var e in am.EnumerateEbx(type).Where(e => re.IsMatch(e.Name)).OrderBy(e => e.Name))
                Console.WriteLine(e.Name);
            return 0;
        }

        static int CmdDump(string[] a)
        {
            string outDir = a[0];
            var re = new Regex(a[1], RegexOptions.IgnoreCase);
            string type = Opt(a, "--type", "");
            int max = int.Parse(Opt(a, "--max", "50"));
            int follow = int.Parse(Opt(a, "--follow", "0"));
            Directory.CreateDirectory(outDir);
            int n = 0;
            foreach (var entry in am.EnumerateEbx(type).Where(e => re.IsMatch(e.Name)).OrderBy(e => e.Name).Take(max))
            {
                var dumper = new EbxJson(am, follow);
                JObject json = dumper.DumpAsset(entry);
                string file = Path.Combine(outDir, entry.Name.Replace("/", "__") + ".json");
                File.WriteAllText(file, json.ToString(Formatting.Indented));
                Console.WriteLine($"{entry.Type,-28} {entry.Name}");
                n++;
            }
            Console.Error.WriteLine($"dumped {n} assets to {outDir}");
            return 0;
        }

        // ID lookup tables (TSV) for formations, sets and plays Ã¢â‚¬â€ the IDs the game's DB tables and protobuf refer to.
        static int CmdIndex(string outDir)
        {
            Directory.CreateDirectory(outDir);
            string Leaf(PointerRef r) => r.Type == PointerRefType.External ? am.GetEbxEntry(r.External.FileGuid)?.Name ?? "" : "";

            using (var w = new StreamWriter(Path.Combine(outDir, "formations.tsv")))
            {
                w.WriteLine("formId\tformationName\tformationType\tasset");
                foreach (var e in am.EnumerateEbx("Formation").OrderBy(e => e.Name))
                {
                    dynamic r = am.GetEbx(e).RootObject;
                    w.WriteLine($"{r.formId}\t{r.formationName}\t{r.formationType}\t{e.Name}");
                }
            }
            using (var w = new StreamWriter(Path.Combine(outDir, "sets.tsv")))
            {
                w.WriteLine("setId\tsetName\tclassification\tsetType\tformation\tasset");
                foreach (var e in am.EnumerateEbx("Set").OrderBy(e => e.Name))
                {
                    dynamic r = am.GetEbx(e).RootObject;
                    w.WriteLine($"{r.setId}\t{r.setName}\t{r.Classification}\t{r.setType}\t{Leaf(r.form)}\t{e.Name}");
                }
            }
            int n = 0;
            using (var w = new StreamWriter(Path.Combine(outDir, "plays.tsv")))
            {
                w.WriteLine("playId\tplayName\toffensePlayType\tdefensePlayType\tset\tasset");
                foreach (var e in am.EnumerateEbx("Play").OrderBy(e => e.Name))
                {
                    dynamic r = am.GetEbx(e).RootObject;
                    w.WriteLine($"{r.playId}\t{r.playName}\t{r.offensePlayType}\t{r.defensePlayType}\t{Leaf(r.Set)}\t{e.Name}");
                    if (++n % 2000 == 0) Console.Error.WriteLine($"  {n} plays");
                }
            }
            Console.Error.WriteLine($"indexed {n} plays to {outDir}");
            return 0;
        }

        // closure <bundle> <asset...>: every asset reachable through EBX dependencies that is NOT in the bundle.
        static int CmdClosure(string bundle, string[] names)
        {
            int bid = am.GetBundleId(bundle);
            var seen = new HashSet<Guid>();
            var stack = new Stack<EbxAssetEntry>(names.Select(n => am.GetEbxEntry(n) ?? throw new ArgumentException("not found: " + n)));
            int missing = 0;
            while (stack.Count > 0)
            {
                EbxAssetEntry e = stack.Pop();
                if (!seen.Add(e.Guid)) continue;
                if (!e.IsInBundle(bid)) { Console.WriteLine($"MISSING {e.Type,-26} {e.Name}"); missing++; }
                foreach (Guid d in e.EnumerateDependencies())
                {
                    EbxAssetEntry de = am.GetEbxEntry(d);
                    if (de != null) stack.Push(de);
                }
            }
            Console.WriteLine($"{bundle}: {seen.Count} assets in closure, {missing} missing");
            return 0;
        }

        // Which bundles each named asset lives in (an asset only loads when a bundle containing it is loaded).
        static int CmdBundles(string[] names)
        {
            foreach (string name in names)
            {
                EbxAssetEntry e = am.GetEbxEntry(name);
                if (e == null) { Console.WriteLine($"{name}: NOT FOUND"); continue; }
                Console.WriteLine($"{e.Type} {e.Name}");
                foreach (int id in e.EnumerateBundles())
                    Console.WriteLine("    " + am.GetBundleEntry(id).Name);
            }
            return 0;
        }

        static string Opt(string[] a, string name, string def)
        {
            int i = Array.IndexOf(a, name);
            return i >= 0 && i + 1 < a.Length ? a[i + 1] : def;
        }
    }

    // Reflection-based EBX -> JSON. Internal pointers are inlined (cycle-guarded),
    // external pointers are named and optionally inlined up to `follow` asset hops.
    internal class EbxJson
    {
        readonly AssetManager am;
        readonly int follow;

        public EbxJson(AssetManager am, int follow) { this.am = am; this.follow = follow; }

        public JObject DumpAsset(EbxAssetEntry entry) => DumpAsset(entry, follow);

        JObject DumpAsset(EbxAssetEntry entry, int hopsLeft)
        {
            EbxAsset asset = am.GetEbx(entry);
            return new JObject
            {
                ["$asset"] = entry.Name,
                ["$type"] = entry.Type,
                ["$fileGuid"] = entry.Guid.ToString(),
                ["root"] = Value(asset.RootObject, new HashSet<object>(ReferenceEqualityComparer.Instance), hopsLeft)
            };
        }

        JToken Value(object v, HashSet<object> path, int hopsLeft)
        {
            switch (v)
            {
                case null: return JValue.CreateNull();
                case string s: return s;
                case CString cs: return cs.IsNull() ? null : cs.ToString();
                case Guid g: return g.ToString();
                case Enum e: return e.ToString();
                case bool or byte or sbyte or short or ushort or int or uint or long or ulong or float or double:
                    return JToken.FromObject(v);
                case PointerRef pr: return Pointer(pr, path, hopsLeft);
                case IList list:
                    var arr = new JArray();
                    foreach (object item in list) arr.Add(Value(item, path, hopsLeft));
                    return arr;
            }
            return Obj(v, path, hopsLeft);
        }

        JToken Pointer(PointerRef pr, HashSet<object> path, int hopsLeft)
        {
            if (pr.Type == PointerRefType.Null) return JValue.CreateNull();
            if (pr.Type == PointerRefType.Internal) return Value(pr.Internal, path, hopsLeft);
            EbxAssetEntry target = am.GetEbxEntry(pr.External.FileGuid);
            var ext = new JObject { ["$ext"] = target?.Name ?? pr.External.FileGuid.ToString(), ["$extType"] = target?.Type };
            if (target != null && hopsLeft > 0)
                ext["$inline"] = DumpAsset(target, hopsLeft - 1)["root"];
            return ext;
        }

        JToken Obj(object o, HashSet<object> path, int hopsLeft)
        {
            Type t = o.GetType();
            var jo = new JObject { ["$type"] = t.Name };
            MethodInfo getGuid = t.GetMethod("GetInstanceGuid");
            if (getGuid != null) jo["$id"] = getGuid.Invoke(o, null)?.ToString();
            if (!t.IsValueType && !path.Add(o)) { jo["$cycle"] = true; return jo; }
            foreach (PropertyInfo p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (p.GetIndexParameters().Length > 0 || !p.CanRead) continue;
                object pv;
                try { pv = p.GetValue(o); } catch (Exception ex) { jo[p.Name] = "!" + ex.GetType().Name; continue; }
                jo[p.Name] = Value(pv, path, hopsLeft);
            }
            if (!t.IsValueType) path.Remove(o);
            return jo;
        }
    }

    internal sealed class ReferenceEqualityComparer : IEqualityComparer<object>
    {
        public static readonly ReferenceEqualityComparer Instance = new ReferenceEqualityComparer();
        public new bool Equals(object x, object y) => ReferenceEquals(x, y);
        public int GetHashCode(object o) => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(o);
    }

    internal sealed class StderrLogger : ILogger
    {
        public void Log(string text, params object[] vars) => Console.Error.WriteLine(vars.Length > 0 ? string.Format(text, vars) : text);
        public void LogWarning(string text, params object[] vars) => Log("WARN " + text, vars);
        public void LogError(string text, params object[] vars) => Log("ERROR " + text, vars);
    }
}
