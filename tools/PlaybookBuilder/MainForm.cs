using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using PlayDump;

namespace PlaybookBuilder
{
    public sealed class MainForm : Form
    {
        const int ContentW = 330, Pad = 20;
        readonly Settings settings = Settings.Load();
        float S = 1;

        // setup view
        readonly Label title = new Label(), subtitle = new Label(), toolsLabel = new Label(), folderLabel = new Label(), outLabel = new Label(), buildLabel = new Label(), caption = new Label();
        readonly StatusRow rowEditor = new StatusRow { Label = "MMC Editor", Link = "Locate…" }, rowGame = new StatusRow { Label = "Madden NFL 27", Link = "Locate…" },
            rowKey = new StatusRow { Label = "Game key" }, rowCache = new StatusRow { Label = "MMC cache" };
        readonly PathField folderField = new PathField { Placeholder = "Pick the folder containing your playbook mod" }, outField = new PathField();
        readonly RoundButton folderChange = new RoundButton { Text = "Change" }, outChange = new RoundButton { Text = "Change" }, build = new RoundButton { Text = "Build and install", Primary = true };
        readonly List<StatusRow> bookRows = new List<StatusRow>();

        // run view
        readonly StatusRow[] stepRows = BuildRunner.Steps.Select(s => new StatusRow { Label = s }).ToArray();
        readonly Bar bar = new Bar();
        readonly Notice notice = new Notice();
        readonly RoundButton again = new RoundButton { Text = "Build again", Primary = true }, showFiles = new RoundButton { Text = "Show files" }, back = new RoundButton { Text = "Back" };

        bool running, runView, showNotice, keyOk, editorOk, gameOk, cacheOk;
        BuildRunner.Result lastResult;

        public MainForm()
        {
            Text = "Playbook Builder";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Bg;
            AutoScaleMode = AutoScaleMode.None;
            Icon = MakeIcon();
            foreach (var l in new[] { title, subtitle, toolsLabel, folderLabel, outLabel, buildLabel, caption }) { l.AutoSize = false; l.BackColor = Theme.Bg; l.UseCompatibleTextRendering = true; }
            title.Text = "Playbook Builder"; subtitle.Text = "Builds your playbook mod for Madden NFL 27";
            toolsLabel.Text = "Tools"; folderLabel.Text = "Playbook folder"; outLabel.Text = "Save mod files to"; buildLabel.Text = "Will build"; caption.Text = "Close Madden first";
            caption.TextAlign = ContentAlignment.MiddleCenter;
            Controls.AddRange(new Control[] { title, subtitle, toolsLabel, rowEditor, rowGame, rowKey, rowCache, folderLabel, folderField, folderChange, outLabel, outField, outChange, buildLabel, build, caption, bar, notice, again, showFiles, back });
            Controls.AddRange(stepRows);

            rowEditor.LinkClicked += (s, e) => LocateExe("Find MMCEditor.exe", "MMC Editor|MMCEditor.exe", settings.EditorDir, dir =>
            {
                if (!GamePaths.IsEditorDir(dir)) { Say("That folder doesn't have MMC Editor with Madden 27 support. Pick MMCEditor.exe from your MMC Modding Tools download."); return; }
                settings.EditorDir = dir; settings.Save(); CheckTools();
            });
            rowGame.LinkClicked += (s, e) => LocateExe("Find Madden27.exe", "Madden NFL 27|" + GamePaths.GameExe, settings.GameDir, dir =>
            {
                settings.GameDir = dir; settings.Save(); CheckTools();
            });
            folderChange.Click += (s, e) =>
            {
                string dir = FolderPicker.Pick(this, "Pick the folder containing your playbook mod", settings.PlaybookDir);
                if (dir == null) return;
                if (!BuildRunner.IsPlaybookDir(dir)) { Say("That isn't a playbook folder. Pick the folder containing your playbook mod: the one with playbooks, research and tools inside."); return; }
                bool defaultOut = settings.OutputDir == null || (settings.PlaybookDir != null && string.Equals(settings.OutputDir, Path.Combine(settings.PlaybookDir, "mods"), StringComparison.OrdinalIgnoreCase));
                settings.PlaybookDir = dir;
                if (defaultOut) settings.OutputDir = Path.Combine(dir, "mods");
                settings.Save(); RefreshFolders();
            };
            outChange.Click += (s, e) =>
            {
                string dir = FolderPicker.Pick(this, "Where should the .fbmod and .fbproject go?", settings.OutputDir);
                if (dir == null) return;
                settings.OutputDir = dir; settings.Save(); RefreshFolders();
            };
            build.Click += (s, e) => StartBuild();
            again.Click += (s, e) => StartBuild();
            back.Click += (s, e) => { runView = false; Relayout(); };
            showFiles.Click += (s, e) =>
            {
                if (notice.Error) { if (File.Exists(BuildRunner.LogFile)) Process.Start("notepad.exe", "\"" + BuildRunner.LogFile + "\""); }
                else if (lastResult?.ModFile != null && File.Exists(lastResult.ModFile)) Process.Start("explorer.exe", "/select,\"" + lastResult.ModFile + "\"");
            };
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            if (!BuildRunner.IsPlaybookDir(settings.PlaybookDir)) settings.PlaybookDir = BuildRunner.FindPlaybookDir();
            if (settings.OutputDir == null && settings.PlaybookDir != null) settings.OutputDir = Path.Combine(settings.PlaybookDir, "mods");
            settings.Save();
            RefreshFolders();
            CheckTools();
        }

