using System.Collections.Generic;
using Frosty.Core;
using Frosty.Core.Managers;
using FrostySdk;
using FrostySdk.Interfaces;
using FrostySdk.Managers;

namespace PlayDump
{
    // Kept in its own class so FrostyCore.dll is only loaded by commands that write projects.
    internal static class EditorGlobals
    {
        public static IEnumerable<Profile> Profiles => App.PluginManager.Profiles;

        public static void Start(ILogger log)
        {
            App.Logger = log;
            App.PluginManager = new PluginManager(log, PluginManagerType.Editor);
            Config.Load(); // reads %LOCALAPPDATA%\MMC\editor_config.json based on the manager type

        }

        public static void Attach(FileSystemManager fs, ResourceManager rm, AssetManager am)
        {
            App.FileSystemManager = fs;
            App.ResourceManager = rm;
            App.AssetManager = am;
            App.PluginManager.Initialize();
            // Same as FrostyProfileTaskWindow for Madden 22-27: legacy (non-EBX) files come from LegacyFileManagerV2.
            am.RegisterCustomAssetManager("legacy", typeof(Frosty.Core.Legacy.LegacyFileManagerV2));
        }
    }
}
