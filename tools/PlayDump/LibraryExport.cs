using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using FrostySdk;
using FrostySdk.Ebx;
using FrostySdk.IO;
using FrostySdk.Managers;
using FrostySdk.Managers.Entries;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace PlayDump
{
    // Exports the play library as plain JSON for tools that don't have the game installed (the web editor):
    //   formations.json, sets.json (alignments + motion presets), plays.json (per-slot assignment refs, reads), assignments.json (chains).
    internal static class LibraryExport
    {
        static readonly HashSet<string> Skip = new HashSet<string> { "__Id", "__InstanceGuid", "opCodeEX", "Name" };

        public static int Run(AssetManager am, string outDir)
        {
            Directory.CreateDirectory(outDir);
            string Ext(PointerRef r) => r.Type == PointerRefType.External ? am.GetEbxEntry(r.External.FileGuid)?.Name : null;

            var formations = new JArray();
            foreach (var e in am.EnumerateEbx("Formation").OrderBy(e => e.Name))
            {
                dynamic r = am.GetEbx(e).RootObject;
                formations.Add(new JObject { ["formId"] = (int)r.formId, ["name"] = r.formationName.ToString(), ["type"] = r.formationType.ToString(), ["asset"] = e.Name });
            }
            Write(outDir, "formations.json", formations);

            var sets = new JArray();
            foreach (var e in am.EnumerateEbx("Set").OrderBy(e => e.Name))
            {
                dynamic r = am.GetEbx(e).RootObject;
                var movements = new JObject();
                foreach (PointerRef m in (List<PointerRef>)r.preSnapMovements)
                {
                    dynamic mv = m.Internal;
                    movements[mv.__Id.ToString()] = new JArray(((List<PointerRef>)mv.PlayerPosition).Select(p => Position(p.Internal)));
                }
                sets.Add(new JObject
                {
                    ["setId"] = (uint)r.setId, ["name"] = r.setName.ToString(), ["asset"] = e.Name, ["formation"] = Ext(r.form),
                    ["classification"] = r.Classification.ToString(), ["setType"] = r.setType.ToString(), ["canFlip"] = (bool)r.canFlip,
                    ["movements"] = movements
                });
            }
            Write(outDir, "sets.json", sets);

            // Custom playbook saves only show plays that are in the global play sheet bundle; others must be pulled in by the mod.
            int globalBundle = am.GetBundleId("win32/football/gameplay/playbooks/playlibrary/globalplaysheets/globalplaybooksheet_playbooks_brt");
            var plays = new JArray();
            int n = 0;
            foreach (var e in am.EnumerateEbx("Play").OrderBy(e => e.Name))
            {
                dynamic r = am.GetEbx(e).RootObject;
                plays.Add(new JObject
                {
                    ["playId"] = (uint)r.playId, ["name"] = r.playName.ToString(), ["asset"] = e.Name, ["set"] = Ext(r.Set),
                    ["offensePlayType"] = r.offensePlayType.ToString(), ["defensePlayType"] = r.defensePlayType.ToString(),
                    ["blocking"] = Ext(r.BlockingSchemeDefine), ["runHole"] = (int)r.runHole, ["vip"] = (int)r.VIPPosition,
                    ["allowHotRoutes"] = (bool)r.allowHotRoutes, ["canFlip"] = (bool)r.canFlip, ["global"] = e.IsInBundle(globalBundle),
                    ["assignments"] = new JArray(((List<PointerRef>)r.positionAssignmentDefines).Select(p => (JToken)Ext(p))),
                    ["reads"] = new JArray(((List<PointerRef>)r.passData).Select(p => { dynamic d = p.Internal; return new JObject { ["pos"] = (int)d.position, ["pct"] = Math.Round((float)d.percentage, 3), ["concept"] = d.concept.ToString(), ["combo"] = (int)d.combo }; }))
                });
                if (++n % 3000 == 0) Console.Error.WriteLine($"  {n} plays");
            }
            Write(outDir, "plays.json", plays);

            var assignments = new JObject();
            foreach (var e in am.EnumerateEbx("PositionAssignmentDefine").OrderBy(e => e.Name))
            {
                dynamic r = am.GetEbx(e).RootObject;
                assignments[e.Name] = new JObject
                {
                    ["id"] = (int)r.positionAssignId, ["routeType"] = r.routeType.ToString(),
                    ["steps"] = new JArray(((List<PointerRef>)r.positionAssignment).Where(p => p.Type == PointerRefType.Internal).Select(p => Step(p.Internal)))
                };
            }
            Write(outDir, "assignments.json", assignments);
            Write(outDir, "enums.json", Enums());
            Console.Error.WriteLine($"library: {formations.Count} formations, {sets.Count} sets, {plays.Count} plays, {assignments.Count} assignments -> {outDir}");
            return 0;
        }

        // Every enum used by play, set and assignment fields (incl. nested types like AutoMotion waypoints): {EnumType: [names], fields: {Class.field: EnumType}}.
        static JObject Enums()
        {
            Type sample = TypeLibrary.GetType("PositionAssignment");
            Type[] all = sample.Assembly.GetTypes();
            var roots = all.Where(t => t.IsSubclassOf(sample)).Concat(new[] { "Play", "Set", "SetPosition", "PlayPassData", "PositionAssignmentDefine" }.Select(TypeLibrary.GetType)).ToList();
            var enums = new JObject();
            var fields = new JObject();
            var seen = new HashSet<Type>();
            void Visit(Type t)
            {
                if (t == null || !seen.Add(t)) return;
                foreach (PropertyInfo p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    Type pt = p.PropertyType.IsGenericType ? p.PropertyType.GetGenericArguments()[0] : p.PropertyType;
                    if (pt.IsEnum)
                    {
                        fields[$"{t.Name.Replace("Assignment", "")}.{p.Name}"] = pt.Name;
                        if (enums[pt.Name] == null) enums[pt.Name] = new JArray(Enum.GetNames(pt));
                    }
                    else if (pt.Namespace == sample.Namespace && pt.IsClass) Visit(pt);
                }
            }
            roots.ForEach(Visit);
            return new JObject { ["fields"] = fields, ["enums"] = enums };
        }

        static JObject Position(object p)
        {
            dynamic s = p;
            return new JObject
            {
                ["slot"] = (int)s.posOrder, ["pos"] = s.depthPosition.ToString(), ["depth"] = (int)s.depth, ["flipAssign"] = (int)s.flipAssign, ["x"] = Math.Round((float)s.XPos, 3), ["y"] = Math.Round((float)s.YPos, 3),
                ["facing"] = (int)s.facing, ["stance"] = s.anim.ToString(), ["group"] = s.groupType.ToString(), ["motionMan"] = (bool)s.primaryMotionMan
            };
        }

        // Assignment step as {type, field: value...}; enums by name, nested objects (e.g. AutoMotion waypoints) recursively.
        static JObject Step(object o)
        {
            var jo = new JObject { ["type"] = o.GetType().Name.Replace("Assignment", "") };
            foreach (var (k, v) in Fields(o)) jo[k] = v;
            return jo;
        }

        static IEnumerable<(string, JToken)> Fields(object o)
        {
            foreach (PropertyInfo p in o.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (Skip.Contains(p.Name) || p.GetIndexParameters().Length > 0) continue;
                yield return (p.Name, Value(p.GetValue(o)));
            }
        }

        static JToken Value(object v)
        {
            switch (v)
            {
                case null: return JValue.CreateNull();
                case float f: return Math.Round(f, 3);
                case Enum e: return e.ToString();
                case CString cs: return cs.ToString();
                case PointerRef pr: return pr.Type == PointerRefType.Null ? null : pr.Type.ToString();
                case string or bool or int or uint or long or ulong or short or ushort or byte or sbyte or double: return JToken.FromObject(v);
                case IList list: return new JArray(list.Cast<object>().Select(Value));
            }
            var jo = new JObject();
            foreach (var (k, x) in Fields(v)) jo[k] = x;
            return jo;
        }

        static void Write(string dir, string file, JToken json) =>
            File.WriteAllText(Path.Combine(dir, file), json.ToString(Formatting.None));
    }
}