        protected override void OnDpiChanged(DpiChangedEventArgs e) { base.OnDpiChanged(e); Relayout(); }

        // ---------- test hooks (--shot) ----------
        public string ShotFile, ShotState;
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (ShotFile == null) return;
            bool started = false;
            var t = new Timer { Interval = 250 };
            t.Tick += (s, a) =>
            {
                if (new[] { rowEditor, rowGame, rowKey, rowCache }.Any(r => r.State == RowState.Checking)) return;
                if (ShotState == "build")
                {
                    if (!started) { started = true; StartBuild(); return; }
                    if (running) return;
                }
                else Fake(ShotState);
                t.Stop();
                Shot(ShotFile);
                Close();
            };
            t.Start();
        }

        void Fake(string state)
        {
            if (state == "setup") return;
            runView = true;
            for (int i = 0; i < stepRows.Length; i++) stepRows[i].Set(RowState.Pending, "");
            if (state == "running")
            {
                stepRows[0].Set(RowState.Done, "2 playbooks"); stepRows[1].Set(RowState.Running, "Reading the game…"); bar.Value = 0.35f;
                running = true; Relayout(); running = false; return;
            }
            stepRows[0].Set(RowState.Done, "2 playbooks");
            if (state == "error")
            {
                stepRows[1].Set(RowState.Failed, ""); bar.Value = 0.35f; bar.Error = true;
                notice.Error = true; notice.Title = "Build failed"; notice.Body = "Madden is running. Close it, then build again."; showFiles.Text = "Show log";
            }
            else
            {
                stepRows[1].Set(RowState.Done, "pbstudio.fbmod"); stepRows[2].Set(RowState.Done, "2"); stepRows[3].Set(RowState.Done, "old copies backed up"); bar.Value = 1;
                notice.Error = false; notice.Title = "Installed STUDIO, STUDIOLIB"; notice.Body = "Next, in MMC Mod Manager: add or refresh pbstudio.fbmod, Apply, then Launch.";
            }
            showNotice = true;
            Relayout();
        }

