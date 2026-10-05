using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using FrostySdk;
using FrostySdk.Ebx;
using FrostySdk.IO;
using FrostySdk.Managers.Entries;
using Newtonsoft.Json.Linq;

namespace PlayDump
{
    // Custom formations and sets (docs/FORMATS.md §5): clones a base Formation/Set, edits the alignment and motion presets,
    // clones plays into the new set, and registers everything in GlobalPlaySheet. Bundles/BRT/closure reuse PlayBuilder.
    internal class SetBuilder
    {
        const string FormationRoot = "football/Gameplay/playbooks/PlayLibrary/Formations/Offense/";
        readonly PlayBuilder pb;
        readonly List<string> formationManifest = new List<string>();
        readonly List<string> setManifest = new List<string>();

        public SetBuilder(PlayBuilder pb) { this.pb = pb; }

        // Returns the cloned plays (for GlobalPlaySheet play registration and closure checks).
        public List<(EbxAssetEntry, uint, string)> Build(JObject spec, string indexDir, string outDir)
        {
            var plays = new List<(EbxAssetEntry, uint, string)>();
            var formIds = TakenIds(Path.Combine(indexDir, "formations.tsv"));
            var setIds = TakenIds(Path.Combine(indexDir, "sets.tsv"));

            foreach (JObject f in spec["formations"] ?? new JArray())
                BuildFormation(f, formIds);
            foreach (JObject s in spec["sets"] ?? new JArray())
                plays.AddRange(BuildSet(s, setIds));

            File.WriteAllLines(Path.Combine(outDir, "custom-formations.tsv"), new[] { "formId\tformationName\tformationType\tasset" }.Concat(formationManifest));
            File.WriteAllLines(Path.Combine(outDir, "custom-sets.tsv"), new[] { "setId\tsetName\tclassification\tsetType\tformation\tasset" }.Concat(setManifest));
            return plays;
        }

        void BuildFormation(JObject f, HashSet<uint> taken)
        {
            string leaf = (string)f["asset"];
            string asset = FormationRoot + leaf + "/" + leaf;
            EbxAssetEntry baseEntry = pb.Need((string)f["base"]);
            EbxAsset form = pb.CloneAsset(baseEntry, asset);
            dynamic root = form.RootObject;
            root.formationName = new CString((string)f["name"]);
            root.formId = (int)(PlayBuilder.NewId(asset, taken) & 0x7fffffff);
            EbxAssetEntry entry = pb.AddAsset(asset, form, baseEntry);

            // GlobalPlaySheet: new FormationContainer + formationIds.
            WithGlobalSheet((gps, gr) =>
            {
                dynamic fc = NewObject(gps, "FormationContainer");
                fc.Formation = pb.Ref(gps, entry);
                ((List<PointerRef>)gr.FormationContainers).Add(new PointerRef(fc));
                PlayBuilder.InsertSorted((List<uint>)gr.formationIds, (uint)(int)root.formId); // stock list is sorted
            });
            formationManifest.Add($"{root.formId}\t{f["name"]}\t{root.formationType}\t{asset}");
            Console.Error.WriteLine($"formation {f["name"]} -> {asset} (formId {root.formId})");
        }

