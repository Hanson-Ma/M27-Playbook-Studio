using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Frosty.Core;
using FrostySdk;
using FrostySdk.IO;
using FrostySdk.Ebx;
using FrostySdk.Managers;
using FrostySdk.Managers.Entries;
using Newtonsoft.Json.Linq;

namespace PlayDump
{
    // Game-side tweaks as their own mod (see mods/tweaks.json):
    //  "legacyJson": { "<legacy file>": { "<KEY>": value } } - set keys in legacy JSON files (text edit, formatting kept)
    //  "subLevels":  { "<SubLevelMap asset>": { "<KeyId>": "<sub world>" } } - point a stadium id at another level
    internal static class Tweaks
    {
        public static int Run(AssetManager am, string projectPath, string modPath, string specPath)
        {
            JObject spec = JObject.Parse(File.ReadAllText(specPath));

            foreach (JProperty file in ((JObject)spec["legacyJson"] ?? new JObject()).Properties())
            {
                AssetEntry entry = am.GetCustomAssetEntry("legacy", file.Name) ?? throw new InvalidOperationException("legacy file not found: " + file.Name);
                string text;
                using (Stream s = am.GetCustomAsset("legacy", entry)) using (var r = new StreamReader(s)) text = r.ReadToEnd();
                foreach (JProperty kv in ((JObject)file.Value).Properties())
                {
                    var re = new Regex("(\"" + Regex.Escape(kv.Name) + "\"\\s*:\\s*)([^,\\r\\n}]+)");
                    var hits = re.Matches(text);
                    if (hits.Count != 1) throw new InvalidOperationException($"{file.Name}: {kv.Name} found {hits.Count} times (need exactly 1)");
                    string value = kv.Value.Type == JTokenType.Boolean ? ((bool)kv.Value ? "true" : "false") : kv.Value.ToString(Newtonsoft.Json.Formatting.None);
                    Console.Error.WriteLine($"{file.Name}: {kv.Name} {hits[0].Groups[2].Value.Trim()} -> {value}");
                    text = re.Replace(text, m => m.Groups[1].Value + value);
                }
                JToken.Parse(text); // still valid JSON
                am.ModifyCustomAsset("legacy", file.Name, Encoding.UTF8.GetBytes(text));
            }

            foreach (JProperty map in ((JObject)spec["subLevels"] ?? new JObject()).Properties())
            {
                EbxAssetEntry e = am.GetEbxEntry(map.Name) ?? throw new InvalidOperationException("asset not found: " + map.Name);
                EbxAsset asset = am.GetEbx(e);
                dynamic root = asset.RootObject;
                foreach (JProperty kv in ((JObject)map.Value).Properties())
                {
                    int key = int.Parse(kv.Name);
                    dynamic item = ((IEnumerable<object>)root.SublevelItems).Cast<dynamic>().FirstOrDefault(i => (int)i.KeyId == key)
                        ?? throw new InvalidOperationException($"{map.Name}: no KeyId {key}");
                    Console.Error.WriteLine($"{map.Name}: KeyId {key} {item.SubWorldName} -> {kv.Value}");
                    item.SubWorldName = new CString((string)kv.Value);
                }
                am.ModifyEbx(e.Name, asset);
            }

            var project = new FrostyProject();
            project.ModSettings.Title = (string)spec["title"] ?? "Game tweaks";
            project.ModSettings.Author = "2026 Playbook";
            project.ModSettings.Version = (string)spec["version"] ?? "0.1.0";
            project.ModSettings.Description = (string)spec["description"] ?? "";
            project.Save(projectPath, updateDirtyState: false);
            project.WriteToMod(modPath, project.ModSettings);
            Console.Error.WriteLine("saved " + projectPath + " and " + modPath);
            return 0;
        }
    }
}