        void Shot(string file)
        {
            foreach (var r in Controls.OfType<StatusRow>()) r.Set(r.State == RowState.Checking ? RowState.Checking : r.State == RowState.Running ? RowState.Running : r.State);
            using (var bmp = new Bitmap(ClientSize.Width, ClientSize.Height))
            {
                using (var g = Graphics.FromImage(bmp)) g.Clear(Theme.Bg);
                foreach (Control c in Controls.Cast<Control>().Where(c => c.Visible).Reverse())
                    c.DrawToBitmap(bmp, c.Bounds);
                bmp.Save(file, System.Drawing.Imaging.ImageFormat.Png);
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (running && MessageBox.Show(this, "A build is still running. Close anyway?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) e.Cancel = true;
            base.OnFormClosing(e);
        }

        void Say(string msg) => MessageBox.Show(this, msg, Text, MessageBoxButtons.OK, MessageBoxIcon.Information);

        void LocateExe(string title, string filter, string start, Action<string> done)
        {
            using (var d = new OpenFileDialog { Title = title, Filter = filter, InitialDirectory = start != null && Directory.Exists(start) ? start : "" })
                if (d.ShowDialog(this) == DialogResult.OK) done(Path.GetDirectoryName(d.FileName));
        }

        // ---------- checks ----------
        void CheckTools()
        {
            foreach (var r in new[] { rowEditor, rowGame, rowKey, rowCache }) r.Set(RowState.Checking, "checking…");
            string editor = settings.EditorDir, game = settings.GameDir;
            Task.Run(() =>
            {
                if (!GamePaths.IsEditorDir(editor)) editor = GamePaths.FindEditor();
                BeginInvoke((Action)(() =>
                {
                    editorOk = editor != null;
                    if (editorOk) { settings.EditorDir = editor; rowEditor.Set(RowState.Ok, "v" + GamePaths.EditorVersion(editor)); }
                    else rowEditor.Set(RowState.Missing, "not found");
                    cacheOk = editorOk && GamePaths.HasCache(editor);
                    rowCache.Set(cacheOk ? RowState.Ok : RowState.Missing, cacheOk ? "ready" : editorOk ? "open Madden once in MMC Editor" : "needs MMC Editor");
                }));
                if (!GamePaths.IsGameDir(game)) game = GamePaths.FindGame();
                BeginInvoke((Action)(() =>
                {
                    gameOk = game != null;
                    if (gameOk) { settings.GameDir = game; rowGame.Set(RowState.Ok, "found"); } else rowGame.Set(RowState.Missing, "not found");
                    settings.Save();
                }));
                string keyErr = editor == null ? "needs MMC Editor" : SafeKeyCheck(editor);
                BeginInvoke((Action)(() => { keyOk = keyErr == null; rowKey.Set(keyOk ? RowState.Ok : RowState.Missing, keyOk ? "from MMC" : keyErr); }));
            });
        }

        static string SafeKeyCheck(string editor)
        {
            try { return BuildRunner.KeyCheck(editor) == null ? null : "couldn't read it"; } catch { return "couldn't read it"; }
        }

        void RefreshFolders()
        {
            folderField.Set(BuildRunner.IsPlaybookDir(settings.PlaybookDir) ? settings.PlaybookDir : null);
            outField.Set(settings.OutputDir);
            foreach (var r in bookRows) { Controls.Remove(r); r.Dispose(); }
            bookRows.Clear();
            var books = BuildRunner.Playbooks(settings.PlaybookDir);
            if (books.Count == 0) bookRows.Add(new StatusRow { Label = "No playbooks yet", State = RowState.Pending, Value = "" });
            foreach (var b in books) bookRows.Add(new StatusRow { Label = b.Name, Value = b.Plays + (b.Plays == 1 ? " play" : " plays"), State = RowState.Item });
            Controls.AddRange(bookRows.ToArray());
            Relayout();
        }

        // ---------- build ----------
        async void StartBuild()
        {
            if (running) return;
            string problem = !editorOk ? "MMC Editor wasn't found. Click Locate… next to it and pick MMCEditor.exe."
                : !gameOk ? "Madden NFL 27 wasn't found. Click Locate… next to it and pick Madden27.exe."
                : !cacheOk ? "Open Madden once in MMC Editor and let it finish loading, then come back."
                : !keyOk ? "The game key couldn't be read from MMC Editor. Make sure it's the MMC Modding Tools editor for Madden 27."
                : !BuildRunner.IsPlaybookDir(settings.PlaybookDir) ? "Pick the folder containing your playbook mod first."
                : BuildRunner.Playbooks(settings.PlaybookDir).Count == 0 ? "There are no playbooks in that folder yet. Make one in Playbook Studio first."
                : string.IsNullOrEmpty(settings.OutputDir) ? "Pick where the mod files should go." : null;
            if (problem != null) { Say(problem); return; }

            running = true; runView = true; lastResult = null;
            foreach (var r in stepRows) r.Set(RowState.Pending, "");
            bar.Value = 0; bar.Error = false; showNotice = false;
            Relayout();
            var cfg = new BuildConfig { EditorDir = settings.EditorDir, GameDir = settings.GameDir, PlaybookDir = settings.PlaybookDir, OutputDir = settings.OutputDir };
            void Report(int i, StepState st, string detail) => BeginInvoke((Action)(() =>
            {
                var row = stepRows[i];
                row.Set(st == StepState.Running ? RowState.Running : st == StepState.Done ? RowState.Done : st == StepState.Failed ? RowState.Failed : RowState.Pending, detail);
                bar.Value = (i + (st == StepState.Done ? 1f : st == StepState.Running ? 0.4f : 0f)) / stepRows.Length;
                bar.Error = st == StepState.Failed;
                bar.Invalidate();
            }));
            try
            {
                lastResult = await Task.Run(() => new BuildRunner().Run(cfg, Report));
                notice.Error = false;
                notice.Title = "Installed " + string.Join(", ", lastResult.Installed);
                notice.Body = "Next, in MMC Mod Manager: add or refresh pbstudio.fbmod, Apply, then Launch.";
                showFiles.Text = "Show files";
            }
            catch (Exception ex)
            {
                notice.Error = true;
                notice.Title = "Build failed";
                notice.Body = (ex is AggregateException ae ? ae.InnerException : ex).Message;
                showFiles.Text = "Show log";
            }
            running = false;
            showNotice = true;
            Relayout();
        }

        // ---------- layout ----------
        void Relayout()
        {
            S = DeviceDpi / 96f;
            int P(float v) => (int)Math.Round(v * S);
            Font body = Theme.Body(13 * S), small = Theme.Light(12 * S), strong = Theme.Strong(14 * S);
            title.Font = Theme.Strong(19 * S); title.ForeColor = Theme.Ink;
            subtitle.Font = small; subtitle.ForeColor = Theme.Muted;
            foreach (var l in new[] { toolsLabel, folderLabel, outLabel, buildLabel }) { l.Font = Theme.Light(11.5f * S); l.ForeColor = Theme.Muted; }
            caption.Font = Theme.Light(11.5f * S); caption.ForeColor = Theme.Muted;
            foreach (Control c in Controls) if (c is StatusRow r) { r.Font = body; r.ValueFont = small; }
            foreach (var p in new[] { folderField, outField }) p.Font = Theme.Body(12 * S);
            foreach (var b in new[] { folderChange, outChange, showFiles, back }) b.Font = Theme.Body(12.5f * S);
            build.Font = again.Font = strong;
            notice.Font = Theme.Body(12.5f * S); notice.TitleFont = Theme.Strong(13.5f * S);

            int x = P(Pad), w = P(ContentW), y = P(18);
            void Put(Control c, int h, int gap = 0, int width = -1, int left = -1) { c.Bounds = new Rectangle(left < 0 ? x : left, y, width < 0 ? w : width, h); c.Visible = true; y += h + gap; }
            Put(title, P(26)); Put(subtitle, P(18), P(16));

            var setup = new Control[] { toolsLabel, rowEditor, rowGame, rowKey, rowCache, folderLabel, folderField, folderChange, outLabel, outField, outChange, buildLabel, build, caption }.Concat(bookRows).ToList();
            var run = new Control[] { bar, notice, again, showFiles, back }.Concat(stepRows).ToList();
            foreach (var c in setup.Concat(run)) c.Visible = false;

            if (!runView)
            {
                Put(toolsLabel, P(16), P(2));
                foreach (var r in new[] { rowEditor, rowGame, rowKey, rowCache }) Put(r, P(25));
                y += P(12);
                int bw = P(70), fh = P(30);
                Put(folderLabel, P(16), P(4));
                folderChange.Bounds = new Rectangle(x + w - bw, y, bw, fh); folderChange.Visible = true; Put(folderField, fh, P(12), w - bw - P(6));
                Put(outLabel, P(16), P(4));
                outChange.Bounds = new Rectangle(x + w - bw, y, bw, fh); outChange.Visible = true; Put(outField, fh, P(12), w - bw - P(6));
                Put(buildLabel, P(16), P(2));
                foreach (var r in bookRows) Put(r, P(25));
                y += P(16);
                Put(build, P(44), P(8));
                Put(caption, P(16), P(16));
            }
            else
            {
                foreach (var r in stepRows) Put(r, P(26));
                y += P(10);
                Put(bar, P(5), P(14));
                if (showNotice && !running)
                {
                    notice.Bounds = new Rectangle(x, y, w, 10);
                    Put(notice, notice.Measure(w), P(14));
                    int half = (w - P(8)) / 2;
                    showFiles.Bounds = new Rectangle(x, y, half, P(32)); showFiles.Visible = true;
                    back.Bounds = new Rectangle(x + half + P(8), y, w - half - P(8), P(32)); back.Visible = true;
                    y += P(32) + P(8);
                    Put(again, P(44), P(18));
                }
                else
                {
                    caption.Text = "This takes about a minute. Keep Madden closed.";
                    Put(caption, P(16), P(18));
                }
            }
            if (!running) caption.Text = runView ? caption.Text : "Close Madden first";
            ClientSize = new Size(P(ContentW + Pad * 2), y);
            Invalidate(true);
        }

        static Icon MakeIcon()
        {
            using (var bmp = new Bitmap(64, 64))
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using (var path = Theme.Round(new RectangleF(2, 2, 60, 60), 14)) using (var b = new SolidBrush(Theme.Accent)) g.FillPath(b, path);
                using (var b = new SolidBrush(Color.White)) g.FillEllipse(b, 13, 21, 38, 22);
                using (var p = new Pen(Theme.Accent, 2.5f)) { g.DrawLine(p, 24, 32, 40, 32); for (int i = 0; i < 4; i++) g.DrawLine(p, 27 + i * 3.5f, 29, 27 + i * 3.5f, 35); }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }
    }
}