        List<(EbxAssetEntry, uint, string)> BuildSet(JObject s, HashSet<uint> taken)
        {
            EbxAssetEntry baseEntry = pb.Need((string)s["base"]);
            EbxAssetEntry formEntry = pb.Need((string)s["formation"]);
            string leaf = (string)s["asset"];
            string folder = formEntry.Name.Substring(0, formEntry.Name.LastIndexOf('/') + 1);
            string asset = folder + leaf + "/" + leaf;

            EbxAsset set = pb.CloneAsset(baseEntry, asset);
            dynamic root = set.RootObject;
            root.setName = new CString((string)s["name"]);
            uint setId = PlayBuilder.NewId(asset, taken);
            root.setId = setId;
            root.form = pb.Ref(set, formEntry);

            var movements = ((List<PointerRef>)root.preSnapMovements).Select(m => (dynamic)m.Internal).ToList();
            dynamic normal = movements.First(m => m.__Id.ToString() == "Normal");
            List<PointerRef> spots = normal.PlayerPosition;

            foreach (JObject p in s["positions"] ?? new JArray())
            {
                dynamic sp = spots[(int)p["slot"]].Internal;
                if (p["x"] != null) sp.XPos = (float)p["x"];
                if (p["y"] != null) sp.YPos = (float)p["y"];
                if (p["facing"] != null) sp.facing = (int)p["facing"];
                if (p["stance"] != null) PlayBuilder.SetEnum(sp, "anim", (string)p["stance"]);
                if (p["flipAssign"] != null) sp.flipAssign = (int)p["flipAssign"];
                if (p["motionMan"] != null) sp.primaryMotionMan = (bool)p["motionMan"];
            }
            // A flipped play mirrors each player onto his flip partner's spot (verified on stock sets).
            var list = spots.Select(x => (dynamic)x.Internal).ToList();
            foreach (dynamic sp in list)
            {
                dynamic partner = list[(int)sp.flipAssign];
                sp.flippedXPos = -(float)partner.XPos;
                sp.flippedYPos = (float)partner.YPos;
                sp.flippedFacing = (180 - (int)partner.facing + 360) % 360;
                PlayBuilder.SetEnum(sp, "flippedAnim", ((object)partner.anim).ToString());
            }
            ValidateAlignment(list, (string)s["name"]);
            foreach (dynamic sp in list.Where(x => (int)x.posOrder >= 1 && (int)x.posOrder <= 5))
                Console.Error.WriteLine($"  slot {sp.posOrder} {((object)sp.depthPosition).ToString().Replace("POSITION_", ""),-15} ({sp.XPos}, {sp.YPos})  flipped ({sp.flippedXPos}, {sp.flippedYPos}) via slot {sp.flipAssign}");

            // Motion presets: each preset holds only the motion man's target spot (posOrder = slot).
            foreach (JProperty mv in ((JObject)s["movements"] ?? new JObject()).Properties())
            {
                dynamic preset = movements.FirstOrDefault(m => m.__Id.ToString() == mv.Name)
                    ?? throw new InvalidOperationException($"{s["name"]}: base set has no motion preset {mv.Name}");
                foreach (JObject t in mv.Value)
                {
                    int slot = (int)t["slot"];
                    dynamic target = ((List<PointerRef>)preset.PlayerPosition).Select(x => (dynamic)x.Internal).FirstOrDefault(x => (int)x.posOrder == slot)
                        ?? throw new InvalidOperationException($"{s["name"]}: preset {mv.Name} doesn't move slot {slot}");
                    target.XPos = (float)t["x"];
                    target.YPos = (float)t["y"];
                    target.flippedXPos = -(float)t["x"];
                    target.flippedYPos = (float)t["y"];
                }
            }

            if (s["presets"] is JObject presets) ReplacePresets(set, root, list, presets, (string)s["name"]);

            EbxAssetEntry entry = pb.AddAsset(asset, set, baseEntry);
            WithGlobalSheet((gps, gr) =>
            {
                dynamic fc = ((List<PointerRef>)gr.FormationContainers).Select(x => (dynamic)x.Internal)
                    .FirstOrDefault(x => ((PointerRef)x.Formation).External.FileGuid == formEntry.Guid)
                    ?? throw new InvalidOperationException("formation not in GlobalPlaySheet: " + formEntry.Name);
                dynamic sc = NewObject(gps, "SetContainer");
                sc.Set = pb.Ref(gps, entry);
                // setIds runs parallel to the SetContainers flattened in FormationContainer order (verified on the
                // stock sheet: 502/502), so the id goes where the container lands, not at the end.
                int before = 0;
                foreach (PointerRef p in (List<PointerRef>)gr.FormationContainers)
                {
                    if (ReferenceEquals(p.Internal, (object)fc)) break;
                    before += ((List<PointerRef>)((dynamic)p.Internal).Sets).Count;
                }
                ((List<PointerRef>)fc.Sets).Add(new PointerRef(sc));
                ((List<uint>)gr.setIds).Insert(before + ((List<PointerRef>)fc.Sets).Count - 1, setId);
            });
            dynamic form = pb.am.GetEbx(formEntry).RootObject;
            setManifest.Add($"{setId}\t{s["name"]}\t{root.Classification}\t{root.setType}\t{formEntry.Name}\t{asset}");
            Console.Error.WriteLine($"set {s["name"]} -> {asset} (setId {setId}, formation {form.formationName})");

            // Plays cloned into the new set: same assignments, new set/id/name.
            var plays = new List<(EbxAssetEntry, uint, string)>();
            foreach (JObject p in s["plays"] ?? new JArray())
            {
                var clone = new JObject { ["name"] = p["name"], ["asset"] = p["asset"], ["base"] = p["from"], ["set"] = asset };
                foreach (var kv in p) if (!clone.ContainsKey(kv.Key) && kv.Key != "from") clone[kv.Key] = kv.Value;
                plays.Add(pb.BuildPlay(clone));
            }
            return plays;
        }

