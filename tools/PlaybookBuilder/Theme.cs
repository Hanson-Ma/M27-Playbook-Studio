using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;

namespace PlaybookBuilder
{
    // Colors and fonts. PP Fraktion Sans is loaded from fonts\ next to the exe when present (it's a licensed font, so it
    // isn't bundled); otherwise Segoe UI.
    public static class Theme
    {
        public static readonly Color Bg = Color.White, Surface = Color.FromArgb(246, 246, 244), Line = Color.FromArgb(226, 224, 219),
            Ink = Color.FromArgb(23, 24, 26), Muted = Color.FromArgb(118, 122, 129), Accent = Color.FromArgb(29, 78, 216), AccentHover = Color.FromArgb(30, 64, 175),
            Good = Color.FromArgb(21, 128, 61), GoodBg = Color.FromArgb(230, 244, 236), Bad = Color.FromArgb(180, 35, 24), BadBg = Color.FromArgb(253, 236, 234);

        static readonly List<PrivateFontCollection> keep = new List<PrivateFontCollection>();
        static FontFamily regular, semibold, light;

        public static void Load()
        {
            string dir = Path.Combine(BuildRunner.AppDir, "fonts");
            FontFamily Pick(string weight)
            {
                string file = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.ttf").Concat(Directory.GetFiles(dir, "*.otf"))
                    .FirstOrDefault(f => Path.GetFileNameWithoutExtension(f).EndsWith("-" + weight, StringComparison.OrdinalIgnoreCase)) : null;
                if (file == null) return null;
                try { var pfc = new PrivateFontCollection(); pfc.AddFontFile(file); keep.Add(pfc); return pfc.Families[0]; } catch { return null; }
            }
            regular = Pick("Regular") ?? new FontFamily("Segoe UI");
            semibold = Pick("Semibold") ?? Pick("Bold") ?? SafeFamily("Segoe UI Semibold") ?? regular;
            light = Pick("Light") ?? SafeFamily("Segoe UI Light") ?? regular;
        }

        static FontFamily SafeFamily(string name) { try { return new FontFamily(name); } catch { return null; } }

        static Font Make(FontFamily f, float px) =>
            new Font(f, px, f.IsStyleAvailable(FontStyle.Regular) ? FontStyle.Regular : FontStyle.Bold, GraphicsUnit.Pixel);

        public static Font Body(float px) => Make(regular, px);
        public static Font Strong(float px) => Make(semibold, px);
        public static Font Light(float px) => Make(light, px);

        public static GraphicsPath Round(RectangleF r, float radius)
        {
            var p = new GraphicsPath();
            float d = radius * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static void Smooth(Graphics g) { g.SmoothingMode = SmoothingMode.AntiAlias; g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit; g.PixelOffsetMode = PixelOffsetMode.HighQuality; }
    }

    // Remembered choices, in %LOCALAPPDATA%\PlaybookBuilder\settings.json.
    public sealed class Settings
    {
        public string EditorDir { get; set; }
        public string GameDir { get; set; }
        public string PlaybookDir { get; set; }
        public string OutputDir { get; set; }

        static string File_ => Path.Combine(BuildRunner.DataDir, "settings.json");

        public static Settings Load()
        {
            try { return new JavaScriptSerializer().Deserialize<Settings>(File.ReadAllText(File_)) ?? new Settings(); } catch { return new Settings(); }
        }

        public void Save() { try { File.WriteAllText(File_, new JavaScriptSerializer().Serialize(this)); } catch { } }
    }
}
