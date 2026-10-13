using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

namespace PlaybookBuilder
{
    // Colors and fonts: the same dark palette and typeface as the Playbook Studio web app (app/src/styles/tokens.css).
    // Public Sans (free, OFL) is embedded in the exe; Segoe UI is the fallback if it can't load.
    public static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(14, 16, 19),            // --bg-1 panels
            Surface = Color.FromArgb(21, 24, 28),                                // --bg-2 raised / fields
            Line = Color.FromArgb(38, 42, 48),                                   // --line
            Ink = Color.FromArgb(243, 244, 246),                                 // --text
            Muted = Color.FromArgb(123, 129, 138),                               // --text-3
            Accent = Color.FromArgb(31, 86, 224),                                // --blue
            AccentHover = Color.FromArgb(24, 66, 184),                           // pressed
            AccentLight = Color.FromArgb(61, 116, 255),                          // --blue-2 (hover)
            Link = Color.FromArgb(90, 169, 255),                                 // --info (readable on dark)
            Good = Color.FromArgb(47, 179, 107), GoodBg = Color.FromArgb(19, 39, 31),   // --green
            Bad = Color.FromArgb(239, 68, 88), BadBg = Color.FromArgb(46, 23, 29);      // --danger

        static readonly List<PrivateFontCollection> keep = new List<PrivateFontCollection>();
        static FontFamily regular, strong;

        public static void Load()
        {
            // The embedded TTFs (tools\PlaybookBuilder\fonts, PlaybookBuilder.fonts.<file>); GDI+ keeps reading the memory, so it's never freed.
            FontFamily Embedded(string file)
            {
                try
                {
                    using (var s = typeof(Theme).Assembly.GetManifestResourceStream("PlaybookBuilder.fonts." + file))
                    {
                        if (s == null) return null;
                        var bytes = new byte[s.Length]; s.Read(bytes, 0, bytes.Length);
                        IntPtr mem = Marshal.AllocCoTaskMem(bytes.Length); Marshal.Copy(bytes, 0, mem, bytes.Length);
                        var pfc = new PrivateFontCollection(); pfc.AddMemoryFont(mem, bytes.Length); keep.Add(pfc);
                        return pfc.Families[0];
                    }
                }
                catch { return null; }
            }
            // Body and labels run Medium (the web app's chrome weight); titles and buttons Bold.
            regular = Embedded("PublicSans-Medium.ttf") ?? Embedded("PublicSans-Regular.ttf") ?? new FontFamily("Segoe UI");
            strong = Embedded("PublicSans-Bold.ttf") ?? SafeFamily("Segoe UI Semibold") ?? regular;
        }

        static FontFamily SafeFamily(string name) { try { return new FontFamily(name); } catch { return null; } }

        static Font Make(FontFamily f, float px) =>
            new Font(f, px, f.IsStyleAvailable(FontStyle.Regular) ? FontStyle.Regular : FontStyle.Bold, GraphicsUnit.Pixel);

        public static Font Body(float px) => Make(regular, px);
        public static Font Strong(float px) => Make(strong, px);
        public static Font Light(float px) => Make(regular, px);

        public static GraphicsPath Round(RectangleF r, float radius)
        {
            var p = new GraphicsPath();
            float d = radius * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        /// <summary>Dark title bar (Windows 10 1903+ / 11), in the window background color on Windows 11.</summary>
        public static void DarkTitleBar(IntPtr hwnd)
        {
            try
            {
                int on = 1;
                if (DwmSetWindowAttribute(hwnd, 20, ref on, 4) != 0) DwmSetWindowAttribute(hwnd, 19, ref on, 4); // IMMERSIVE_DARK_MODE
                int caption = Bg.R | Bg.G << 8 | Bg.B << 16, text = Ink.R | Ink.G << 8 | Ink.B << 16;
                DwmSetWindowAttribute(hwnd, 35, ref caption, 4); // CAPTION_COLOR
                DwmSetWindowAttribute(hwnd, 36, ref text, 4);    // TEXT_COLOR
            }
            catch { }
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
        public string Playbook { get; set; } // file name of the playbook picked in the window, e.g. FUSION.json

        static string File_ => Path.Combine(BuildRunner.DataDir, "settings.json");

        public static Settings Load()
        {
            try { return new JavaScriptSerializer().Deserialize<Settings>(File.ReadAllText(File_)) ?? new Settings(); } catch { return new Settings(); }
        }

        public void Save() { try { File.WriteAllText(File_, new JavaScriptSerializer().Serialize(this)); } catch { } }
    }
}
