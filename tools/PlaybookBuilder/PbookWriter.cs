using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace PlaybookBuilder
{
    // Builds a custom playbook save (PBOOKOFF-*) from a playbook spec, using a template save for the layout.
    // Port of tools/pbook-build.mjs; same inputs (research/index/*.tsv, enums.json) and the same output bytes.
    public sealed class PbookWriter
    {
        // In-game audible slot -> PGPL.Flag bit (slot 3 is bit 16, slot 4 is bit 8).
        static readonly Dictionary<int, long> AudibleBits = new Dictionary<int, long> { { 1, 2 }, { 2, 4 }, { 3, 16 }, { 4, 8 } };
        static readonly HashSet<string> DefenseTypes = new HashSet<string> { "FormationType_Defense", "FormationType_KickReturn", "FormationType_Safety_KickReturn" };

        public static JavaScriptSerializer Json() => new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 512 };
        public static Dictionary<string, object> ReadJson(string file) => (Dictionary<string, object>)Json().DeserializeObject(File.ReadAllText(file).TrimStart('﻿'));

        readonly string indexDir;
        readonly List<Dictionary<string, string>> formations, sets, plays;
        readonly Dictionary<string, object> enums;

        public PbookWriter(string indexDir)
        {
            this.indexDir = indexDir;
            formations = Tsv("formations").Concat(Tsv("custom-formations")).ToList();
            // custom sets first: a custom set may reuse a stock set's name in the same formation (FUSION's "Bunch TE")
            sets = Tsv("custom-sets").Concat(Tsv("sets")).ToList();
            plays = Tsv("plays").Concat(Tsv("custom-plays")).ToList();
            enums = ReadJson(Path.Combine(indexDir, "enums.json"));
        }

        List<Dictionary<string, string>> Tsv(string name)
        {
            string file = Path.Combine(indexDir, name + ".tsv");
            if (!File.Exists(file)) return new List<Dictionary<string, string>>();
            string[] lines = File.ReadAllText(file).Trim().Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
            string[] cols = lines[0].Split('\t');
            return lines.Skip(1).Select(l => { var v = l.Split('\t'); var d = new Dictionary<string, string>(); for (int i = 0; i < v.Length && i < cols.Length; i++) d[cols[i]] = v[i]; return d; }).ToList();
        }

        static string Norm(string s) => Regex.Replace(s.ToLowerInvariant(), @"[\s_]+", " ").Trim();
        static string Get(Dictionary<string, string> d, string k) => d.TryGetValue(k, out string v) ? v : null;
        static long L(object o) => Convert.ToInt64(o);
        static List<Dictionary<string, long>> Copy(IEnumerable<Dictionary<string, long>> rows) => rows.Select(r => new Dictionary<string, long>(r)).ToList();

        long EnumValue(string group, string key) =>
            enums.TryGetValue(group, out object g) && ((Dictionary<string, object>)g).TryGetValue(key, out object v) ? L(v) : -1;

        // collect: only record library plays that need pulling into the global play sheet (custom plays may not exist yet)
        public string Build(string specFile, string templateFile, string outFile, string pullFile, bool collect, Action<string> log)
        {
            var spec = ReadJson(specFile);
            bool defense = spec.TryGetValue("side", out object side) && (string)side == "defense";
            byte[] buf = File.ReadAllBytes(templateFile);
            var T = Tdb.Read(buf);

            Dictionary<string, string> FormByName(string name)
            {
                var named = formations.Where(x => Norm(x["formationName"]) == Norm(name) && defense == DefenseTypes.Contains(Get(x, "formationType") ?? "")).ToList();
                var f = named.FirstOrDefault(x => T["PGFM"].Rows.Any(r => r["PBFM"] == long.Parse(x["formId"])))
                    ?? named.FirstOrDefault(x => Norm(x["asset"].Split('/').Last()) == Norm(name)) ?? named.FirstOrDefault();
                if (f == null && !collect) throw new InvalidOperationException($"unknown formation \"{name}\"");
                return f;
            }
            Dictionary<string, string> SetByName(Dictionary<string, string> form, string name)
            {
                string folder = form["asset"].Substring(0, form["asset"].LastIndexOf('/') + 1);
                var s = sets.FirstOrDefault(x => x["asset"].StartsWith(folder) && Norm(x["setName"]) == Norm(name));
                if (s == null && !collect) throw new InvalidOperationException($"unknown set \"{name}\" in {form["formationName"]}");
                return s;
            }
            Dictionary<string, string> PlayInSet(Dictionary<string, string> set, string name)
            {
                var p = plays.FirstOrDefault(x => x["set"] == set["asset"] && Norm(x["playName"]) == Norm(name));
                if (p == null && !collect) throw new InvalidOperationException($"unknown play \"{name}\" in set {set["setName"]}");
                return p;
            }
            long Plyt(Dictionary<string, string> p)
            {
                string type = p["offensePlayType"] != "OffensePlayType_DontCare" ? p["offensePlayType"] : p["defensePlayType"];
                long v = EnumValue("OffensePlayType", type);
                if (v < 0) v = EnumValue("DefensePlayType", type);
                if (v < 0) throw new InvalidOperationException($"no PLYT for {type}");
                return v;
            }
            long Situation(string name)
            {
                long v = EnumValue("Offense_PlayCallSituation", "Offense_PlayCallSituation_" + name);
                if (v < 0) throw new InvalidOperationException($"unknown situation \"{name}\"");
                return v;
            }

            long book = T["PGPL"].Rows.Count > 0 ? T["PGPL"].Rows[0]["BOKL"] : 32764;
            var o = new Dictionary<string, List<Dictionary<string, long>>> { ["PGFM"] = new List<Dictionary<string, long>>(), ["STID"] = new List<Dictionary<string, long>>(), ["PGPL"] = new List<Dictionary<string, long>>(), ["PBAI"] = new List<Dictionary<string, long>>() };

            foreach (Dictionary<string, object> fspec in (IList)spec["formations"])
            {
                var form = FormByName((string)fspec["formation"]);
                if (form == null) continue; // collect pass: custom formation not built yet
                long formId = long.Parse(form["formId"]);
                o["PGFM"].Add(Copy(T["PGFM"].Rows.Where(r => r["PBFM"] == formId).Take(1)).FirstOrDefault()
                    ?? new Dictionary<string, long> { ["BOKL"] = book, ["PBFM"] = formId, ["SRFM"] = formId });

                if (fspec["sets"] is string s0 && s0 == "template")
                {
                    if (!T["STID"].Rows.Any(r => r["PBFM"] == formId))
                        throw new InvalidOperationException($"\"{fspec["formation"]}\" (formId {formId}) has no sets in the template, so \"template\" would drop it");
                    foreach (var s in T["STID"].Rows.Where(r => r["PBFM"] == formId))
                    {
                        o["STID"].Add(new Dictionary<string, long>(s));
                        var rows = T["PGPL"].Rows.Where(p => p["SETL"] == s["SETL"]).OrderBy(p => p["ord_"]).ToList();
                        for (int i = 0; i < rows.Count; i++) { var r = new Dictionary<string, long>(rows[i]) { ["BOKL"] = book, ["ord_"] = i }; o["PGPL"].Add(r); }
                        o["PBAI"].AddRange(Copy(T["PBAI"].Rows.Where(r => rows.Any(p => p["PLYL"] == r["PLYL"]))));
                    }
                    continue;
                }

                foreach (Dictionary<string, object> sspec in (IList)fspec["sets"])
                {
                    var set = SetByName(form, (string)sspec["set"]);
                    if (set == null) continue; // collect pass: custom set not built yet
                    long setId = long.Parse(set["setId"]);
                    o["STID"].Add(Copy(T["STID"].Rows.Where(r => r["SETL"] == setId).Take(1)).FirstOrDefault()
                        ?? new Dictionary<string, long> { ["BOKL"] = book, ["SETL"] = setId, ["PBFM"] = formId, ["PBST"] = setId, ["SPF_"] = 0 });
                    var used = new HashSet<int>();
                    var pl = (IList)sspec["plays"];
                    for (int i = 0; i < pl.Count; i++)
                    {
                        var pspec = (Dictionary<string, object>)pl[i];
                        var p = PlayInSet(set, (string)pspec["play"]);
                        if (p == null) continue;
                        int audible = pspec.TryGetValue("audible", out object a) && a != null ? (int)L(a) : 0;
                        if (audible != 0 && !AudibleBits.ContainsKey(audible)) throw new InvalidOperationException($"{pspec["play"]}: audible slot must be 1-4");
                        if (audible != 0 && used.Contains(audible)) throw new InvalidOperationException($"{sspec["set"]}: audible slot {audible} used twice");
                        used.Add(audible);
                        long playId = long.Parse(p["playId"]);
                        o["PGPL"].Add(new Dictionary<string, long> { ["BOKL"] = book, ["SETL"] = setId, ["PLYL"] = playId, ["PBST"] = setId, ["PLYT"] = Plyt(p), ["ord_"] = i, ["Flag"] = audible != 0 ? AudibleBits[audible] : 0 });
                        // CPU situation weights: explicit "cpu" wins, otherwise keep whatever the template had for this play
                        if (pspec.TryGetValue("cpu", out object cpu) && cpu is Dictionary<string, object> weights)
                            foreach (var kv in weights) o["PBAI"].Add(new Dictionary<string, long> { ["BOKL"] = book, ["PLYL"] = playId, ["AIGR"] = Situation(kv.Key), ["prct"] = L(kv.Value) });
                        else o["PBAI"].AddRange(Copy(T["PBAI"].Rows.Where(r => r["PLYL"] == playId)));
                    }
                }
            }

            foreach (var kv in o) Tdb.WriteTable(buf, T[kv.Key], kv.Value);

            // The game drops library plays that aren't in the global play sheet, so the mod build must pull them in.
            var pull = File.Exists(pullFile) ? ((object[])Json().DeserializeObject(File.ReadAllText(pullFile))).Cast<string>().ToList() : new List<string>();
            foreach (var row in o["PGPL"])
            {
                var p = plays.FirstOrDefault(x => long.Parse(x["playId"]) == row["PLYL"] && x.ContainsKey("global"));
                if (p != null && p["global"] == "0" && !pull.Contains(p["asset"]))
                {
                    pull.Add(p["asset"]);
                    log($"\"{p["playName"]}\" is hidden from custom playbooks; the mod will pull it in");
                }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(pullFile));
            File.WriteAllText(pullFile, "[\n" + string.Join(",\n", pull.Select(x => "  " + Json().Serialize(x))) + (pull.Count > 0 ? "\n" : "") + "]");
            if (collect) return null;

            // save timestamp in the FBCHUNKS header: u16 year, month, day, hour, minute, second at 0x16
            DateTime now = DateTime.Now;
            int[] stamp = { now.Year, now.Month, now.Day, now.Hour, now.Minute, now.Second };
            for (int i = 0; i < 6; i++) { buf[0x16 + i * 2] = (byte)stamp[i]; buf[0x17 + i * 2] = (byte)(stamp[i] >> 8); }

            var bad = Tdb.BadCrcs(buf);
            if (bad.Count > 0) throw new InvalidOperationException("CRC mismatch after write: " + string.Join(", ", bad));
            File.WriteAllBytes(outFile, buf);
            return $"{o["PGFM"].Count} formations, {o["STID"].Count} sets, {o["PGPL"].Count} plays";
        }
    }
}
