using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace PlayDump
{
    // Reads the profile Key1 from the user's own MMC install: FrostyCore's profile window builds it from a 16-byte
    // array initializer (ldtoken <field>; call InitializeArray) right after loading the string "Key1".
    // Nothing is shipped with this tool; a key1.local.bin next to the tool still wins when present.
    public static class KeyFinder
    {
        public static byte[] Find(string editorDir, string localFile)
        {
            if (localFile != null && File.Exists(localFile)) return File.ReadAllBytes(localFile);
            Assembly core = Assembly.LoadFrom(Path.Combine(editorDir, "FrostyCore.dll"));
            Type t = core.GetType("Frosty.Core.Windows.FrostyProfileTaskWindow", false);
            if (t == null) throw new InvalidOperationException("FrostyCore.dll has no profile window; is this an MMC Editor folder?");
            const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
            var methods = t.GetMethods(all).Cast<MethodBase>().Concat(t.GetConstructors(all))
                .Concat(t.GetNestedTypes(BindingFlags.NonPublic | BindingFlags.Public).SelectMany(n => n.GetMethods(all)));
            byte[] fallback = null;
            foreach (MethodBase m in methods)
            {
                byte[] il;
                try { il = m.GetMethodBody()?.GetILAsByteArray(); } catch { continue; }
                if (il == null) continue;
                string lastString = null;
                for (int i = 0; i + 4 < il.Length; i++)
                {
                    int token = BitConverter.ToInt32(il, i + 1);
                    if (il[i] == 0x72 && (token >> 24) == 0x70)
                    {
                        try { lastString = m.Module.ResolveString(token); } catch { }
                        continue;
                    }
                    if (il[i] != 0xD0 || (token >> 24) != 0x04) continue;
                    FieldInfo f;
                    try { f = m.Module.ResolveField(token); } catch { continue; }
                    if (!f.IsStatic || (f.Attributes & FieldAttributes.HasFieldRVA) == 0 || !f.FieldType.IsValueType || Marshal.SizeOf(f.FieldType) != 16) continue;
                    var key = new byte[16];
                    RuntimeHelpers.InitializeArray(key, f.FieldHandle);
                    if (lastString == "Key1") return key;
                    fallback = fallback ?? key;
                }
            }
            return fallback ?? throw new InvalidOperationException("couldn't find the profile key in FrostyCore.dll");
        }
    }
}
