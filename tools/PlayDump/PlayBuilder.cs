using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Frosty.Core;
using FrostySdk;
using FrostySdk.Ebx;
using FrostySdk.IO;
using FrostySdk.Managers;
using FrostySdk.Managers.Entries;
using Newtonsoft.Json.Linq;

namespace PlayDump
{
    // Builds new plays from a JSON spec (see playbooks/plays/*.json) into a Frosty project + mod:
    //  - clones a base Play from the same set (keeps handoff/blocking mechanics that are tied to the alignment),
    //  - per player slot: keeps the base assignment, points at an existing PositionAssignmentDefine, or authors a new one,
    //  - registers new assets in the target bundles + their bundle ref tables, and in GlobalPlaySheet.
    internal class PlayBuilder
    {
        const string AssignRoot = "football/Gameplay/playbooks/PlayLibrary/Assignments/";
        readonly AssetManager am;
        readonly JObject spec;
        readonly int[] bundleIds;
        readonly Dictionary<string, object> opcodes = new Dictionary<string, object>();
        readonly HashSet<uint> takenPlayIds;
        readonly List<string> manifest = new List<string>();
        readonly MethodInfo addToBrt;

        public PlayBuilder(AssetManager am, JObject spec, string indexDir)
        {
            this.am = am;
            this.spec = spec;
            bundleIds = spec["bundles"].Select(b => am.GetBundleId((string)b)).ToArray();
            foreach (var (name, id) in spec["bundles"].Select(b => (string)b).Zip(bundleIds, (n, i) => (n, i)))
            {
                if (id == -1) throw new InvalidOperationException("unknown bundle " + name);
                Console.Error.WriteLine($"bundle {name}: {am.GetBundleEntry(id).Type}");
            }
            takenPlayIds = new HashSet<uint>(File.ReadLines(Path.Combine(indexDir, "plays.tsv")).Skip(1).Select(l => uint.Parse(l.Split('\t')[0])));
            Type dup = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("DuplicationPlugin.DuplicationTool", false)).FirstOrDefault(t => t != null);
            addToBrt = dup?.GetMethod("AddToBRT", BindingFlags.Public | BindingFlags.Static)
                ?? throw new InvalidOperationException("DuplicationPlugin.DuplicationTool.AddToBRT not found (is the plugin loaded?)");
        }

        public void Run(string projectPath, string modPath, string manifestPath)
        {
            var built = new List<(EbxAssetEntry entry, uint playId, string set)>();
            foreach (JObject p in spec["plays"])
                built.Add(BuildPlay(p));
            RegisterGlobal(built);

            var project = new FrostyProject();
            project.ModSettings.Title = (string)spec["title"] ?? "PB Studio plays";
            project.ModSettings.Author = "2026 Playbook";
            project.ModSettings.Version = (string)spec["version"] ?? "0.1.0";
            project.ModSettings.Description = (string)spec["description"] ?? "";
            project.Save(projectPath, updateDirtyState: false);
            Console.Error.WriteLine("saved " + projectPath);
            if (modPath != null)
            {
                project.WriteToMod(modPath, project.ModSettings);
                Console.Error.WriteLine("wrote " + modPath);
            }
            File.WriteAllLines(manifestPath, new[] { "playId\tplayName\toffensePlayType\tdefensePlayType\tset\tasset" }.Concat(manifest));
        }

        (EbxAssetEntry, uint, string) BuildPlay(JObject p)
        {
            EbxAssetEntry baseEntry = Need((string)p["base"]);
            string name = (string)p["name"];
            string assetName = baseEntry.Name.Substring(0, baseEntry.Name.LastIndexOf('/') + 1) + (string)p["asset"];
            EbxAsset play = CloneAsset(baseEntry, assetName);
            dynamic root = play.RootObject;

            uint playId = NewId(assetName, takenPlayIds);
            root.playName = new CString(name);
            root.playId = playId;
            if (p["playType"] != null) SetEnum(root, "offensePlayType", (string)p["playType"]);
            if (p["runHole"] != null) root.runHole = (int)p["runHole"];
            if (p["blocking"] != null) root.BlockingSchemeDefine = Ref(play, Need("football/Gameplay/playbooks/PlayLibrary/Blocking/" + (string)p["blocking"]));

            List<PointerRef> pads = root.positionAssignmentDefines;
            foreach (JProperty slot in ((JObject)p["players"] ?? new JObject()).Properties())
            {
                int i = int.Parse(slot.Name);
                JToken s = slot.Value;
                if (s.Type == JTokenType.String)
                    pads[i] = Ref(play, Need(AssignRoot + (string)s));
                else
                    pads[i] = Ref(play, BuildAssignment((JObject)s, pads[i]));
            }

            if (p["reads"] is JArray reads)
            {
                List<PointerRef> passData = root.passData;
                for (int k = 0; k < passData.Count; k++)
                {
                    dynamic pd = passData[k].Internal;
                    JObject r = k < reads.Count ? (JObject)reads[k] : null;
                    pd.position = r != null ? (int)r["pos"] : 0;
                    pd.percentage = r != null ? (float)r["pct"] : 0f;
                    pd.combo = r != null ? (int?)r["combo"] ?? 0 : 0;
                    SetEnum(pd, "concept", r != null ? (string)r["concept"] ?? "Concept_Invalid" : "Concept_Invalid");
                }
            }

            EbxAssetEntry entry = AddAsset(assetName, play, baseEntry);
            manifest.Add($"{playId}\t{name}\t{root.offensePlayType}\t{root.defensePlayType}\t{Leaf((PointerRef)root.Set)}\t{assetName}");
            Console.Error.WriteLine($"play {name} -> {assetName} (playId {playId})");
            return (entry, playId, Leaf((PointerRef)root.Set));
        }

