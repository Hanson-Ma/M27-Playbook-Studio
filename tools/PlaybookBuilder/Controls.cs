using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PlaybookBuilder
{
    public abstract class Painted : Control
    {
        protected float S => DeviceDpi / 96f;
        protected Painted() { SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true); BackColor = Theme.Bg; }
        protected static void Text_(Graphics g, string s, Font f, Color c, RectangleF r, StringAlignment h = StringAlignment.Near, bool wrap = false)
        {
            using (var b = new SolidBrush(c))
            using (var fmt = new StringFormat { Alignment = h, LineAlignment = wrap ? StringAlignment.Near : StringAlignment.Center, Trimming = StringTrimming.EllipsisPath })
            {
                if (!wrap) fmt.FormatFlags = StringFormatFlags.NoWrap;
                g.DrawString(s ?? "", f, b, r, fmt);
            }
        }
    }

    public sealed class RoundButton : Painted
    {
        public bool Primary;
        bool hover, down;
        public RoundButton() { Cursor = Cursors.Hand; }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Theme.Smooth(g);
            var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
            using (var path = Theme.Round(r, 7 * S))
            {
                if (Primary)
                    using (var b = new SolidBrush(down ? Theme.AccentHover : hover ? Color.FromArgb(37, 88, 228) : Theme.Accent)) g.FillPath(b, path);
                else
                {
                    using (var b = new SolidBrush(down ? Theme.Line : hover ? Theme.Surface : Theme.Bg)) g.FillPath(b, path);
                    using (var p = new Pen(Theme.Line, S)) g.DrawPath(p, path);
                }
            }
            Text_(g, Text, Font, Primary ? Color.White : Theme.Ink, new RectangleF(0, 0, Width, Height), StringAlignment.Center);
        }
    }

    public enum RowState { Checking, Ok, Missing, Pending, Running, Done, Failed, Item }

    // icon + label + value on the right; optional link ("Locate…") at the far right
    public sealed class StatusRow : Painted
    {
        public RowState State;
        public string Label, Value, Link;
        public Font ValueFont;
        public event EventHandler LinkClicked;
        RectangleF linkRect;
        float spin;
        readonly Timer timer = new Timer { Interval = 40 };
        public StatusRow() { timer.Tick += (s, e) => { spin = (spin + 18) % 360; Invalidate(); }; }
        public void Set(RowState st, string value = null) { State = st; if (value != null) Value = value; timer.Enabled = st == RowState.Checking || st == RowState.Running; Invalidate(); }
        protected override void OnMouseMove(MouseEventArgs e) { Cursor = Link != null && linkRect.Contains(e.Location) ? Cursors.Hand : Cursors.Default; base.OnMouseMove(e); }
        protected override void OnMouseClick(MouseEventArgs e) { if (Link != null && linkRect.Contains(e.Location)) LinkClicked?.Invoke(this, EventArgs.Empty); base.OnMouseClick(e); }
        protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Theme.Smooth(g);
            float d = 14 * S, cy = Height / 2f;
            DrawIcon(g, new RectangleF(0, cy - d / 2, d, d));
            float x = d + 9 * S, right = Width;
            if (Link != null)
            {
                SizeF ls = g.MeasureString(Link, Font);
                linkRect = new RectangleF(right - ls.Width, 0, ls.Width, Height);
                Text_(g, Link, Font, Theme.Accent, linkRect, StringAlignment.Far);
                right -= ls.Width + 10 * S;
            }
            SizeF lab = g.MeasureString(Label, Font);
            Color labelColor = State == RowState.Pending ? Theme.Muted : Theme.Ink;
            Text_(g, Label, Font, labelColor, new RectangleF(x, 0, lab.Width + 2, Height));
            Color vc = State == RowState.Missing || State == RowState.Failed ? Theme.Bad : Theme.Muted;
            float vx = x + lab.Width + 8 * S;
            if (right > vx) Text_(g, Value, ValueFont ?? Font, vc, new RectangleF(vx, 0, right - vx, Height), StringAlignment.Far);
        }

        void DrawIcon(Graphics g, RectangleF r)
        {
            switch (State)
            {
                case RowState.Ok: case RowState.Done:
                    using (var b = new SolidBrush(Theme.Good)) g.FillEllipse(b, r);
                    using (var p = new Pen(Color.White, 1.8f * S) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                        g.DrawLines(p, new[] { new PointF(r.X + r.Width * .28f, r.Y + r.Height * .52f), new PointF(r.X + r.Width * .44f, r.Y + r.Height * .68f), new PointF(r.X + r.Width * .73f, r.Y + r.Height * .35f) });
                    break;
                case RowState.Missing: case RowState.Failed:
                    using (var b = new SolidBrush(Theme.Bad)) g.FillEllipse(b, r);
                    using (var p = new Pen(Color.White, 1.8f * S) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    {
                        float k = r.Width * .3f;
                        g.DrawLine(p, r.X + k, r.Y + k, r.Right - k, r.Bottom - k); g.DrawLine(p, r.Right - k, r.Y + k, r.X + k, r.Bottom - k);
                    }
                    break;
                case RowState.Item:
                    using (var b = new SolidBrush(Theme.Surface)) using (var path = Theme.Round(new RectangleF(r.X + S, r.Y + S, r.Width - 2 * S, r.Height - 2 * S), 3 * S)) { g.FillPath(b, path); using (var p = new Pen(Theme.Muted, 1.2f * S)) g.DrawPath(p, path); }
                    using (var p = new Pen(Theme.Muted, 1.2f * S)) { g.DrawLine(p, r.X + r.Width * .35f, r.Y + r.Height * .42f, r.Right - r.Width * .3f, r.Y + r.Height * .42f); g.DrawLine(p, r.X + r.Width * .35f, r.Y + r.Height * .62f, r.Right - r.Width * .38f, r.Y + r.Height * .62f); }
                    break;
                case RowState.Pending:
                    using (var p = new Pen(Theme.Line, 1.5f * S)) g.DrawEllipse(p, r.X + S, r.Y + S, r.Width - 2 * S, r.Height - 2 * S);
                    break;
                default:
                    using (var p = new Pen(Theme.Line, 1.8f * S)) g.DrawEllipse(p, r.X + S, r.Y + S, r.Width - 2 * S, r.Height - 2 * S);
                    using (var p = new Pen(Theme.Accent, 1.8f * S) { StartCap = LineCap.Round, EndCap = LineCap.Round }) g.DrawArc(p, r.X + S, r.Y + S, r.Width - 2 * S, r.Height - 2 * S, spin, 100);
                    break;
            }
        }
    }

    // read-only path box (click "Change" next to it)
    public sealed class PathField : Painted
    {
        public string Path_;
        public string Placeholder = "Not set";
        public void Set(string p) { Path_ = p; Invalidate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Theme.Smooth(g);
            using (var path = Theme.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), 7 * S))
            {
                using (var b = new SolidBrush(Theme.Surface)) g.FillPath(b, path);
                using (var p = new Pen(Theme.Line, S)) g.DrawPath(p, path);
            }
            bool empty = string.IsNullOrEmpty(Path_);
            Text_(g, empty ? Placeholder : Path_, Font, empty ? Theme.Muted : Theme.Ink, new RectangleF(9 * S, 0, Width - 18 * S, Height));
        }
    }

    // success / error box: bold title, wrapped body
    public sealed class Notice : Painted
    {
        public bool Error;
        public string Title, Body;
        public Font TitleFont;
        public int Measure(int width)
        {
            using (var g = CreateGraphics())
            {
                float h = g.MeasureString(Body ?? "", Font, (int)(width - 24 * S)).Height;
                return (int)(12 * S + TitleFont.GetHeight(g) + 4 * S + h + 12 * S);
            }
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Theme.Smooth(g);
            Color fg = Error ? Theme.Bad : Theme.Good;
            using (var path = Theme.Round(new RectangleF(0, 0, Width - 1, Height - 1), 8 * S))
            using (var b = new SolidBrush(Error ? Theme.BadBg : Theme.GoodBg)) g.FillPath(b, path);
            float th = TitleFont.GetHeight(g);
            Text_(g, Title, TitleFont, fg, new RectangleF(12 * S, 12 * S, Width - 24 * S, th));
            using (var br = new SolidBrush(fg)) g.DrawString(Body ?? "", Font, br, new RectangleF(12 * S, 12 * S + th + 4 * S, Width - 24 * S, Height));
        }
    }

    public sealed class Bar : Painted
    {
        public float Value; // 0..1
        public bool Error;
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; Theme.Smooth(g);
            float h = Height;
            using (var b = new SolidBrush(Theme.Line)) using (var p = Theme.Round(new RectangleF(0, 0, Width, h), h / 2)) g.FillPath(b, p);
            if (Value > 0)
                using (var b = new SolidBrush(Error ? Theme.Bad : Value >= 1 ? Theme.Good : Theme.Accent))
                using (var p = Theme.Round(new RectangleF(0, 0, Math.Max(h, Width * Math.Min(1, Value)), h), h / 2)) g.FillPath(b, p);
        }
    }

    // Windows' modern folder picker (IFileOpenDialog + FOS_PICKFOLDERS)
    public static class FolderPicker
    {
        public static string Pick(IWin32Window owner, string title, string start)
        {
            var dlg = (IFileOpenDialog)new FileOpenDialogRCW();
            try
            {
                dlg.GetOptions(out uint opts);
                dlg.SetOptions(opts | 0x20 | 0x40); // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
                dlg.SetTitle(title);
                if (!string.IsNullOrEmpty(start) && System.IO.Directory.Exists(start) && SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out IShellItem item) == 0)
                    dlg.SetFolder(item);
                if (dlg.Show(owner?.Handle ?? IntPtr.Zero) != 0) return null;
                dlg.GetResult(out IShellItem res);
                res.GetDisplayName(0x80058000, out IntPtr p); // SIGDN_FILESYSPATH
                string path = Marshal.PtrToStringUni(p); Marshal.FreeCoTaskMem(p);
                return path;
            }
            finally { Marshal.ReleaseComObject(dlg); }
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem item);

        [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogRCW { }

        [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IFileOpenDialog
        {
            [PreserveSig] int Show(IntPtr parent);
            void SetFileTypes(); void SetFileTypeIndex(); void GetFileTypeIndex(); void Advise(); void Unadvise();
            void SetOptions(uint fos); void GetOptions(out uint fos);
            void SetDefaultFolder(IShellItem psi); void SetFolder(IShellItem psi); void GetFolder(); void GetCurrentSelection();
            void SetFileName(); void GetFileName();
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
            void SetOkButtonLabel(); void SetFileNameLabel();
            void GetResult(out IShellItem psi);
        }

        [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItem
        {
            void BindToHandler(); void GetParent();
            void GetDisplayName(uint sigdn, out IntPtr name);
        }
    }
}
