using System;
using System.Windows.Forms;

namespace PlaybookBuilder
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            // --save <spec.json> <template> <out> <indexDir> <pullFile>: write one save without the window (parity tests)
            if (args.Length == 6 && args[0] == "--save")
            {
                Console.WriteLine(new PbookWriter(args[4]).Build(args[1], args[2], args[3], args[5], false, Console.WriteLine));
                return 0;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(true);
            Theme.Load();
            // --shot <out.png> [setup|running|done|error]: render the window to an image (visual checks)
            if (args.Length >= 2 && args[0] == "--shot")
            {
                var f = new MainForm { ShotFile = args[1], ShotState = args.Length > 2 ? args[2] : "setup" };
                Application.Run(f);
                return 0;
            }
            Application.Run(new MainForm());
            return 0;
        }
    }
}