        // A new PositionAssignmentDefine: clone `template` (or the slot's base assignment), keep its first `keep` steps,
        // append authored steps, terminate with NoneAssignment.
        EbxAssetEntry BuildAssignment(JObject s, PointerRef baseRef)
        {
            string name = AssignRoot + "PBS/" + (string)s["new"];
            EbxAssetEntry existing = am.GetEbxEntry(name);
            if (existing != null) return existing; // shared by several plays in this spec
            EbxAssetEntry template = s["template"] != null ? Need(AssignRoot + (string)s["template"]) : am.GetEbxEntry(baseRef.External.FileGuid);
            EbxAsset pad = CloneAsset(template, name);
            dynamic root = pad.RootObject;
            root.positionAssignId = (int)(NewId(name, null) & 0x7fffffff);
            if (s["routeType"] != null) SetEnum(root, "routeType", (string)s["routeType"]);

            List<PointerRef> chain = root.positionAssignment;
            int keep = (int?)s["keep"] ?? 0;
            foreach (PointerRef dropped in chain.Skip(keep).ToList()) pad.RemoveObject(dropped.Internal);
            chain.RemoveRange(keep, chain.Count - keep);
            foreach (JObject step in s["steps"].Concat(new[] { new JObject { ["type"] = "None" } }))
                chain.Add(new PointerRef(NewStep(pad, step)));

            EbxAssetEntry entry = AddAsset(name, pad, template);
            Console.Error.WriteLine($"  assignment {name} (id {root.positionAssignId}, {chain.Count} steps)");
            return entry;
        }

        object NewStep(EbxAsset pad, JObject step)
        {
            string cls = (string)step["type"] + "Assignment";
            dynamic obj = TypeLibrary.CreateObject(cls) ?? throw new InvalidOperationException("unknown assignment type " + cls);
            foreach (JProperty prop in step.Properties().Where(x => x.Name != "type"))
            {
                PropertyInfo pi = ((object)obj).GetType().GetProperty(prop.Name) ?? throw new InvalidOperationException($"{cls} has no field {prop.Name}");
                pi.SetValue(obj, Convert(pi.PropertyType, prop.Value));
            }
            ((object)obj).GetType().GetProperty("opCodeEX").SetValue(obj, Opcode(cls));
            obj.SetInstanceGuid(new AssetClassGuid(Utils.GenerateDeterministicGuid(pad.Objects, ((object)obj).GetType(), pad.FileGuid), -1));
            pad.AddObject(obj);
            return obj;
        }

        // opCodeEX for an assignment class, learned from the first existing PositionAssignmentDefine that uses it.
        object Opcode(string cls)
        {
            if (opcodes.TryGetValue(cls, out object op)) return op;
            foreach (EbxAssetEntry e in am.EnumerateEbx("PositionAssignmentDefine"))
            {
                dynamic r = am.GetEbx(e).RootObject;
                foreach (PointerRef a in (List<PointerRef>)r.positionAssignment)
                {
                    if (a.Type != PointerRefType.Internal) continue;
                    string n = a.Internal.GetType().Name;
                    if (!opcodes.ContainsKey(n)) opcodes[n] = ((dynamic)a.Internal).opCodeEX;
                }
                if (opcodes.ContainsKey(cls)) break;
            }
            return opcodes.TryGetValue(cls, out op) ? op : throw new InvalidOperationException("no opcode seen for " + cls);
        }