        // "presets": { "M1left": [{ slot, x, y, motionMan, stance? }], "SM1right": [...] } replaces every non-Normal motion preset.
        // Like stock sets: preset Mn moves the slot-n player (plus any adjusting players); a flipped play uses the mirror of the
        // opposite-direction preset; each mover starts as a copy of his Normal spot.
        void ReplacePresets(EbxAsset set, dynamic root, List<dynamic> normal, JObject presets, string setName)
        {
            List<PointerRef> movements = root.preSnapMovements;
            foreach (PointerRef m in movements.Where(m => ((dynamic)m.Internal).__Id.ToString() != "Normal").ToList())
            {
                foreach (PointerRef p in (List<PointerRef>)((dynamic)m.Internal).PlayerPosition) set.RemoveObject(p.Internal);
                set.RemoveObject(m.Internal);
                movements.Remove(m);
            }
            var copyProps = ((object)normal[0]).GetType().GetProperties().Where(p => p.CanWrite && p.Name != "__InstanceGuid").ToList();
            foreach (JProperty preset in presets.Properties())
            {
                var mt = System.Text.RegularExpressions.Regex.Match(preset.Name, @"^(S?)M(\d)(left|right)$");
                if (!mt.Success) throw new InvalidOperationException($"{setName}: bad preset name {preset.Name}");
                int n = int.Parse(mt.Groups[2].Value);
                string dir = mt.Groups[3].Value, other = dir == "left" ? "right" : "left";
                dynamic mv = NewObject(set, "PreSnapMovement");
                mv.__Id = new CString(preset.Name);
                mv.name = new CString(preset.Name);
                mv.isDefault = false;
                PlayBuilder.SetEnum(mv, "type", $"PreSnapMovementType_MIM_{(mt.Groups[1].Value == "S" ? "Second" : "")}{(dir == "left" ? "Left" : "Right")}Man_{n}");
                var counterpart = (JArray)presets[$"{mt.Groups[1].Value}M{n}{other}"];
                foreach (JObject t in preset.Value)
                {
                    int slot = (int)t["slot"];
                    dynamic src = normal[slot];
                    dynamic sp = NewObject(set, "SetPosition");
                    foreach (var p in copyProps) p.SetValue((object)sp, p.GetValue((object)src));
                    sp.XPos = (float)t["x"];
                    sp.YPos = (float)t["y"];
                    if (t["stance"] != null) PlayBuilder.SetEnum(sp, "anim", (string)t["stance"]);
                    bool man = (bool?)t["motionMan"] ?? false;
                    sp.primaryMotionMan = man;
                    if (man) PlayBuilder.SetEnum(sp, "groupType", "Set_Group_Type_MotionMan" + n);
                    JObject mirror = counterpart?.Cast<JObject>().FirstOrDefault(c => (int)c["slot"] == slot) ?? t;
                    sp.flippedXPos = -(float)mirror["x"];
                    sp.flippedYPos = (float)mirror["y"];
                    PlayBuilder.SetEnum(sp, "flippedAnim", (string)mirror["stance"] ?? ((object)sp.anim).ToString());
                    ((List<PointerRef>)mv.PlayerPosition).Add(new PointerRef(sp));
                }
                movements.Add(new PointerRef(mv));
            }
            Console.Error.WriteLine($"  presets: {string.Join(" ", presets.Properties().Select(p => p.Name))}");
        }

        // 11 players, 7 on the line of scrimmage, OL spacing intact (FORMATS.md §5).
        static void ValidateAlignment(List<dynamic> spots, string name)
        {
            if (spots.Count != 11) throw new InvalidOperationException($"{name}: {spots.Count} players");
            int onLine = spots.Count(sp => ((object)sp.depthPosition).ToString() != "POSITION_QB" && (float)sp.YPos > -1.75f);
            if (onLine != 7) throw new InvalidOperationException($"{name}: {onLine} players on the line (need 7; on-line means y > -1.75)");
            float[] ol = { -3.333f, -1.666f, 0f, 1.666f, 3.333f };
            for (int i = 0; i < 5; i++)
                if (Math.Abs((float)spots[6 + i].XPos - ol[i]) > 0.25f) Console.Error.WriteLine($"  WARN {name}: OL slot {6 + i} moved to x={spots[6 + i].XPos}");
        }

        void WithGlobalSheet(Action<EbxAsset, dynamic> edit)
        {
            EbxAssetEntry e = pb.am.EnumerateEbx("GlobalPlaySheet").First();
            EbxAsset gps = pb.am.GetEbx(e);
            edit(gps, gps.RootObject);
            pb.am.ModifyEbx(e.Name, gps);
            foreach (Guid d in gps.Dependencies)
                if (!e.ModifiedEntry.DependentAssets.Contains(d)) e.ModifiedEntry.DependentAssets.Add(d);
        }

        static dynamic NewObject(EbxAsset owner, string type)
        {
            dynamic o = TypeLibrary.CreateObject(type);
            o.SetInstanceGuid(new AssetClassGuid(Utils.GenerateDeterministicGuid(owner.Objects, ((object)o).GetType(), owner.FileGuid), -1));
            owner.AddObject(o);
            return o;
        }

        static HashSet<uint> TakenIds(string tsv) =>
            new HashSet<uint>(File.Exists(tsv) ? File.ReadLines(tsv).Skip(1).Select(l => (uint)long.Parse(l.Split('\t')[0])) : Enumerable.Empty<uint>());
    }
}