        void RegisterGlobal(List<(EbxAssetEntry entry, uint playId, string set)> plays)
        {
            EbxAssetEntry gpsEntry = am.EnumerateEbx("GlobalPlaySheet").First();
            EbxAsset gps = am.GetEbx(gpsEntry);
            dynamic root = gps.RootObject;
            List<uint> ids = root.playIds;
            foreach (var (entry, playId, _) in plays)
            {
                dynamic play = am.GetEbx(entry).RootObject;
                Guid setGuid = ((PointerRef)play.Set).External.FileGuid;
                dynamic setContainer = null;
                foreach (PointerRef fc in (List<PointerRef>)root.FormationContainers)
                    foreach (PointerRef sc in (List<PointerRef>)((dynamic)fc.Internal).Sets)
                        if (((PointerRef)((dynamic)sc.Internal).Set).External.FileGuid == setGuid) setContainer = sc.Internal;
                if (setContainer == null) throw new InvalidOperationException("set of " + entry.Name + " not in GlobalPlaySheet");

                dynamic pc = TypeLibrary.CreateObject("PlayContainer");
                pc.Play = Ref(gps, entry);
                pc.SetInstanceGuid(new AssetClassGuid(Utils.GenerateDeterministicGuid(gps.Objects, ((object)pc).GetType(), gps.FileGuid), -1));
                gps.AddObject(pc);
                ((List<PointerRef>)setContainer.Plays).Add(new PointerRef(pc));
                if (!ids.Contains(playId)) ids.Add(playId);
            }
            am.ModifyEbx(gpsEntry.Name, gps);
            gpsEntry.ModifiedEntry.DependentAssets.AddRange(plays.Select(x => x.entry.Guid));
            Console.Error.WriteLine($"registered {plays.Count} plays in {gpsEntry.Name}");
        }

        // Same approach as DuplicationPlugin.DuplicateAssetExtension: round-trip through the EBX writer, new file and root guids.
        EbxAsset CloneAsset(EbxAssetEntry template, string newName)
        {
            if (am.GetEbxEntry(newName) != null) throw new InvalidOperationException(newName + " already exists");
            EbxAsset src = am.GetEbx(template);
            EbxAsset copy;
            using (EbxBaseWriter w = EbxBaseWriter.CreateWriter(new MemoryStream(), EbxWriteFlags.DoNotSort))
            {
                w.WriteAsset(src);
                using (EbxReader r = EbxReader.CreateReader(new MemoryStream(w.ToByteArray())))
                    copy = r.ReadAsset<EbxAsset>();
            }
            copy.SetFileGuid(StableGuid(newName));
            dynamic root = copy.RootObject;
            root.Name = newName;
            root.SetInstanceGuid(new AssetClassGuid(Utils.GenerateDeterministicGuid(copy.Objects, ((object)root).GetType(), copy.FileGuid), -1));
            return copy;
        }

        // BundleRefTableResourceV2.DupeAsset copies the bundle lookup of an existing asset, and silently does nothing when that
        // asset isn't in the table â€” so the reference must be an asset present in every target bundle (spec "brtRef" per type).
        EbxAssetEntry AddAsset(string name, EbxAsset asset, EbxAssetEntry template)
        {
            EbxAssetEntry entry = am.AddEbx(name, asset, bundleIds);
            entry.ModifiedEntry.DependentAssets.AddRange(asset.Dependencies);
            string refName = (string)spec["brtRef"]?[entry.Type];
            EbxAssetEntry brtRef = refName != null ? Need(refName) : template;
            foreach (int id in bundleIds)
                if (!brtRef.IsInBundle(id))
                    Console.Error.WriteLine($"  WARN {brtRef.Name} is not in {am.GetBundleEntry(id).Name}; {name} won't be added to its ref table");
            addToBrt.Invoke(null, new object[] { entry, brtRef });
            return entry;
        }

        PointerRef Ref(EbxAsset owner, EbxAssetEntry target)
        {
            EbxAsset t = target.IsAdded ? (EbxAsset)target.ModifiedEntry.DataObject : am.GetEbx(target);
            owner.AddDependency(target.Guid);
            return new PointerRef(new EbxImportReference { FileGuid = target.Guid, ClassGuid = t.RootInstanceGuid });
        }

        EbxAssetEntry Need(string name) => am.GetEbxEntry(name) ?? throw new InvalidOperationException("asset not found: " + name);

        string Leaf(PointerRef r) => r.Type == PointerRefType.External ? am.GetEbxEntry(r.External.FileGuid)?.Name ?? "" : "";

        static object Convert(Type t, JToken v)
        {
            if (t.IsEnum) return ParseEnum(t, (string)v);
            if (t == typeof(CString)) return new CString((string)v);
            return v.ToObject(t);
        }

        static object ParseEnum(Type t, string name) => Enum.Parse(t, name);

        static void SetEnum(object target, string prop, string name)
        {
            PropertyInfo pi = target.GetType().GetProperty(prop);
            pi.SetValue(target, ParseEnum(pi.PropertyType, name));
        }

        static Guid StableGuid(string name)
        {
            using (MD5 md5 = MD5.Create())
                return new Guid(md5.ComputeHash(Encoding.UTF8.GetBytes("pbstudio:" + name.ToLowerInvariant())));
        }

        // FNV-1a over the lowercased asset name; probes past collisions with existing ids.
        static uint NewId(string name, HashSet<uint> taken)
        {
            uint h = 2166136261;
            foreach (byte b in Encoding.UTF8.GetBytes(name.ToLowerInvariant())) { h ^= b; h *= 16777619; }
            while (h < 100000 || (taken != null && taken.Contains(h))) h = h * 16777619 + 1;
            taken?.Add(h);
            return h;
        }
    }
}
